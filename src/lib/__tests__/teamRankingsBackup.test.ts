import { describe, expect, it } from "vitest";
import { CSV_SECTIONS, csvSectionMarker, splitCsvSections } from "../csv";
import { parseScheduleCsvImport } from "../scheduleCsvImport";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";
import {
  coerceTeamRankingsBackup,
  estimateBackupBytes,
  formatBytes,
  LARGE_BACKUP_BYTES,
  parseTeamRankingsCsv,
  summarizeTeamRankingsBackup,
  teamRankingsBackupIsEmpty,
  teamRankingsCsvParts,
  teamRankingsCsvSections,
  teamRankingsJson,
  teamRankingsJsonParts,
  parseTeamRankingsJson,
  looksLikeJsonBackup,
  BACKUP_JSON_VERSION,
  type TeamRankingsBackup,
} from "../teamRankingsBackup";

const ageGroups: AgeGroup[] = [
  {
    id: "ag1",
    name: "10U 2028",
    ageLevel: 10,
    year: 2028,
    seasonIds: ["default", "season-2"],
    myTeamId: "S-ICEC",
  },
  // A group saved before the age/year picker existed: free-text name, no level or year.
  { id: "ag2", name: "2027, 9U", seasonIds: [], continuesFromId: "ag1" },
];

const fallLink: GcTeamLink = {
  teamId: "gsUthn4XoIxS",
  name: 'Ice Cats 10u "Scout"',
  ageGroupId: "ag1",
  season: "fall",
  seasonYear: 2027,
  ageLevel: 10,
  avatarKey: "5192a689-d888-4ae5-abce-446885dca7c7",
  record: { win: 11, loss: 1, tie: 0 },
  importedAt: "2027-09-14T12:00:00.000Z",
};
const springLink: GcTeamLink = { teamId: "zjvVkYnqLrf0", name: "Ice Cats 10U", ageGroupId: "ag1" };

const teams: ScoutTeam[] = [
  {
    id: "S-ICEC",
    name: "Ice Cats",
    isMine: true,
    state: "OH",
    city: "Columbus",
    gcTeams: [fallLink, springLink],
  },
  { id: "S-ROCK", name: "Rockets, Red" },
];

const games: ScoutGame[] = [
  {
    id: "gc_gsUthn4XoIxS_59cdce43",
    teamAId: "S-ICEC",
    teamBId: "S-ROCK",
    ageGroupId: "ag1",
    teamAScore: 7,
    teamBScore: 4,
    date: "2028-04-05",
    event: 'Spring "Classic"',
    note: "Pool play",
    season: "Spring 2028",
    ageLevelA: 10,
    ageLevelB: 11,
    source: { kind: "gamechanger", teamId: "gsUthn4XoIxS", gameId: "59cdce43" },
  },
  // A scheduled game, no scores yet.
  { id: "g2", teamAId: "S-ROCK", teamBId: "S-ICEC", ageGroupId: "ag1" },
  // Played up an age level, so logged but kept out of the ratings.
  {
    id: "g3",
    teamAId: "S-ICEC",
    teamBId: "S-ROCK",
    ageGroupId: "ag2",
    teamAScore: 0,
    teamBScore: 12,
    excluded: true,
  },
];

const backup: TeamRankingsBackup = { ageGroups, teams, games };

const scheduleCsv = [
  "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Home Team,Home Runs,Home Hits,Home K",
  "lg1,2026-04-05,Aces,6,7,9,3,Bruins,4,6,2",
  "lg2,2026-04-06,Bruins,6,,,,Aces,,,",
].join("\n");

const backupCsv = `${csvSectionMarker(CSV_SECTIONS.schedule)}\n${scheduleCsv}\n\n${teamRankingsCsvSections(backup)}\n`;

