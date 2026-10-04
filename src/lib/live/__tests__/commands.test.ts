import { describe, expect, it } from "vitest";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../teamRankings/types";
import { namedAgesList, type NamedAge } from "../../namedAges";
import type { AgeUnknownTeam } from "../../ageUnknown";
import type { RefreshCadence } from "../../gameChangerSchedule";
import { NO_MEMBERSHIP, type OrgMembership } from "../../orgMembership";
import { encodeScoutGames, encodeScoutTeams } from "../../teamRankingsCompact";
import {
  applyCommand,
  changeBetween,
  coerceCommand,
  isOwnerCommand,
  MAX_COMMAND_STEPS,
  poolParts,
  type PoolParts,
  type AnswerList,
  type PoolCommand,
  type PoolRead,
  type PoolWrite,
} from "../commands";

/*
 * Team Rankings' edits as commands (`commands.ts`): each makes its change to the part it touches
 * and nothing else, and each comes with the command that takes it back exactly, every part it
 * touched restored to the value it held. Placeholder names throughout.
 */

type Parts = {
  teams: ScoutTeam[];
  groups: AgeGroup[];
  games: Map<number | null, ScoutGame[]>;
  answers: Map<AnswerList, Set<string>>;
  named: Map<string, NamedAge>;
  ageless: AgeUnknownTeam[];
  cadence: RefreshCadence;
  orgs: OrgMembership;
};

const applyWrites = (parts: Parts, writes: readonly PoolWrite[]) =>
  writes.forEach((one) => {
    if (one.part === "teams") parts.teams = one.teams;
    else if (one.part === "groups") parts.groups = one.groups;
    else if (one.part === "games") parts.games.set(one.year, one.games);
    else if (one.part === "answers") parts.answers.set(one.list, one.ids);
    else if (one.part === "namedAges") parts.named = one.named;
    else if (one.part === "cadence") parts.cadence = one.cadence;
    else if (one.part === "orgs") parts.orgs = one.membership;
    else parts.ageless = one.list;
  });

const memory = (parts: Parts) => {
  const read: PoolRead = {
    teams: () => parts.teams,
    groups: () => parts.groups,
    years: () => [...parts.games.keys()],
    games: (year) => parts.games.get(year) ?? [],
    answers: (list) => parts.answers.get(list) ?? new Set(),
    namedAges: () => parts.named,
    ageless: () => parts.ageless,
    cadence: () => parts.cadence,
    orgs: () => parts.orgs,
  };
  const write = (writes: readonly PoolWrite[]) => applyWrites(parts, writes);
  /** Applies, writes, and hands back what came of it; throws when it was not applied. */
  const run = (command: PoolCommand) => {
    const result = applyCommand(read, command);
    if (!result.ok) throw new Error(`not applied: ${result.why}`);
    write(result.writes);
    return result;
  };
  return { read, run, parts };
};

/** A part as storage would keep it, so that two equal values compare equal however built. */
const stored = (parts: Parts) => ({
  teams: JSON.stringify(encodeScoutTeams(parts.teams)),
  groups: JSON.stringify(parts.groups),
  games: [...parts.games.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([year, games]) => [year, JSON.stringify(encodeScoutGames(games))]),
  answers: [...parts.answers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([list, ids]) => [list, [...ids].sort()]),
  named: JSON.stringify(namedAgesList(parts.named)),
  ageless: JSON.stringify(parts.ageless),
  cadence: parts.cadence,
  orgs: JSON.stringify(parts.orgs),
});

const clone = (parts: Parts): Parts => ({
  teams: structuredClone(parts.teams),
  groups: structuredClone(parts.groups),
  games: new Map([...parts.games].map(([year, games]) => [year, structuredClone(games)])),
  answers: new Map([...parts.answers].map(([list, ids]) => [list, new Set(ids)])),
  named: new Map(parts.named),
  ageless: structuredClone(parts.ageless),
  cadence: parts.cadence,
  orgs: structuredClone(parts.orgs),
});

const club = (id: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name: `Club ${id}`,
  ...extra,
});

const played = (id: string, a: string, b: string, scoreA: number, scoreB: number) => ({
  id,
  ageGroupId: "ag_10u_2027",
  teamAId: a,
  teamBId: b,
  teamAScore: scoreA,
  teamBScore: scoreB,
});

/** A team nobody could age, waiting on somebody to say, one of them with what was kept about it. */
const waitingOn = (teamId: string): AgeUnknownTeam => ({
  teamId,
  name: `Placeholder ${teamId}`,
  firstSeen: "2026-09-01T00:00:00.000Z",
  lastTried: "2026-09-08T00:00:00.000Z",
  tries: 2,
  ...(teamId === "gcW2"
    ? {
        evidence: {
          games: 3,
          scored: 2,
          aheadOfToday: 0,
          shutoutBlowouts: 1,
          opponents: 3,
          namedAnAge: 0,
          tally: [],
          city: "Sampleton",
          state: "OH",
        },
      }
    : {}),
});

