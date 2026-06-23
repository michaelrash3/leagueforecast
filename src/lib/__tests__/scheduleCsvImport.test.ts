import { describe, expect, it } from "vitest";
import { parseScheduleCsvImport } from "../scheduleCsvImport";

const baseHeader = "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Home Team,Home Runs,Home Hits,Home K";

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

it("imports player-pitch error and BB allowed aliases", () => {
  const csv = [
    "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away Errors,Away BB Allowed,Home Team,Home Runs,Home Hits,Home E,Home BB",
    "g1,2026-09-05,Aces,6,7,9,2,4,Bruins,5,6,1,3",
  ].join("\n");

  const result = parseScheduleCsvImport(csv);

  expect(result.logs.g1).toMatchObject({
    awayErrors: "2",
    awayWalksAllowed: "4",
    homeErrors: "1",
    homeWalksAllowed: "3",
  });
});