describe("teamRankingsCsvSections", () => {
  it("round-trips the whole pool through CSV", () => {
    expect(parseTeamRankingsCsv(teamRankingsCsvSections(backup))).toEqual(backup);
  });

  it("round-trips the pool appended to a schedule export", () => {
    expect(parseTeamRankingsCsv(backupCsv)).toEqual(backup);
  });

  it("writes nothing for an empty pool, so a plain schedule CSV stays flat", () => {
    expect(teamRankingsCsvSections({ ageGroups: [], teams: [], games: [] })).toBe("");
  });

  it("flattens a newline in free text so one game stays one row", () => {
    const csv = teamRankingsCsvSections({
      ageGroups: [],
      teams: [{ id: "S-ICEC", name: "Ice\nCats" }],
      games: [
        {
          id: "g1",
          teamAId: "S-ICEC",
          teamBId: "S-ROCK",
          ageGroupId: "ag1",
          note: "line one\nline two",
        },
      ],
    });

    expect(csv).not.toMatch(/Ice\nCats/);
    const parsed = parseTeamRankingsCsv(csv);
    expect(parsed?.teams).toEqual([{ id: "S-ICEC", name: "Ice Cats" }]);
    expect(parsed?.games).toEqual([
      {
        id: "g1",
        teamAId: "S-ICEC",
        teamBId: "S-ROCK",
        ageGroupId: "ag1",
        note: "line one line two",
      },
    ]);
  });

  it("keeps team and age group names readable beside the IDs", () => {
    const gamesSection = teamRankingsCsvSections(backup)
      .split(csvSectionMarker(CSV_SECTIONS.games))[1]
      ?.trim();
    expect(gamesSection).toContain("Ice Cats");
    expect(gamesSection).toContain("10U 2028");
  });

  it("writes the GameChanger links as one JSON cell on the team's row", () => {
    const teamsSection = teamRankingsCsvSections(backup)
      .split(csvSectionMarker(CSV_SECTIONS.teams))[1]
      ?.split(csvSectionMarker(CSV_SECTIONS.games))[0]
      ?.trim();
    const lines = teamsSection?.split("\n") ?? [];
    expect(lines[0]).toBe(
      "Team ID,Team Name,State,City,Is My Team,Placeholder,Name Only,Avatar Key,GameChanger Teams"
    );
    // One row per team, even though the first carries two links with quotes and commas inside.
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Columbus");
    expect(lines[1]).toContain("gsUthn4XoIxS");
    expect(lines[1]).toContain("zjvVkYnqLrf0");
    expect(lines[2]).toMatch(/,$/);
  });

  it("writes the season, both ages and the source beside each game", () => {
    const gamesSection = teamRankingsCsvSections(backup)
      .split(csvSectionMarker(CSV_SECTIONS.games))[1]
      ?.trim();
    const lines = gamesSection?.split("\n") ?? [];
    expect(lines[0]).toBe(
      [
        "Game ID,Age Group ID,Age Group,Date,Team A ID,Team A,Team A Score,Team B ID,Team B",
        "Team B Score,Event,Note,Excluded,Season,Team A Age,Team B Age,Source Team ID,Source Game ID",
        "Also From",
      ].join(",")
    );
    // The trailing empty cell is a game no stand-in was ever folded into, which is nearly all of them.
    expect(lines[1]).toMatch(/,Spring 2028,10,11,gsUthn4XoIxS,59cdce43,$/);
    expect(lines[2]).toMatch(/,,,,,,$/);
  });
});

