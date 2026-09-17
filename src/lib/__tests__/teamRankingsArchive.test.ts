import { describe, expect, it } from "vitest";
import {
  ARCHIVE_VERSION,
  archivableYears,
  archiveIdOf,
  archiveEntryOf,
  archiveSeason,
  archiveSquadYear,
  coerceArchivedSeason,
  withUniqueIds,
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
    const done = archiveSquadYear(
      2026,
      { teams, games },
      { ageGroups: yearGroups, teams, games },
      "2026-09-17T00:00:00.000Z"
    );

    expect(done.seasons.map((season) => season.name).sort()).toEqual(["10U 2026", "9U 2026"]);
    expect(done.state.ageGroups.map((group) => group.id)).toEqual(["ag_9_2027"]);
    expect(done.state.games.map((game) => game.id)).toEqual(["y-live"]);
    // Only the live game's two teams are still needed.
    expect(done.state.teams.map((team) => team.id).sort()).toEqual(["N-A", "N-NEXT"]);
    expect(done.droppedTeams).toBe(6);
  });

  it("reports the games that went without a table, rather than losing them quietly", () => {
    const { teams, games } = yearPool();
    const done = archiveSquadYear(
      2026,
      { teams, games },
      { ageGroups: yearGroups, teams, games },
      "2026-09-17T00:00:00.000Z"
    );

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
    const done = archiveSquadYear(
      2026,
      { teams, games },
      { ageGroups: yearGroups, teams, games },
      "2026-09-17T00:00:00.000Z"
    );
    const kept = done.seasons.find((season) => season.name === "10U 2026")!;

    expect(kept.rows.map((row) => row.teamName)).toEqual(alone.map((row) => row.teamName));
    kept.rows.forEach((row, at) => expect(row.rating).toBeCloseTo(alone[at]!.rating, 9));
  });

  it("leaves a year it was not asked about alone", () => {
    const { teams, games } = yearPool();
    const done = archiveSquadYear(
      2026,
      { teams, games },
      { ageGroups: yearGroups, teams, games },
      "2026-09-17T00:00:00.000Z"
    );
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
    const done = archiveSquadYear(
      2099,
      { teams, games },
      { ageGroups: yearGroups, teams, games },
      "2026-09-17T00:00:00.000Z"
    );
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
    const done = archiveSquadYear(
      2026,
      { teams, games },
      { ageGroups: named, teams, games },
      "2026-09-17T00:00:00.000Z"
    );
    expect(done.state.ageGroups).toEqual([]);
    expect(done.state.games).toEqual([]);
    expect(done.droppedGames).toBe(1);
  });
});

/*
 * The league's own fixtures are derived fresh from League Standings on every render and never
 * stored, so the table on screen stands on more games than the pool on disk holds. An archive is
 * the one place that difference bites: freeze the stored pool and the frozen table omits every
 * league game and every league-only club, freeze the merged pool into storage and the delete
 * leaves behind a permanent second copy of fixtures that are supposed to be derived. So the table
 * is built from what was shown and the delete takes only what was stored.
 */
