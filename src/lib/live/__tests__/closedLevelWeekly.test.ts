import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { fieldsOf, firestoreFieldsOf } from "../../cloud/firestoreRest";
import { nightlyVerdicts } from "../../runAlarms";
import { compareClosedLevels, type ClosedLevelCheck } from "../../scoutBacktest";
import { rankingPoolGroupIds, type AgeGroup } from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "../allKnown";
import {
  coerceClosedLevelRecord,
  lastClosedLevelLine,
  readLastClosedLevel,
  type ClosedLevelRecord,
} from "../closedLevelRecord";
import {
  closedLevelDue,
  closedLevelRecordOf,
  closedLevelWord,
  describeWeekly,
  weeklyClosedLevel,
} from "../closedLevelWeekly";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import { asWorkerSees } from "../views/board";
import type { LiveReader } from "../viewStore";

/*
 * The Monday re-measure of where a rating starts, as the nightly runs it on the pool it has just
 * published from (`closedLevelWeekly.ts`), and the record it keeps for the Model check card
 * (`closedLevelRecord.ts`). On the seeded fixture (`scripts/poolFixture.ts`), stored and read back
 * through the real storage layer, as the nightly's pool is: about 3,000 made-up clubs over two squad
 * years. None of it reads or writes a name.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
/** The fixture's League Standings seasons, coerced as the cloud copy's `league` part is read. */
const SEASONS: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};
/** A Monday a few days before the fixture's day, so its four weeks are full of games. */
const MONDAY = "2027-04-12";

let ageGroups: AgeGroup[] = [];
beforeAll(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  ageGroups = loadAgeGroups();
});
afterAll(() => resetTeamRankingsStore());

const input = (today: string) => ({
  ageGroups,
  teams: loadScoutTeams(),
  gamesOfYear: loadScoutGamesForYear,
  readSeason: SEASONS,
  autoRemoved: new Map(),
  today,
});

describe("when the nightly re-measures", () => {
  it("re-measures on a Monday and on no other day", () => {
    expect(closedLevelDue("2026-10-12")).toBe(true);
    expect(closedLevelDue("2026-10-19")).toBe(true);
    for (const day of ["2026-10-11", "2026-10-13", "2026-10-17"]) {
      expect(closedLevelDue(day)).toBe(false);
    }
    expect(closedLevelDue("12 October")).toBe(false);
  });
});

describe("the Monday re-measure on the pool the boards were built from", () => {
  it("reads the squad year in play, on its pool as the boards fit it", () => {
    const weekly = weeklyClosedLevel(input(MONDAY))!;
    // The 2026 year's pages hold nothing in March and April 2027; this year's hold the weeks.
    expect(weekly.year).toBe(2027);
    expect(weekly.check.games).toBeGreaterThan(0);
    // The same answer the Model check gives on any of the year's pages, on the board's pool.
    const page = "ag_12u_2027";
    const known = deriveAllKnown({
      ageGroups,
      teams: loadScoutTeams(),
      yearGames: loadScoutGamesForYear(2027),
      readSeason: SEASONS,
      autoRemoved: new Map(),
    });
    const pool = asWorkerSees(
      known.teams,
      gamesOnPages(known.games, rankingPoolGroupIds(page, ageGroups))
    );
    expect(weekly.check).toEqual(
      compareClosedLevels(page, pool.teams, pool.games, ageGroups, MONDAY)
    );
  });

  it("has nothing to re-measure when no year with a table has games in the four weeks", () => {
    expect(weeklyClosedLevel(input("2030-01-07"))).toBeNull();
    expect(weeklyClosedLevel(input("not a day"))).toBeNull();
  });

  it("says what it found in counts and numbers, and names nobody", () => {
    const weekly = weeklyClosedLevel(input(MONDAY))!;
    const lines = describeWeekly(weekly, 21);
    expect(lines[0]).toMatch(
      /^Starting level re-measured on the 2027 squad year, 2027-03-15 to 2027-04-11: -?\d+\.\d\d \+\/- \d+\.\d\d on \d+ games in \d+ clusters \(weeks of \d+, \d+, \d+, \d+\), in 21 s\.$/
    );
    expect(lines[1]).toMatch(/runs a game (better|worse) than the -1\.6 held, over \d+ games; /);
    const said = lines.join("\n");
    for (const team of fixture.teams) expect(said).not.toContain(team.name);
    expect(describeWeekly(null, 3)).toEqual([
      "The starting level was not re-measured: no squad year with a table has games in the four weeks.",
    ]);
  });
});

