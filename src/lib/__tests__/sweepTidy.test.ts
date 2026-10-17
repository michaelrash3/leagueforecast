import { describe, expect, it } from "vitest";
import { leagueUnread, readSweepFile, sweepTidy } from "../../../scripts/sweepTidy";
import { BACKUP_APP, BACKUP_VERSION, type FullBackup } from "../backup";
import type { GcTeamSchedule } from "../gameChangerApi";
import { importGcSchedule, tidyPool, type GcImportState } from "../gameChangerImport";
import {
  parseTeamRankingsJson,
  teamRankingsCsvParts,
  teamRankingsJson,
  type BackupAnswers,
  type TeamRankingsBackup,
} from "../teamRankingsBackup";
import { DEFAULT_SETTINGS, STORAGE_VERSION, type TeamBase } from "../types";

/*
 * The recency sweep's tidy (`scripts/sweepTidy.ts`) against the device's: a club the owner vouched
 * for, by the real list or a League Standings team's pick, whose GameChanger name reads as a
 * tryout, stays with its games, as the device's tidy keeps it, rather than being deleted for its
 * name and its games rewritten under the back-test. Every name is invented.
 */

const WEX = "gcWEXCO00001";
const played = (id: string, opponentName: string, date: string) => ({
  id,
  date,
  opponentName,
  teamScore: 6,
  opponentScore: 2,
  status: "completed" as const,
});
const workouts: GcTeamSchedule = {
  profile: {
    id: WEX,
    name: "Wexcombe Workouts 12U",
    ageLevel: 12,
    season: { season: "fall", year: 2026 },
  },
  games: [
    played("w1", "Brindlewood Badgers 12U", "2026-09-12"),
    played("w2", "Copperfield Cubs 12U", "2026-09-19"),
  ],
  fetchedAt: "2026-10-01T12:00:00.000Z",
};
/** The club in the pool, pulled with the owner's word given, and its two games filed. */
const pool: GcImportState = importGcSchedule(
  workouts,
  { ageGroups: [], teams: [], games: [] },
  { today: "2026-10-11", realClubs: new Set([WEX]) }
).state;
const answers = (realClubs?: string[]): BackupAnswers => ({
  namedAges: [],
  droppedClubs: [],
  tooYoungClubs: [],
  deletedGames: [],
  keptApart: [],
  ageUnknown: [],
  ...(realClubs ? { realClubs } : {}),
});
/** The backup as the sweep reads it: written to the file Setup writes, and read back. */
const backup = (realClubs?: string[]): TeamRankingsBackup => {
  const read = parseTeamRankingsJson(
    teamRankingsJson({ ...pool, answers: answers(realClubs) }, "2026-10-11T12:00:00.000Z")
  );
  if (!read) throw new Error("The backup did not read back.");
  return read;
};
const clubOf = (state: GcImportState) =>
  state.teams.find((team) => team.gcTeams?.some((link) => link.teamId === WEX));

describe("the recency sweep's tidy", () => {
  it("keeps a club the backup says is real, with its games, whatever its name says", () => {
    const { state, notATeam } = sweepTidy(backup([WEX]));
    expect(notATeam).toBe(0);
    expect(clubOf(state)).toBeDefined();
    expect(state.games.map((game) => game.id).sort()).toEqual([`gc_${WEX}_w1`, `gc_${WEX}_w2`]);
  });

  it("deletes it, as the device would, when nobody said it is real", () => {
    const { state, notATeam } = sweepTidy(backup([]));
    expect(notATeam).toBe(1);
    expect(clubOf(state)).toBeUndefined();
    expect(state.games).toEqual([]);
  });

  it("tidies a backup without a real list exactly as before", () => {
    const read = backup();
    expect(read.answers?.realClubs).toBeUndefined();
    expect(sweepTidy(read)).toEqual(
      tidyPool({ ageGroups: read.ageGroups, teams: read.teams, games: read.games })
    );
  });

  it("says when a page plays in League Standings seasons the file cannot show", () => {
    expect(leagueUnread(backup())).toBe(false);
    const linked = backup();
    expect(
      leagueUnread({
        ...linked,
        ageGroups: linked.ageGroups.map((group) => ({ ...group, seasonIds: ["fall"] })),
      })
    ).toBe(true);
  });
});

/*
 * The League Standings half of what the device spares, which only the whole-browser backup can
 * show: its seasons ride beside the pool, where a Team Rankings file holds only their ids.
 */
describe("the recency sweep's tidy, given League Standings", () => {
  const SEASON = "season_fall";
  const club = clubOf(pool)!.id;
  /** The pool with its one page playing in the season. */
  const inLeague: GcImportState = {
    ...pool,
    ageGroups: pool.ageGroups.map((group) => ({ ...group, seasonIds: [SEASON] })),
  };
  /** The whole-browser backup as Settings writes it, no real list, read as the sweep reads it. */
  const whole = (teams: TeamBase[]) => {
    const backup: FullBackup = {
      app: BACKUP_APP,
      backupVersion: BACKUP_VERSION,
      storageVersion: STORAGE_VERSION,
      exportedAt: "2026-10-11T12:00:00.000Z",
      activeSeasonId: SEASON,
      seasons: [
        {
          id: SEASON,
          name: "Fall 2026",
          createdAt: "2026-08-01T12:00:00.000Z",
          teams,
          matchups: [],
          logs: {},
          bracketLogs: {},
          settings: DEFAULT_SETTINGS,
        },
      ],
      teamRankings: { ...inLeague, answers: answers([]) },
      preferences: {},
    };
    const read = readSweepFile(JSON.stringify(backup, null, 2));
    if (!read) throw new Error("The whole-browser backup did not read back.");
    return read;
  };
  const picked = [{ id: "lt-wex", name: "Workouts", scoutTeamId: club }];

  it("keeps a club a League team picks, with its games, read from the whole-browser backup", () => {
    const { pool: read, seasons } = whole(picked);
    expect(seasons).not.toBeNull();
    const { state, notATeam } = sweepTidy(read, seasons);
    expect(notATeam).toBe(0);
    expect(clubOf(state)).toBeDefined();
    expect(state.games.map((game) => game.id).sort()).toEqual([`gc_${WEX}_w1`, `gc_${WEX}_w2`]);
  });

  it("deletes it from the same backup when no League team links it", () => {
    const { pool: read, seasons } = whole([{ id: "lt-owls", name: "Owls" }]);
    const { state, notATeam } = sweepTidy(read, seasons);
    expect(notATeam).toBe(1);
    expect(clubOf(state)).toBeUndefined();
  });

  it("deletes it from a Team Rankings file, which cannot show the pick, and says so", () => {
    const file = readSweepFile(
      teamRankingsJson({ ...inLeague, answers: answers([]) }, "2026-10-11T12:00:00.000Z")
    );
    expect(file?.seasons).toBeNull();
    const { state, notATeam } = sweepTidy(file!.pool);
    expect(notATeam).toBe(1);
    expect(clubOf(state)).toBeUndefined();
    expect(leagueUnread(file!.pool)).toBe(true);
  });

  it("reads the older CSV as a pool with no seasons, and refuses what is no backup", () => {
    const csv = readSweepFile(teamRankingsCsvParts(inLeague).join(""));
    expect(csv?.seasons).toBeNull();
    expect(csv?.pool.teams.map((team) => team.id)).toEqual(inLeague.teams.map((team) => team.id));
    expect(readSweepFile("{}")).toBeNull();
    expect(readSweepFile("{ not json")).toBeNull();
  });
});
