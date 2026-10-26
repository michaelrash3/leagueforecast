import { describe, expect, it } from "vitest";
import {
  connectedLeagues,
  LONGHORNS,
  plantClosedLeague,
} from "../../../scripts/closedLeagueFixture";
import {
  describeCommunitySweep,
  LEVEL_VARIANTS,
  runCommunitySweep,
} from "../../../scripts/communitySweep";
import { describeRemovalDiagnosis, runRemovalDiagnosis } from "../../../scripts/removalDiagnosis";
import { coerceAutoRemovals } from "../autoRemoved";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * The two halves of `scripts/communityLevelSweep.ts` that are not reading a pool: the comparison of
 * league levels (`communitySweep.ts`) and the removal sections (`removalDiagnosis.ts`), run on
 * made-up pools and held to what their reports say, the public lines above all: numbers, days and
 * scores, never a club's name, which goes to the named lines alone.
 */

describe("the league-level comparison", () => {
  const page = "ag_10";
  const groups: AgeGroup[] = [
    { id: page, name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  ];
  const core = connectedLeagues({ seed: 11, page });
  const planted = plantClosedLeague({ seed: 12, page, outsider: core.strongest });
  const input = {
    ageGroups: groups,
    teams: [...core.teams, ...planted.teams],
    games: [...core.games, ...planted.games],
    pageId: page,
    today: "2026-11-01",
    club: { ...LONGHORNS, page: "10U 2027" },
  };
  const sweep = runCommunitySweep(input);

  it("scores every variant on the same later games, against the control", () => {
    expect(sweep.measurable).toBe(true);
    expect(sweep.variants.map((variant) => variant.key)).toEqual(
      LEVEL_VARIANTS.map((variant) => variant.key)
    );
    const games = sweep.variants.map(
      (variant) => variant.segments.find((segment) => segment.key === "all")!.games
    );
    expect(new Set(games).size).toBe(1);
    expect(games[0]).toBeGreaterThan(500);
    // The control is the reference, so it has no gain of its own; every variant has one.
    expect(sweep.variants[0]!.segments.every((segment) => segment.squaredGain === null)).toBe(true);
    expect(sweep.variants[1]!.segments[0]!.squaredGain?.samples).toBe(games[0]);
    expect(sweep.cuts.map((cut) => cut.cut)).toEqual(["2026-09-01", "2026-09-08", "2026-09-15"]);
  });

  it("reads the board of the day: places kept, #1s moved, and the club asked about", () => {
    const control = sweep.variants[0]!;
    expect(control.topPlaces).toMatchObject({ kept: 25, of: 25 });
    expect(control.stateOnes.changed).toBe(0);
    const longhorns = (key: string) => sweep.variants.find((variant) => variant.key === key)!.club;
    expect(longhorns("control")).toHaveLength(1);
    expect(longhorns("control")[0]).toMatchObject({ name: LONGHORNS.name, record: "14-0" });
    // Two outside games' worth of belief drop it furthest; twenty least; all of them some.
    const rating = (key: string) => longhorns(key)[0]!.rating;
    expect(rating("k2")).toBeLessThan(rating("k5"));
    expect(rating("k5")).toBeLessThan(rating("k20"));
    expect(rating("k20")).toBeLessThan(rating("control"));
    expect(longhorns("k2")[0]!.stateRank!).toBeGreaterThan(longhorns("control")[0]!.stateRank!);
  });

  it("names no club in its public lines, and names the club asked about in the others", () => {
    const { lines, named } = describeCommunitySweep(sweep);
    const text = lines.join("\n");
    expect(text).not.toMatch(/Longhorns|Edgewood|LH-|CL-/);
    expect(text).toContain("The club asked about (1 match(es)");
    expect(named).toHaveLength(LEVEL_VARIANTS.length);
    expect(named[0]).toContain("Longhorns (Edgewood, KY; 10U 2027)");
  });

  it("says not measurable, and ranks nothing, when the later games are too few", () => {
    // The made-up games end on 29 October: 22 of them that day, scored at each of the three cuts.
    const thin = runCommunitySweep({ ...input, scoreFrom: "2026-10-29" });
    expect(thin.measurable).toBe(false);
    const text = describeCommunitySweep(thin).lines.join("\n");
    expect(text).toContain("Not measurable: 66 scored game(s) on 1 day(s)");
    expect(text).not.toContain("clearly better");
    expect(text).not.toContain("squared ");
  });
});

describe("the removal sections", () => {
  const p9: AgeGroup = { id: "p9", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] };
  const p10: AgeGroup = { id: "p10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] };
  const club = (id: string, page: AgeGroup): ScoutTeam => ({
    id,
    name: `Secret ${id}`,
    gcTeams: [{ teamId: `gc${id}`, name: `Secret ${id}`, ageGroupId: page.id }],
  });
  const teams = [
    ...["W", "L", "T1", "T2", "V1", "V2", "R", "X", "M1", "M2"].map((id) => club(id, p9)),
    ...["F", "G", "H"].map((id) => club(id, p10)),
  ];
  let serial = 0;
  const played = (
    a: string,
    b: string,
    runs: readonly [number, number],
    date: string,
    filer: string | null,
    page = "p9",
    more: Partial<ScoutGame> = {}
  ): ScoutGame => ({
    id: `g${(serial += 1)}`,
    ageGroupId: page,
    teamAId: a,
    teamBId: b,
    teamAScore: runs[0],
    teamBScore: runs[1],
    date,
    ...(filer
      ? { source: { kind: "gamechanger", teamId: `gc${filer}`, gameId: `r${serial}` } }
      : {}),
    ...more,
  });
  const games = [
    played("W", "L", [121, 1], "2026-05-10", "W"),
    played("T1", "T2", [101, 0], "2026-06-17", null),
    played("V1", "V2", [100, 0], "2026-05-28", "V1", "p9", { scoreConfirmed: 100 }),
    played("R", "X", [130, 0], "2026-03-30", "R"),
    played("M1", "M2", [0, 150], "2026-04-18", "M1"),
    played("F", "G", [45, 1], "2026-10-10", "F", "p10"),
    played("G", "H", [6, 2], "2026-10-11", "G", "p10", { alsoFrom: ["gcH"] }),
  ];
  const marks = coerceAutoRemovals([
    {
      gcTeamId: "gcM1",
      name: "Secret M1",
      on: "2026-10-01",
      signs: ["hundred"],
      reported: [{ gameId: "g5", margin: 150 }],
    },
  ]);
  const found = runRemovalDiagnosis({
    ageGroups: [p9, p10],
    teams,
    games,
    answers: { realClubs: new Set(["gcR"]), keptApart: new Set(), namedAges: new Map() },
    marks,
    today: "2026-10-26",
    leagueLinked: null,
    archived: [],
    storedByYear: [
      { year: 2026, games: 5 },
      { year: 2027, games: 2 },
    ],
    asked: [
      { date: "2026-06-17", runs: [101, 0] },
      { date: "2025-09-22", runs: [820, 0] },
    ],
  });
  const sideOf = (score: string, index: 0 | 1) =>
    found.hundred.find((game) => game.score === score)!.sides[index];

  it("finds every game won by a hundred, its squad year, and the games asked about", () => {
    expect(found.currentYear).toBe(2027);
    expect(found.hundred.map((game) => game.score)).toEqual([
      "121-1",
      "101-0",
      "100-0",
      "130-0",
      "0-150",
    ]);
    expect(found.hundred.every((game) => game.yearStatus === "past")).toBe(true);
    expect(found.asked.map(({ found: ids }) => ids.length)).toEqual([1, 0]);
  });

  it("says what keeps each side, or that the sweep would mark it now", () => {
    expect(sideOf("121-1", 0)).toMatchObject({ charged: 120, wouldMark: true });
    expect(sideOf("121-1", 0).reasons).toContain(
      "shows H and nothing keeps it: the sweep would mark it now"
    );
    expect(sideOf("121-1", 1).reasons).toContain(
      "its own schedule did not report it: only the other side's schedule did"
    );
    expect(sideOf("101-0", 0).reasons[0]).toMatch(/came off no GameChanger schedule/);
    // H charges nobody for a game off no schedule, but B reads it as the winner's own (`filedBy`).
    expect(sideOf("101-0", 0).reasons).toContain("the sweep run now marks it, for rout");
    expect(sideOf("121-1", 0).reasons).toContain("the sweep run now marks it, for rout+hundred");
    expect(sideOf("100-0", 0).reasons).toContain("its score is vouched for (confirmed at 100)");
    expect(sideOf("130-0", 0).reasons).toContain("kept: said to be real (realClubs)");
    expect(sideOf("0-150", 0)).toMatchObject({ charged: 150, removed: true, wouldMark: false });
  });

  it("runs H at each line against the stored marks, saving nothing", () => {
    const at = (line: number) => found.runs.find((run) => run.line === line)!;
    expect(found.runs.map((run) => run.line)).toEqual([40, 50, 75, 100]);
    const ids = (line: number) =>
      at(line)
        .clubs.map((entry) => entry.clubId)
        .sort();
    expect(ids(100)).toEqual(["T1", "W"]);
    expect(ids(75)).toEqual(["T1", "W"]);
    expect(ids(40)).toEqual(["F", "T1", "W"]);
    expect(at(40).beyondShipped).toBe(1);
    const caught = at(40).clubs.find((entry) => entry.clubId === "F")!;
    expect(caught).toMatchObject({ pageName: "10U 2027", year: 2027, alsoAt100: false });
    expect(caught.caught).toEqual([{ date: "2026-10-10", score: "45-1", side: "won", margin: 44 }]);
    // The marks handed in are as they were.
    expect([...marks.keys()]).toEqual(["gcM1"]);
  });

  it("names no club in its public lines", () => {
    const { lines, named } = describeRemovalDiagnosis(found);
    expect(lines.join("\n")).not.toMatch(/Secret|gc[A-Z]/);
    expect(named.join("\n")).toContain("Secret W");
  });
});
