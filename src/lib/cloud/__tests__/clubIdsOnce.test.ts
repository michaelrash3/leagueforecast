import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { auditLeague } from "../../leagueFindings";
import { NO_LEAGUE_DOCS } from "../../live/cloudLeague";
import type { PoolCommand } from "../../live/commands";
import { runEdit } from "../../live/editRun";
import { createEditPool, type EditPool } from "../../live/poolCache";
import { leagueScoutBridge, type LeagueTeamLink, type ScoutTeam } from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGames,
  loadScoutTeams,
  resetTeamRankingsStore,
} from "../../teamRankingsStorage";
import { DEFAULT_SETTINGS } from "../../types";
import { commitChanges } from "../cloudEngine";
import { LEAGUE_PART } from "../cloudPlan";
import { loadPoolFrom, memoryIo, runCloudPull } from "../cloudRunner";
import { memoryCloud, type MemoryCloud } from "./memoryCloud";

/*
 * A club's id is never handed out twice on the cloud copy (sweep item 4): a club folded or deleted
 * gave its id to the next club whose name started the same, and a League Standings team that had
 * picked the club went with the id, carrying its league's games onto the new club's record and the
 * new club's results into its forecast. And a pick kept with the GameChanger id of its club follows
 * that club where Team Rankings is started again and every id is minted afresh. Each step is the
 * server's own: the pull (`runCloudPull`), the owner's edits and Start again (`runEdit`).
 * Placeholder names throughout.
 */

const backing = new Map<string, string>();
beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});
let pool: EditPool | null = null;
afterEach(async () => {
  await pool?.drop();
  pool = null;
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

const RAYS = "gcRAYS000001";
const GOLD = "gcRAYSGOLD01";
const OWLS = "gcOWLS000001";
const ROBINS = "gcROBINS0001";

const game = (id: string, opponentName: string, day: string, own: number, theirs: number) =>
  ({
    id,
    date: `2026-09-${day}`,
    startTs: `2026-09-${day}T15:00:00.000Z`,
    opponentName,
    status: "completed",
    teamScore: own,
    opponentScore: theirs,
  }) satisfies GcGame;
const schedule = (id: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `${name} 9U`,
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state: "OH",
    city: "Cincinnati",
  },
  games,
  fetchedAt: "2026-09-29T07:20:00.000Z",
});

/** Riverside Rays, Riverside Rays Gold and Oak Hill Owls, each with a game against the Comets. */
const FIRST: GcTeamSchedule[] = [
  schedule(RAYS, "Riverside Rays", [game("r1", "Comets", "12", 3, 2)]),
  schedule(GOLD, "Riverside Rays Gold", [game("g1", "Comets", "13", 4, 1)]),
  schedule(OWLS, "Oak Hill Owls", [game("o1", "Comets", "14", 2, 6)]),
];
/** The Owls again, now with a game against a club nobody has pulled. */
const OWLS_AGAIN = schedule(OWLS, "Oak Hill Owls", [
  game("o1", "Comets", "14", 2, 6),
  game("o2", "Riverbend Robins", "20", 0, 15),
]);

/** A copy with nothing in it yet, as a new one is. */
const emptyCopy = async (): Promise<MemoryCloud> => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [{ key: LEAGUE_PART, value: { seasons: [] }, at: 1 }],
    device: "phone",
    now: "2026-09-28T12:00:00.000Z",
  });
  if (!saved.ok) throw new Error("seed");
  return cloud;
};

/** A pull of `schedules`, in their order, as a catch-up asks for every one. */
const pull = async (cloud: MemoryCloud, schedules: GcTeamSchedule[], at: string) => {
  const byId = new Map(schedules.map((one) => [one.profile.id, one]));
  const done = await runCloudPull(
    {
      kind: "list",
      entries: schedules.map((one) => ({ teamId: one.profile.id })),
      seasonYears: [2027],
      refresh: true,
    },
    {
      store: cloud.store,
      now: () => new Date(at),
      device: "cloud-pull",
      fetchTeams: async (ids: string[], options: FetchGcTeamsOptions) => {
        const answers = new Map<string, GcTeamResponse>();
        ids.forEach((teamId, done) => {
          const found = byId.get(teamId);
          const result: GcTeamResponse = found
            ? { ok: true, schedule: found }
            : { ok: false, reason: "not-found", message: "No such team." };
          answers.set(teamId, result);
          options.onProgress?.({ done: done + 1, total: ids.length, teamId, result, attempts: 1 });
        });
        return answers;
      },
    }
  );
  if (done.end !== "finished") throw new Error(`pull: ${done.end}`);
};