const POOL = (): Parts => ({
  teams: [
    club("A", {
      state: "OH",
      gcTeams: [{ teamId: "gcA", name: "Club A 10U", ageGroupId: "ag_10u_2027" }],
    }),
    club("B", {
      gcTeams: [
        { teamId: "gcB1", name: "Club B 10U", ageGroupId: "ag_10u_2027" },
        { teamId: "gcB2", name: "Club B Fall", ageGroupId: "ag_10u_2026" },
      ],
    }),
    club("C"),
  ],
  groups: [
    { id: "ag_10u_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
    { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [], myTeamId: "C" },
    { id: "ag_old", name: "Old", seasonIds: [] },
  ],
  games: new Map<number | null, ScoutGame[]>([
    [2027, [played("g1", "A", "B", 5, 4), played("g2", "B", "C", 34, 0)]],
    [2026, [{ ...played("old", "A", "C", 2, 1), ageGroupId: "ag_10u_2026" }]],
    [null, [{ id: "open", ageGroupId: "ag_old", teamAId: "A", teamBId: "B" }]],
  ]),
  answers: new Map<AnswerList, Set<string>>([
    ["realClubs", new Set(["gcA"])],
    ["ageRight", new Set()],
    ["keptApart", new Set()],
    ["droppedClubs", new Set()],
    ["deletedGames", new Set()],
  ]),
  named: new Map(),
  ageless: [1, 2, 3, 4].map((at) => waitingOn(`gcW${at}`)),
  cadence: "daily",
  orgs: NO_MEMBERSHIP,
});

describe("a command's change", () => {
  it("writes the one year a game is in, and no other", () => {
    const pool = memory(POOL());
    const result = pool.run({
      kind: "game.score",
      year: null,
      gameId: "open",
      teamAScore: 6,
      teamBScore: 3,
    });
    expect(result.writes.map((write) => write.part)).toEqual(["games"]);
    expect(pool.parts.games.get(null)?.[0]).toMatchObject({ teamAScore: 6, teamBScore: 3 });
    expect(pool.parts.games.get(2027)).toEqual(POOL().games.get(2027));
  });

  it("vouches for a lopsided score at the margin it reads now, and nothing for one unplayed", () => {
    const pool = memory(POOL());
    pool.run({ kind: "game.confirm", year: 2027, gameId: "g2" });
    expect(pool.parts.games.get(2027)?.[1]?.scoreConfirmed).toBe(34);
    expect(pool.run({ kind: "game.confirm", year: null, gameId: "open" }).writes).toEqual([]);
  });

  it("keeps a game out of the maths and puts it back, the field gone when it counts", () => {
    const pool = memory(POOL());
    pool.run({ kind: "game.exclude", year: 2027, gameId: "g1", excluded: true });
    expect(pool.parts.games.get(2027)?.[0]?.excluded).toBe(true);
    pool.run({ kind: "game.exclude", year: 2027, gameId: "g1", excluded: false });
    expect(pool.parts.games.get(2027)?.[0]).not.toHaveProperty("excluded");
  });

  it("finds no game that is not in the year named", () => {
    const pool = memory(POOL());
    expect(applyCommand(pool.read, { kind: "game.confirm", year: 2026, gameId: "g2" })).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("refuses a score that is not a count of runs, and a state that is not two letters", () => {
    const pool = memory(POOL());
    const score = (teamAScore: number) =>
      applyCommand(pool.read, {
        kind: "game.score",
        year: 2027,
        gameId: "g1",
        teamAScore,
        teamBScore: 1,
      });
    expect(score(-1)).toEqual({ ok: false, why: "refused" });
    expect(score(2.5)).toEqual({ ok: false, why: "refused" });
    expect(applyCommand(pool.read, { kind: "team.state", teamId: "A", state: "Ohio" })).toEqual({
      ok: false,
      why: "refused",
    });
  });

  it("sets a club's state, normalised, and clears it", () => {
    const pool = memory(POOL());
    pool.run({ kind: "team.state", teamId: "C", state: "ky" });
    expect(pool.parts.teams[2]?.state).toBe("KY");
    pool.run({ kind: "team.state", teamId: "C", state: null });
    expect(pool.parts.teams[2]).not.toHaveProperty("state");
  });

  it("adds a club League Standings made only when it is given a state, and only that club", () => {
    const pool = memory(POOL());
    const adopt = club("S-LEAGUE");
    expect(pool.run({ kind: "team.state", teamId: "S-LEAGUE", state: null, adopt }).writes).toEqual(
      []
    );
    pool.run({ kind: "team.state", teamId: "S-LEAGUE", state: "IN", adopt });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C", "S-LEAGUE"]);
    expect(pool.parts.teams[3]?.state).toBe("IN");
    expect(applyCommand(pool.read, { kind: "team.state", teamId: "S-NONE", state: "IN" })).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("takes one GameChanger id off a club, leaving the rest", () => {
    const pool = memory(POOL());
    pool.run({ kind: "team.unlinkGc", teamId: "B", gcTeamId: "gcB2" });
    expect(pool.parts.teams[1]?.gcTeams?.map((link) => link.teamId)).toEqual(["gcB1"]);
    expect(pool.run({ kind: "team.unlinkGc", teamId: "B", gcTeamId: "gcB2" }).writes).toEqual([]);
  });

  it("adds and takes answers, writing nothing when nothing changes", () => {
    const pool = memory(POOL());
    pool.run({ kind: "answers", list: "realClubs", add: ["gcB1", "gcB2"], remove: ["gcA"] });
    expect([...pool.parts.answers.get("realClubs")!].sort()).toEqual(["gcB1", "gcB2"]);
    expect(
      pool.run({ kind: "answers", list: "realClubs", add: ["gcB1"], remove: ["gcA"] }).writes
    ).toEqual([]);
  });

  it("adds games at the end of their year, with the new clubs they name and no others", () => {
    const pool = memory(POOL());
    const game = { id: "scout_1", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "S-NEW" };
    pool.run({
      kind: "game.add",
      year: 2027,
      games: [game],
      // A, held already (another device may have added it since), is passed over.
      adopt: [club("S-NEW"), club("A", { state: "XX" })],
    });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "g2", "scout_1"]);
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C", "S-NEW"]);
    expect(pool.parts.teams[0]).not.toHaveProperty("state", "XX");
  });

  it("refuses a club to add that the games do not name, or one offered twice", () => {
    const pool = memory(POOL());
    const game = { id: "scout_1", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "S-NEW" };
    const add = (adopt: ScoutTeam[]) =>
      applyCommand(pool.read, { kind: "game.add", year: 2027, games: [game], adopt });
    expect(add([club("S-NEW"), club("S-UNNAMED")])).toEqual({ ok: false, why: "refused" });
    expect(add([club("S-NEW"), club("S-NEW")])).toEqual({ ok: false, why: "refused" });
    expect(add([club("S-NEW")]).ok).toBe(true);
  });

  it("adds no game whose id is taken, nor one naming a club nobody holds", () => {
    const pool = memory(POOL());
    const add = (game: ScoutGame) =>
      applyCommand(pool.read, { kind: "game.add", year: 2027, games: [game], adopt: [] });
    expect(add({ id: "g1", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "B" })).toEqual({
      ok: false,
      why: "refused",
    });
    expect(add({ id: "g9", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "S-GHOST" })).toEqual({
      ok: false,
      why: "missing",
    });
    const twice = { id: "g9", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "B" };
    expect(
      applyCommand(pool.read, { kind: "game.add", year: 2027, games: [twice, twice], adopt: [] })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("takes games out of their year and puts them back where they stood", () => {
    const pool = memory(POOL());
    const result = pool.run({ kind: "game.remove", year: 2027, gameIds: ["g1"] });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g2"]);
    expect(result.inverse).toEqual({
      kind: "game.insert",
      year: 2027,
      games: [{ game: played("g1", "A", "B", 5, 4), at: 0 }],
    });
    pool.run(result.inverse);
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "g2"]);
  });

  it("puts games back where they stood in whatever order they arrive, and none over one held", () => {
    const pool = memory(POOL());
    const lost = (id: string) => played(id, "A", "B", 1, 0);
    // Places in the list as it grows: x first at 0, then y at 2, behind g1.
    pool.run({
      kind: "game.insert",
      year: 2027,
      games: [
        { game: lost("y"), at: 2 },
        { game: lost("x"), at: 0 },
      ],
    });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["x", "g1", "y", "g2"]);
    expect(
      applyCommand(pool.read, {
        kind: "game.insert",
        year: 2027,
        games: [{ game: lost("g1"), at: 0 }],
      })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("takes a club off the roster and puts it back in its place, and none over one held", () => {
    const parts = POOL();
    // A club no game names and no page marks, between two that are named.
    parts.teams.splice(1, 0, club("D"));
    const pool = memory(parts);
    const result = pool.run({ kind: "team.remove", teamId: "D" });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C"]);
    pool.run(result.inverse);
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "D", "B", "C"]);
    expect(applyCommand(pool.read, { kind: "team.insert", team: club("A"), at: 0 })).toEqual({
      ok: false,
      why: "refused",
    });
  });

  it("takes a club off a page: its games there, the page's mark, and the club only when nothing is left of it", () => {
    const pool = memory(POOL());
    // C plays B this year and A last year: off this page it keeps its record.
    pool.run({ kind: "club.leavePage", ageGroupId: "ag_10u_2027", teamId: "C" });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1"]);
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C"]);
    expect(pool.parts.groups[1]).not.toHaveProperty("myTeamId");
    // Off last year's page as well, nothing is left of it.
    pool.run({ kind: "club.leavePage", ageGroupId: "ag_10u_2026", teamId: "C" });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B"]);
  });

  it("reads an old page's year off its name, as storage files its games", () => {
    const parts = POOL();
    // A page from before pages stored their year: its games are filed under the year its name says.
    parts.groups.push({ id: "ag_named", name: "11U 2027", seasonIds: [] });
    parts.games.set(2027, [
      ...(parts.games.get(2027) ?? []),
      { ...played("named", "C", "A", 3, 2), ageGroupId: "ag_named" },
    ]);
    const pool = memory(parts);
    pool.run({ kind: "club.leavePage", ageGroupId: "ag_named", teamId: "C" });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "g2"]);
  });

  it("takes a club off one page alone, leaving its games on another page of the same year", () => {
    const parts = POOL();
    parts.groups.push({
      id: "ag_11u_2027",
      name: "11U 2027",
      ageLevel: 11,
      year: 2027,
      seasonIds: [],
    });
    parts.games.set(2027, [
      ...(parts.games.get(2027) ?? []),
      { ...played("up", "C", "A", 3, 2), ageGroupId: "ag_11u_2027" },
    ]);
    const pool = memory(parts);
    pool.run({ kind: "club.leavePage", ageGroupId: "ag_10u_2027", teamId: "C" });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "up"]);
  });

  it("marks a page's team, a club League Standings made joining the roster under its id", () => {
    const pool = memory(POOL());
    pool.run({
      kind: "page.myTeam",
      ageGroupId: "ag_10u_2026",
      teamId: "S-L1",
      adopt: club("S-L1"),
    });
    expect(pool.parts.groups[0]?.myTeamId).toBe("S-L1");
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C", "S-L1"]);
    pool.run({ kind: "page.myTeam", ageGroupId: "ag_10u_2026", teamId: null });
    expect(pool.parts.groups[0]).not.toHaveProperty("myTeamId");
    expect(
      applyCommand(pool.read, { kind: "page.myTeam", ageGroupId: "ag_10u_2026", teamId: "S-NONE" })
    ).toEqual({ ok: false, why: "missing" });
    // The club offered must be the one marked, or the mark would hold an id nobody has.
    expect(
      applyCommand(pool.read, {
        kind: "page.myTeam",
        ageGroupId: "ag_10u_2026",
        teamId: "S-NONE",
        adopt: club("S-OTHER"),
      })
    ).toEqual({ ok: false, why: "missing" });
  });

  it("lays each command of a batch over the last, writing each part once", () => {
    const pool = memory(POOL());
    const result = pool.run({
      kind: "batch",
      commands: [
        { kind: "team.state", teamId: "A", state: "KY" },
        { kind: "team.unlinkGc", teamId: "A", gcTeamId: "gcA" },
        { kind: "game.exclude", year: 2027, gameId: "g1", excluded: true },
      ],
    });
    expect(result.writes.map((write) => write.part)).toEqual(["teams", "games"]);
    expect(pool.parts.teams[0]).toEqual({ id: "A", name: "Club A", state: "KY" });
  });
});

