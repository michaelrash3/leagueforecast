import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseGcTeamList,
  type GcGame,
  type GcTeamResponse,
  type GcTeamSchedule,
} from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { localDayKey } from "../../gameChangerSchedule";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadAutoRemoved,
  loadDroppedClubs,
  loadRefreshLog,
  loadRefusedClubs,
  loadScoutGames,
  loadAgeUnknown,
  loadScoutTeams,
  loadTidyStamp,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveAgeUnknown,
  saveDroppedClubs,
  saveKeptApart,
  saveRefreshCadence,
  saveRealClubs,
  saveRefreshLog,
  saveRefusedClubs,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
  saveTooYoungClubs,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { DATA_SCHEMA, epochOf } from "../cloudManifest";
import { LEAGUE_PART } from "../cloudPlan";
import type { CloudManifest } from "../cloudManifest";
import {
  loadPoolFrom,
  memoryIo,
  runCloudPull,
  selectImportTeams,
  finishStagedImport,
  workOutRefresh,
  type CloudPullDeps,
  type CloudPullJob,
} from "../cloudRunner";
import { memoryCloud, type MemoryCloud } from "./memoryCloud";
import { NO_LEAGUE_DOCS } from "../../live/cloudLeague";
import { docsOf, listing } from "../../live/__tests__/leagueDocsFixture";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS, type TeamBase } from "../../types";
import type { AgeGroup, ScoutTeam } from "../../teamRankings";
import { runEdit } from "../../live/editRun";

/*
 * A pull run on the cloud copy (`runCloudPull`): it files what GameChanger answers into the copy's
 * pool as a pull in the browser would, and sends back the values that changed and nothing else —
 * never League Standings, never a value it did not change, and never over another device's save.
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
afterEach(() => {
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

const game = (
  id: string,
  opponentName: string,
  teamScore: number,
  opponentScore: number
): GcGame => ({
  id,
  date: "2026-09-20",
  startTs: "2026-09-20T15:00:00.000Z",
  opponentName,
  status: "completed",
  teamScore,
  opponentScore,
});
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
const ACES = "gcACES000001";
const BEARS = "gcBEARS00001";
/** A schedule every result of which is on a day that has not happened: invented. */
const AHEAD = "gcAHEAD00001";
/** A squad whose GameChanger name reads as a tryout, which only the owner's word lets in. */
const WORKOUTS = "gcWEXCO00001";
/** A club whose schedule names that squad, by its GameChanger name. */
const QUAILS = "gcQUILL00001";
const schedules = new Map<string, GcTeamSchedule>([
  [ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)])],
  [BEARS, schedule(BEARS, "Bears", [game("b1", "Aces", 3, 5)])],
  [WORKOUTS, schedule(WORKOUTS, "Wexcombe Workouts", [game("w1", "Bears", 4, 1)])],
  [QUAILS, schedule(QUAILS, "Quillfeather Quails", [game("q1", "Wexcombe Workouts 9U", 6, 2)])],
  [
    AHEAD,
    schedule(AHEAD, "Ahead", [
      { ...game("f1", "Aces", 9, 0), date: "2020-06-01", startTs: "2020-06-01T15:00:00.000Z" },
    ]),
  ],
]);

/** Answers from the schedules above, as `fetchGcTeams` gives them, each told as it comes. */
const answering =
  (before?: () => Promise<void>): CloudPullDeps["fetchTeams"] =>
  async (ids: string[], options: FetchGcTeamsOptions) => {
    await before?.();
    const answers = new Map<string, GcTeamResponse>();
    ids.forEach((teamId, at) => {
      const found = schedules.get(teamId);
      const result: GcTeamResponse = found
        ? { ok: true, schedule: found }
        : { ok: false, reason: "not-found", message: "No such team." };
      answers.set(teamId, result);
      options.onProgress?.({ done: at + 1, total: ids.length, teamId, result, attempts: 1 });
    });
    return answers;
  };

const LEAGUE = { seasons: ["the league's own"] };

/**
 * A cloud copy saved by a phone: whatever `write` puts in its pool, and a League Standings part
 * nothing here may write (`league`, by default one no build reads as seasons).
 */
const seed = async (
  cloud: MemoryCloud,
  write: () => void = () => undefined,
  league: unknown = LEAGUE
) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveKeptApart(new Set(["gcX|gcY"]));
  write();
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  changes.push({ key: LEAGUE_PART, value: league, at: 1 });
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes,
    device: "phone",
    now: "2026-09-28T12:00:00.000Z",
  });
  if (!saved.ok) throw new Error("seed");
  resetTeamRankingsStore();
  return saved.manifest;
};

const deps = (
  cloud: MemoryCloud,
  at: string,
  extra: Partial<CloudPullDeps> = {}
): CloudPullDeps => ({
  store: cloud.store,
  fetchTeams: answering(),
  now: () => new Date(at),
  device: "cloud-pull",
  ...extra,
});

const list = {
  kind: "list",
  entries: [{ teamId: ACES }, { teamId: BEARS }],
  seasonYears: [2027],
} as const;

/**
 * The owner's Start again, as the edit function makes it (`runEdit`'s `copy.reset`): every Team
 * Rankings part out of the copy, under the same copy id, and the manifest it leaves.
 */
const startAgain = async (cloud: MemoryCloud): Promise<CloudManifest> => {
  const done = await runEdit({
    store: cloud.store,
    leagueDocs: NO_LEAGUE_DOCS,
    command: { kind: "copy.reset" },
    now: () => "2026-09-29T13:00:30.000Z",
  });
  if (!done.ok) throw new Error(`start again: ${done.why}`);
  return cloud.manifest()!;
};

