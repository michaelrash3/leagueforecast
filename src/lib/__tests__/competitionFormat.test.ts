import { describe, expect, it } from "vitest";
import {
  migrateCompetitionFormat,
  selectQualifiers,
  validateCompetitionFormat,
  type CompetitionFormat,
} from "../competitionFormat";
import { DEFAULT_SETTINGS } from "../types";

const ranked = ["A", "B", "C", "D", "E"].map((id) => ({ id, name: id }));

describe("competition formats", () => {
  it("migrates existing seasons to behaviorally identical top-N, all, and none presets", () => {
    expect(migrateCompetitionFormat({ ...DEFAULT_SETTINGS, goldCutoff: 3 }).automaticBids).toBe(3);
    expect(migrateCompetitionFormat({ ...DEFAULT_SETTINGS, postseasonFormat: "all" }).preset).toBe(
      "everyone"
    );
    expect(migrateCompetitionFormat({ ...DEFAULT_SETTINGS, postseasonFormat: "none" }).preset).toBe(
      "regular-season"
    );
  });

  it("selects each group winner before standings-ordered wild cards", () => {
    const format: CompetitionFormat = {
      version: 1,
      preset: "division-wildcard",
      groups: { A: "East", B: "East", C: "West", D: "West", E: "West" },
      automaticBids: 1,
      wildcardBids: 1,
      bracket: "single-elimination",
      byes: 0,
      reseed: true,
    };
    expect(selectQualifiers(ranked, format).map((team) => team.id)).toEqual(["A", "B", "C"]);
    expect(validateCompetitionFormat(format, ranked)).toEqual([]);
  });

  it("rejects missing groups, excess bids, and impossible byes", () => {
    const format: CompetitionFormat = {
      version: 1,
      preset: "pool-wildcard",
      groups: { A: "One" },
      automaticBids: 5,
      wildcardBids: 5,
      bracket: "double-elimination",
      byes: 10,
      reseed: false,
    };
    expect(validateCompetitionFormat(format, ranked)).toHaveLength(3);
  });
});