describe("parseTeamRankingsCsv", () => {
  it("returns null for a schedule-only CSV, leaving the live pool alone", () => {
    expect(parseTeamRankingsCsv(scheduleCsv)).toBeNull();
  });

  it("reads a pool whose sections arrive in any order and with reordered columns", () => {
    const csv = [
      csvSectionMarker(CSV_SECTIONS.games),
      "Team B ID,Team A ID,Game ID,Age Group ID,Team A Score,Team B Score",
      "S-ROCK,S-ICEC,g1,ag1,7,4",
      "",
      csvSectionMarker(CSV_SECTIONS.teams),
      "Team Name,Team ID,Is My Team",
      "Ice Cats,S-ICEC,yes",
    ].join("\n");

    expect(parseTeamRankingsCsv(csv)).toEqual({
      ageGroups: [],
      teams: [{ id: "S-ICEC", name: "Ice Cats", isMine: true }],
      games: [
        {
          id: "g1",
          teamAId: "S-ICEC",
          teamBId: "S-ROCK",
          ageGroupId: "ag1",
          teamAScore: 7,
          teamBScore: 4,
        },
      ],
    });
  });

  it("reads a file written before the GameChanger columns existed", () => {
    const csv = [
      csvSectionMarker(CSV_SECTIONS.teams),
      "Team ID,Team Name,State,Is My Team",
      "S-ICEC,Ice Cats,OH,yes",
      "",
      csvSectionMarker(CSV_SECTIONS.games),
      "Game ID,Age Group ID,Age Group,Date,Team A ID,Team A,Team A Score,Team B ID,Team B,Team B Score,Event,Note,Excluded",
      "g1,ag1,10U 2028,2028-04-05,S-ICEC,Ice Cats,7,S-ROCK,Rockets,4,,,",
    ].join("\n");

    expect(parseTeamRankingsCsv(csv)).toEqual({
      ageGroups: [],
      teams: [{ id: "S-ICEC", name: "Ice Cats", isMine: true, state: "OH" }],
      games: [
        {
          id: "g1",
          teamAId: "S-ICEC",
          teamBId: "S-ROCK",
          ageGroupId: "ag1",
          teamAScore: 7,
          teamBScore: 4,
          date: "2028-04-05",
        },
      ],
    });
  });

  it("treats a links cell it cannot read as no links, and drops only the bad link from one it can", () => {
    const mixed = JSON.stringify([springLink, { name: "no id" }]).replace(/"/g, '""');
    const csv = [
      csvSectionMarker(CSV_SECTIONS.teams),
      "Team ID,Team Name,City,GameChanger Teams",
      "S-ICEC,Ice Cats,Columbus,not json",
      `S-ROCK,Rockets,,"${mixed}"`,
      "S-NONE,Nobody,,[]",
    ].join("\n");

    expect(parseTeamRankingsCsv(csv)?.teams).toEqual([
      { id: "S-ICEC", name: "Ice Cats", city: "Columbus" },
      { id: "S-ROCK", name: "Rockets", gcTeams: [springLink] },
      { id: "S-NONE", name: "Nobody" },
    ]);
  });

  it("takes a game's source only when both of its ids are there", () => {
    const csv = [
      csvSectionMarker(CSV_SECTIONS.games),
      "Game ID,Age Group ID,Team A ID,Team B ID,Team A Age,Team B Age,Source Team ID,Source Game ID",
      "g1,ag1,S-ICEC,S-ROCK,9,,gsUthn4XoIxS,",
      "g2,ag1,S-ICEC,S-ROCK,,8.5,,59cdce43",
      "g3,ag1,S-ICEC,S-ROCK,,,gsUthn4XoIxS,59cdce43",
    ].join("\n");

    expect(parseTeamRankingsCsv(csv)?.games).toEqual([
      { id: "g1", teamAId: "S-ICEC", teamBId: "S-ROCK", ageGroupId: "ag1", ageLevelA: 9 },
      { id: "g2", teamAId: "S-ICEC", teamBId: "S-ROCK", ageGroupId: "ag1" },
      {
        id: "g3",
        teamAId: "S-ICEC",
        teamBId: "S-ROCK",
        ageGroupId: "ag1",
        source: { kind: "gamechanger", teamId: "gsUthn4XoIxS", gameId: "59cdce43" },
      },
    ]);
  });

  it("skips rows missing the IDs a row is meaningless without", () => {
    const csv = [
      csvSectionMarker(CSV_SECTIONS.games),
      "Game ID,Age Group ID,Team A ID,Team B ID",
      "g1,ag1,S-ICEC,S-ROCK",
      ",ag1,S-ICEC,S-ROCK",
      "g3,ag1,,S-ROCK",
      "",
      csvSectionMarker(CSV_SECTIONS.teams),
      "Team ID,Team Name",
      "S-ICEC,Ice Cats",
      "S-NONAME,",
    ].join("\n");

    const parsed = parseTeamRankingsCsv(csv);
    expect(parsed?.games.map((game) => game.id)).toEqual(["g1"]);
    expect(parsed?.teams.map((team) => team.id)).toEqual(["S-ICEC"]);
  });
});

describe("parseScheduleCsvImport with a sectioned backup CSV", () => {
  it("reads only the schedule section, ignoring the appended pool", () => {
    const result = parseScheduleCsvImport(backupCsv);

    expect(result.matchups.map((game) => game.id)).toEqual(["lg1", "lg2"]);
    expect(result.teams.map((team) => team.name)).toEqual(["Aces", "Bruins"]);
    expect(result.issues).toEqual([]);
  });

  it("still reads an unsectioned CSV as all schedule", () => {
    const result = parseScheduleCsvImport(scheduleCsv);
    expect(result.matchups).toHaveLength(2);
    expect(result.issues).toEqual([]);
  });
});

describe("coerceTeamRankingsBackup", () => {
  it("round-trips the pool through a JSON backup block", () => {
    const written = JSON.parse(JSON.stringify({ teamRankings: backup })) as {
      teamRankings: unknown;
    };
    expect(coerceTeamRankingsBackup(written.teamRankings)).toEqual(backup);
  });

  it("returns null when a backup predates rankings data", () => {
    expect(coerceTeamRankingsBackup(undefined)).toBeNull();
    expect(coerceTeamRankingsBackup({})).toBeNull();
    expect(coerceTeamRankingsBackup("nope")).toBeNull();
  });

  it("keeps a block that carries only some of the three lists", () => {
    expect(coerceTeamRankingsBackup({ teams })).toEqual({ ageGroups: [], teams, games: [] });
  });

  it("drops entries that are not usable rankings data", () => {
    expect(
      coerceTeamRankingsBackup({
        ageGroups: [{ id: "ag1", name: "10U", seasonIds: [] }, { name: "no id" }],
        teams: [{ id: "S-ICEC", name: "Ice Cats" }, "junk"],
        games: [{ id: "g1", teamAId: "a" }],
      })
    ).toEqual({
      ageGroups: [{ id: "ag1", name: "10U", seasonIds: [] }],
      teams: [{ id: "S-ICEC", name: "Ice Cats" }],
      games: [],
    });
  });
});

describe("summarizeTeamRankingsBackup", () => {
  it("counts groups, teams, and scored games", () => {
    expect(summarizeTeamRankingsBackup(backup)).toBe(
      "2 age groups · 2 ranked teams · 3 logged games (2 scored)"
    );
  });

  it("singularizes a pool of one", () => {
    expect(
      summarizeTeamRankingsBackup({
        ageGroups: [ageGroups[0]!],
        teams: [teams[0]!],
        games: [games[1]!],
      })
    ).toBe("1 age group · 1 ranked team · 1 logged game (0 scored)");
  });
});

describe("teamRankingsBackupIsEmpty", () => {
  it("is true only with nothing in the pool", () => {
    expect(teamRankingsBackupIsEmpty({ ageGroups: [], teams: [], games: [] })).toBe(true);
    expect(teamRankingsBackupIsEmpty({ ageGroups: [], teams: [], games: [games[1]!] })).toBe(false);
  });

  // The import dialog leans on this to warn plainly that a restore will clear the pool, rather
  // than reporting a row of zeroes nobody would read as "this wipes Team Rankings".
  it("flags a file whose sections are present but carry no rows", () => {
    const parsed = parseTeamRankingsCsv(
      [csvSectionMarker(CSV_SECTIONS.teams), "Team ID,Team Name"].join("\n")
    );
    expect(parsed).not.toBeNull();
    expect(teamRankingsBackupIsEmpty(parsed!)).toBe(true);
  });
});

describe("splitCsvSections", () => {
  it("files an unsectioned file under the leading name", () => {
    const sections = splitCsvSections("a,b\n1,2", CSV_SECTIONS.schedule);
    expect([...sections.keys()]).toEqual(["schedule"]);
    expect(sections.get("schedule")).toBe("a,b\n1,2");
  });

  it("tolerates a BOM, blank separators, and loose marker spacing", () => {
    const sections = splitCsvSections(
      "﻿a,b\n1,2\n\n#section:Team Rankings Teams\nTeam ID\nS-ICEC\n",
      CSV_SECTIONS.schedule
    );
    expect(sections.get("schedule")).toBe("a,b\n1,2");
    expect(sections.get("team rankings teams")).toBe("Team ID\nS-ICEC");
  });
});

describe("placeholder slots in a backup", () => {
  it("round-trips the flag, so a slot does not come back as a team", () => {
    const backup = {
      ageGroups: [{ id: "ag1", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }],
      teams: [
        { id: "S-ACES", name: "Aces" },
        { id: "S-TBD", name: "TBD", placeholder: true as const },
      ],
      games: [],
    };
    const restored = parseTeamRankingsCsv(teamRankingsCsvSections(backup));
    expect(restored?.teams).toEqual(backup.teams);
  });

  it("reads a file written before the column existed, leaving every team a team", () => {
    const csv = [csvSectionMarker(CSV_SECTIONS.teams), "Team ID,Team Name", "S-ACES,Aces"].join(
      "\n"
    );
    const restored = parseTeamRankingsCsv(csv);
    expect(restored?.teams).toEqual([{ id: "S-ACES", name: "Aces" }]);
  });
});

describe("writing a backup for a pool too big to hold twice", () => {
  const bigPool = (teams: number, games: number): TeamRankingsBackup => ({
    ageGroups: [{ id: "ag_1", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }],
    teams: Array.from({ length: teams }, (_, index) => ({
      id: `S-${index}`,
      name: `Team ${index}`,
      state: "KY",
    })),
    games: Array.from({ length: games }, (_, index) => ({
      id: `g${index}`,
      ageGroupId: "ag_1",
      teamAId: `S-${index % teams}`,
      teamBId: `S-${(index + 1) % teams}`,
      teamAScore: 6,
      teamBScore: 2,
      date: "2026-09-12",
    })),
  });

  it("writes byte for byte what the joined version writes", () => {
    const backup = bigPool(40, 200);
    expect(teamRankingsCsvParts(backup).join("")).toBe(teamRankingsCsvSections(backup));
  });

  it("comes back in pieces rather than as one string", () => {
    // The joined copy exists alongside the rows it was built from at the moment of the join, which
    // is the peak a phone cannot afford at twenty thousand teams.
    const parts = teamRankingsCsvParts(bigPool(40, 9_000));
    expect(parts.length).toBeGreaterThan(4);
    parts.forEach((part) => expect(part.length).toBeLessThan(1_000_000));
  });

  it("has nothing to write for an empty pool", () => {
    expect(teamRankingsCsvParts({ ageGroups: [], teams: [], games: [] })).toEqual([]);
  });

  it("round-trips through the parser like the joined version does", () => {
    const backup = bigPool(6, 20);
    const parsed = parseTeamRankingsCsv(teamRankingsCsvParts(backup).join(""));
    expect(parsed?.teams).toHaveLength(6);
    expect(parsed?.games).toHaveLength(20);
  });
});

describe("saying how big a backup will be before building it", () => {
  const poolOf = (teams: number, games: number): TeamRankingsBackup => ({
    ageGroups: [],
    teams: Array.from({ length: teams }, (_, index) => ({
      id: `S-${index}`,
      name: `Team ${index}`,
    })),
    games: Array.from({ length: games }, (_, index) => ({
      id: `g${index}`,
      ageGroupId: "ag_1",
      teamAId: "S-0",
      teamBId: "S-1",
    })),
  });

  it("grows with the pool", () => {
    expect(estimateBackupBytes(poolOf(100, 500))).toBeGreaterThan(
      estimateBackupBytes(poolOf(10, 50))
    );
  });

  it("is nothing for nothing", () => {
    expect(estimateBackupBytes({ ageGroups: [], teams: [], games: [] })).toBe(0);
  });

  it("is the right order of magnitude against a pulled pool", () => {
    // Rows as a GameChanger pull leaves them: real club names, a link, an event and a source. That
    // is what the estimate is calibrated against, since it is what a large pool is made of.
    const pulled: TeamRankingsBackup = {
      ageGroups: [{ id: "ag_1", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }],
      teams: Array.from({ length: 200 }, (_, index) => ({
        id: `S-TROSKYILLINOIS${index}`,
        name: `2026 Fall Trosky Illinois 9U ${index}`,
        state: "IL",
        city: "Naperville",
        gcTeams: [
          {
            teamId: `FtEExZwB4b8${index}`,
            name: `2026 Fall Trosky Illinois 9U ${index}`,
            ageGroupId: "ag_1",
            season: "fall",
            seasonYear: 2026,
          },
        ],
      })),
      games: Array.from({ length: 1_000 }, (_, index) => ({
        id: `g-${index}-abcdef`,
        ageGroupId: "ag_1",
        teamAId: `S-TROSKYILLINOIS${index % 200}`,
        teamBId: `S-TROSKYILLINOIS${(index + 1) % 200}`,
        teamAScore: 6,
        teamBScore: 2,
        date: "2026-09-12",
        event: "Fall Classic Championship",
        season: "Fall 2026",
        source: {
          kind: "gamechanger" as const,
          teamId: `FtEExZwB4b8${index % 200}`,
          gameId: `gm-${index}-xyz123`,
        },
      })),
    };
    // Measured against the JSON, which is what a backup is written as now.
    const actual = teamRankingsJson(pulled, "2026-09-17T12:00:00.000Z").length;
    const estimate = estimateBackupBytes(pulled);
    // Only used to decide whether to warn, so being within a quarter either way is the whole ask.
    expect(estimate).toBeGreaterThan(actual * 0.75);
    expect(estimate).toBeLessThan(actual * 1.25);
  });

  it("leans high on a pool typed in by hand rather than low", () => {
    const sparse = poolOf(200, 1_000);
    // Warning a little early costs a confirmation; warning late costs a phone.
    expect(estimateBackupBytes(sparse)).toBeGreaterThan(
      teamRankingsJson(sparse, "2026-09-17T12:00:00.000Z").length
    );
  });

  /*
   * The answers block was worth nothing at all to this estimate, and on a nationwide pool it is
   * the biggest thing in the file: a row on the waiting list costs 374 bytes with its evidence
   * (1.5 MB for 4,013 rows, measured in `agelessEvidence.ts`), so thirty-six thousand of them is
   * thirteen megabytes the warning threshold of eight could not see.
   */
  it("counts the teams waiting on an age, which are most of a nationwide backup", () => {
    const pool = poolOf(40, 300);
    const waiting = {
      ...pool,
      answers: {
        namedAges: [],
        droppedClubs: [],
        tooYoungClubs: [],
        deletedGames: [],
        keptApart: [],
        ageUnknown: Array.from({ length: 36_194 }, (_, index) => ({
          teamId: `gc${index}`,
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-08T00:00:00.000Z",
          tries: 1,
        })),
      },
    };
    expect(estimateBackupBytes(pool)).toBeLessThan(LARGE_BACKUP_BYTES);
    expect(estimateBackupBytes(waiting)).toBeGreaterThan(LARGE_BACKUP_BYTES);
  });

  it("calls a nationwide pool large and a league's own pool not", () => {
    // Twenty thousand teams and the games that come with them: worth asking about first.
    expect(estimateBackupBytes(poolOf(20_000, 200_000))).toBeGreaterThan(LARGE_BACKUP_BYTES);
    // One club's season: it should just download.
    expect(estimateBackupBytes(poolOf(40, 300))).toBeLessThan(LARGE_BACKUP_BYTES);
  });

  it("says a size the way a sentence would", () => {
    expect(formatBytes(2_700_000)).toBe("2.7 MB");
    expect(formatBytes(840_000)).toBe("840 KB");
    expect(formatBytes(512)).toBe("512 bytes");
  });
});

describe("the JSON backup", () => {
  const SAVED_AT = "2026-09-17T12:00:00.000Z";

  it("brings back every age group, team and game exactly as they went in", () => {
    const back = parseTeamRankingsJson(teamRankingsJson(backup, SAVED_AT));
    expect(back).not.toBeNull();
    expect(back!.ageGroups).toEqual(backup.ageGroups);
    expect(back!.teams).toEqual(backup.teams);
    expect(back!.games).toEqual(backup.games);
  });

  it("keeps a team's GameChanger links whole, nested and all", () => {
    /*
     * The shape CSV had nowhere to put: a team carries a list of links, each with its own staff
     * list and season record, so the links went into a cell as JSON inside the CSV and the format
     * was half JSON already.
     */
    const back = parseTeamRankingsJson(teamRankingsJson(backup, SAVED_AT));
    const linked = back!.teams.find((team) => team.gcTeams?.length);
    const original = backup.teams.find((team) => team.gcTeams?.length);
    expect(linked?.gcTeams).toEqual(original?.gcTeams);
  });

  /**
   * The answers, which this file never carried.
   *
   * `readTeamRankingsBackup` built the block and `writeTeamRankingsBackup` restored it; only the
   * writer between them left it out, so the pool backup restored answers it had never saved. It
   * is the file the reset card offers as the way back, and a reset clears the waiting list — so
   * backing up, resetting and restoring lost every team waiting on an age, at two requests each
   * to learn again.
   */
  it("carries the answers, and brings them back", () => {
    const withAnswers = {
      ...backup,
      answers: {
        namedAges: [{ teamId: "gcA", level: 11, namedAt: SAVED_AT }],
        droppedClubs: ["gcB"],
        tooYoungClubs: ["gcC"],
        deletedGames: ["gc_gcA_1"],
        keptApart: ["gcA\u0000gcB"],
        ageUnknown: [
          {
            teamId: "gcD",
            name: "D33 Minors Allied Gardens 2",
            firstSeen: SAVED_AT,
            lastTried: SAVED_AT,
            tries: 2,
            evidence: {
              games: 8,
              scored: 8,
              aheadOfToday: 0,
              shutoutBlowouts: 0,
              opponents: 5,
              namedAnAge: 0,
              tally: [],
              ngb: ["little league"],
            },
          },
          {
            teamId: "gcE",
            name: "LLL Double A - S. Stevens",
            firstSeen: SAVED_AT,
            lastTried: SAVED_AT,
            tries: 1,
          },
        ],
      },
    };
    const back = parseTeamRankingsJson(teamRankingsJson(withAnswers, SAVED_AT));
    expect(back!.answers).toEqual(withAnswers.answers);
  });

  // Written a row at a time like the archives, so the pieces still have to join into one file.
  it("is still valid JSON with an answers block in it", () => {
    const withAnswers = {
      ...backup,
      answers: {
        namedAges: [],
        droppedClubs: [],
        tooYoungClubs: [],
        deletedGames: [],
        keptApart: [],
        ageUnknown: Array.from({ length: 3 }, (_, index) => ({
          teamId: `gc${index}`,
          firstSeen: SAVED_AT,
          lastTried: SAVED_AT,
          tries: 1,
        })),
      },
    };
    const parsed = JSON.parse(teamRankingsJson(withAnswers, SAVED_AT));
    expect(parsed.answers.ageUnknown).toHaveLength(3);
  });

  // A file written before the block existed must leave this browser's answers alone, rather than
  // reading "no answers" as "clear them".
  it("says nothing about answers when the file has none", () => {
    const back = parseTeamRankingsJson(teamRankingsJson(backup, SAVED_AT));
    expect(back!.answers).toBeUndefined();
  });

  it("says what it is, so a file found on a disk a year from now can be read", () => {
    const parsed = JSON.parse(teamRankingsJson(backup, SAVED_AT));
    expect(parsed.format).toBe("league-forecast-team-rankings");
    expect(parsed.version).toBe(BACKUP_JSON_VERSION);
    expect(parsed.savedAt).toBe(SAVED_AT);
    expect(parsed.counts).toEqual({
      ageGroups: backup.ageGroups.length,
      teams: backup.teams.length,
      games: backup.games.length,
    });
  });

  it("writes in pieces that concatenate to exactly the whole file", () => {
    // A Blob is assembled from parts perfectly well, so the join that doubles peak memory at a
    // few hundred thousand games is simply never done.
    expect(teamRankingsJsonParts(backup, SAVED_AT).join("")).toBe(
      teamRankingsJson(backup, SAVED_AT)
    );
  });

  it("has nothing to write for an empty pool", () => {
    expect(teamRankingsJsonParts({ ageGroups: [], teams: [], games: [] }, SAVED_AT)).toEqual([]);
  });

  /*
   * "This file is not a Team Rankings backup" and "this backup is of an empty pool" are different
   * answers, and a restore that treated them alike would wipe a pool on being handed the wrong
   * file.
   */
  it("refuses a file that is not one of ours, rather than reading it as empty", () => {
    expect(parseTeamRankingsJson("not json at all")).toBeNull();
    expect(parseTeamRankingsJson("[]")).toBeNull();
    expect(parseTeamRankingsJson(JSON.stringify({ teams: [], games: [] }))).toBeNull();
    expect(parseTeamRankingsJson(JSON.stringify({ format: "something-else" }))).toBeNull();
  });

  it("tells a JSON backup from a CSV one without parsing either", () => {
    expect(looksLikeJsonBackup(teamRankingsJson(backup, SAVED_AT))).toBe(true);
    expect(looksLikeJsonBackup(`\n  ${teamRankingsJson(backup, SAVED_AT)}`)).toBe(true);
    expect(looksLikeJsonBackup(backupCsv)).toBe(false);
  });

  it("is a fraction of the size the CSV was", () => {
    /*
     * The compact codec is what the pool is already stored as — tuples and a shared dictionary
     * rather than a repeated key per field — so writing it out is a copy rather than a
     * re-encoding.
     */
    const json = teamRankingsJson(backup, SAVED_AT).length;
    const csv = teamRankingsCsvSections(backup).length;
    expect(json).toBeLessThan(csv);
  });

  it("still reads a CSV backup, because files written before this exist", () => {
    // A backup nobody can restore is not a backup.
    const back = parseTeamRankingsCsv(backupCsv);
    expect(back).not.toBeNull();
    expect(back!.games.length).toBe(backup.games.length);
  });
});
