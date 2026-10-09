import { beforeEach, describe, expect, it } from "vitest";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import { storedBases } from "../leagueBase";
import { seasonDocId, seasonToDoc } from "../leagueDocs";

/*
 * What this device knows of each season's document, as this browser's storage keeps it: read back
 * through the document's own checks, a base the copy gave at a first meeting at write 0 included,
 * which no document is at (1.6e).
 */

const SEASON: SeasonSnapshot = {
  id: "fall",
  name: "Fall",
  createdAt: "2027-01-04T00:00:00.000Z",
  teams: [
    { id: "A", name: "Club A" },
    { id: "B", name: "Club B" },
  ],
  matchups: [{ id: "g1", date: "4/3", away: "A", home: "B" }],
  logs: {},
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS, seasonLabel: "Fall" },
};
const DOC_ID = seasonDocId("fall");
const LANDED = [{ rev: 1, changes: [{ path: ["name"], value: "Fall ball" }] }];

beforeEach(() => window.localStorage.clear());

describe("the bases this browser keeps", () => {
  it("reads back a base at the write it was kept at, with its landed writes", () => {
    storedBases.write(DOC_ID, { season: SEASON, rev: 3, landed: LANDED });
    expect(storedBases.read(DOC_ID)).toEqual({ season: SEASON, rev: 3, landed: LANDED });
  });

  it("reads back the copy's base of a first meeting at write 0, before any of the document's", () => {
    storedBases.write(DOC_ID, { season: SEASON, rev: 0, landed: LANDED });
    expect(storedBases.read(DOC_ID)).toEqual({ season: SEASON, rev: 0, landed: LANDED });
    // Once it moves on to a write of the document's, it is that write's again.
    storedBases.write(DOC_ID, { season: SEASON, rev: 2, landed: [] });
    expect(storedBases.read(DOC_ID)).toEqual({ season: SEASON, rev: 2, landed: [] });
  });

  it("reads a base an earlier version kept, which says nothing of the copy, at its write", () => {
    window.localStorage.setItem(
      `lf_league_base_${DOC_ID}_v1`,
      JSON.stringify({ doc: seasonToDoc(SEASON, 5), landed: [] })
    );
    expect(storedBases.read(DOC_ID)?.rev).toBe(5);
  });
});
