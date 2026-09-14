import { describe, expect, it } from "vitest";
import { CSV_SECTIONS, csvSectionMarker, splitCsvSections } from "../csv";
import { parseScheduleCsvImport } from "../scheduleCsvImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import {
  coerceTeamRankingsBackup,
  parseTeamRankingsCsv,
  summarizeTeamRankingsBackup,
  teamRankingsBackupIsEmpty,
  teamRankingsCsvSections,
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

const teams: ScoutTeam[] = [
  { id: "S-ICEC", name: "Ice Cats", isMine: true, state: "OH" },
  { id: "S-ROCK", name: "Rockets, Red" },
];

const games: ScoutGame[] = [
  {
    id: "g1",
    teamAId: "S-ICEC",
    teamBId: "S-ROCK",
    ageGroupId: "ag1",
    teamAScore: 7,
    teamBScore: 4,
    date: "2028-04-05",
    event: 'Spring "Classic"',
    note: "Pool play",
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