describe("a season whose table includes the league's own games", () => {
  const pages: AgeGroup[] = [
    { id: "ag_9_2026", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: ["se_mab_fall_2025"] },
    { id: "ag_9_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: ["se_mab_fall_2026"] },
  ];

  const both = () => {
    const pulled: ScoutTeam[] = [
      { id: "S-A", name: "Aces", state: "KY" },
      { id: "S-B", name: "Badgers", state: "KY" },
      { id: "S-C", name: "Cougars", state: "OH" },
      { id: "S-NEXT", name: "Nexters", state: "TN" },
    ];
    const stored: ScoutGame[] = [
      { id: "s1", ageGroupId: "ag_9_2026", teamAId: "S-A", teamBId: "S-B", teamAScore: 7, teamBScore: 2, date: "2026-04-11" }, // prettier-ignore
      { id: "s2", ageGroupId: "ag_9_2026", teamAId: "S-B", teamBId: "S-C", teamAScore: 5, teamBScore: 4, date: "2026-04-18" }, // prettier-ignore
      { id: "s3", ageGroupId: "ag_9_2026", teamAId: "S-C", teamBId: "S-A", teamAScore: 1, teamBScore: 9, date: "2026-04-25" }, // prettier-ignore
      { id: "s4", ageGroupId: "ag_9_2027", teamAId: "S-NEXT", teamBId: "S-A", teamAScore: 4, teamBScore: 3, date: "2026-09-05" }, // prettier-ignore
    ];
    // What the derivation adds: a club that exists only in League Standings, and its fixtures.
    const leagueOnly: ScoutTeam = { id: "S-LEAGUE", name: "Lexington Legends", state: "KY" };
    const derived: ScoutGame[] = [
      { id: "L-1", ageGroupId: "ag_9_2026", teamAId: "S-LEAGUE", teamBId: "S-A", teamAScore: 6, teamBScore: 5, date: "2026-05-02" }, // prettier-ignore
      { id: "L-2", ageGroupId: "ag_9_2026", teamAId: "S-LEAGUE", teamBId: "S-B", teamAScore: 8, teamBScore: 1, date: "2026-05-09" }, // prettier-ignore
    ];
    return {
      shown: { teams: [...pulled, leagueOnly], games: [...stored, ...derived] },
      stored: { ageGroups: pages, teams: pulled, games: stored },
    };
  };

  it("freezes the league's games into the table, where the stored pool alone would lose them", () => {
    const { shown, stored } = both();
    const done = archiveSquadYear(2026, shown, stored, "2026-09-17T00:00:00.000Z");
    const kept = done.seasons.find((season) => season.name === "9U 2026")!;

    expect(kept.rows.map((row) => row.teamName)).toContain("Lexington Legends");
    // The record is the league's: two wins, no losses, and the table says so.
    expect(kept.rows.find((row) => row.teamName === "Lexington Legends")?.record).toBe("2-0");
    // And the pulled clubs' records count the league games they played.
    expect(kept.rows.find((row) => row.teamName === "Aces")?.games).toBe(3);

    const storedOnly = archiveSquadYear(
      2026,
      { teams: stored.teams, games: stored.games },
      stored,
      "2026-09-17T00:00:00.000Z"
    ).seasons.find((season) => season.name === "9U 2026")!;
    expect(storedOnly.rows.map((row) => row.teamName)).not.toContain("Lexington Legends");
  });

  it("persists none of them, because a derived fixture is never stored", () => {
    const { shown, stored } = both();
    const done = archiveSquadYear(2026, shown, stored, "2026-09-17T00:00:00.000Z");

    expect(done.state.games.map((game) => game.id)).toEqual(["s4"]);
    expect(done.state.teams.map((team) => team.id).sort()).toEqual(["S-A", "S-NEXT"]);
    // Three stored games went; the two league fixtures were never on disk to go.
    expect(done.droppedGames).toBe(3);
    expect(done.archivedLeagueGames).toBe(2);
  });

  it("names the league seasons that stop feeding a ranking, and leaves the live one alone", () => {
    const { shown, stored } = both();
    const done = archiveSquadYear(2026, shown, stored, "2026-09-17T00:00:00.000Z");
    expect(done.leagueSeasonIds).toEqual(["se_mab_fall_2025"]);
    expect(done.state.ageGroups.map((group) => group.seasonIds)).toEqual([["se_mab_fall_2026"]]);
  });
});

/*
 * A snapshot is a snapshot: nothing in it may be linkable back to live data, because the live data
 * is what is being deleted and it can come back. League Standings keeps its own seasons whatever
 * the rankings side does, so a page for an archived year can be created again and its fixtures
 * derived all over — and when that happens the archive must neither collide with the new page nor
 * be joined to it.
 */
describe("an archive is not linked to anything live", () => {
  it("mints an id of its own instead of carrying the page's", () => {
    const { teams, games } = pool();
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    expect(kept.id).not.toBe(groups[0]!.id);
    expect(kept.id).toBe("arc_2026_9u_2026");
    // The name is what is kept, as text.
    expect(kept.name).toBe("9U 2026");
  });

  it("keeps no team ids, so a row cannot be resolved into a club", () => {
    const { teams, games } = pool();
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    const ids = new Set(teams.map((team) => team.id));
    kept.rows.forEach((row) => {
      expect(row).not.toHaveProperty("teamId");
      expect(ids.has(row.teamName)).toBe(false);
    });
    expect(JSON.stringify(kept)).not.toContain("T-BOTH");
  });

  it("reads a year out of the name when the field is missing, rather than calling it x", () => {
    expect(archiveIdOf("2026, 10U", 2026)).toBe("arc_2026_2026_10u");
    expect(archiveIdOf("9U 2026", undefined)).toBe("arc_x_9u_2026");
    expect(archiveIdOf("!!", 2026)).toBe("arc_2026_season");
  });

  it("does not overwrite an earlier freeze of a page that came back", () => {
    const { teams, games } = pool();
    const first = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    const again = withUniqueIds([first], [first.id]);
    expect(again[0]!.id).toBe("arc_2026_9u_2026_2");
    expect(withUniqueIds([first], [first.id, `${first.id}_2`])[0]!.id).toBe("arc_2026_9u_2026_3");
    // An id nothing is using is left exactly as minted.
    expect(withUniqueIds([first], [])[0]!.id).toBe(first.id);
  });

  it("separates two seasons minted to the same id in one call", () => {
    const { teams, games } = pool();
    const kept = archiveSeason(groups[0]!, teams, games, groups, "2026-09-17T00:00:00.000Z");
    const pair = withUniqueIds([kept, kept], []);
    expect(new Set(pair.map((season) => season.id)).size).toBe(2);
  });
});
