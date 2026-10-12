import { describe, expect, it } from "vitest";
import { parseScheduleCsvImport } from "../scheduleCsvImport";

const baseHeader =
  "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Home Team,Home Runs,Home Hits,Home K";

describe("parseScheduleCsvImport", () => {
  it("imports score-only finals instead of requiring strikeout columns", () => {
    const csv = [
      baseHeader,
      "g1,2026-04-05,Aces,6,7,9,,Bruins,4,6,",
      "g2,2026-04-06,Bruins,6,,,,Aces,,,",
    ].join("\n");

    const result = parseScheduleCsvImport(csv);

    expect(result.matchups).toHaveLength(2);
    expect(result.logs.g1).toMatchObject({
      awayRuns: "7",
      homeRuns: "4",
      awayK: "0",
      homeK: "0",
      isFinal: true,
    });
    expect(result.logs.g2).toMatchObject({
      awayRuns: "",
      homeRuns: "",
      awayK: "",
      homeK: "",
      isFinal: false,
    });
  });

  it("does not call a 0-0 final unless the game is already in the past", () => {
    const today = new Date(2026, 3, 6); // 6 April 2026
    const csv = [
      baseHeader,
      "past,2026-04-05,Aces,6,0,,,Bruins,0,,",
      "today,2026-04-06,Aces,6,0,,,Bruins,0,,",
      "future,2026-04-12,Aces,6,0,,,Bruins,0,,",
      "undated,,Aces,6,0,,,Bruins,0,,",
      "scored,2026-04-12,Aces,6,3,,,Bruins,0,,",
    ].join("\n");

    const result = parseScheduleCsvImport(csv, today);

    expect(result.logs.past?.isFinal).toBe(true);
    expect(result.logs.today?.isFinal).toBe(false);
    expect(result.logs.future?.isFinal).toBe(false);
    expect(result.logs.undated?.isFinal).toBe(false);
    // A real score is a result whatever the date says: dates are wrong far more often than scores.
    expect(result.logs.scored?.isFinal).toBe(true);
    // The zeros the file typed are kept, so the game still shows what it said; it is just not final.
    expect(result.logs.future).toMatchObject({ awayRuns: "0", homeRuns: "0" });
  });

  it("keeps existing strikeout values when scored CSV finals include them", () => {
    const csv = [baseHeader, "g1,2026-04-05,Aces,6,7,9,3,Bruins,4,6,2"].join("\n");

    const result = parseScheduleCsvImport(csv);

    expect(result.logs.g1).toMatchObject({ awayK: "3", homeK: "2", isFinal: true });
  });

  it("skips duplicate game IDs and reports the CSV row", () => {
    const csv = [
      baseHeader,
      "g1,2026-04-05,Aces,6,7,9,3,Bruins,4,6,2",
      "g1,2026-04-06,Bruins,6,,,,Aces,,,",
    ].join("\n");

    const result = parseScheduleCsvImport(csv);

    expect(result.matchups).toHaveLength(1);
    expect(result.issues).toEqual([{ kind: "duplicate-id", rowNumber: 3, detail: "g1" }]);
  });
});

it("imports player-pitch box-score BB as walks drawn by that team", () => {
  const csv = [
    "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away Errors,Away BB,Home Team,Home Runs,Home Hits,Home E,Home BB",
    "g1,2026-09-05,Aces,6,7,9,2,4,Bruins,5,6,1,3",
  ].join("\n");

  const result = parseScheduleCsvImport(csv);

  expect(result.logs.g1).toMatchObject({
    awayErrors: "2",
    awayWalksAllowed: "3",
    homeErrors: "1",
    homeWalksAllowed: "4",
  });
});

it("imports explicit BB allowed aliases without switching them", () => {
  const csv = [
    "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away E,Away BB Allowed,Home Team,Home Runs,Home Hits,Home Errors,Home BB Allowed",
    "g1,2026-09-05,Aces,6,7,9,2,5,Bruins,4,6,1,2",
  ].join("\n");

  const result = parseScheduleCsvImport(csv);

  expect(result.logs.g1).toMatchObject({
    awayErrors: "2",
    awayWalksAllowed: "5",
    homeErrors: "1",
    homeWalksAllowed: "2",
  });
});

/**
 * A nil-nil is a placeholder until the day has been and gone, and saying which day a bare "M/D" is
 * takes the year the season sits in. The reader used to compare both sides inside one fixed year,
 * which is really a month-and-day comparison — so a spring season set up in December had every one
 * of its games marked final as a draw nobody played, because March sorts before December.
 *
 * Squad year 2027 runs August 2026 to July 2027, so in it a "9/20" is 2026 and a "3/15" is 2027.
 */
describe("when a nil-nil is a result", () => {
  const csv = [
    "Game ID,Date,Away Team,Away Runs,Home Team,Home Runs",
    "g1,9/20,Aces,0,Bears,0",
    "g2,3/15,Aces,0,Cubs,0",
    "g3,4/12,Aces,0,Ducks,0",
  ].join("\n");

  const finalsOn = (when: string, squadYear?: number) => {
    const out = parseScheduleCsvImport(csv, new Date(when), squadYear);
    return out.matchups.filter((m) => out.logs[m.id]?.isFinal === true).map((m) => m.date);
  };

  it("counts only the days already behind us", () => {
    // December 2026: the autumn game has been played, the spring ones have not.
    expect(finalsOn("2026-12-20T12:00:00", 2027)).toEqual(["9/20"]);
  });

  it("takes each game as its own day passes", () => {
    expect(finalsOn("2027-04-01T12:00:00", 2027)).toEqual(["9/20", "3/15"]);
    expect(finalsOn("2027-05-01T12:00:00", 2027)).toEqual(["9/20", "3/15", "4/12"]);
  });

  it("calls nothing a result when no year says which day it is", () => {
    // No age group claims the season yet. A game nobody can place is a game nobody has played.
    expect(finalsOn("2027-05-01T12:00:00", undefined)).toEqual([]);
  });

  it("still takes a scoreline as a result whatever the date", () => {
    // Only a nil-nil is ambiguous; 7-3 is somebody's afternoon however it is dated.
    const played = [
      "Game ID,Date,Away Team,Away Runs,Home Team,Home Runs",
      "g1,3/15,Aces,7,Bears,3",
    ].join("\n");
    const out = parseScheduleCsvImport(played, new Date("2026-12-20T12:00:00"), 2027);
    expect(out.logs[out.matchups[0]!.id]?.isFinal).toBe(true);
  });
});
