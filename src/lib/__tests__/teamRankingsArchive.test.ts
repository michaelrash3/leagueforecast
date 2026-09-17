import { describe, expect, it } from "vitest";
import {
  ARCHIVE_VERSION,
  archivableYears,
  archiveEntryOf,
  archiveSeason,
  archiveSquadYear,
  coerceArchivedSeason,
  withoutSeason,
} from "../teamRankingsArchive";
import { buildTeamRankings, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag_9_2026", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
  { id: "ag_9_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
];

/** A page with a table on it, plus one club that plays on both pages. */
const pool = () => {
  const teams: ScoutTeam[] = [
    { id: "T-A", name: "Aces", state: "KY" },
    { id: "T-B", name: "Badgers", state: "OH" },
    { id: "T-C", name: "Cougars", state: "KY" },
    { id: "T-D", name: "Dodgers", state: "TN" },
    // Plays in both years, so archiving the older one must leave it alone.
    { id: "T-BOTH", name: "Bridgers", state: "KY" },
  ];
  const games: ScoutGame[] = [];
  let at = 0;
  const add = (page: string, a: string, b: string, sa: number, sb: number, date: string) => {
    games.push({
      id: `g${at++}`,
      ageGroupId: page,
      teamAId: a,
      teamBId: b,
      teamAScore: sa,
      teamBScore: sb,
      date,
    });
  };
  // 2026: a small round robin, four sides plus the club that spans both.
  ["T-A", "T-B", "T-C", "T-D"].forEach((home, index) => {
    ["T-A", "T-B", "T-C", "T-D"].slice(index + 1).forEach((away) => {
      add("ag_9_2026", home, away, 8, 3, "2026-04-11");
      add("ag_9_2026", away, home, 2, 7, "2026-05-16");
    });
  });
  add("ag_9_2026", "T-BOTH", "T-A", 6, 5, "2026-06-06");
  // 2027: the spanning club and one of the others, on the live page.
  add("ag_9_2027", "T-BOTH", "T-B", 9, 1, "2026-09-05");
  return { teams, games };
};

describe("keeping a season's table and letting its games go", () => {
  it("keeps the table the app would have shown", () => {
    const { teams, games } = pool();
    const live = buildTeamRankings("ag_9_2026", teams, games, undefined, groups);
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");

    expect(kept.rows).toHaveLength(live.length);
    expect(kept.rows.map((row) => row.teamName)).toEqual(live.map((row) => row.teamName));
    expect(kept.rows.map((row) => row.rank)).toEqual(live.map((row) => row.rank));
    kept.rows.forEach((row, at) => {
      expect(row.rating).toBeCloseTo(live[at]!.rating, 9);
      expect(row.record).toBe(live[at]!.record);
      expect(row.sosRank).toBe(live[at]!.sosRank);
    });
  });

  it("carries the state across, because the row does not hold it", () => {
    const { teams, games } = pool();
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    expect(kept.rows.find((row) => row.teamName === "Aces")?.state).toBe("KY");
    expect(kept.rows.find((row) => row.teamName === "Dodgers")?.state).toBe("TN");
  });

  it("says what stood behind it", () => {
    const { teams, games } = pool();
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    const onPage = games.filter((game) => game.ageGroupId === "ag_9_2026");
    expect(kept.fromGames).toBe(onPage.length);
    expect(kept.fromTeams).toBe(5);
    expect(kept.version).toBe(ARCHIVE_VERSION);
    expect(kept.name).toBe("9U 2026");
  });

  it("lists without carrying the rows, which are the bulk", () => {
    const { teams, games } = pool();
    const entry = archiveEntryOf(
      archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z")
    );
    expect(entry.teams).toBe(5);
    expect(entry).not.toHaveProperty("rows");
    expect(JSON.stringify(entry).length).toBeLessThan(200);
  });
});

describe("dropping the season from the live pool", () => {
  it("takes the games, the page, and only the teams nothing else needs", () => {
    const { teams, games } = pool();
    const next = withoutSeason("ag_9_2026", { ageGroups: groups, teams, games });

    // Only the 2027 game survives, so only its two teams do.
    expect(next.games).toHaveLength(1);
    expect(next.ageGroups.map((group) => group.id)).toEqual(["ag_9_2027"]);
    expect(next.teams.map((team) => team.id).sort()).toEqual(["T-B", "T-BOTH"]);
    expect(next.dropped).toBe(3);
  });

  it("leaves a club that is still playing exactly where it was", () => {
    const { teams, games } = pool();
    const next = withoutSeason("ag_9_2026", { ageGroups: groups, teams, games });
    const bridger = next.teams.find((team) => team.id === "T-BOTH");
    expect(bridger).toEqual(teams.find((team) => team.id === "T-BOTH"));
  });

  it("changes nothing when the page is not there", () => {
    const { teams, games } = pool();
    const next = withoutSeason("ag_nope", { ageGroups: groups, teams, games });
    expect(next.games).toHaveLength(games.length);
    expect(next.teams).toHaveLength(teams.length);
    expect(next.dropped).toBe(0);
  });
});

describe("reading an archive back", () => {
  it("round-trips through JSON", () => {
    const { teams, games } = pool();
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    expect(coerceArchivedSeason(JSON.parse(JSON.stringify(kept)))).toEqual(kept);
  });

  it("is null for something that is not one, rather than a throw", () => {
    expect(coerceArchivedSeason(null)).toBeNull();
    expect(coerceArchivedSeason("9U 2026")).toBeNull();
    expect(coerceArchivedSeason({ id: "ag", name: "9U 2026" })).toBeNull();
  });

  it("drops a row with no team name rather than keeping a blank one", () => {
    const read = coerceArchivedSeason({
      id: "ag",
      name: "9U 2026",
      rows: [{ teamName: "Aces", rank: 1 }, { rank: 2 }, { teamName: "", rank: 3 }],
    });
    expect(read?.rows.map((row) => row.teamName)).toEqual(["Aces"]);
  });
});

/*
 * A squad year, not a page. Every group sharing a season year is rated together — a 9U table is
 * computed partly from the 8U teams that played down against it — so archiving one page of a year
 * would change the tables of the ones left behind, which is the one thing an archive must not do.
 */
describe("freezing a whole squad year", () => {
  const yearGroups: AgeGroup[] = [
    // 8U is below MIN_RANKED_AGE_LEVEL, so it has no table of its own.
    { id: "ag_8_2026", name: "8U 2026", ageLevel: 8, year: 2026, seasonIds: [] },
    { id: "ag_9_2026", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
    { id: "ag_10_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
    { id: "ag_9_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  ];

  const yearPool = () => {
    const teams: ScoutTeam[] = [
      { id: "N-A", name: "Aces", state: "KY" },
      { id: "N-B", name: "Badgers", state: "KY" },
      { id: "N-C", name: "Cougars", state: "OH" },
      { id: "N-TINY", name: "Tinies", state: "KY" },
      { id: "N-NEXT", name: "Nexters", state: "TN" },
      // The 10U page needs sides of its own: a team is listed on the page its home level says,
      // and a club that mostly plays 9U is a 9U club however many 10U games it turns up in.
      { id: "N-TEN1", name: "Tenners", state: "IN" },
      { id: "N-TEN2", name: "Dimes", state: "IN" },
      { id: "N-TEN3", name: "Deckers", state: "IN" },
    ];
    const games: ScoutGame[] = [];
    let at = 0;
    const add = (page: string, a: string, b: string, sa: number, sb: number) => {
      games.push({
        id: `y${at++}`,
        ageGroupId: page,
        teamAId: a,
        teamBId: b,
        teamAScore: sa,
        teamBScore: sb,
        date: "2026-05-16",
      });
    };
    // A 9U table with enough to rank, a 10U one, and 8U games that feed them but never rank.
    add("ag_9_2026", "N-A", "N-B", 7, 2);
    add("ag_9_2026", "N-B", "N-C", 5, 4);
    add("ag_9_2026", "N-C", "N-A", 1, 9);
    add("ag_10_2026", "N-TEN1", "N-TEN2", 6, 3);
    add("ag_10_2026", "N-TEN2", "N-TEN3", 5, 1);
    add("ag_10_2026", "N-TEN3", "N-TEN1", 2, 8);
    add("ag_8_2026", "N-TINY", "N-A", 2, 8);
    add("ag_8_2026", "N-TINY", "N-B", 1, 7);
    // And a live year that must be untouched.
    games.push({
      id: "y-live",
      ageGroupId: "ag_9_2027",
      teamAId: "N-NEXT",
      teamBId: "N-A",
      teamAScore: 4,
      teamBScore: 3,
      date: "2026-09-05",
    });
    return { teams, games };
  };

  it("offers the years a pool could freeze, newest first", () => {
    expect(archivableYears(yearGroups)).toEqual([2027, 2026]);
    expect(archivableYears([])).toEqual([]);
  });

  it("keeps a table per page that has one and drops the year from the pool", () => {
    const { teams, games } = yearPool();
    const done = archiveSquadYear(2026, teams, games, yearGroups, "2026-09-17T00:00:00.000Z");

    expect(done.seasons.map((season) => season.name).sort()).toEqual(["10U 2026", "9U 2026"]);
    expect(done.state.ageGroups.map((group) => group.id)).toEqual(["ag_9_2027"]);
    expect(done.state.games.map((game) => game.id)).toEqual(["y-live"]);
    // Only the live game's two teams are still needed.
    expect(done.state.teams.map((team) => team.id).sort()).toEqual(["N-A", "N-NEXT"]);
    expect(done.droppedTeams).toBe(6);
  });

  it("reports the games that went without a table, rather than losing them quietly", () => {
    const { teams, games } = yearPool();
    const done = archiveSquadYear(2026, teams, games, yearGroups, "2026-09-17T00:00:00.000Z");

    // 8U is not ranked by design, so its games inform the ages above and keep no row of their own.
    expect(done.unranked).toEqual([{ name: "8U 2026", games: 2 }]);
    expect(done.droppedGames).toBe(8);
  });

  /*
   * The reason this is a year and not a page. Every table is built against the pool as it was, so
   * the page archived second is frozen from the same games as the page archived first — including
   * the 8U games that fed both.
   */
  it("freezes every page from the pool as it stood, not as the last step left it", () => {
    const { teams, games } = yearPool();
    const alone = buildTeamRankings("ag_10_2026", teams, games, undefined, yearGroups);
    const done = archiveSquadYear(2026, teams, games, yearGroups, "2026-09-17T00:00:00.000Z");
    const kept = done.seasons.find((season) => season.name === "10U 2026")!;

    expect(kept.rows.map((row) => row.teamName)).toEqual(alone.map((row) => row.teamName));
    kept.rows.forEach((row, at) => expect(row.rating).toBeCloseTo(alone[at]!.rating, 9));
  });

  it("leaves a year it was not asked about alone", () => {
    const { teams, games } = yearPool();
    const done = archiveSquadYear(2026, teams, games, yearGroups, "2026-09-17T00:00:00.000Z");
    const live = buildTeamRankings(
      "ag_9_2027",
      done.state.teams,
      done.state.games,
      undefined,
      done.state.ageGroups
    );
    expect(live.length).toBeGreaterThan(0);
  });

  it("does nothing for a year with no pages", () => {
    const { teams, games } = yearPool();
    const done = archiveSquadYear(2099, teams, games, yearGroups, "2026-09-17T00:00:00.000Z");
    expect(done.seasons).toEqual([]);
    expect(done.state.games).toHaveLength(games.length);
    expect(done.droppedGames).toBe(0);
  });
});

/*
 * The year is read the way everything else reads it: through the parse, not off the field. A page
 * can carry its year in its name and nowhere else, and `rankingPoolGroupIds` counts it in that
 * year's rating pool regardless. Comparing `group.year` raw left such a page behind while its
 * siblings were archived — so the page stayed and its ratings changed, which is the one thing the
 * year-at-a-time rule exists to prevent.
 */
describe("a page whose year is only in its name", () => {
  const named: AgeGroup[] = [
    { id: "ag_named", name: "2026, 10U", seasonIds: [] },
    { id: "ag_9_2026b", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
  ];

  it("is offered as an archivable year", () => {
    expect(archivableYears([named[0]!])).toEqual([2026]);
  });

  it("is archived with the rest of its year, not left behind", () => {
    const teams: ScoutTeam[] = [
      { id: "P-A", name: "Aces" },
      { id: "P-B", name: "Badgers" },
    ];
    const games: ScoutGame[] = [
      {
        id: "p1",
        ageGroupId: "ag_named",
        teamAId: "P-A",
        teamBId: "P-B",
        teamAScore: 6,
        teamBScore: 2,
        date: "2026-05-16",
      },
    ];
    const done = archiveSquadYear(2026, teams, games, named, "2026-09-17T00:00:00.000Z");
    expect(done.state.ageGroups).toEqual([]);
    expect(done.state.games).toEqual([]);
    expect(done.droppedGames).toBe(1);
  });
});