describe("the clean-up commands", () => {
  const own = (id: string, gcTeamId: string, a: string, b: string) => ({
    ...played(id, a, b, 3, 1),
    source: { kind: "gamechanger" as const, teamId: gcTeamId, gameId: `row-${id}` },
  });

  it("throws games out of whichever years hold them, remembering the rows that scored them", () => {
    const pool = memory(POOL());
    pool.run({ kind: "games.drop", gameIds: ["g2", "old", "nowhere"] });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1"]);
    expect(pool.parts.games.get(2026)).toEqual([]);
    expect([...(pool.parts.answers.get("deletedGames") ?? [])].sort()).toEqual(["g2", "old"]);
    expect(applyCommand(pool.read, { kind: "games.drop", gameIds: ["nowhere"] })).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("throws a club out: its games, their rows, its GameChanger ids and the club", () => {
    const parts = POOL();
    parts.games.set(2027, [...(parts.games.get(2027) ?? []), own("mine", "gcB1", "B", "C")]);
    const pool = memory(parts);
    pool.run({ kind: "club.drop", teamId: "B" });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "C"]);
    expect(pool.parts.games.get(2027)).toEqual([]);
    expect(pool.parts.games.get(null)).toEqual([]);
    expect([...(pool.parts.answers.get("droppedClubs") ?? [])].sort()).toEqual(["gcB1", "gcB2"]);
    // The game's own id, and the row it was made from, which a pull matches on.
    expect([...(pool.parts.answers.get("deletedGames") ?? [])].sort()).toEqual(
      ["g1", "g2", "gc_gcB1_row-mine", "mine", "open"].sort()
    );
    expect(applyCommand(pool.read, { kind: "club.drop", teamId: "B" })).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("puts a league season on the page of its age, making the page under the id it is given", () => {
    const pool = memory(POOL());
    const made = { kind: "season.assign", seasonId: "s1", pageId: "ag_new" } as const;
    pool.run({ ...made, season: { ageLevel: 11, year: 2027 } });
    expect(pool.parts.groups.map((group) => group.id)).toContain("ag_new");
    expect(pool.parts.groups.find((group) => group.id === "ag_new")?.seasonIds).toEqual(["s1"]);
    // Moved to a page that is there, it leaves the one it was on.
    pool.run({ ...made, pageId: "ag_unused", season: { ageLevel: 10, year: 2027 } });
    expect(pool.parts.groups.find((group) => group.id === "ag_new")?.seasonIds).toEqual([]);
    expect(pool.parts.groups[1]?.seasonIds).toEqual(["s1"]);
    pool.run({ ...made, season: null });
    expect(pool.parts.groups[1]?.seasonIds).toEqual([]);
    // A page to make under an id a page has already is refused.
    expect(
      applyCommand(pool.read, { ...made, pageId: "ag_old", season: { ageLevel: 12, year: 2027 } })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("files a club at the age it is said to play, holding it there, and takes that back", () => {
    const parts = POOL();
    parts.games.set(2027, [...(parts.games.get(2027) ?? []), own("mine", "gcA", "A", "C")]);
    const pool = memory(parts);
    pool.run({
      kind: "club.age",
      year: 2027,
      teamId: "A",
      level: 11,
      at: "2026-09-30T12:00:00.000Z",
      pageId: "ag_11",
    });
    expect(pool.parts.groups.find((group) => group.id === "ag_11")?.name).toBe("11U 2027");
    expect(pool.parts.teams[0]?.gcTeams?.[0]).toMatchObject({
      ageGroupId: "ag_11",
      ageLevel: 11,
      ageFrom: "you",
    });
    // Its own schedule's row moves with it; the other clubs' rows stay where they were filed.
    expect(pool.parts.games.get(2027)?.find((one) => one.id === "mine")?.ageGroupId).toBe("ag_11");
    expect(pool.parts.games.get(2027)?.find((one) => one.id === "g1")?.ageGroupId).toBe(
      "ag_10u_2027"
    );
    expect(pool.parts.named.get("gcA")).toEqual({
      teamId: "gcA",
      level: 11,
      name: "Club A 10U",
      namedAt: "2026-09-30T12:00:00.000Z",
      pinned: true,
      was: 10,
    });
    pool.run({ kind: "club.ageClear", year: 2027, teamId: "A", pageId: "ag_back" });
    expect(pool.parts.named.has("gcA")).toBe(false);
    expect(pool.parts.teams[0]?.gcTeams?.[0]).toMatchObject({
      ageGroupId: "ag_10u_2027",
      ageLevel: 10,
    });
    expect(pool.parts.teams[0]?.gcTeams?.[0]).not.toHaveProperty("ageFrom");
    expect(pool.parts.games.get(2027)?.find((one) => one.id === "mine")?.ageGroupId).toBe(
      "ag_10u_2027"
    );
  });

  it("takes back an age held on ids the app had at two levels, each to its own, and undoes that exactly", () => {
    const parts = POOL();
    // gcB3 was filed at 11U on the 10U page (its own level recorded), so no 11U page is there.
    parts.teams[1] = {
      ...parts.teams[1]!,
      gcTeams: [
        ...(parts.teams[1]?.gcTeams ?? []),
        { teamId: "gcB3", name: "Club B 11U", ageGroupId: "ag_10u_2027", ageLevel: 11 },
      ],
    };
    const pool = memory(parts);
    pool.run({ kind: "club.age", year: 2027, teamId: "B", level: 12, at: "t", pageId: "ag_12" });
    expect(pool.parts.named.get("gcB1")?.was).toBe(10);
    expect(pool.parts.named.get("gcB3")?.was).toBe(11);
    const held = stored(clone(pool.parts));
    const cleared = pool.run({ kind: "club.ageClear", year: 2027, teamId: "B", pageId: "ag_back" });
    const links = pool.parts.teams[1]?.gcTeams ?? [];
    expect(links.find((link) => link.teamId === "gcB1")).toMatchObject({
      ageGroupId: "ag_10u_2027",
      ageLevel: 10,
    });
    // The second level back needed a page, made under the second id the command names.
    expect(links.find((link) => link.teamId === "gcB3")).toMatchObject({
      ageGroupId: "ag_back-1",
      ageLevel: 11,
    });
    expect(pool.parts.groups.find((group) => group.id === "ag_back-1")?.name).toBe("11U 2027");
    pool.run(cleared.inverse);
    expect(stored(pool.parts)).toEqual(held);
  });

  it("tells what it changed by identity, from a store that decodes every read afresh", () => {
    const parts = POOL();
    parts.games.set(2027, [...(parts.games.get(2027) ?? []), own("mine", "gcA", "A", "C")]);
    const pool = memory(parts);
    // As the browser's store does: a year read twice is two copies of it.
    const decoding: PoolRead = {
      ...pool.read,
      games: (year) => structuredClone(pool.read.games(year)),
    };
    const result = applyCommand(decoding, {
      kind: "club.age",
      year: 2027,
      teamId: "A",
      level: 11,
      at: "t",
      pageId: "ag_11",
    });
    if (!result.ok) throw new Error(result.why);
    // The undo puts back the one game that moved, not the year as it stood.
    const steps = result.inverse.kind === "batch" ? result.inverse.commands : [result.inverse];
    const flat = steps.flatMap((step) => (step.kind === "batch" ? step.commands : [step]));
    const put = flat.find((step) => step.kind === "game.put");
    expect(put?.kind === "game.put" && put.games.map((game) => game.id)).toEqual(["mine"]);
    expect(flat.some((step) => step.kind === "games.set")).toBe(false);
  });

  it("reads each part once, however often it is asked for it", () => {
    const pool = memory(POOL());
    const reads = new Map<string, number>();
    const counting: PoolRead = {
      ...pool.read,
      games: (year) => {
        reads.set(String(year), (reads.get(String(year)) ?? 0) + 1);
        return pool.read.games(year);
      },
    };
    applyCommand(counting, { kind: "teams.merge", fromId: "C", intoId: "A", adopt: [] });
    expect([...reads.values()].every((count) => count === 1)).toBe(true);
    expect(reads.size).toBe(3);
  });

  it("refuses an age it does not rank, a club with no link that year, and a taken page id", () => {
    const pool = memory(POOL());
    const age = (teamId: string, level: number, pageId = "ag_new") =>
      applyCommand(pool.read, { kind: "club.age", year: 2027, teamId, level, at: "t", pageId });
    expect(age("A", 3)).toEqual({ ok: false, why: "refused" });
    expect(age("C", 11)).toEqual({ ok: false, why: "refused" });
    expect(age("A", 11, "ag_old")).toEqual({ ok: false, why: "refused" });
    expect(age("S-NONE", 11)).toEqual({ ok: false, why: "missing" });
    // A page that is there already needs no id, so a taken one does not matter.
    expect(age("A", 10, "ag_old").ok).toBe(true);
  });

  it("folds one club into another, every page's mark following it", () => {
    const pool = memory(POOL());
    pool.run({ kind: "teams.merge", fromId: "C", intoId: "A", adopt: [] });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B"]);
    expect(pool.parts.games.get(2027)?.find((one) => one.id === "g2")).toMatchObject({
      teamAId: "B",
      teamBId: "A",
    });
    // A game between the two cannot survive: a club does not play itself.
    expect(pool.parts.games.get(2026)).toEqual([]);
    expect(pool.parts.groups[1]?.myTeamId).toBe("A");
  });

  it("folds into a club League Standings made, and refuses a club offered that is not one of the two", () => {
    const pool = memory(POOL());
    const merge = (adopt: ScoutTeam[], intoId = "S-L1") =>
      applyCommand(pool.read, { kind: "teams.merge", fromId: "C", intoId, adopt });
    expect(merge([club("S-L1"), club("S-L2")])).toEqual({ ok: false, why: "refused" });
    expect(merge([])).toEqual({ ok: false, why: "missing" });
    expect(merge([], "C")).toEqual({ ok: false, why: "refused" });
    pool.run({ kind: "teams.merge", fromId: "C", intoId: "S-L1", adopt: [club("S-L1")] });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "S-L1"]);
  });

  it("renames a club, and refuses a name another club goes by", () => {
    const pool = memory(POOL());
    pool.run({ kind: "team.rename", teamId: "C", name: "  Club   Z " });
    expect(pool.parts.teams[2]?.name).toBe("Club Z");
    const rename = (teamId: string, name: string) =>
      applyCommand(pool.read, { kind: "team.rename", teamId, name });
    expect(rename("C", "club a")).toEqual({ ok: false, why: "refused" });
    expect(rename("C", "  ")).toEqual({ ok: false, why: "refused" });
    // A club League Standings made takes its name from the league.
    expect(rename("S-L1", "Hawks")).toEqual({ ok: false, why: "missing" });
  });

  it("puts back a part whose records it left in another order, whole", () => {
    const pool = memory(POOL());
    const result = pool.run({ kind: "teams.set", teams: [club("C"), club("A"), club("B")] });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["C", "A", "B"]);
    expect(result.inverse.kind).toBe("teams.set");
    pool.run(result.inverse);
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C"]);
  });

  it("puts back a year holding one id twice exactly, whole", () => {
    const parts = POOL();
    const twice = played("g1", "A", "C", 9, 9);
    parts.games.set(2027, [...(parts.games.get(2027) ?? []), twice]);
    const pool = memory(parts);
    const held = stored(clone(pool.parts));
    const result = pool.run({ kind: "games.set", year: 2027, games: [twice] });
    expect(result.inverse.kind).toBe("games.set");
    pool.run(result.inverse);
    expect(stored(pool.parts)).toEqual(held);
  });

  it("puts back no game the year does not hold", () => {
    const pool = memory(POOL());
    expect(
      applyCommand(pool.read, {
        kind: "game.put",
        year: 2026,
        games: [played("g1", "A", "B", 1, 0)],
      })
    ).toEqual({ ok: false, why: "missing" });
  });

  it("puts back no page over one held", () => {
    const pool = memory(POOL());
    expect(
      applyCommand(pool.read, { kind: "group.insert", group: pool.parts.groups[0]!, at: 0 })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("refuses to take back an age onto a page it would make under an id a page has", () => {
    const parts = POOL();
    // gcB3 was filed at 11U on the 10U page, so going back needs an 11U page.
    parts.teams[1] = {
      ...parts.teams[1]!,
      gcTeams: [{ teamId: "gcB3", name: "Club B 11U", ageGroupId: "ag_10u_2027", ageLevel: 11 }],
    };
    const pool = memory(parts);
    pool.run({ kind: "club.age", year: 2027, teamId: "B", level: 12, at: "t", pageId: "ag_12" });
    expect(
      applyCommand(pool.read, { kind: "club.ageClear", year: 2027, teamId: "B", pageId: "ag_old" })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("files every game of a merge under the year storage reads off its page, an old page's name too", () => {
    const parts = POOL();
    parts.groups.push({ id: "ag_named", name: "11U 2027", seasonIds: [] });
    parts.games.set(2027, [
      ...(parts.games.get(2027) ?? []),
      { ...played("named", "A", "B", 3, 2), ageGroupId: "ag_named" },
    ]);
    const pool = memory(parts);
    pool.run({ kind: "teams.merge", fromId: "C", intoId: "A", adopt: [] });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "g2", "named"]);
    expect(pool.parts.games.get(null)?.map((one) => one.id)).toEqual(["open"]);
  });

  it("takes away no page a game is on", () => {
    const pool = memory(POOL());
    expect(applyCommand(pool.read, { kind: "group.remove", groupId: "ag_10u_2026" })).toEqual({
      ok: false,
      why: "refused",
    });
  });
});

/** The parts `changeBetween` compares. */
const partsOf = (parts: Parts): PoolParts => ({
  teams: parts.teams,
  groups: parts.groups,
  games: parts.games,
});

describe("work done on a copy of the pool", () => {
  it("is laid onto the pool as it is now, keeping what was changed meanwhile", () => {
    const start = POOL();
    // A tidy, say, on a copy: one game's score fixed, another game gone, a club renamed.
    const copy = clone(start);
    copy.games.set(2027, [{ ...played("g1", "A", "B", 6, 4) }]);
    copy.teams = copy.teams.map((team) => (team.id === "C" ? { ...team, name: "Club See" } : team));
    // Meanwhile on the pool itself: last year's game excluded, a new game added this year.
    const pool = memory(clone(start));
    pool.run({ kind: "game.exclude", year: 2026, gameId: "old", excluded: true });
    pool.run({
      kind: "game.add",
      year: 2027,
      games: [{ id: "scout_9", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "C" }],
      adopt: [],
    });
    pool.run(changeBetween(partsOf(start), partsOf(copy)));
    expect(pool.parts.games.get(2027)?.map((one) => [one.id, one.teamAScore])).toEqual([
      ["g1", 6],
      ["scout_9", undefined],
    ]);
    expect(pool.parts.games.get(2026)?.[0]?.excluded).toBe(true);
    expect(pool.parts.teams[2]?.name).toBe("Club See");
  });

  it("brings in a year only the work holds, and writes nothing for a record held the same", () => {
    const start = POOL();
    const copy = clone(start);
    copy.groups = [
      ...copy.groups,
      { id: "ag_10u_2028", name: "10U 2028", ageLevel: 10, year: 2028, seasonIds: [] },
    ];
    copy.games.set(2028, [{ ...played("next", "A", "B", 1, 0), ageGroupId: "ag_10u_2028" }]);
    // The same record, with a field that holds nothing: storage keeps it as not there at all.
    copy.teams = copy.teams.map((team) => (team.id === "C" ? { ...team, state: undefined } : team));
    const pool = memory(clone(start));
    const result = pool.run(changeBetween(partsOf(start), partsOf(copy)));
    expect(pool.parts.games.get(2028)?.map((one) => one.id)).toEqual(["next"]);
    expect(result.writes.map((write) => write.part).sort()).toEqual(["games", "groups"]);
  });

  it("calls a record the same whichever side holds a field with nothing in it", () => {
    const start = POOL();
    start.teams[1] = { ...start.teams[1]!, city: undefined };
    const copy = clone(start);
    copy.teams[1] = { id: "B", name: "Club B", gcTeams: start.teams[1]?.gcTeams };
    const pool = memory(clone(start));
    expect(pool.run(changeBetween(partsOf(start), partsOf(copy))).writes).toEqual([]);
  });

  it("is split by the year storage reads off each page", () => {
    const parts = poolParts({
      teams: [],
      ageGroups: [
        { id: "ag_named", name: "11U 2027", seasonIds: [] },
        { id: "ag_none", name: "Open", seasonIds: [] },
      ],
      games: [
        { id: "a", ageGroupId: "ag_named", teamAId: "A", teamBId: "B" },
        { id: "b", ageGroupId: "ag_none", teamAId: "A", teamBId: "B" },
        { id: "c", ageGroupId: "ag_gone", teamAId: "A", teamBId: "B" },
      ],
    });
    expect([...parts.games].map(([year, games]) => [year, games.map((one) => one.id)])).toEqual([
      [2027, ["a"]],
      [null, ["b", "c"]],
    ]);
  });
});

describe("what the review of 1.3 found", () => {
  it("adds, puts back or sets no game whose page is in another year or not in the pool", () => {
    const pool = memory(POOL());
    const elsewhere = { ...played("old", "B", "A", 9, 9), ageGroupId: "ag_10u_2026" };
    const nowhere = { ...played("g9", "A", "B", 1, 0), ageGroupId: "ag_gone" };
    for (const games of [[elsewhere], [nowhere]])
      expect(applyCommand(pool.read, { kind: "game.add", year: 2027, games, adopt: [] })).toEqual({
        ok: false,
        why: "refused",
      });
    // Storage files a game for no page with the games that have no year, so the year alone would
    // let it in there: it is the page that is missing.
    expect(
      applyCommand(pool.read, { kind: "game.add", year: null, games: [nowhere], adopt: [] })
    ).toEqual({ ok: false, why: "refused" });
    expect(
      applyCommand(pool.read, {
        kind: "game.insert",
        year: 2027,
        games: [{ game: nowhere, at: 0 }],
      })
    ).toEqual({ ok: false, why: "refused" });
    expect(applyCommand(pool.read, { kind: "games.set", year: 2027, games: [elsewhere] })).toEqual({
      ok: false,
      why: "refused",
    });
    expect(
      applyCommand(pool.read, {
        kind: "game.put",
        year: 2027,
        games: [{ ...played("g1", "A", "B", 1, 0), ageGroupId: "ag_10u_2026" }],
      })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("keeps a club an undo would take away when a game added since names it", () => {
    const pool = memory(POOL());
    const first = pool.run({
      kind: "game.add",
      year: 2027,
      games: [{ id: "i1", ageGroupId: "ag_10u_2027", teamAId: "A", teamBId: "S-NEW" }],
      adopt: [club("S-NEW")],
    });
    // Another game against the new club, added before the first one's Undo.
    pool.run({
      kind: "game.add",
      year: 2027,
      games: [{ id: "h1", ageGroupId: "ag_10u_2027", teamAId: "B", teamBId: "S-NEW" }],
      adopt: [],
    });
    pool.run(first.inverse);
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "g2", "h1"]);
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C", "S-NEW"]);
  });

  it("keeps a club an undo would take away while a page marks it as its own", () => {
    const pool = memory(POOL());
    const adopted = pool.run({
      kind: "team.state",
      teamId: "S-L1",
      state: "KY",
      adopt: club("S-L1"),
    });
    pool.run({ kind: "page.myTeam", ageGroupId: "ag_10u_2026", teamId: "S-L1" });
    pool.run(adopted.inverse);
    expect(pool.parts.teams.map((team) => team.id)).toContain("S-L1");
  });

  it("edits no game whose id the year holds twice, so no copy is lost to its undo", () => {
    const parts = POOL();
    parts.games.set(2027, [...(parts.games.get(2027) ?? []), played("g1", "A", "C", 9, 9)]);
    const pool = memory(parts);
    expect(
      applyCommand(pool.read, {
        kind: "game.score",
        year: 2027,
        gameId: "g1",
        teamAScore: 1,
        teamBScore: 1,
      })
    ).toEqual({ ok: false, why: "refused" });
    expect(
      applyCommand(pool.read, {
        kind: "game.put",
        year: 2027,
        games: [played("g1", "A", "B", 1, 0)],
      })
    ).toEqual({ ok: false, why: "refused" });
  });

  it("reads back the inverse of every drawn change, however it nests", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const next = seeded(seed);
      const pool = memory(POOL());
      for (let warm = 0; warm < 3; warm += 1) {
        const result = applyCommand(pool.read, drawCommand(pool.parts, next));
        if (result.ok) applyWrites(pool.parts, result.writes);
      }
      const command: PoolCommand = {
        kind: "batch",
        commands: [drawCommand(pool.parts, next), drawCommand(pool.parts, next)],
      };
      const result = applyCommand(pool.read, command);
      if (!result.ok) continue;
      expect([seed, coerceCommand(JSON.parse(JSON.stringify(result.inverse)))]).toEqual([
        seed,
        result.inverse,
      ]);
    }
  });

  it("reads no record with a field it cannot keep, rather than dropping the field", () => {
    for (const raw of [
      { kind: "team.put", team: { id: "A", name: "Club A", state: 5 } },
      {
        kind: "team.put",
        team: { id: "A", name: "Club A", gcTeams: [{ teamId: "gcA" }] },
      },
      {
        kind: "game.put",
        year: 2027,
        games: [{ ...played("g1", "A", "B", 5, 4), excluded: "yes" }],
      },
      {
        kind: "game.put",
        year: 2027,
        games: [
          { ...played("g1", "A", "B", 5, 4), source: { kind: "gamechanger", teamId: "gcA" } },
        ],
      },
      { kind: "group.put", group: { id: "ag_x", name: "X", seasonIds: [], ageLevel: "ten" } },
    ])
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
  });

  it("throws out a club its games still name when the roster holds no entry for it", () => {
    const parts = POOL();
    parts.games.set(2027, [...(parts.games.get(2027) ?? []), played("orphan", "Z", "A", 20, 0)]);
    const pool = memory(parts);
    pool.run({ kind: "club.drop", teamId: "Z" });
    expect(pool.parts.games.get(2027)?.map((one) => one.id)).toEqual(["g1", "g2"]);
    expect([...(pool.parts.answers.get("deletedGames") ?? [])]).toEqual(["orphan"]);
  });

  it("takes back a batch of batches with one flat batch, its steps in reverse", () => {
    const pool = memory(POOL());
    const before = stored(pool.parts);
    const result = pool.run({
      kind: "batch",
      commands: [
        {
          kind: "batch",
          commands: [
            { kind: "team.state", teamId: "B", state: "KY" },
            { kind: "game.score", year: null, gameId: "open", teamAScore: 6, teamBScore: 3 },
          ],
        },
        { kind: "game.exclude", year: 2027, gameId: "g1", excluded: true },
      ],
    });
    expect(result.inverse.kind).toBe("batch");
    const steps = result.inverse.kind === "batch" ? result.inverse.commands : [];
    expect(steps.map((step) => step.kind)).toEqual(["game.put", "game.put", "team.put"]);
    pool.run(result.inverse);
    expect(stored(pool.parts)).toEqual(before);
  });

  it("takes every page's mark off a club that leaves the roster, and puts them back", () => {
    const parts = POOL();
    // C's one game is on this year's page, and last year's page marks it too.
    parts.games.set(2026, []);
    parts.groups[0] = { ...parts.groups[0]!, myTeamId: "C" };
    const pool = memory(parts);
    const before = stored(pool.parts);
    const result = pool.run({ kind: "club.leavePage", ageGroupId: "ag_10u_2027", teamId: "C" });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B"]);
    expect(pool.parts.groups.filter((group) => group.myTeamId !== undefined)).toEqual([]);
    pool.run(result.inverse);
    expect(stored(pool.parts)).toEqual(before);
  });
});

/** A small seeded generator, so a failing draw can be run again. */
const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A command a person could have asked of `parts`, drawn by `next`. */
const drawCommand = (parts: Parts, next: () => number): PoolCommand => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const year = pick([2027, 2026, null] as const);
  const games = parts.games.get(year) ?? [];
  const game = games.length > 0 ? pick(games) : undefined;
  // Enough edits can leave no club at all.
  if (parts.teams.length === 0) return { kind: "none" };
  const team = pick(parts.teams);
  const ids = ["gcA", "gcB1", "gcB2", "gcC", "gcZ"];
  const n = Math.floor(next() * 1000);
  switch (Math.floor(next() * 22)) {
    case 0:
      return game
        ? {
            kind: "game.score",
            year,
            gameId: game.id,
            teamAScore: Math.floor(next() * 12),
            teamBScore: Math.floor(next() * 12),
          }
        : { kind: "none" };
    case 1:
      return game
        ? { kind: "game.exclude", year, gameId: game.id, excluded: next() < 0.5 }
        : { kind: "none" };
    case 2:
      return game ? { kind: "game.confirm", year, gameId: game.id } : { kind: "none" };
    case 3:
      return {
        kind: "team.state",
        teamId: team.id,
        state: next() < 0.3 ? null : pick(["KY", "oh", "IN"]),
      };
    case 4: {
      const link = team.gcTeams?.[0];
      return link
        ? { kind: "team.unlinkGc", teamId: team.id, gcTeamId: link.teamId }
        : { kind: "none" };
    }
    case 5:
      return {
        kind: "team.state",
        teamId: `S-L${Math.floor(next() * 3)}`,
        state: "KY",
        adopt: club(`S-L${Math.floor(next() * 3)}`),
      };
    case 6:
      return {
        kind: "answers",
        list: pick(["realClubs", "ageRight", "keptApart"] as const),
        add: ids.filter(() => next() < 0.3),
        remove: ids.filter(() => next() < 0.3),
      };
    case 7: {
      const other = pick(parts.teams);
      const fresh = next() < 0.5 ? club(`S-NEW${n}`) : undefined;
      return {
        kind: "game.add",
        year,
        games: [
          {
            id: `scout_${n}`,
            ageGroupId: year === 2027 ? "ag_10u_2027" : year === 2026 ? "ag_10u_2026" : "ag_old",
            teamAId: fresh?.id ?? team.id,
            teamBId: other.id === (fresh?.id ?? team.id) ? "A" : other.id,
            // Off a club's own schedule, half the time, so that an age set on it moves the row.
            ...(next() < 0.5
              ? { source: { kind: "gamechanger" as const, teamId: pick(ids), gameId: `r${n}` } }
              : {}),
          },
        ],
        adopt: fresh ? [fresh] : [],
      };
    }
    case 8:
      return {
        kind: "game.remove",
        year,
        gameIds: games.filter(() => next() < 0.5).map((one) => one.id),
      };
    case 9: {
      const page = pick(parts.groups);
      const n = Math.floor(next() * 3);
      return next() < 0.3
        ? { kind: "page.myTeam", ageGroupId: page.id, teamId: null }
        : next() < 0.5
          ? { kind: "page.myTeam", ageGroupId: page.id, teamId: `S-L${n}`, adopt: club(`S-L${n}`) }
          : { kind: "page.myTeam", ageGroupId: page.id, teamId: team.id };
    }
    case 10:
      return { kind: "club.leavePage", ageGroupId: pick(parts.groups).id, teamId: team.id };
    case 11:
      return {
        kind: "games.drop",
        gameIds: [...parts.games.values()]
          .flat()
          .filter(() => next() < 0.3)
          .map((one) => one.id),
      };
    case 12:
      return { kind: "club.drop", teamId: team.id };
    case 13:
      return {
        kind: "season.assign",
        seasonId: pick(["s1", "s2"]),
        season: next() < 0.2 ? null : { ageLevel: pick([10, 11]), year: pick([2026, 2027]) },
        pageId: `ag_p${n}`,
      };
    case 14:
      return {
        kind: "club.age",
        year: pick([2026, 2027]),
        teamId: team.id,
        level: pick([9, 10, 11]),
        at: `t${n}`,
        pageId: `ag_p${n}`,
      };
    case 15: {
      const year = pick([2026, 2027]);
      const clear: PoolCommand = {
        kind: "club.ageClear",
        year,
        teamId: team.id,
        pageId: `ag_q${n}`,
      };
      // On a club with an age held, alone; otherwise after holding one, so there is one to clear.
      return team.gcTeams?.some((link) => parts.named.get(link.teamId)?.pinned)
        ? clear
        : {
            kind: "batch",
            commands: [
              {
                kind: "club.age",
                year,
                teamId: team.id,
                level: pick([9, 11]),
                at: `t${n}`,
                pageId: `ag_p${n}`,
              },
              clear,
            ],
          };
    }
    case 16: {
      const league = next() < 0.3 ? club(`S-L${n % 3}`) : undefined;
      return {
        kind: "teams.merge",
        fromId: team.id,
        intoId: league?.id ?? pick(parts.teams).id,
        adopt: league ? [league] : [],
      };
    }
    case 17:
      return { kind: "team.rename", teamId: team.id, name: pick(["Club A", "Club Z", "Club Q"]) };
    case 18:
      return {
        kind: "ageless.forget",
        teamIds: ["gcW1", "gcW2", "gcW3", "gcW4", "gcW9"].filter(() => next() < 0.4),
      };
    case 19:
      return { kind: "refresh.cadence", cadence: pick(["daily", "rotation"] as const) };
    case 20:
      return {
        kind: "orgs.merge",
        orgs: [1, 2, 3]
          .filter(() => next() < 0.6)
          .map((at) => ({
            orgId: `org${at}`,
            name: pick([`Placeholder ${at}U`, `Placeholder Org ${at}`]),
            teamIds: ids.filter(() => next() < 0.5),
          }))
          .filter((org) => org.teamIds.length > 0),
        at: `2026-10-0${1 + (n % 9)}T00:00:00.000Z`,
      };
    default:
      return {
        kind: "batch",
        commands: [drawCommand(parts, next), drawCommand(parts, next)],
      };
  }
};

describe("a command's inverse", () => {
  it("puts every part the command touched back as it was, and again, over many drawn edits", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const next = seeded(seed);
      const pool = memory(POOL());
      // A few edits first, so the commands land on pools of every shape.
      for (let warm = 0; warm < 3; warm += 1) {
        const result = applyCommand(pool.read, drawCommand(pool.parts, next));
        if (result.ok) applyWrites(pool.parts, result.writes);
      }
      const start = clone(pool.parts);
      const before = stored(start);
      const command = drawCommand(pool.parts, next);
      const result = applyCommand(pool.read, command);
      if (!result.ok) continue;
      applyWrites(pool.parts, result.writes);
      const after = stored(clone(pool.parts));
      // The same change, read off the two pools, makes the same pool again.
      const again = memory(clone(start));
      const between = applyCommand(again.read, changeBetween(partsOf(start), partsOf(pool.parts)));
      expect([seed, between.ok]).toEqual([seed, true]);
      if (between.ok) applyWrites(again.parts, between.writes);
      expect([
        seed,
        stored({
          ...again.parts,
          answers: pool.parts.answers,
          named: pool.parts.named,
          ageless: pool.parts.ageless,
          cadence: pool.parts.cadence,
          orgs: pool.parts.orgs,
        }),
      ]).toEqual([seed, after]);
      const undone = applyCommand(pool.read, result.inverse);
      expect([seed, undone.ok]).toEqual([seed, true]);
      if (!undone.ok) continue;
      applyWrites(pool.parts, undone.writes);
      expect([seed, stored(pool.parts)]).toEqual([seed, before]);
      // And the undo's own inverse makes the change again, exactly.
      const redone = applyCommand(pool.read, undone.inverse);
      expect([seed, redone.ok]).toEqual([seed, true]);
      if (redone.ok) applyWrites(pool.parts, redone.writes);
      expect([seed, stored(pool.parts)]).toEqual([seed, after]);
    }
  });
});

describe("the teams nobody could age, taken off their list and put back", () => {
  it("takes the teams named off, and puts each back at its place", () => {
    const pool = memory(POOL());
    const before = stored(pool.parts);
    const forgot = pool.run({ kind: "ageless.forget", teamIds: ["gcW2", "gcW4", "gcZ"] });
    expect(pool.parts.ageless.map((entry) => entry.teamId)).toEqual(["gcW1", "gcW3"]);
    expect(forgot.writes.map((write) => write.part)).toEqual(["ageless"]);
    expect(forgot.inverse).toEqual({
      kind: "ageless.insert",
      rows: [
        { entry: waitingOn("gcW2"), at: 1 },
        { entry: waitingOn("gcW4"), at: 3 },
      ],
    });
    pool.run(forgot.inverse);
    expect(stored(pool.parts)).toEqual(before);
    // Put back at their places whatever order the rows come in.
    const firstTwo = pool.run({ kind: "ageless.forget", teamIds: ["gcW1", "gcW2"] });
    if (firstTwo.inverse.kind !== "ageless.insert") throw new Error("not an insert");
    pool.run({ ...firstTwo.inverse, rows: [...firstTwo.inverse.rows].reverse() });
    expect(stored(pool.parts)).toEqual(before);
    // Nothing on the list to take off is no change, and nothing to undo.
    expect(applyCommand(pool.read, { kind: "ageless.forget", teamIds: ["gcZ"] })).toEqual({
      ok: true,
      writes: [],
      inverse: { kind: "none" },
    });
  });

  it("leaves a team a pull has asked about again as the pull left it, and undoes only what it put back", () => {
    const pool = memory(POOL());
    const forgot = pool.run({ kind: "ageless.forget", teamIds: ["gcW1", "gcW2"] });
    // A pull asks about gcW2 again before the undo: its row is the pull's now.
    const relearned = { ...waitingOn("gcW2"), tries: 3 };
    pool.parts.ageless = [...pool.parts.ageless, relearned];
    const back = pool.run(forgot.inverse);
    expect(pool.parts.ageless.map((entry) => entry.teamId)).toEqual([
      "gcW1",
      "gcW3",
      "gcW4",
      "gcW2",
    ]);
    expect(pool.parts.ageless[3]).toBe(relearned);
    expect(back.inverse).toEqual({ kind: "ageless.forget", teamIds: ["gcW1"] });
  });

  it("is read back exactly, and refused with a row storage would have to change to keep", () => {
    const insert: PoolCommand = {
      kind: "ageless.insert",
      rows: [{ entry: waitingOn("gcW2"), at: 1 }],
    };
    expect(coerceCommand(JSON.parse(JSON.stringify(insert)))).toEqual(insert);
    const forget: PoolCommand = { kind: "ageless.forget", teamIds: ["gcW1"] };
    expect(coerceCommand(forget)).toEqual(forget);
    for (const raw of [
      { kind: "ageless.insert", rows: [{ entry: { ...waitingOn("gcW1"), tries: "2" }, at: 0 }] },
      { kind: "ageless.insert", rows: [{ entry: waitingOn("gcW1"), at: -1 }] },
      { kind: "ageless.insert", rows: [{ entry: waitingOn("gcW1"), at: 0, why: "rule" }] },
      { kind: "ageless.insert", rows: [{ entry: { ...waitingOn("gcW1"), mood: 1 }, at: 0 }] },
      { kind: "ageless.forget", teamIds: [""] },
      { kind: "ageless.forget", teamIds: "gcW1" },
    ]) {
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
    }
  });
});

describe("what the nightly refresh reads off the pool", () => {
  const ORG = (orgId: string, name: string, teamIds: string[]) => ({ orgId, name, teamIds });

  it("sets how much a refresh pulls at once, and takes it back", () => {
    const pool = memory(POOL());
    const made = pool.run({ kind: "refresh.cadence", cadence: "rotation" });
    expect(made.writes).toEqual([{ part: "cadence", cadence: "rotation" }]);
    expect(pool.parts.cadence).toBe("rotation");
    // Asked for what it already is, it writes nothing.
    expect(applyCommand(pool.read, { kind: "refresh.cadence", cadence: "rotation" })).toEqual({
      ok: true,
      writes: [],
      inverse: { kind: "none" },
    });
    pool.run(made.inverse);
    expect(pool.parts.cadence).toBe("daily");
  });

  it("keeps a file's organizations beside those kept, one named again replacing its own", () => {
    const pool = memory(POOL());
    const first = pool.run({
      kind: "orgs.merge",
      orgs: [ORG("o1", "Placeholder 9U", ["gcA"]), ORG("o2", "Placeholder 10U", ["gcB1"])],
      at: "2026-10-01T00:00:00.000Z",
    });
    expect(pool.parts.orgs.savedAt).toBe("2026-10-01T00:00:00.000Z");
    const before = clone(pool.parts);
    const second = pool.run({
      kind: "orgs.merge",
      orgs: [ORG("o2", "Placeholder 10U", ["gcB1", "gcB2"]), ORG("o3", "Placeholder 11U", ["gcC"])],
      at: "2026-10-02T00:00:00.000Z",
    });
    expect(pool.parts.orgs).toEqual({
      orgs: [
        ORG("o1", "Placeholder 9U", ["gcA"]),
        ORG("o2", "Placeholder 10U", ["gcB1", "gcB2"]),
        ORG("o3", "Placeholder 11U", ["gcC"]),
      ],
      savedAt: "2026-10-02T00:00:00.000Z",
    });
    // Its undo puts the membership back as it was, when it changed included.
    pool.run(second.inverse);
    expect(stored(pool.parts)).toEqual(stored(before));
    pool.run(first.inverse);
    expect(pool.parts.orgs).toEqual(NO_MEMBERSHIP);
  });

  it("writes nothing for a file with nothing new, nor moves when the membership changed", () => {
    const pool = memory(POOL());
    pool.run({ kind: "orgs.merge", orgs: [ORG("o1", "Placeholder 9U", ["gcA"])], at: "t1" });
    const again = applyCommand(pool.read, {
      kind: "orgs.merge",
      orgs: [ORG("o1", "Placeholder 9U", ["gcA"])],
      at: "t2",
    });
    expect(again).toEqual({ ok: true, writes: [], inverse: { kind: "none" } });
    expect(
      applyCommand(pool.read, { kind: "orgs.put", membership: structuredClone(pool.parts.orgs) })
    ).toEqual({ ok: true, writes: [], inverse: { kind: "none" } });
  });

  it("reads each step of a batch over the step before", () => {
    const pool = memory(POOL());
    const org = (teamIds: string[]) => ORG("o1", "Placeholder 9U", teamIds);
    const made = pool.run({
      kind: "batch",
      commands: [
        { kind: "refresh.cadence", cadence: "rotation" },
        { kind: "refresh.cadence", cadence: "daily" },
        { kind: "orgs.merge", orgs: [org(["gcA"])], at: "t1" },
        { kind: "orgs.merge", orgs: [org(["gcA"])], at: "t2" },
      ],
    });
    expect(pool.parts.cadence).toBe("daily");
    // The second file had nothing new by the time it was read, so the first one's time stands.
    expect(pool.parts.orgs).toEqual({ orgs: [org(["gcA"])], savedAt: "t1" });
    pool.run(made.inverse);
    expect(pool.parts.orgs).toEqual(NO_MEMBERSHIP);
  });

  it("is read back exactly as sent, and refused when it is not exactly a command", () => {
    const sent: PoolCommand[] = [
      { kind: "refresh.cadence", cadence: "rotation" },
      { kind: "orgs.merge", orgs: [ORG("o1", "Placeholder 9U", ["gcA", "gcB1"])], at: "t1" },
      {
        kind: "orgs.put",
        membership: { orgs: [ORG("o1", "Placeholder 9U", ["gcA"])], savedAt: "t1" },
      },
      { kind: "orgs.put", membership: NO_MEMBERSHIP },
    ];
    for (const command of sent)
      expect(coerceCommand(JSON.parse(JSON.stringify(command)))).toEqual(command);
    for (const raw of [
      { kind: "refresh.cadence", cadence: "weekly" },
      { kind: "orgs.merge", orgs: [ORG("o1", "Placeholder 9U", [])], at: "t1" },
      { kind: "orgs.merge", orgs: [ORG("", "Placeholder 9U", ["gcA"])], at: "t1" },
      {
        kind: "orgs.merge",
        orgs: [{ ...ORG("o1", "Placeholder 9U", ["gcA"]), city: "X" }],
        at: "t1",
      },
      { kind: "orgs.merge", orgs: [ORG("o1", "Placeholder 9U", ["gcA", ""])], at: "t1" },
      { kind: "orgs.merge", orgs: [ORG("o1", "Placeholder 9U", ["gcA"])], at: "" },
      { kind: "orgs.put", membership: { orgs: [] } },
      { kind: "orgs.put", membership: { orgs: [], savedAt: "t1", kept: true } },
    ])
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
  });
});

describe("a command as it arrives from elsewhere", () => {
  it("reads back every command exactly as it was sent", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const command = drawCommand(POOL(), seeded(seed));
      expect(coerceCommand(JSON.parse(JSON.stringify(command)))).toEqual(command);
    }
    const put: PoolCommand = {
      kind: "game.put",
      year: 2027,
      games: [played("g1", "A", "B", 5, 4)],
    };
    expect(coerceCommand(JSON.parse(JSON.stringify(put)))).toEqual(put);
    const back: PoolCommand = { kind: "team.put", team: club("A", { state: "OH" }) };
    expect(coerceCommand(JSON.parse(JSON.stringify(back)))).toEqual(back);
  });

  it("reads a batch nested five deep, and refuses one deeper", () => {
    const nested = (levels: number): PoolCommand =>
      Array.from({ length: levels - 1 }).reduce<PoolCommand>(
        (inner) => ({ kind: "batch", commands: [inner] }),
        { kind: "batch", commands: [{ kind: "none" }] }
      );
    expect(coerceCommand(JSON.parse(JSON.stringify(nested(5))))).toEqual(nested(5));
    expect(coerceCommand(JSON.parse(JSON.stringify(nested(6))))).toBeNull();
  });

  it("refuses a field it does not know, at the top and in each step of a batch", () => {
    const told: PoolCommand[] = [
      { kind: "team.rename", teamId: "A", name: "Club Q" },
      { kind: "game.score", year: 2027, gameId: "g1", teamAScore: 6, teamBScore: 3 },
      { kind: "club.drop", teamId: "B" },
      { kind: "none" },
    ];
    for (const command of told) {
      expect(coerceCommand(JSON.parse(JSON.stringify(command)))).toEqual(command);
      const more = { ...command, keepOldName: true };
      expect([more, coerceCommand(more)]).toEqual([more, null]);
      const inBatch = { kind: "batch", commands: [{ kind: "none" }, more] };
      expect([inBatch, coerceCommand(inBatch)]).toEqual([inBatch, null]);
    }
    expect(coerceCommand({ kind: "batch", commands: [], undoable: false })).toBeNull();
  });

  it("refuses a command of more steps than the server will take, its batches' steps counted", () => {
    const steps = (count: number) => Array.from({ length: count }, () => ({ kind: "none" }));
    expect(coerceCommand({ kind: "batch", commands: steps(MAX_COMMAND_STEPS) })).toEqual({
      kind: "batch",
      commands: steps(MAX_COMMAND_STEPS),
    });
    expect(coerceCommand({ kind: "batch", commands: steps(MAX_COMMAND_STEPS + 1) })).toBeNull();
    const half = Math.ceil((MAX_COMMAND_STEPS + 1) / 2);
    const nested = {
      kind: "batch",
      commands: [
        { kind: "batch", commands: steps(half) },
        { kind: "batch", commands: steps(half) },
      ],
    };
    expect(coerceCommand(nested)).toBeNull();
  });

  it("reads nothing that is not exactly a command", () => {
    for (const raw of [
      null,
      "game.score",
      { kind: "game.drop", gameId: "g1" },
      { kind: "game.score", year: "2027", gameId: "g1", teamAScore: 1, teamBScore: 2 },
      { kind: "game.score", year: 2027, gameId: "", teamAScore: 1, teamBScore: 2 },
      { kind: "answers", list: "everything", add: [], remove: [] },
      { kind: "answers", list: "realClubs", add: [1], remove: [] },
      { kind: "team.state", teamId: "A", state: 5 },
      { kind: "team.put", team: { name: "No id" } },
      { kind: "batch", commands: [{ kind: "none" }, { kind: "nope" }] },
      // Nested deeper than any command or inverse the app makes, which are one batch deep.
      [1, 2, 3, 4, 5, 6].reduce<unknown>((inner) => ({ kind: "batch", commands: [inner] }), {
        kind: "batch",
        commands: [],
      }),
    ])
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
  });
});