/** An edit the owner makes on the copy, run as the edit function runs it. */
const edit = async (cloud: MemoryCloud, command: PoolCommand) => {
  pool = createEditPool();
  const done = await runEdit({
    pool,
    store: cloud.store,
    leagueDocs: NO_LEAGUE_DOCS,
    command,
    now: () => "2026-09-29T13:00:00.000Z",
  });
  await pool.drop();
  pool = null;
  if (!done.ok) throw new Error(`edit: ${done.why}`);
};

/** The copy's pool as a device opening it would read it. */
const reopen = async (cloud: MemoryCloud) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  if (!(await loadPoolFrom(cloud.store))) throw new Error("no copy");
};

const clubNamed = (name: string): ScoutTeam => {
  const club = loadScoutTeams().find((team) => team.name === name);
  if (!club) throw new Error(`no ${name}`);
  return club;
};

/** The League Standings team "Rays" and its pick, read by the bridge off the copy's pool. */
const bridgeOf = (pick: LeagueTeamLink) =>
  leagueScoutBridge(
    "season-x",
    // The page claims the season, as Setup's League seasons card would have it.
    loadAgeGroups().map((group) => ({ ...group, seasonIds: ["season-x"] })),
    loadScoutTeams(),
    loadScoutGames(),
    [pick],
    []
  );
const ofRays = (results: ReturnType<typeof bridgeOf>["results"]) =>
  results.filter((result) => result.home === "RAYS" || result.away === "RAYS");

describe("a club's id let go of on the cloud copy", () => {
  it("is not minted again after a fold, so a League pick of the folded club reaches no other", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, FIRST, "2026-09-29T12:00:00.000Z");
    await reopen(cloud);
    expect(
      ["Riverside Rays", "Riverside Rays Gold", "Oak Hill Owls"].map((name) => clubNamed(name).id)
    ).toEqual(["S-RIVE", "S-RIVE2", "S-OAKH"]);
    // The owner keeps the pairing: the Gold squad is folded into the Rays.
    await edit(cloud, { kind: "teams.merge", fromId: "S-RIVE2", intoId: "S-RIVE", adopt: [] });
    await pull(cloud, [OWLS_AGAIN], "2026-09-30T12:00:00.000Z");
    await reopen(cloud);
    expect(loadScoutTeams().some((team) => team.id === "S-RIVE2")).toBe(false);
    // The next club of the Gold's letters takes the next id, never the Gold's.
    expect(clubNamed("Riverbend Robins").id).toBe("S-RIVE3");
    // The Rays' League team picked the Gold: a club gone, said so, and the Robins' 15-0 is theirs.
    const bridge = bridgeOf({ id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE2" });
    expect(bridge.rows[0]).toMatchObject({ how: "none", staleScoutTeamId: "S-RIVE2" });
    expect(ofRays(bridge.results)).toEqual([]);
  });

  it("is not minted again after the club is deleted", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, FIRST, "2026-09-29T12:00:00.000Z");
    await edit(cloud, { kind: "club.drop", teamId: "S-RIVE2" });
    await pull(cloud, [OWLS_AGAIN], "2026-09-30T12:00:00.000Z");
    await reopen(cloud);
    expect(clubNamed("Riverbend Robins").id).toBe("S-RIVE3");
    expect(ofRays(bridgeOf({ id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE2" }).results)).toEqual(
      []
    );
  });

  it("is not minted again for a game added by its clubs' names on the live page", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, FIRST, "2026-09-29T12:00:00.000Z");
    await edit(cloud, { kind: "teams.merge", fromId: "S-RIVE2", intoId: "S-RIVE", adopt: [] });
    await reopen(cloud);
    const page = loadAgeGroups()[0]?.id ?? "";
    await edit(cloud, {
      kind: "game.import",
      year: 2027,
      page,
      games: [
        {
          id: "t1",
          teamA: "Riverbend Robins",
          teamB: "Oak Hill Owls",
          teamAScore: 15,
          teamBScore: 0,
        },
      ],
    });
    await reopen(cloud);
    expect(clubNamed("Riverbend Robins").id).toBe("S-RIVE3");
  });

  it("is not minted again for a club League Standings made, which a game added by name adopts", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, FIRST, "2026-09-29T12:00:00.000Z");
    await edit(cloud, { kind: "teams.merge", fromId: "S-RIVE2", intoId: "S-RIVE", adopt: [] });
    await reopen(cloud);
    const page = loadAgeGroups()[0];
    if (!page) throw new Error("no page");
    // A league on the page whose Riverview Rockets nobody has pulled: a club the page makes for
    // them from the roster each time it is read, which a game added by name puts in the roster.
    const league = {
      seasons: [
        {
          id: "season-x",
          name: "Fall league",
          createdAt: "2026-08-01T12:00:00.000Z",
          teams: [
            { id: "RV", name: "Riverview Rockets" },
            { id: "OW", name: "Oak Hill Owls" },
          ],
          matchups: [{ id: "m1", date: "9/27", away: "RV", home: "OW" }],
          logs: {},
          bracketLogs: {},
          settings: DEFAULT_SETTINGS,
        },
      ],
    };
    const leagued = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value: league, at: 2 }],
      device: "phone",
      now: "2026-09-29T12:30:00.000Z",
    });
    if (!leagued.ok) throw new Error("not saved");
    await edit(cloud, { kind: "group.put", group: { ...page, seasonIds: ["season-x"] } });
    await edit(cloud, {
      kind: "game.import",
      year: 2027,
      page: page.id,
      games: [{ id: "t1", teamA: "Riverview Rockets", teamB: "Oak Hill Owls" }],
    });
    await reopen(cloud);
    expect(clubNamed("Riverview Rockets").id).toBe("S-RIVE3");
  });
});