describe("a pull run on the cloud copy", () => {
  it("reconsiders an unaged club after all its opponents arrive, before the single final tidy", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const unknown = schedule("gcUNAGED0001", "Unaged", [
      game("u1", "Alpha", 3, 2),
      { ...game("u2", "Bravo", 3, 2), date: "2026-09-21" },
      { ...game("u3", "Charlie", 3, 2), date: "2026-09-22" },
    ]);
    unknown.profile.name = "Unaged";
    delete unknown.profile.ageLevel;
    const anchors = ["Alpha", "Bravo", "Charlie"].map((name, n) =>
      schedule(`gcANCHOR000${n}`, name, [
        { ...game(`a${n}`, "Unaged", 2, 3), date: `2026-09-${20 + n}` },
      ])
    );
    let tidies = 0;
    const selections: (string[] | undefined)[] = [];
    let consumed = 0;
    const source = (ids?: ReadonlySet<string>) =>
      (async function* () {
        selections.push(ids ? [...ids] : undefined);
        for (const schedule of [unknown, ...anchors]) {
          if (ids && !ids.has(schedule.profile.id)) continue;
          consumed++;
          yield schedule;
        }
      })();
    const result = await finishStagedImport(
      {
        kind: "list",
        entries: [unknown, ...anchors].map((s) => ({ teamId: s.profile.id })),
        seasonYears: [2027],
      },
      source,
      epochOf(base),
      { asked: 4, answered: 4, failed: 0 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00Z"),
        device: "test",
        beforeTidy: async () => {
          tidies++;
        },
      }
    );
    expect(result.filed).toBe(4);
    expect(
      loadScoutTeams().some((t) => t.gcTeams?.some((link) => link.teamId === unknown.profile.id))
    ).toBe(true);
    expect(tidies).toBe(1);
    expect(selections).toEqual([undefined]);
    expect(consumed).toBe(4);
  });
  it("rereads only uncached unresolved teams when an import exceeds the age cache", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const unknown = Array.from({ length: 2001 }, (_, n) => {
      const letters = [Math.floor(n / 676), Math.floor(n / 26) % 26, n % 26]
        .map((letter) => String.fromCharCode(65 + letter))
        .join("");
      const team = schedule(`gc${String(n).padStart(10, "0")}`, `Unaged Club ${letters}`, [
        game(`u${n}`, "Unknown rival", 3, 2),
      ]);
      team.profile.name = `Unaged Club ${letters}`;
      delete team.profile.ageLevel;
      return team;
    });
    const selections: (string[] | undefined)[] = [];
    const source = (ids?: ReadonlySet<string>) =>
      (async function* () {
        selections.push(ids ? [...ids] : undefined);
        for (const team of unknown) if (!ids || ids.has(team.profile.id)) yield team;
      })();
    let tidies = 0;
    const result = await finishStagedImport(
      {
        kind: "list",
        entries: unknown.map((team) => ({ teamId: team.profile.id })),
        seasonYears: [2027],
      },
      source,
      epochOf(base),
      { asked: 2001, answered: 2001, failed: 0 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00Z"),
        device: "test",
        beforeTidy: async () => {
          tidies++;
        },
      }
    );
    expect(result.end).toBe("finished");
    expect(result.filed).toBe(0);
    expect(selections).toEqual([undefined, [unknown[2000]!.profile.id]]);
    expect(tidies).toBe(1);
  });
  it("selects from the team index without downloading games, in a stable import order", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () =>
      saveScoutGames([
        {
          id: "untouched",
          teamAId: "x",
          teamBId: "y",
          ageGroupId: "9",
          date: "2026-09-20",
          teamAScore: 1,
          teamBScore: 2,
        },
      ])
    );
    const chunkReads = vi.spyOn(cloud.store, "getChunk");
    const selected = await selectImportTeams(cloud.store, {
      ...list,
      entries: [...list.entries].reverse(),
    });
    expect(selected.entries.map((e) => e.teamId)).toEqual(
      [...list.entries].map((e) => e.teamId).sort()
    );
    const gameParts = cloud.manifest()!.parts.filter((p) => p.key.includes("scout_games"));
    for (const part of gameParts)
      expect(chunkReads.mock.calls.every(([id]) => !id.startsWith(part.id))).toBe(true);
  });

  it("streams the entire downloaded set through one final tidy and one save, without fetching teams again", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const commit = vi.spyOn(cloud.store, "commitManifest");
    let tidyCalls = 0;
    let consumed = 0;
    const source = () =>
      (async function* () {
        consumed++;
        yield schedules.get(ACES)!;
        consumed++;
        yield schedules.get(BEARS)!;
      })();
    const result = await finishStagedImport(
      list,
      source,
      epochOf(base),
      { asked: 2, answered: 2, failed: 0 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00.000Z"),
        device: "import-test",
        beforeTidy: async () => {
          tidyCalls++;
          expect(consumed).toBe(2);
        },
      }
    );
    expect(result.end).toBe("finished");
    expect(result.filed).toBe(2);
    expect(tidyCalls).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(loadScoutGames()).toHaveLength(1);
    expect(loadTidyStamp()).toBeTruthy();
  });
  it("files a pasted list into the copy and sends only the values it changed", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const result = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(result).toMatchObject({ end: "finished", asked: 2, answered: 2, failed: 0, filed: 2 });
    expect(result.version).toBe(before.version + 1);
    // The copy the store in memory now is: what was just saved.
    expect(result.manifest).toEqual(cloud.manifest());

    const after = cloud.manifest()!;
    const part = (key: string) => after.parts.find((entry) => entry.key === key);
    // League Standings and a pool value the pull did not change are the phone's still.
    expect(part(LEAGUE_PART)).toEqual(before.parts.find((entry) => entry.key === LEAGUE_PART));
    const kept = before.parts.find((entry) => entry.key === "league_forecast_gc_apart_v1")!;
    expect(part(kept.key)).toEqual(kept);
    expect(result.changed).not.toContain(LEAGUE_PART);
    expect(result.changed).not.toContain(kept.key);
    result.changed.forEach((key) => expect(part(key)?.by).toBe("cloud-pull"));

    // And the copy now holds the two clubs and their one game, tidied and stamped.
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(
      loadScoutTeams().flatMap((team) => team.gcTeams?.map((link) => link.teamId) ?? [])
    ).toEqual(expect.arrayContaining([ACES, BEARS]));
    expect(loadScoutGames()).toHaveLength(1);
    expect(loadTidyStamp()).toMatch(/^r\d+\|/);
  });

  it("pulls a paste's teams the pool lacks, a catch-up's every one, and none refused or too young", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    await runCloudPull(
      { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] },
      deps(cloud, "2026-09-29T13:00:00.000Z")
    );
    // A paste with one team the pool has and one it lacks asks only for the one it lacks.
    const paste = await runCloudPull(list, deps(cloud, "2026-09-29T14:00:00.000Z"));
    expect(paste.asked).toBe(1);
    // Past a handful, a paste asks only for what the pool lacks, and a catch-up for every one.
    const many = {
      ...list,
      entries: [
        ...list.entries,
        ...Array.from({ length: 24 }, (_, at) => ({
          teamId: `gcNONE${String(at).padStart(6, "0")}`,
        })),
      ],
    };
    expect((await runCloudPull(many, deps(cloud, "2026-09-29T15:00:00.000Z"))).asked).toBe(24);
    const catchUp = await runCloudPull(
      { ...many, refresh: true },
      deps(cloud, "2026-09-29T16:00:00.000Z")
    );
    expect(catchUp.asked).toBe(26);
    // Refused for good, or too young to rank, costs no request, as on the device.
    const refused = memoryCloud();
    await seed(refused, () => {
      saveRefusedClubs({ forGood: new Set([ACES]), bySeason: new Map() });
      saveTooYoungClubs(new Set([BEARS]));
    });
    const none = await runCloudPull(
      { ...list, refresh: true },
      deps(refused, "2026-09-29T13:00:00.000Z")
    );
    expect(none).toMatchObject({ asked: 0, end: "nothing-due" });
  });

  /*
   * A pasted list's slugs and names, which GameChanger answers with HTTP 400 (`invalid-id`), were
   * asked about again on every paste of the list. Remembered with the clubs refused for good, a
   * paste asks about them once.
   */
  it("remembers the ids GameChanger said are not team ids, so a paste does not ask again", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const slug = "bears-baseball-10u";
    const asked: string[][] = [];
    const fetchTeams: CloudPullDeps["fetchTeams"] = async (ids, options) => {
      asked.push([...ids]);
      const answers = new Map<string, GcTeamResponse>();
      for (const teamId of ids) {
        const found = schedules.get(teamId);
        const result: GcTeamResponse = found
          ? { ok: true, schedule: found }
          : { ok: false, reason: "invalid-id", message: "Not a team id." };
        answers.set(teamId, result);
        options.onProgress?.({ done: 1, total: ids.length, teamId, result, attempts: 1 });
      }
      return answers;
    };
    const paste = { kind: "list", entries: [{ teamId: ACES }, { teamId: slug }], seasonYears: [] };
    const first = await runCloudPull(
      paste as CloudPullJob,
      deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams })
    );
    expect(first).toMatchObject({ asked: 2, answered: 1, failed: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadRefusedClubs().forGood]).toEqual([slug]);
    // Pasted again: the slug costs no request; the one club, a handful, is read again.
    await runCloudPull(
      paste as CloudPullJob,
      deps(cloud, "2026-09-29T14:00:00.000Z", { fetchTeams })
    );
    expect(asked).toEqual([[ACES, slug], [ACES]]);
  });

  it("remembers none when every id came back invalid, as a route answering all with 400 would", async () => {
    // GameChanger changing its route, or the proxy breaking, answers every id with HTTP 400 alike:
    // remembered, every real club in the run would be skipped by every later paste.
    const cloud = memoryCloud();
    await seed(cloud);
    const fetchTeams: CloudPullDeps["fetchTeams"] = async (ids, options) => {
      const answers = new Map<string, GcTeamResponse>();
      for (const teamId of ids) {
        const result: GcTeamResponse = { ok: false, reason: "invalid-id", message: "Bad Request" };
        answers.set(teamId, result);
        options.onProgress?.({ done: 1, total: ids.length, teamId, result, attempts: 1 });
      }
      return answers;
    };
    const paste = { kind: "list", entries: [{ teamId: ACES }], seasonYears: [] };
    const run = await runCloudPull(
      paste as CloudPullJob,
      deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams })
    );
    expect(run).toMatchObject({ asked: 1, answered: 0, failed: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadRefusedClubs().forGood]).toEqual([]);
  });

  it("remembers them from a staged import's final phase too", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const source = () =>
      (async function* () {
        yield schedules.get(ACES)!;
      })();
    await finishStagedImport(
      list,
      source,
      epochOf(base),
      { asked: 2, answered: 1, failed: 1 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00.000Z"),
        device: "import-test",
        invalidIds: ["bears-baseball-10u"],
      }
    );
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadRefusedClubs().forGood]).toEqual(["bears-baseball-10u"]);
  });

  it("leaves the copy as it was when a pull changes nothing in it", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const first = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const writes = cloud.costs.writes;
    const again = await runCloudPull(list, deps(cloud, "2026-09-29T14:00:00.000Z"));
    expect(again).toMatchObject({ end: "finished", changed: [], version: first.version });
    expect(cloud.costs.writes).toBe(writes);
    expect(again.manifest).toEqual(cloud.manifest());
  });

  it("names the copy it read when nothing is due", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud, () => saveDroppedClubs(new Set([ACES, BEARS])));
    const result = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(result).toMatchObject({ end: "nothing-due", asked: 0 });
    expect(result.manifest).toEqual(before);
  });

  /*
   * The sweep for clubs plainly made up (`obviousFakes.ts`) runs on the copy after a refresh's tidy,
   * the nightly's or a leg of Refresh now's, and on one with nothing left to pull, its marks saved in
   * the run's one commit. A list's legs never sweep, a paste's or a catch-up's, nor does a list with
   * nothing due: every list leg is kept as light as it can be, and the nightly sweeps what they filed
   * that night.
   */
  describe("the sweep for clubs plainly made up", () => {
    const MARKS = "league_forecast_gc_auto_removed_v1";
    const ROUTER = "gcROUTER0001";
    // Two wins by 40 over clubs nobody pulled, at 9U: sign A at any age.
    const routs = schedule(ROUTER, "Router", [
      game("r1", "Owls", 40, 0),
      { ...game("r2", "Hawks", 41, 0), id: "r2", date: "2026-09-21" },
    ]);
    const routerAnswers = async (ids: string[]) =>
      new Map(ids.map((id) => [id, { ok: true, schedule: routs } as GcTeamResponse]));
    const demo = (gcId: string) => () =>
      saveScoutTeams([
        {
          id: "S-DEMO",
          name: "Demo Squad",
          gcTeams: [{ teamId: gcId, name: "Demo Squad", ageGroupId: "ag_9u_2027", ageLevel: 9 }],
        },
      ]);
    /** A leg of Refresh now, these teams its share. */
    const leg = (teamIds: string[]): CloudPullJob => ({
      kind: "rota",
      walk: {
        teamIds,
        ageLevels: [9, 12],
        markOn: null,
        workedAt: new Date("2026-09-29T12:00:00.000Z"),
      },
    });
    const marksInCopy = async (cloud: MemoryCloud) => {
      resetTeamRankingsStore();
      await loadPoolFrom(cloud.store);
      return loadAutoRemoved();
    };

    it("marks a club a refresh filed with two routs its own schedule reports, deleting none unread", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud);
      const result = await runCloudPull(
        leg([ROUTER]),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: routerAnswers })
      );
      expect(result).toMatchObject({ end: "finished", filed: 1 });
      expect(result.version).toBe(before.version + 1);
      expect(result.changed).toEqual(
        expect.arrayContaining([MARKS, "league_forecast_scout_teams_v1"])
      );
      // Wins by 40 and 41 its own schedule reports: sign A, and sign H from the owner's line of 27
      // October 2026. The copy's League part is one no build reads, so nothing is deleted.
      expect((await marksInCopy(cloud)).get(ROUTER)?.signs).toEqual(["wins", "hundred"]);
    });

    const routerGone = () => ({
      marked: loadAutoRemoved().has(ROUTER),
      club: loadScoutTeams().some((team) => team.gcTeams?.some((link) => link.teamId === ROUTER)),
      games: loadScoutGames().filter((entry) => entry.id.includes(ROUTER)).length,
      refused: loadDroppedClubs().has(ROUTER),
    });

    it("deletes a club its own schedule reports winning by 40 or more, once League is read", async () => {
      // The owner's rule of 27 October 2026: the club, every game it is in and its mark go, and
      // its GameChanger id is refused by later pulls, as Delete club deletes one.
      const cloud = memoryCloud();
      await seed(cloud, undefined, { seasons: [] });
      const result = await runCloudPull(
        leg([ROUTER]),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: routerAnswers })
      );
      expect(result).toMatchObject({ end: "finished", filed: 1 });
      await marksInCopy(cloud);
      expect(routerGone()).toEqual({ marked: false, club: false, games: 0, refused: true });
    });

    it("keeps one a League Standings team picks, marked, and deletes it once none does", async () => {
      const page = {
        id: "ag_9u_2027",
        name: "9U 2027",
        seasonIds: ["fall"],
        ageLevel: 9,
        year: 2027,
      };
      const router = {
        id: "S-ROUTER",
        name: "Router",
        state: "OH",
        gcTeams: [{ teamId: ROUTER, name: "Router 9U", ageGroupId: page.id, ageLevel: 9 }],
      };
      const season = (teams: TeamBase[]): SeasonSnapshot => ({
        id: "fall",
        name: "Fall 2026",
        createdAt: "2026-08-01T12:00:00.000Z",
        teams,
        matchups: [],
        logs: {},
        bracketLogs: {},
        settings: DEFAULT_SETTINGS,
      });
      const cloud = memoryCloud();
      // The copy's own League part, a season on the club's page picking it.
      await seed(
        cloud,
        () => {
          saveAgeGroups([page]);
          saveScoutTeams([router]);
        },
        { seasons: [season([{ id: "lt-r", name: "Router", scoutTeamId: router.id }])] }
      );
      await runCloudPull(
        leg([ROUTER]),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: routerAnswers })
      );
      await marksInCopy(cloud);
      expect(routerGone()).toMatchObject({ marked: true, club: true, refused: false });
      // A night with nothing to pull, the seasons' documents picking nobody: it goes.
      const nobody = { leagueDocs: listing(docsOf([season([{ id: "lt-o", name: "Owls" }])])) };
      await runCloudPull(leg([]), deps(cloud, "2026-09-30T13:00:00.000Z", nobody));
      await marksInCopy(cloud);
      expect(routerGone()).toEqual({ marked: false, club: false, games: 0, refused: true });
    });

    /*
     * The nightly's cap and the owner's 40-run rule together (31 October 2026): a squad year a list
     * brought in meets the sweep first at the nightly, which held its save for the 1,646 games the
     * rule's 40 deletions took with them. What the rule deletes is the rule at work, not an answer
     * gone wrong, so its clubs' games do not count toward the 5% line; the clubs themselves still
     * count toward the 2% one, so a sweep gone wrong is held as before.
     */
    const listOf = (teamIds: string[]): CloudPullJob => ({
      kind: "list",
      entries: teamIds.map((teamId) => ({ teamId })),
      seasonYears: [2027],
    });

    it("saves a capped night whose only big loss is a club the 40-run rule deletes, and says so", async () => {
      const long = schedule(ROUTER, "Router", [
        game("r0", "Owls", 41, 0),
        ...Array.from({ length: 80 }, (_, at) => ({
          ...game(`r${at + 1}`, `Opponent ${at}`, 5, 3),
          id: `r${at + 1}`,
        })),
      ]);
      const answers = async (ids: string[]) =>
        new Map(ids.map((id) => [id, { ok: true, schedule: long } as GcTeamResponse]));
      const cloud = memoryCloud();
      await seed(cloud, undefined, { seasons: [] });
      // The long season comes in by a list, which never sweeps; the nightly meets it first.
      const listed = await runCloudPull(
        listOf([ROUTER]),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: answers })
      );
      expect(listed).toMatchObject({ end: "finished", filed: 1 });
      const night = await runCloudPull(
        leg([]),
        deps(cloud, "2026-09-30T07:17:00.000Z", { cap: true })
      );
      expect(night.end).toBe("finished");
      expect(night.deleted).toEqual({ clubs: 1, games: 81 });
      await marksInCopy(cloud);
      expect(routerGone()).toEqual({ marked: false, club: false, games: 0, refused: true });
    });

    it("counts once a game between two clubs the 40-run rule deletes (Codex on #495)", async () => {
      const PAIR = ["gcROUTPAIR01", "gcROUTPAIR02"] as const;
      const names = ["Router Pair One", "Router Pair Two"] as const;
      // Each a 41-0 win of its own, and one meeting both schedules list: three games in all.
      const answers = async (asked: string[]) =>
        new Map(
          asked.map((id) => {
            const at = PAIR.indexOf(id as (typeof PAIR)[number]);
            const meeting =
              at === 0
                ? game(`${id}-m`, names[1], 6, 4)
                : { ...game(`${id}-m`, names[0], 4, 6), id: `${id}-m` };
            return [
              id,
              {
                ok: true,
                schedule: schedule(id, names[at] ?? id, [
                  { ...game(`${id}-r`, `Owls ${at}`, 41, 0), id: `${id}-r`, date: "2026-09-21" },
                  meeting,
                ]),
              } as GcTeamResponse,
            ];
          })
        );
      const cloud = memoryCloud();
      await seed(cloud, undefined, { seasons: [] });
      await runCloudPull(
        listOf([...PAIR]),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: answers })
      );
      const meetings = loadScoutGames().filter((row) =>
        [row.teamAId, row.teamBId].every((club) =>
          loadScoutTeams().some(
            (team) =>
              team.id === club &&
              team.gcTeams?.some((link) => PAIR.includes(link.teamId as (typeof PAIR)[number]))
          )
        )
      ).length;
      const night = await runCloudPull(
        leg([]),
        deps(cloud, "2026-09-30T07:17:00.000Z", { cap: true })
      );
      expect(night.deleted?.clubs).toBe(2);
      expect(night.deleted?.games).toBe(2 + meetings);
    });

    it("still holds a capped night whose 40-run deletions take more than 2% of a year's clubs", async () => {
      const ids = Array.from({ length: 25 }, (_, at) => `gcROUT${String(at).padStart(6, "0")}`);
      const answers = async (asked: string[]) =>
        new Map(
          asked.map((id) => [
            id,
            {
              ok: true,
              schedule: schedule(id, `Router ${id.slice(-3)}`, [
                game(`${id}-r`, `Owls ${id.slice(-3)}`, 41, 0),
              ]),
            } as GcTeamResponse,
          ])
        );
      const cloud = memoryCloud();
      await seed(cloud, undefined, { seasons: [] });
      await runCloudPull(
        listOf(ids),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: answers })
      );
      const version = cloud.manifest()?.version;
      const night = await runCloudPull(
        leg([]),
        deps(cloud, "2026-09-30T07:17:00.000Z", { cap: true })
      );
      expect(night.end).toBe("held");
      expect(night.held?.[0]?.clubsRemoved).toBeGreaterThanOrEqual(25);
      expect(night.deleted).toEqual({ clubs: 25, games: 25 });
      expect(cloud.manifest()?.version).toBe(version);
    });

    /*
     * Both kinds of list leg the page sends: a paste, and a catch-up (`refresh`) such as "Ask again
     * about teams nobody could age" or "Check short rosters again", which asks about every team on
     * it and still is a list, not a refresh of the pool.
     */
    const lists = [
      ["pasted list", {}],
      ["catch-up list", { refresh: true }],
    ] as const;

    it.each(lists)("files a %s's leg without sweeping it", async (_, kind) => {
      const cloud = memoryCloud();
      const before = await seed(cloud);
      const result = await runCloudPull(
        { kind: "list", entries: [{ teamId: ROUTER }], seasonYears: [2027], ...kind },
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: routerAnswers })
      );
      expect(result).toMatchObject({ end: "finished", filed: 1 });
      expect(result.version).toBe(before.version + 1);
      expect(result.changed).toContain("league_forecast_scout_teams_v1");
      expect(result.changed).not.toContain(MARKS);
      expect((await marksInCopy(cloud)).size).toBe(0);
      // The next refresh sweeps what the list filed, though it has nothing left to pull.
      const night = await runCloudPull(leg([]), deps(cloud, "2026-09-30T07:17:00.000Z"));
      expect(night).toMatchObject({ end: "finished", asked: 0, changed: [MARKS] });
      expect((await marksInCopy(cloud)).get(ROUTER)?.signs).toEqual(["wins", "hundred"]);
    });

    it("commits only the marks on a refresh with nothing left to pull", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud, () => {
        saveDroppedClubs(new Set([ACES, BEARS]));
        demo("gcDEMO000001")();
      });
      const result = await runCloudPull(
        leg([ACES, BEARS]),
        deps(cloud, "2026-09-29T13:00:00.000Z")
      );
      expect(result).toMatchObject({ end: "finished", asked: 0, changed: [MARKS] });
      expect(result.version).toBe(before.version + 1);
      expect(result.manifest).toEqual(cloud.manifest());
      expect([...(await marksInCopy(cloud)).keys()]).toEqual(["gcDEMO000001"]);
      // And the next night, with nothing new, writes nothing.
      const again = await runCloudPull(leg([ACES, BEARS]), deps(cloud, "2026-09-30T13:00:00.000Z"));
      expect(again).toMatchObject({ end: "finished", changed: [], version: result.version });
    });

    it("sweeps on a nightly with nothing due", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud, () => {
        saveDroppedClubs(new Set([ACES, BEARS, "gcDEMO000001"]));
        demo("gcDEMO000001")();
      });
      const result = await runCloudPull({ kind: "rota" }, deps(cloud, "2026-09-29T13:00:00.000Z"));
      expect(result).toMatchObject({ end: "nothing-due", asked: 0, changed: [MARKS] });
      expect(result.version).toBe(before.version + 1);
    });

    it.each(lists)(
      "writes nothing for a %s with nothing due, whatever the copy holds",
      async (_, kind) => {
        const cloud = memoryCloud();
        const before = await seed(cloud, () => {
          saveDroppedClubs(new Set([ACES, BEARS]));
          demo("gcDEMO000001")();
        });
        const writes = cloud.costs.writes;
        const result = await runCloudPull(
          { ...list, ...kind },
          deps(cloud, "2026-09-29T13:00:00.000Z")
        );
        expect(result).toMatchObject({ end: "nothing-due", asked: 0, changed: [] });
        expect(result.manifest).toEqual(before);
        expect(cloud.manifest()).toEqual(before);
        expect(cloud.costs.writes).toBe(writes);
        expect((await marksInCopy(cloud)).size).toBe(0);
      }
    );

    it("never marks a club said to be real", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud, () => {
        saveDroppedClubs(new Set([ACES, BEARS]));
        demo("gcDEMO000001")();
        saveRealClubs(new Set(["gcDEMO000001"]));
      });
      const result = await runCloudPull(
        leg([ACES, BEARS]),
        deps(cloud, "2026-09-29T13:00:00.000Z")
      );
      expect(result).toMatchObject({ end: "finished", changed: [] });
      expect(result.manifest).toEqual(before);
    });
  });

  it("never asks about a club the copy has thrown out", async () => {
    const cloud = memoryCloud();
    // The phone threw the Bears out; the list sent before it did still names them.
    await seed(cloud, () => saveDroppedClubs(new Set([BEARS])));
    const asked: string[][] = [];
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", {
        fetchTeams: async (ids, options) => {
          asked.push(ids);
          return answering()(ids, options);
        },
      })
    );
    expect(result.asked).toBe(1);
    expect(asked).toEqual([[ACES]]);
  });

  it("throws out a club whose every result is on a day that has not happened", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const invented = { kind: "list", entries: [{ teamId: AHEAD }], seasonYears: [2027] } as const;
    // On the run's own day, not the machine's: the result is dated after the one and long before
    // the other.
    const result = await runCloudPull(invented, deps(cloud, "2020-01-01T13:00:00.000Z"));
    expect(result.filed).toBe(0);
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadDroppedClubs()]).toEqual([AHEAD]);
  });

  it("tidies the whole pool, not only what it pulled", async () => {
    const cloud = memoryCloud();
    const ag9 = { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 };
    const pulledClub = (id: string, name: string, gcId: string) => ({
      id,
      name,
      state: "OH",
      gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9", ageLevel: 9 }],
    });
    // A stand-in of "Cubs" named by an Ohio club on a day the one pulled Cubs of Ohio played:
    // the tidy files it onto the club (`refileStandIns`).
    await seed(cloud, () => {
      saveAgeGroups([ag9]);
      saveScoutTeams([
        pulledClub("S-CUBS", "Cubs", "gcCUBS000001"),
        pulledClub("S-PULL", "Pullers", "gcPULLER0001"),
        { id: "S-CUBS2", name: "Cubs", nameOnly: true },
        { id: "S-DUKES", name: "Dukes", nameOnly: true },
      ]);
      saveScoutGames([
        {
          id: "gc_gcCUBS000001_c1",
          teamAId: "S-CUBS",
          teamBId: "S-DUKES",
          teamAScore: 4,
          teamBScore: 1,
          ageGroupId: "ag9",
          date: "2026-09-20",
          source: { kind: "gamechanger", teamId: "gcCUBS000001", gameId: "c1" },
        },
        {
          id: "gc_gcPULLER0001_p1",
          teamAId: "S-PULL",
          teamBId: "S-CUBS2",
          teamAScore: 2,
          teamBScore: 6,
          ageGroupId: "ag9",
          date: "2026-09-21",
          source: { kind: "gamechanger", teamId: "gcPULLER0001", gameId: "p1" },
        },
      ]);
    });
    const aces = { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] } as const;
    await runCloudPull(aces, deps(cloud, "2026-09-29T13:00:00.000Z"));
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadScoutGames().find((entry) => entry.id === "gc_gcPULLER0001_p1")?.teamBId).toBe(
      "S-CUBS"
    );
  });

  describe("deleting a page whose every name says it is no team", () => {
    const ag9 = { id: "ag9", name: "9U 2027", seasonIds: ["fall"], ageLevel: 9, year: 2027 };
    // Its own name has no word; its one GameChanger page is an old page marked do not use.
    const hawks = {
      id: "S-HAWKS",
      name: "Hollowmere Hawks",
      state: "OH",
      gcTeams: [
        { teamId: "gcHAWKS00001", name: "Hollowmere Hawks 9U DNU", ageGroupId: "ag9", ageLevel: 9 },
      ],
    };
    const season = (teams: TeamBase[]): SeasonSnapshot => ({
      id: "fall",
      name: "Fall 2026",
      createdAt: "2026-08-01T12:00:00.000Z",
      teams,
      matchups: [],
      logs: {},
      bracketLogs: {},
      settings: DEFAULT_SETTINGS,
    });
    const picked = season([{ id: "lt-hawks", name: "Hawks", scoutTeamId: "S-HAWKS" }]);
    const nobody = season([{ id: "lt-owls", name: "Owls" }]);
    /** Whether the club is still in the copy after a pull of another club, and its tidy. */
    const stays = async (extra: Partial<CloudPullDeps>, part: unknown = { seasons: [] }) => {
      const cloud = memoryCloud();
      await seed(
        cloud,
        () => {
          saveAgeGroups([ag9]);
          saveScoutTeams([hawks]);
        },
        part
      );
      const aces = { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] } as const;
      await runCloudPull(aces, deps(cloud, "2026-09-29T13:00:00.000Z", extra));
      resetTeamRankingsStore();
      await loadPoolFrom(cloud.store);
      return loadScoutTeams().some((entry) => entry.id === "S-HAWKS");
    };

    it("deletes it when League Standings links nobody to it", async () => {
      expect(await stays({ leagueDocs: listing(docsOf([nobody])) })).toBe(false);
      expect(await stays({}, { seasons: [nobody] })).toBe(false);
    });

    it("keeps a club a League Standings team picks, in the seasons' documents", async () => {
      expect(await stays({ leagueDocs: listing(docsOf([picked])) })).toBe(true);
    });

    it("keeps one a season in the copy's own part picks, where there are no documents", async () => {
      expect(await stays({}, { seasons: [picked] })).toBe(true);
    });

    it("pulls again a club the owner vouched for, by the real list or a League pick", async () => {
      const workouts = {
        id: "S-WEXC",
        name: "Wexcombe Workouts",
        state: "OH",
        gcTeams: [
          { teamId: WORKOUTS, name: "Wexcombe Workouts 9U", ageGroupId: "ag9", ageLevel: 9 },
        ],
      };
      /** Whether its new game is in the copy after a pull of it alone. */
      const filed = async (write: () => void, extra: Partial<CloudPullDeps> = {}) => {
        const cloud = memoryCloud();
        await seed(
          cloud,
          () => {
            saveAgeGroups([ag9]);
            saveScoutTeams([workouts]);
            write();
          },
          { seasons: [] }
        );
        const again = {
          kind: "list",
          entries: [{ teamId: WORKOUTS }],
          seasonYears: [2027],
        } as const;
        await runCloudPull(again, deps(cloud, "2026-09-29T13:00:00.000Z", extra));
        resetTeamRankingsStore();
        await loadPoolFrom(cloud.store);
        return loadScoutGames().some((entry) => entry.id === `gc_${WORKOUTS}_w1`);
      };
      expect(await filed(() => undefined)).toBe(false);
      expect(await filed(() => saveRealClubs(new Set([WORKOUTS])))).toBe(true);
      const pick = season([{ id: "lt-wex", name: "Workouts", scoutTeamId: "S-WEXC" }]);
      expect(await filed(() => undefined, { leagueDocs: listing(docsOf([pick])) })).toBe(true);
    });

    it("pulls it from a paste that names it, and asks nothing of a practice page", async () => {
      const workouts = {
        id: "S-WEXC",
        name: "Wexcombe Workouts",
        state: "OH",
        gcTeams: [
          { teamId: WORKOUTS, name: "Wexcombe Workouts 9U", ageGroupId: "ag9", ageLevel: 9 },
        ],
      };
      // The rows as the live page's paste box sends them, each marked with the word its name hit.
      const { entries } = parseGcTeamList(
        [
          "Team Name,Team ID,Age Group",
          `Wexcombe Workouts 9U,${WORKOUTS},9U`,
          "Thornbury Practice 9U,gcTHORN00001,9U",
        ].join("\n")
      );
      expect(entries.map((entry) => entry.notATeam)).toEqual(["tryout", "practice"]);
      const pasted = { kind: "list", entries, seasonYears: [2027] } as const;
      /** What an import and a pull of the paste ask about, and whether the club's game is filed. */
      const pull = async (teams: ScoutTeam[], write: () => void, extra: Partial<CloudPullDeps>) => {
        const cloud = memoryCloud();
        await seed(
          cloud,
          () => {
            saveAgeGroups([ag9]);
            saveScoutTeams(teams);
            write();
          },
          { seasons: [] }
        );
        const selected = await selectImportTeams(cloud.store, pasted);
        const fetchTeams = vi.fn(answering());
        await runCloudPull(
          pasted,
          deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams, ...extra })
        );
        resetTeamRankingsStore();
        await loadPoolFrom(cloud.store);
        return {
          selected: selected.entries.map((entry) => entry.teamId),
          asked: fetchTeams.mock.calls.flatMap(([ids]) => ids),
          filed: loadScoutGames().some((entry) => entry.id === `gc_${WORKOUTS}_w1`),
        };
      };
      const again = { selected: [WORKOUTS], asked: [WORKOUTS], filed: true };
      expect(await pull([workouts], () => saveRealClubs(new Set([WORKOUTS])), {})).toEqual(again);
      const pick = season([{ id: "lt-wex", name: "Workouts", scoutTeamId: "S-WEXC" }]);
      const byLeague = { leagueDocs: listing(docsOf([pick])) };
      expect(await pull([workouts], () => undefined, byLeague)).toEqual(again);
      // Carried by a club of a page that plays in a League season, the row is asked about, since
      // only League could vouch for it, and the import, reading League, refuses it unvouched.
      expect(await pull([workouts], () => undefined, {})).toEqual({ ...again, filed: false });
      // On the real list with no club of it yet, a pool started again since the word was given.
      expect(await pull([], () => saveRealClubs(new Set([WORKOUTS])), {})).toEqual(again);
      // On no list and carried by no club, it cannot be one the import files: no request at all.
      expect(await pull([], () => undefined, {})).toEqual({
        selected: [],
        asked: [],
        filed: false,
      });
    });

    /*
     * A handful pasted by hand, every club of it held, with a club's practice page among them: the
     * Thrashers, whom the tidy keeps for their one clean page while the practice page stays linked.
     * The device's panel leaves that row out unless somebody vouched for the club, and pulls the
     * rest again; the cloud must not count it toward the handful and so refresh nothing.
     */
    describe("a handful with a held club's practice page in it", () => {
      const held: ScoutTeam[] = Array.from({ length: 24 }, (_, n) => {
        const name = `Ashbury Club ${n + 1}`;
        const teamId = `gcASHB${String(n + 1).padStart(6, "0")}`;
        return {
          id: `S-ASHB${n + 1}`,
          name,
          state: "OH",
          gcTeams: [{ teamId, name: `${name} 9U`, ageGroupId: "ag9", ageLevel: 9 }],
        };
      });
      const THRASHERS = "gcTHORN00001";
      const PRACTICE = "gcTHORP00001";
      const thrashers: ScoutTeam = {
        id: "S-THORN",
        name: "Thornbury Thrashers",
        state: "OH",
        gcTeams: [
          { teamId: THRASHERS, name: "Thornbury Thrashers 9U", ageGroupId: "ag9", ageLevel: 9 },
          {
            teamId: PRACTICE,
            name: "Thornbury Thrashers 9U Practice",
            ageGroupId: "ag9",
            ageLevel: 9,
          },
        ],
      };
      const page: AgeGroup = {
        id: "ag9",
        name: "9U 2027",
        seasonIds: [],
        ageLevel: 9,
        year: 2027,
      };
      /** Every page of `teams` as an export lists it. */
      const pasted = (teams: ScoutTeam[]) => {
        const { entries } = parseGcTeamList(
          [
            "Team Name,Team ID,Age Group",
            ...teams.flatMap((team) =>
              (team.gcTeams ?? []).map((link) => `${link.name},${link.teamId},9U`)
            ),
          ].join("\n")
        );
        return { kind: "list", entries, seasonYears: [2027] } as const;
      };
      /** What the staged import's selection and a pull of the paste ask about, and the end. */
      const asks = async (teams: ScoutTeam[], group: AgeGroup) => {
        const cloud = memoryCloud();
        await seed(
          cloud,
          () => {
            saveAgeGroups([group]);
            saveScoutTeams(teams);
          },
          { seasons: [] }
        );
        const job = pasted(teams);
        const selected = await selectImportTeams(cloud.store, job);
        const fetchTeams = vi.fn(answering());
        const result = await runCloudPull(
          job,
          deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams })
        );
        return {
          selected: selected.entries.map((entry) => entry.teamId).sort(),
          asked: fetchTeams.mock.calls.flatMap(([ids]) => ids).sort(),
          end: result.end,
        };
      };
      const clean = (teams: ScoutTeam[]) => teams.map((team) => team.gcTeams![0]!.teamId).sort();

      it("reads the practice page as no team", () => {
        const { entries } = pasted([thrashers]);
        expect(entries.map((entry) => entry.notATeam ?? null)).toEqual([null, "practice"]);
      });

      it("pulls the 25 again and asks nothing of the practice page when nothing can vouch for it", async () => {
        const ids = clean([...held, thrashers]);
        expect(ids).toHaveLength(25);
        expect(await asks([...held, thrashers], page)).toEqual({
          selected: ids,
          asked: ids,
          end: "finished",
        });
      });

      it("pulls the 25 again where a page plays League, the page sent uncounted to be settled", async () => {
        // League might link the Thrashers, which only the import, reading it, can tell.
        const withPractice = [...clean([...held, thrashers]), PRACTICE].sort();
        expect(await asks([...held, thrashers], { ...page, seasonIds: ["fall"] })).toEqual({
          selected: withPractice,
          asked: withPractice,
          end: "finished",
        });
      });

      it("asks about the practice page of a page's own team, counted, as the device does", async () => {
        const teams = [...held.slice(1), thrashers];
        const all = [...clean(teams), PRACTICE].sort();
        expect(all).toHaveLength(25);
        expect(await asks(teams, { ...page, myTeamId: "S-THORN" })).toEqual({
          selected: all,
          asked: all,
          end: "finished",
        });
      });
    });

    it("deletes nothing for its name in a run that could not read League Standings", async () => {
      // Read as no seasons, a pick it could not see would be deleted for good.
      expect(await stays({}, LEAGUE)).toBe(true);
      const newer = { id: "season_fall", fields: { schema: 999 } };
      expect(await stays({ leagueDocs: listing([newer]) })).toBe(true);
    });

    it("takes no game off a row naming a League pick in a run that could not read League", async () => {
      // The Quails' row names the Workouts, whose name reads as a tryout and whom League picks,
      // and a game stands on it already.
      const link = (teamId: string, name: string) => [
        { teamId, name, ageGroupId: "ag9", ageLevel: 9 },
      ];
      const workouts = {
        id: "S-WEXC",
        name: "Wexcombe Workouts",
        state: "OH",
        gcTeams: link(WORKOUTS, "Wexcombe Workouts 9U"),
      };
      const quails = {
        id: "S-QUILL",
        name: "Quillfeather Quails",
        state: "OH",
        gcTeams: link(QUAILS, "Quillfeather Quails 9U"),
      };
      const onRow = {
        id: `gc_${QUAILS}_q1`,
        teamAId: "S-QUILL",
        teamBId: "S-WEXC",
        teamAScore: 6,
        teamBScore: 2,
        ageGroupId: "ag9",
        date: "2026-09-20",
        source: { kind: "gamechanger" as const, teamId: QUAILS, gameId: "q1" },
      };
      // A game nobody here touches, so the year is never emptied.
      const bystanders = [
        { id: "S-OWLS", name: "Owls", nameOnly: true as const },
        { id: "S-DOVES", name: "Doves", nameOnly: true as const },
      ];
      const apart = {
        id: "apart",
        teamAId: "S-OWLS",
        teamBId: "S-DOVES",
        teamAScore: 3,
        teamBScore: 1,
        ageGroupId: "ag9",
        date: "2026-09-21",
      };
      /** Whether the game is in the copy after a pull of the Quails and its tidy. */
      const kept = async (extra: Partial<CloudPullDeps>, part: unknown = { seasons: [] }) => {
        const cloud = memoryCloud();
        await seed(
          cloud,
          () => {
            saveAgeGroups([ag9]);
            saveScoutTeams([workouts, quails, ...bystanders]);
            saveScoutGames([onRow, apart]);
          },
          part
        );
        const again = { kind: "list", entries: [{ teamId: QUAILS }], seasonYears: [2027] } as const;
        await runCloudPull(again, deps(cloud, "2026-09-29T13:00:00.000Z", extra));
        resetTeamRankingsStore();
        await loadPoolFrom(cloud.store);
        return loadScoutGames().some((entry) => entry.id === onRow.id);
      };
      const pick = season([{ id: "lt-wex", name: "Workouts", scoutTeamId: "S-WEXC" }]);
      // Read, the pick lets the row through and the game stands; with no pick both go.
      expect(await kept({ leagueDocs: listing(docsOf([pick])) })).toBe(true);
      expect(await kept({ leagueDocs: listing(docsOf([nobody])) })).toBe(false);
      // Not read, the row is turned away, but its game is left for a run that can see the pick.
      expect(await kept({}, LEAGUE)).toBe(true);
    });
  });

  it.each([
    ["deletes", false],
    ["keeps", true],
  ])("%s a page whose every name says it is no team, by the real list", async (_, real) => {
    const cloud = memoryCloud();
    const ag9 = { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 };
    const gcTeams = [
      { teamId: "gcTHORN00001", name: "Thornbury Practice 9U", ageGroupId: "ag9", ageLevel: 9 },
    ];
    // A League Standings part that reads, with no seasons, so the tidy's step runs at all.
    await seed(
      cloud,
      () => {
        saveAgeGroups([ag9]);
        saveScoutTeams([{ id: "S-THORN", name: "Thornbury Practice", state: "OH", gcTeams }]);
        if (real) saveRealClubs(new Set(["gcTHORN00001"]));
      },
      { seasons: [] }
    );
    const aces = { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] } as const;
    await runCloudPull(aces, deps(cloud, "2026-09-29T13:00:00.000Z"));
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadScoutTeams().some((entry) => entry.id === "S-THORN")).toBe(real);
  });

  it("files a list in the squad years it was sent for and no other", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const lastYear = { ...list, seasonYears: [2026] };
    const result = await runCloudPull(lastYear, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(result).toMatchObject({ answered: 2, filed: 0 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadScoutGames()).toEqual([]);
  });

  it("pulls the teams due today, and logs the day only once every one was asked", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    // Three days on, the rota is both clubs, pulled again and the day logged.
    const day = "2026-10-02T07:17:00.000Z";
    const asked: string[][] = [];
    const rota = await runCloudPull(
      { kind: "rota" },
      deps(cloud, day, {
        fetchTeams: async (ids, options) => {
          asked.push([...ids].sort());
          return answering()(ids, options);
        },
      })
    );
    expect(asked).toEqual([[ACES, BEARS]]);
    expect(rota.end).toBe("finished");
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()["9"]).toBe(localDayKey(new Date(day)));

    // Refused half way the next day: what came is kept, and the day is not logged.
    const next = "2026-10-03T07:17:00.000Z";
    const refused = await runCloudPull(
      { kind: "rota" },
      deps(cloud, next, {
        fetchTeams: async (ids, options) => {
          options.onRefused?.(3);
          return answering()(ids.slice(0, 1), options);
        },
      })
    );
    expect(refused.end).toBe("gave-up");
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()["9"]).toBe(localDayKey(new Date(day)));
  });

  it("asks again about the teams waiting on an age that are due, beside the rota's", async () => {
    const WAITING = "gcWAIT000001";
    const cloud = memoryCloud();
    await seed(cloud, () => {
      saveRefreshCadence("daily");
      saveAgeUnknown([
        {
          teamId: WAITING,
          name: "Wildcats",
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-20T00:00:00.000Z",
          tries: 1,
        },
      ]);
    });
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const asked: string[][] = [];
    await runCloudPull(
      { kind: "rota" },
      deps(cloud, "2026-10-02T07:17:00.000Z", {
        fetchTeams: async (ids, options) => {
          asked.push([...ids].sort());
          return answering()(ids, options);
        },
      })
    );
    expect(asked).toEqual([[ACES, BEARS, WAITING]]);
  });

  it("files the waiting teams it asks about in the season being played only", async () => {
    const LAST_SUMMER = "gcWAIT000002";
    const THIS_FALL = "gcWAIT000003";
    const waiting = (teamId: string, name: string) => ({
      teamId,
      name,
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastTried: "2026-09-20T00:00:00.000Z",
      tries: 1,
    });
    const answers = new Map<string, GcTeamSchedule>([
      ...schedules,
      [THIS_FALL, schedule(THIS_FALL, "Foxes", [game("x1", "Aces", 2, 1)])],
      [
        LAST_SUMMER,
        (() => {
          const summer = schedule(LAST_SUMMER, "Owls", [game("o1", "Bears", 7, 4)]);
          return {
            ...summer,
            profile: { ...summer.profile, season: { season: "summer", year: 2026 } },
          };
        })(),
      ],
    ]);
    const cloud = memoryCloud();
    await seed(cloud, () => {
      saveRefreshCadence("daily");
      saveAgeUnknown([waiting(LAST_SUMMER, "Owls"), waiting(THIS_FALL, "Foxes")]);
    });
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    await runCloudPull(
      { kind: "rota" },
      deps(cloud, "2026-10-02T07:17:00.000Z", {
        fetchTeams: async (ids, options) => {
          const told = new Map<string, GcTeamResponse>();
          ids.forEach((teamId, at) => {
            const found = answers.get(teamId);
            const result: GcTeamResponse = found
              ? { ok: true, schedule: found }
              : { ok: false, reason: "not-found", message: "No such team." };
            told.set(teamId, result);
            options.onProgress?.({ done: at + 1, total: ids.length, teamId, result, attempts: 1 });
          });
          return told;
        },
      })
    );
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    const pulled = loadScoutTeams().flatMap(
      (team) => team.gcTeams?.map((link) => link.teamId) ?? []
    );
    // The rota's own teams are filed as ever, and so is the waiting team playing this fall.
    expect(pulled).toEqual(expect.arrayContaining([ACES, BEARS, THIS_FALL]));
    // Last summer's squad is refused for its year, and leaves the waiting list with it.
    expect(pulled).not.toContain(LAST_SUMMER);
    expect(loadAgeUnknown().map((entry) => entry.teamId)).not.toContain(LAST_SUMMER);
  });

  it("pulls only the first teams due on a trial run, and leaves the day unlogged", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const day = "2026-10-02T07:17:00.000Z";
    const asked: string[][] = [];
    const trial = await runCloudPull(
      { kind: "rota", limit: 1 },
      deps(cloud, day, {
        fetchTeams: async (ids, options) => {
          asked.push(ids);
          return answering()(ids, options);
        },
      })
    );
    expect(asked.map((ids) => ids.length)).toEqual([1]);
    expect(trial).toMatchObject({ end: "finished", asked: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()["9"]).toBeUndefined();
  });

  it("walks a refresh's teams as worked out at its start, and logs its levels only from its last leg", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const day = "2026-10-02T07:17:00.000Z";
    const asked: string[][] = [];
    const asking = (extra: Partial<CloudPullDeps> = {}) =>
      deps(cloud, day, {
        fetchTeams: async (ids, options) => {
          asked.push([...ids]);
          return answering()(ids, options);
        },
        ...extra,
      });
    const logged = async () => {
      resetTeamRankingsStore();
      await loadPoolFrom(cloud.store);
      const log = loadRefreshLog();
      resetTeamRankingsStore();
      return log;
    };
    // Worked out the day before the legs run.
    const workedOut = new Date("2026-10-01T15:00:00.000Z");
    // A leg before the last: its share of the list, worked out afresh by nothing, and no level
    // logged, whatever the rota would say now.
    const first = await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [BEARS], ageLevels: [9], markOn: null, workedAt: workedOut },
      },
      asking()
    );
    expect(first).toMatchObject({ end: "finished", asked: 1 });
    expect(asked).toEqual([[BEARS]]);
    expect((await logged())["9"]).toBeUndefined();

    // The last leg: its share, and the levels logged on the day the refresh was worked out for,
    // here the day before the leg runs.
    await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [ACES], ageLevels: [9], markOn: workedOut, workedAt: workedOut },
      },
      asking()
    );
    expect(asked).toEqual([[BEARS], [ACES]]);
    expect((await logged())["9"]).toBe(localDayKey(workedOut));

    // A last leg that did not ask about every team logs nothing.
    const refusing = await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [ACES, BEARS], ageLevels: [10], markOn: workedOut, workedAt: workedOut },
      },
      asking({
        fetchTeams: async (ids, options) => {
          options.onRefused?.(3);
          return answering()(ids.slice(0, 1), options);
        },
      })
    );
    expect(refusing.end).toBe("gave-up");
    expect((await logged())["10"]).toBeUndefined();
  });

  it("never logs a level back to an earlier day than the log already has it", async () => {
    const cloud = memoryCloud();
    const later = new Date("2026-10-03T15:00:00.000Z");
    await seed(cloud, () => {
      saveRefreshCadence("daily");
      saveRefreshLog({ "9": localDayKey(later) });
    });
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    // A refresh worked out the day before the nightly logged 9U ends after it did.
    const workedOut = new Date("2026-10-02T15:00:00.000Z");
    await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [ACES], ageLevels: [9, 10], markOn: workedOut, workedAt: workedOut },
      },
      deps(cloud, "2026-10-03T16:00:00.000Z")
    );
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()).toMatchObject({
      "9": localDayKey(later),
      "10": localDayKey(workedOut),
    });
  });

  it("works out Refresh now's teams from the copy, or says why there are none to work out", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const day = new Date("2026-10-02T07:17:00.000Z");
    const worked = await workOutRefresh(cloud.store, day);
    const copy = cloud.manifest()!;
    // With the copy and the start of its Team Rankings they were worked out from.
    expect(worked).toMatchObject({
      ok: true,
      again: false,
      heldBack: 0,
      on: { copy: copy.copy, epoch: copy.epoch },
    });
    expect(worked.ok && [...worked.teamIds].sort()).toEqual([ACES, BEARS].sort());

    expect(await workOutRefresh(memoryCloud().store, day)).toEqual({
      ok: false,
      end: "no-copy",
    });
    const newer = memoryCloud();
    await seed(newer, () => saveTidyStamp("r999|0|0|0|"));
    expect(await workOutRefresh(newer.store, day)).toEqual({ ok: false, end: "newer-copy" });
  });

  it("keeps what it replaced as an earlier version any device can bring back, when asked to", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const first = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(cloud.manifest()?.kept).toEqual([]);
    const before = cloud.manifest()!;
    // The next night's run changes the games and the teams, and keeps what they were.
    schedules.set(
      ACES,
      schedule(ACES, "Aces", [game("a1", "Bears", 5, 3), game("a2", "Cubs", 1, 2)])
    );
    try {
      const again = await runCloudPull(
        list,
        deps(cloud, "2026-09-30T07:17:00.000Z", { keep: true })
      );
      expect(again.version).toBe((first.version ?? 0) + 1);
    } finally {
      schedules.set(ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)]));
    }
    const kept = cloud.manifest()!.kept;
    expect(kept.length).toBeGreaterThan(0);
    kept.forEach((part) => {
      expect(part.why).toBe("replaced");
      // The very value the copy held before, pieces and all.
      expect(before.parts.find((entry) => entry.key === part.key)?.hash).toBe(part.hash);
    });
    expect(new Set(kept.map((part) => part.group)).size).toBe(1);
  });

  describe("a nightly's cap on what one save takes away (blastRadius.ts)", () => {
    // Aces with a long season, then a night whose answer lists two games of it: the rest go, as
    // rows the schedule no longer lists. A changed answer read as every schedule emptied looks so.
    const long = Array.from({ length: 120 }, (_, at) =>
      game(`a${at}`, `Opponent ${at}`, 5 + (at % 4), 3)
    );
    const night = async (cap: boolean) => {
      const cloud = memoryCloud();
      await seed(cloud);
      schedules.set(ACES, schedule(ACES, "Aces", long));
      try {
        const first = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
        expect(first.end).toBe("finished");
        const games = loadScoutGames().length;
        schedules.set(ACES, schedule(ACES, "Aces", long.slice(0, 2)));
        const writes = cloud.costs.writes;
        const version = cloud.manifest()?.version;
        const result = await runCloudPull(
          list,
          deps(cloud, "2026-09-30T07:17:00.000Z", cap ? { cap: true } : {})
        );
        return { result, games, writes, version, cloud };
      } finally {
        schedules.set(ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)]));
      }
    };

    it("holds a save that would take most of a year's games, and writes nothing", async () => {
      const { result, games, writes, version, cloud } = await night(true);
      expect(result.end).toBe("held");
      expect(result.changed).toEqual([]);
      expect(result.manifest).toBeUndefined();
      expect(result.held).toHaveLength(1);
      expect(result.held?.[0]).toMatchObject({ year: 2027 });
      expect(result.held?.[0]?.gamesRemoved).toBeGreaterThanOrEqual(100);
      expect(result.held?.[0]?.games).toBe(games);
      expect(cloud.costs.writes).toBe(writes);
      expect(cloud.manifest()?.version).toBe(version);
    });

    it("saves the same night where nobody asked for the cap, as a pull a person starts does", async () => {
      const { result, version } = await night(false);
      expect(result.end).toBe("finished");
      expect(result.version).toBe((version ?? 0) + 1);
    });

    it("says how much of what GameChanger listed it could read", async () => {
      const { result } = await night(true);
      // Aces list two games that night and Bears one, and every one of them reads.
      expect(result.ingest).toMatchObject({ listed: 3, read: 3, drifted: false });
    });

    it("counts the rows a schedule listed that never reached the import", async () => {
      const cloud = memoryCloud();
      await seed(cloud);
      const unreadable = [...Array(600).keys()].map((at) => `row${at}`);
      // The Bears' answer lists 600 entries the reader could not read, and one it could.
      schedules.set(BEARS, {
        ...schedule(BEARS, "Bears", [game("b1", "Aces", 3, 5)]),
        rowIds: ["b1", ...unreadable],
      });
      try {
        const result = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
        expect(result.ingest?.listed).toBeGreaterThanOrEqual(601);
        expect(result.ingest?.drifted).toBe(true);
      } finally {
        schedules.set(BEARS, schedule(BEARS, "Bears", [game("b1", "Aces", 3, 5)]));
      }
    });
  });

  it("files the same answers onto a copy another device saved meanwhile, keeping its change", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    // While GameChanger answers, the phone throws the Bears out.
    const phoneSaves = async () => {
      const current = cloud.manifest()!;
      const saved = await commitChanges({
        store: cloud.store,
        base: current,
        changes: [{ key: "league_forecast_gc_dropped_clubs_v1", value: [BEARS], at: 2 }],
        device: "phone",
        now: "2026-09-29T13:00:30.000Z",
      });
      if (!saved.ok) throw new Error("phone");
    };
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", { fetchTeams: answering(phoneSaves) })
    );
    expect(result).toMatchObject({ end: "finished", replays: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    // The phone's change stands, and the pull honoured it: the Bears were not filed.
    expect([...loadDroppedClubs()]).toEqual([BEARS]);
    const pulled = loadScoutTeams().flatMap(
      (team) => team.gcTeams?.map((link) => link.teamId) ?? []
    );
    expect(pulled).toContain(ACES);
    expect(pulled).not.toContain(BEARS);
    expect(cloud.manifest()?.version).toBe(result.version);
  });

  it("ends at once when stopped while it reads the copy, asking and saving nothing", async () => {
    const cloud = memoryCloud();
    // A copy of several values, so a read that went on past the stop would show.
    const before = await seed(cloud, () => {
      saveAgeGroups([{ id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 }]);
      saveScoutTeams([{ id: "S-ONE", name: "One" }]);
      saveScoutGames([
        {
          id: "g1",
          teamAId: "S-ONE",
          teamBId: "S-ONE",
          teamAScore: 1,
          teamBScore: 0,
          ageGroupId: "ag9",
          date: "2026-09-20",
        },
      ]);
    });
    expect(before.parts.filter((part) => part.key !== LEAGUE_PART).length).toBeGreaterThan(2);
    const stop = new AbortController();
    // The stop arrives as the copy's first value is being read.
    let reads = 0;
    const store = {
      ...cloud.store,
      getChunk: (id: string) => {
        reads += 1;
        stop.abort();
        return cloud.store.getChunk(id);
      },
    };
    const asked = vi.fn(answering());
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", { store, fetchTeams: asked, signal: stop.signal })
    );
    expect(result).toMatchObject({ end: "stopped", asked: 0, answered: 0, filed: 0, changed: [] });
    expect(asked).not.toHaveBeenCalled();
    // Only the value being read when the stop came was read: none after it.
    const first = before.parts.find((part) => part.key !== LEAGUE_PART)!;
    expect(reads).toBe(first.chunks);
    expect(cloud.manifest()).toEqual(before);
  });

  it("lays nothing into the pool store when stopped as the copy's last value is read", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud, () => saveScoutTeams([{ id: "S-ONE", name: "One" }]));
    const parts = before.parts.filter((part) => part.key !== LEAGUE_PART);
    const last = parts[parts.length - 1]!;
    const stop = new AbortController();
    const store = {
      ...cloud.store,
      getChunk: (id: string) => {
        if (id.startsWith(last.id)) stop.abort();
        return cloud.store.getChunk(id);
      },
    };
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    expect(await loadPoolFrom(store, stop.signal)).toBeNull();
    expect(loadScoutTeams()).toEqual([]);
    // Unstopped, the same copy lays its club in.
    expect(await loadPoolFrom(cloud.store)).not.toBeNull();
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["S-ONE"]);
  });

  it("ends at once when stopped before any answer, without tidying or saving the pool", async () => {
    const cloud = memoryCloud();
    // A pool the tidy would change, so a tidy that ran would save.
    const before = await seed(cloud, () => {
      saveScoutGames([
        {
          id: "gc_gcACES000001_old",
          teamAId: "S-ONE",
          teamBId: "S-TWO",
          teamAScore: 1,
          teamBScore: 0,
          ageGroupId: "nowhere",
          date: "2099-01-01",
        },
      ]);
    });
    const stop = new AbortController();
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", {
        signal: stop.signal,
        fetchTeams: async () => {
          stop.abort();
          return new Map();
        },
      })
    );
    expect(result).toMatchObject({ end: "stopped", answered: 0, filed: 0, changed: [] });
    expect(result.version).toBe(before.version);
    expect(cloud.manifest()).toEqual(before);
  });

  it("still files and saves what it fetched before a stop", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const stop = new AbortController();
    const firstOnly: CloudPullDeps["fetchTeams"] = async (ids, options) => {
      const answers = await answering()(ids.slice(0, 1), options);
      stop.abort();
      return answers;
    };
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", { signal: stop.signal, fetchTeams: firstOnly })
    );
    expect(result).toMatchObject({ end: "stopped", answered: 1, filed: 1 });
    expect(result.version).toBe(before.version + 1);
  });

  it("files nothing into a copy deleted and started again while it fetched", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    let fresh: CloudManifest | null = null;
    // While GameChanger answers, the copy is deleted and somebody starts a new one.
    const startAgain = async () => {
      cloud.setManifest(null);
      const saved = await commitChanges({
        store: cloud.store,
        base: null,
        changes: [{ key: LEAGUE_PART, value: { seasons: ["a fresh start"] }, at: 3 }],
        device: "laptop",
        now: "2026-09-29T13:00:30.000Z",
      });
      if (!saved.ok) throw new Error("start again");
      fresh = saved.manifest;
    };
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", { fetchTeams: answering(startAgain) })
    );
    expect(result).toMatchObject({ end: "copy-replaced", changed: [] });
    expect(result.manifest).toBeUndefined();
    expect(cloud.manifest()).toEqual(fresh);
  });

  it("files nothing into a copy whose Team Rankings was started again while it fetched", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    let started: CloudManifest | null = null;
    // While GameChanger answers, the owner starts Team Rankings again: the copy keeps its id.
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", {
        fetchTeams: answering(async () => {
          started = await startAgain(cloud);
        }),
      })
    );
    expect(started!.copy).toBe(before.copy);
    expect(started!.parts.map((part) => part.key)).toEqual([LEAGUE_PART]);
    expect(result).toMatchObject({ end: "copy-replaced", changed: [], answered: 2 });
    expect(result.manifest).toBeUndefined();
    // The emptied copy is as the start left it: not one team of the answers filed into it.
    expect(cloud.manifest()).toEqual(started);
  });

  it("asks GameChanger nothing for a job whose first part read another start of Team Rankings", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const fetchTeams = vi.fn(answering());
    const elsewhere = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", {
        fetchTeams,
        startedOn: { copy: before.copy, epoch: "an-earlier-start" },
      })
    );
    expect(elsewhere).toMatchObject({ end: "copy-replaced", asked: 0, changed: [] });
    expect(fetchTeams).not.toHaveBeenCalled();
    expect(cloud.manifest()).toEqual(before);
    // Held to the start it did read, the same job's part runs as any other.
    const same = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", { fetchTeams, startedOn: epochOf(before) })
    );
    expect(same).toMatchObject({ end: "finished", answered: 2 });
  });

  it("files none of an import's downloads once Team Rankings is started again after it chose them", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const selected = await selectImportTeams(cloud.store, list);
    expect(selected).toMatchObject({ copy: base.copy, epoch: base.epoch });
    const started = await startAgain(cloud);
    let consumed = 0;
    const source = () =>
      (async function* () {
        consumed++;
        yield schedules.get(ACES)!;
      })();
    const result = await finishStagedImport(
      list,
      source,
      selected,
      { asked: 2, answered: 1, failed: 1 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:02:00.000Z"),
        device: "import-test",
      }
    );
    expect(result).toMatchObject({ end: "copy-replaced", filed: 0, changed: [] });
    expect(consumed).toBe(0);
    expect(cloud.manifest()).toEqual(started);
  });

  it("gives up on a copy that keeps moving, writing nothing and leaving no pieces behind", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const pieces = cloud.chunks.size;
    const moving = { ...cloud.store, commitManifest: async () => false };
    const result = await runCloudPull(list, {
      ...deps(cloud, "2026-09-29T13:00:00.000Z"),
      store: moving,
    });
    expect(result).toMatchObject({ end: "copy-kept-changing", changed: [] });
    expect(result.manifest).toBeUndefined();
    expect(cloud.manifest()).toEqual(before);
    expect(cloud.chunks.size).toBe(pieces);
  });

  it("leaves alone a copy saved by a newer build or tidied by newer rules, asking nothing", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const fetchTeams = vi.fn(answering());
    cloud.setManifest({ ...before, schema: DATA_SCHEMA + 1 });
    const newer = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams }));
    expect(newer.end).toBe("newer-copy");
    expect(newer.manifest).toBeUndefined();

    const other = memoryCloud();
    await seed(other, () => saveTidyStamp("r999|0|0|0|"));
    const rules = await runCloudPull(list, deps(other, "2026-09-29T13:00:00.000Z", { fetchTeams }));
    expect(rules.end).toBe("newer-copy");
    expect(fetchTeams).not.toHaveBeenCalled();
  });

  it("says so when there is no copy, and refuses one holding a key this build does not keep", async () => {
    const empty = memoryCloud();
    const none = await runCloudPull(list, deps(empty, "2026-09-29T13:00:00.000Z"));
    expect(none.end).toBe("no-copy");
    expect(none.manifest).toBeUndefined();

    const cloud = memoryCloud();
    const before = await seed(cloud);
    const unknown = await commitChanges({
      store: cloud.store,
      base: before,
      changes: [{ key: "league_forecast_from_the_future_v9", value: 1, at: 3 }],
      device: "phone",
      now: "2026-09-29T12:00:00.000Z",
    });
    expect(unknown.ok).toBe(true);
    await expect(runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"))).rejects.toThrow(
      /pool key this build does not keep/
    );
  });
});