describe("a year archived or deleted, the copy's owner's alone", () => {
  const ARCHIVE: PoolCommand = { kind: "year.archive", year: 2026, at: "2026-10-04T12:00:00.000Z" };
  const DELETE: PoolCommand = { kind: "year.delete", year: 2026 };

  it("is read exactly as sent, on its own, and is the owner's", () => {
    expect(coerceCommand(JSON.parse(JSON.stringify(ARCHIVE)))).toEqual(ARCHIVE);
    expect(coerceCommand(DELETE)).toEqual(DELETE);
    expect([ARCHIVE, DELETE].map(isOwnerCommand)).toEqual([true, true]);
    expect(isOwnerCommand({ kind: "club.drop", teamId: "A" })).toBe(false);
  });

  it("is refused in a batch, for a year the app holds no page of, or at a time no clock writes", () => {
    for (const raw of [
      { kind: "batch", commands: [DELETE] },
      { kind: "batch", commands: [ARCHIVE] },
      { ...DELETE, year: 1999 },
      { ...DELETE, year: 2200 },
      { ...DELETE, year: 2026.5 },
      { ...DELETE, year: "2026" },
      { ...ARCHIVE, at: "yesterday" },
      { ...ARCHIVE, at: "-271821-04-20T00:00:00.000Z" },
      { kind: "year.archive", year: 2026 },
      { ...DELETE, at: ARCHIVE.at },
    ])
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
  });

  it("is never a pool's step: only the server runs it, on more than a pool holds", () => {
    const pool = memory(POOL());
    for (const command of [ARCHIVE, DELETE]) {
      expect(applyCommand(pool.read, command)).toEqual({ ok: false, why: "refused" });
    }
  });
});