describe("a League pick made before the GameChanger id was kept, after Team Rankings is started again", () => {
  /** League Standings, kept in the copy, with one season whose Rays were picked as `S-RIVE`. */
  const keepLeague = async (
    cloud: MemoryCloud,
    teams: { id: string; name: string; scoutTeamId?: string }[] = [
      { id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE" },
      { id: "OW", name: "Oak Hill Owls" },
    ]
  ) => {
    const league = {
      seasons: [
        {
          id: "season-x",
          name: "Fall league",
          createdAt: "2026-08-01T12:00:00.000Z",
          teams,
          matchups: [],
          logs: {},
          bracketLogs: {},
          settings: DEFAULT_SETTINGS,
        },
      ],
    };
    const kept = await commitChanges({
      store: cloud.store,
      base: cloud.manifest(),
      changes: [{ key: LEAGUE_PART, value: league, at: 2 }],
      device: "phone",
      now: "2026-09-29T12:30:00.000Z",
    });
    if (!kept.ok) throw new Error("not saved");
  };

  it("names no other club: the pull, its tidy and a game added by name each hold its id", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, [FIRST[0]!, FIRST[2]!], "2026-09-29T12:00:00.000Z");
    await keepLeague(cloud);
    // Start again, which empties Team Rankings, every id it minted and its high-water with it.
    await edit(cloud, { kind: "copy.reset" });
    // The Robins pulled first: with the roster empty, they would be S-RIVE, the pick's id.
    const robins = schedule(ROBINS, "Riverbend Robins", [game("b1", "Comets", "15", 12, 1)]);
    await pull(cloud, [robins, FIRST[2]!], "2026-09-30T12:00:00.000Z");
    await reopen(cloud);
    expect(clubNamed("Riverbend Robins").id).toBe("S-RIVE2");
    expect(loadScoutTeams().some((team) => team.id === "S-RIVE")).toBe(false);
    // The pick names a club gone, and is told so; the Robins' 12-1 is theirs alone.
    const gone = bridgeOf({ id: "RAYS", name: "Rays", scoutTeamId: "S-RIVE" });
    expect(gone.rows[0]).toMatchObject({ how: "none", staleScoutTeamId: "S-RIVE" });
    expect(ofRays(gone.results)).toEqual([]);
    // Nor does a club typed in on the live page take it.
    const page = loadAgeGroups()[0]?.id ?? "";
    await edit(cloud, {
      kind: "game.import",
      year: 2027,
      page,
      games: [{ id: "t1", teamA: "Riverview Rockets", teamB: "Oak Hill Owls" }],
    });
    await reopen(cloud);
    expect(clubNamed("Riverview Rockets").id).toBe("S-RIVE3");
  });

  it("is held by the pull's tidy, which keeps a page that is no team's games on slots", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, [FIRST[2]!], "2026-09-29T12:00:00.000Z");
    // The Hornets picked as `S-HOLL2`, a club the roster no longer holds.
    await keepLeague(cloud, [{ id: "HH", name: "Hornets", scoutTeamId: "S-HOLL2" }]);
    // Two of the Owls' games against an old page of the Hornets marked do not use, on the copy.
    await reopen(cloud);
    const page = loadAgeGroups()[0]?.id ?? "";
    const oldPage: ScoutTeam = { id: "S-HOLL", name: "Hollowmere Hornets DNU", nameOnly: true };
    const row = (id: string, day: string) => ({
      id,
      ageGroupId: page,
      teamAId: "S-OAKH",
      teamBId: oldPage.id,
      teamAScore: 6,
      teamBScore: 2,
      date: `2026-09-${day}`,
      source: { kind: "gamechanger" as const, teamId: OWLS, gameId: id },
    });
    await edit(cloud, {
      kind: "game.add",
      year: 2027,
      games: [row("h1", "16"), row("h2", "23")],
      adopt: [oldPage],
    });
    // The next pull's tidy takes the page off, and keeps each game against a slot of its name.
    await pull(cloud, [FIRST[0]!], "2026-09-30T12:00:00.000Z");
    await reopen(cloud);
    const hornets = loadScoutTeams().filter((team) => team.id.startsWith("S-HOLL"));
    expect(hornets.filter((team) => team.placeholder)).toHaveLength(2);
    expect(hornets.map((team) => team.id)).not.toContain("S-HOLL2");
  });
});