/** A reading clearly better than the held level, its numbers made to order. */
const better: ClosedLevelCheck = {
  held: -1.6,
  level: -1.9234,
  standardError: 0.12,
  games: 79_981,
  clusters: 10_590,
  weeks: [
    { from: "2026-09-14", to: "2026-09-20", games: 19_710, level: -1.95 },
    { from: "2026-09-21", to: "2026-09-27", games: 25_909, level: -1.9 },
    { from: "2026-09-28", to: "2026-10-04", games: 27_834, level: -1.91 },
    { from: "2026-10-05", to: "2026-10-11", games: 6_528, level: -1.93 },
  ],
  paired: { by: 0.0012, standardError: 0.0004, samples: 79_981 },
  better: true,
};

describe("the word the alarm step is handed", () => {
  it("is held where no level read clearly better, and settles the alarm on a live night", () => {
    expect(closedLevelWord({ ...better, better: false })).toBe("held");
    expect(
      nightlyVerdicts({
        outcome: "success",
        event: "schedule",
        mode: "live",
        closedLevel: closedLevelWord({ ...better, better: false }),
      })
    ).toContainEqual({ kind: "closedLevel", failing: false });
  });

  it("carries the numbers of a clearly better level, which raise the alarm", () => {
    const word = closedLevelWord(better);
    expect(word).toBe("better -1.6 -1.92 0.00120 0.00040 79981");
    const raised = nightlyVerdicts({
      outcome: "success",
      event: "schedule",
      mode: "live",
      closedLevel: word,
    }).find((verdict) => verdict.kind === "closedLevel");
    expect(raised).toMatchObject({ failing: true });
    expect(raised?.failing && raised.said).toContain("clearly better at -1.92 than the -1.6 held");
  });
});

describe("the record kept for the card", () => {
  const record = closedLevelRecordOf(
    { year: 2027, check: better },
    "2026-10-12",
    "2026-10-12T04:40:00.000Z"
  );

  it("reads back as kept, through Firestore's own encoding as the nightly writes it", () => {
    expect(coerceClosedLevelRecord(record)).toEqual(record);
    expect(coerceClosedLevelRecord(fieldsOf(firestoreFieldsOf(record)))).toEqual(record);
    const none = closedLevelRecordOf(
      { year: null, check: { ...better, level: null, standardError: null, paired: null } },
      "2026-10-12",
      "2026-10-12T04:40:00.000Z"
    );
    expect(coerceClosedLevelRecord(fieldsOf(firestoreFieldsOf(none)))).toEqual(none);
  });

  it("refuses a record of another layout or shape", () => {
    expect(coerceClosedLevelRecord({ ...record, format: 2 })).toBeNull();
    expect(coerceClosedLevelRecord({ ...record, check: { ...better, games: -1 } })).toBeNull();
    expect(coerceClosedLevelRecord({ ...record, measuredOn: 12 })).toBeNull();
    expect(coerceClosedLevelRecord(null)).toBeNull();
  });

  it("is read through the member's reader of live/, and is none where it cannot be", async () => {
    const reader = (readClosedLevel?: () => Promise<unknown>) => async () =>
      ({
        readMeta: async () => null,
        getChunk: async () => null,
        ...(readClosedLevel ? { readClosedLevel } : {}),
      }) satisfies LiveReader;
    expect(await readLastClosedLevel(reader(async () => record))).toEqual(record);
    expect(await readLastClosedLevel(reader(async () => null))).toBeNull();
    expect(await readLastClosedLevel(reader(async () => ({ ...record, format: 2 })))).toBeNull();
    expect(await readLastClosedLevel(reader())).toBeNull();
    expect(await readLastClosedLevel(async () => null)).toBeNull();
    expect(
      await readLastClosedLevel(reader(() => Promise.reject({ code: "permission-denied" })))
    ).toBeNull();
  });

  it("says on the card when it was measured, then the line", () => {
    const line = lastClosedLevelLine(record as ClosedLevelRecord);
    expect(line).toBe(
      "Last weekly re-measure, 12 Oct. Starting level for leagues with few outside games: held at −1.6; the four weeks to 11 Oct read −1.92 ± 0.12 on 79,981 games; clearly better, by 0.0012 runs a game, give or take 0.0004, so a change to −1.92 is ready."
    );
  });
});