describe("Team Rankings started again or brought back, the copy's owner's alone", () => {
  const RESET: PoolCommand = { kind: "copy.reset" };
  const RESTORE: PoolCommand = { kind: "copy.restore", group: "0123456789abcdef0123456789abcdef" };

  it("is read exactly as sent, on its own, and is the owner's", () => {
    expect(coerceCommand(JSON.parse(JSON.stringify(RESET)))).toEqual(RESET);
    expect(coerceCommand(RESTORE)).toEqual(RESTORE);
    expect([RESET, RESTORE].map(isOwnerCommand)).toEqual([true, true]);
  });

  it("is refused in a batch, or for a version no manifest could name", () => {
    for (const raw of [
      { kind: "batch", commands: [RESET] },
      { kind: "batch", commands: [RESTORE] },
      { kind: "copy.restore" },
      { kind: "copy.restore", group: "" },
      { kind: "copy.restore", group: 7 },
      { kind: "copy.restore", group: "a/b" },
      { kind: "copy.restore", group: "x".repeat(65) },
      { ...RESET, group: RESTORE.group },
    ])
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
  });

  it("is never a pool's step: only the server runs it, on the copy itself", () => {
    const pool = memory(POOL());
    for (const command of [RESET, RESTORE]) {
      expect(applyCommand(pool.read, command)).toEqual({ ok: false, why: "refused" });
    }
  });
});