describe("a League pick kept with its club's GameChanger id, after Team Rankings is started again", () => {
  /** The Rays' League team, picked as the Rays while the pool called them S-RIVE. */
  const PICK: LeagueTeamLink = {
    id: "RAYS",
    name: "Rays",
    scoutTeamId: "S-RIVE",
    scoutGcTeamId: RAYS,
  };

  it("reaches no other club under its id, and follows the club to the id it has now", async () => {
    const cloud = await emptyCopy();
    await pull(cloud, [FIRST[0]!, FIRST[2]!], "2026-09-29T12:00:00.000Z");
    await reopen(cloud);
    expect(clubNamed("Riverside Rays").id).toBe("S-RIVE");
    // Start again, which empties Team Rankings and with it every id it had minted.
    await edit(cloud, { kind: "copy.reset" });
    // Pulled again in another order: the Robins first, so the Robins are S-RIVE now.
    const robins = schedule(ROBINS, "Riverbend Robins", [game("b1", "Comets", "15", 12, 1)]);
    await pull(cloud, [robins, FIRST[2]!], "2026-09-30T12:00:00.000Z");
    await reopen(cloud);
    expect(clubNamed("Riverbend Robins").id).toBe("S-RIVE");
    // The Rays not pulled again yet: the pick is said to have moved, and the Robins' 12-1 is theirs.
    const moved = bridgeOf(PICK);
    expect(moved.rows[0]).toMatchObject({ how: "none", movedScoutTeamId: "S-RIVE" });
    expect(ofRays(moved.results)).toEqual([]);
    const findings = auditLeague({
      teams: [{ id: "RAYS", name: "Rays" }],
      matchups: [],
      logs: {},
      settings: DEFAULT_SETTINGS,
      today: new Date(2026, 9, 1),
      links: moved.rows,
    });
    expect(findings.find((finding) => finding.code === "link-moved")?.targets).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "RAYS" })])
    );
    // Pulled again: the Rays are S-RIVE2, and the pick is theirs, their 3-2 the league team's.
    await pull(cloud, [FIRST[0]!], "2026-10-01T12:00:00.000Z");
    await reopen(cloud);
    expect(clubNamed("Riverside Rays").id).toBe("S-RIVE2");
    const followed = bridgeOf(PICK);
    expect(followed.rows[0]).toMatchObject({
      how: "picked",
      scoutTeamId: "S-RIVE2",
      suggestedName: "Riverside Rays",
    });
    expect(ofRays(followed.results).map((result) => Math.abs(result.homeMargin))).toEqual([1]);
  });
});
