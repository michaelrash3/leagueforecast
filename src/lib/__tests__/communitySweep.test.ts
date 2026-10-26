import { describe, expect, it } from "vitest";
import {
  connectedLeagues,
  LONGHORNS,
  plantClosedLeague,
} from "../../../scripts/closedLeagueFixture";
import {
  COMMUNITY_HOPS,
  describeCommunitySweep,
  LEVEL_VARIANTS,
  PROVEN_ORDERS,
  type ProvenOrder,
  reachLineOf,
  runCommunitySweep,
  WEB_HOPS,
} from "../../../scripts/communitySweep";
import { describeRemovalDiagnosis, runRemovalDiagnosis } from "../../../scripts/removalDiagnosis";
import { compareWithGameChanger, describeClubLeague } from "../../../scripts/clubLeagueReport";
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
    expect(named.filter((line) => line.includes("Longhorns (Edgewood, KY;"))).toHaveLength(
      LEVEL_VARIANTS.length
    );
    expect(named[0]).toContain("Longhorns (Edgewood, KY; 10U 2027)");
  });

  it("reads the proven orders on the same decided games, and moves only the order", () => {
    expect(sweep.proven.map((order) => order.key)).toEqual(PROVEN_ORDERS.map((order) => order.key));
    const decided = sweep.proven.map(
      (order) => order.segments.find((segment) => segment.key === "all")!.games
    );
    expect(new Set(decided).size).toBe(1);
    const all = sweep.variants[0]!.segments.find((segment) => segment.key === "all")!;
    expect(decided[0]).toBe(all.decided);
    const [shown, ...others] = sweep.proven;
    // The board's own order is the reference, and is the board itself.
    expect(shown!.segments.every((segment) => segment.gain === null)).toBe(true);
    expect(shown!.topPlaces).toMatchObject({ kept: 25, of: 25 });
    expect(shown!.stateOnes.changed).toBe(0);
    expect(shown!.club[0]).toMatchObject({
      rank: sweep.variants[0]!.club[0]!.rank,
      stateRank: sweep.variants[0]!.club[0]!.stateRank,
    });
    expect(others.every((order) => order.segments[0]!.gain !== null)).toBe(true);
    // Taking more off a closed league lists its unbeaten club no higher.
    const placed = (key: string) =>
      sweep.proven.find((order) => order.key === key)!.club[0]!.stateRank!;
    expect(placed("p0.5")).toBeGreaterThanOrEqual(placed("shown"));
    expect(placed("p1")).toBeGreaterThanOrEqual(placed("p0.5"));
    expect(placed("p2")).toBeGreaterThan(placed("shown"));
  });

  it("lists a club whose league is short of the line after every proven club", () => {
    const placed = (key: string) =>
      sweep.proven.find((order) => order.key === key)!.club[0]!.stateRank!;
    // The planted league has one outside game: short of every line, so below every proven club.
    expect(placed("e10")).toBeGreaterThan(placed("shown"));
    expect(placed("e10")).toBeGreaterThan(10);
    // No club short of the line is listed above one that is not.
    sweep.proven
      .filter((order) => order.key.startsWith("e"))
      .forEach((order) => {
        const line = Number(order.key.slice(1));
        const back = order.stateTop.map((row) => row.outside < line);
        expect(back).toEqual([...back].sort((a, b) => Number(a) - Number(b)));
        expect(order.stateTop.some((row) => row.name === "Longhorns")).toBe(false);
      });
  });

  it("says how far the club's web of games reaches, against the clubs at the top", () => {
    // The planted league: its seven opponents, then one more club through the Owls' one game out.
    expect(sweep.reach.club?.slice(0, 2)).toEqual([7, 8]);
    expect(sweep.reach.nationalTop.two!.p50).toBeGreaterThan(sweep.reach.club![1]!);
    expect(sweep.reach.league).toHaveLength(8);
    const placed = (key: string) =>
      sweep.proven.find((order) => order.key === key)!.club[0]!.stateRank!;
    expect(placed("r2-25")).toBeGreaterThan(placed("shown"));
  });

  it("draws a share line from the typical web of each day's games, and lists by it", () => {
    // One typical web per cut day and one for the board's day, each read one to five games out.
    expect(sweep.reach.typical.map(({ day }) => day)).toEqual([
      "2026-09-01",
      "2026-09-08",
      "2026-09-15",
      input.today,
    ]);
    expect(sweep.reach.typical.every(({ reach }) => reach.length === WEB_HOPS)).toBe(true);
    const today = sweep.reach.typical[3]!.reach;
    // A web counted further out reaches no fewer clubs.
    expect([...today].sort((a, b) => a - b)).toEqual(today);
    const share = PROVEN_ORDERS.find((order) => order.key === "s5-25")!;
    expect(reachLineOf(share, (hops) => today[hops - 1]!)).toBe(0.25 * today[4]!);
    expect(
      reachLineOf(
        PROVEN_ORDERS.find((order) => order.key === "r5-100")!,
        () => 1
      )
    ).toBe(100);
    expect(reachLineOf(PROVEN_ORDERS[0]!, () => 1)).toBeUndefined();
    // Under each share order, no club short of its line is listed above one that reaches it.
    sweep.proven
      .filter((order) => order.key.startsWith("s"))
      .forEach((order) => {
        const line = reachLineOf(
          PROVEN_ORDERS.find((known) => known.key === order.key)!,
          (hops) => today[hops - 1]!
        )!;
        const back = order.stateTop.map((row) => row.reach[4]! < line);
        expect(back).toEqual([...back].sort((a, b) => Number(a) - Number(b)));
      });
    const { lines } = describeCommunitySweep(sweep);
    expect(lines).toContain(
      `  ${input.today}: ${today.join(", ")}; s5-10 ${Math.round(0.1 * today[4]!)}, s5-25 ${Math.round(0.25 * today[4]!)}`
    );
  });

  it("holds a club back by a share line, which moves with the typical web", () => {
    // The made-up pool is two hundred clubs, all within five games of each other, so a line five
    // games out holds nobody back on it; three games out, half the typical web holds the planted
    // league back, whose web stops at 29 where the typical club's reaches 192.
    const half: ProvenOrder = {
      key: "s3-50",
      why: "half the typical web within three games",
      k: 0,
      prior: 2,
      reach: { hops: 3, share: 0.5 },
    };
    const shared = runCommunitySweep({ ...input, provenOrders: [PROVEN_ORDERS[0]!, half] });
    const [shown, byShare] = shared.proven;
    const today = shared.reach.typical[shared.reach.typical.length - 1]!.reach;
    const line = reachLineOf(half, (hops) => today[hops - 1]!)!;
    expect(shared.reach.club![2]!).toBeLessThan(line);
    expect(byShare!.club[0]!.stateRank!).toBeGreaterThan(shown!.club[0]!.stateRank!);
    expect(byShare!.stateTop.some((row) => row.name === LONGHORNS.name)).toBe(false);
    const back = byShare!.stateTop.map((row) => row.reach[2]! < line);
    expect(back).toEqual([...back].sort((a, b) => Number(a) - Number(b)));
    // The line is the share of each day's own typical web: smaller on the first cut day.
    expect(shared.reach.typical[0]!.reach[2]!).toBeLessThan(today[2]!);
  });

  it("reads the league the fit found, club by club: its web and its chain from the club", () => {
    const community = sweep.reach.community!;
    expect(community).toHaveLength(sweep.league!.size);
    expect(community.every((club) => club.reach.length === COMMUNITY_HOPS)).toBe(true);
    const longhorns = community.find((club) => club.name === LONGHORNS.name)!;
    expect(longhorns.reach).toEqual(sweep.reach.club);
    expect(longhorns.chain).toEqual([LONGHORNS.name]);
    // Every other club of it is some games away, the chain starting at the Longhorns and ending
    // at the club, one game apart each.
    const played = new Set(
      input.games.flatMap((game) => [
        `${game.teamAId}|${game.teamBId}`,
        `${game.teamBId}|${game.teamAId}`,
      ])
    );
    const idOf = new Map(input.teams.map((team) => [team.name, team.id]));
    community
      .filter((club) => club !== longhorns)
      .forEach((club) => {
        const chain = club.chain!;
        expect(chain[0]).toBe(LONGHORNS.name);
        expect(chain[chain.length - 1]).toBe(club.name);
        expect(chain.length).toBeGreaterThan(1);
        chain.slice(1).forEach((name, at) => {
          expect(played.has(`${idOf.get(chain[at]!)}|${idOf.get(name)}`)).toBe(true);
        });
      });
    const { lines, named } = describeCommunitySweep(sweep);
    expect(lines.join("\n")).not.toContain("shortest chain");
    expect(named).toContain(
      `  ${LONGHORNS.name} (${LONGHORNS.city}, ${LONGHORNS.state}): ${longhorns.reach.join(", ")}; 0 game(s) away: ${LONGHORNS.name}`
    );
  });

  it("reports the club's league as its schedule names it, club by club", () => {
    const league = sweep.clubLeague!;
    expect(league.name).toBe("Longhorns");
    expect(league.league).toHaveLength(8);
    expect(league.league[0]).toMatchObject({ name: "Longhorns", overall: { won: 14, lost: 0 } });
    expect(league.games).toHaveLength(14);
    const owls = league.league.find((club) => club.name === "Owls")!;
    expect(owls.outside).toEqual({ won: 0, lost: 1, tied: 0 });
    expect(owls.outsideGames[0]).toMatchObject({ result: "L", score: "1-16" });
    expect(league.community).toEqual({ size: 8, outside: 1 });
  });

  it("names what GameChanger lists that the pool lacks, in the league or outside it", () => {
    const league = sweep.clubLeague!;
    const owls = league.league.find((club) => club.name === "Owls")!;
    const pulled = new Map(
      owls.gcTeamIds.map((gcTeamId) => [
        gcTeamId,
        {
          ok: true as const,
          schedule: {
            profile: { id: gcTeamId, name: "Owls", record: { win: 6, loss: 10, tie: 0 } },
            games: [
              {
                id: "x1",
                opponentName: "Rams",
                date: "2026-10-20",
                teamScore: 4,
                opponentScore: 2,
                status: "completed" as const,
              },
              {
                id: "x2",
                opponentName: "Somewhere Else 9U",
                date: "2026-10-21",
                teamScore: 0,
                opponentScore: 9,
                status: "completed" as const,
              },
            ],
            fetchedAt: "2026-10-26T12:00:00Z",
          },
        },
      ])
    );
    const compared = compareWithGameChanger(league, input.teams, input.games, pulled);
    const mine = compared.find((one) => one.club === "Owls")!;
    expect(mine).toMatchObject({ gcRecord: "6-10", gcGames: 2 });
    expect(mine.missing).toEqual([
      { date: "2026-10-20", opponent: "Rams", score: "4-2", inLeague: true },
      { date: "2026-10-21", opponent: "Somewhere Else 9U", score: "0-9", inLeague: false },
    ]);
    // A club asked of GameChanger that did not answer says so, rather than reading as complete.
    expect(compared.filter((one) => one.club !== "Owls").every((one) => one.failed)).toBe(true);
    const { lines, named } = describeClubLeague(league, compared);
    expect(lines.join("\n")).not.toMatch(/Longhorns|Owls|Rams|Edgewood/);
    expect(named.join("\n")).toContain("OUTSIDE   2026-10-21  0-9  against Somewhere Else 9U");
  });

  it("says the proven orders in numbers only, and names the club in the others", () => {
    const { lines, named } = describeCommunitySweep(sweep);
    const text = lines.join("\n");
    expect(text).toContain('A "proven" order, ranking only');
    expect(text).toMatch(/p1 +misordered \d+\.\d\d%, gain [+−]/);
    expect(text).toContain("The club asked about, where each order lists it:");
    expect(text).not.toMatch(/Longhorns|Edgewood|LH-|CL-/);
    expect(named.filter((line) => /Longhorns, (shown|p|e|r|s)/.test(line))).toHaveLength(
      PROVEN_ORDERS.length
    );
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
