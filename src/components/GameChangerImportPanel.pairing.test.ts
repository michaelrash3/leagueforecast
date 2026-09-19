import { describe, expect, it } from "vitest";
import { pairingMatches } from "./GameChangerImportPanel";
import type { GcSeasonPairing } from "../lib/gameChangerImport";

/*
 * A nationwide pull offers four hundred of these. The list used to draw a hundred and say the rest
 * could be done from each team's own panel — three hundred panels, one at a time, for the same
 * decision every time. An unpaired squad is not cosmetic either: a club whose fall and spring ids
 * were never joined is two teams with no game between them, so a rating cannot carry across a
 * winter it cannot see.
 */
const pairing = (over: Partial<GcSeasonPairing> = {}): GcSeasonPairing => ({
  fromTeamId: "gc-from",
  fromTeamName: "Complete Game - Spears",
  fromSeason: "Fall 2025",
  toTeamId: "gc-to",
  toTeamName: "Complete Game - Spears",
  toSeason: "Spring 2026",
  evidence: ["state", "shared-opponent"],
  sameName: true,
  confidence: "likely",
  kind: "next-season",
  ...over,
});

describe("searching the season pairings", () => {
  it("matches everything when nothing is typed", () => {
    expect(pairingMatches(pairing(), "")).toBe(true);
    expect(pairingMatches(pairing(), "   ")).toBe(true);
  });

  it("finds a club by either of its names, whatever the case", () => {
    expect(pairingMatches(pairing(), "spears")).toBe(true);
    expect(pairingMatches(pairing(), "COMPLETE GAME")).toBe(true);
    expect(pairingMatches(pairing({ toTeamName: "Olathe Nine" }), "olathe")).toBe(true);
  });

  it("finds them by season, which is how the winter boundary gets worked through", () => {
    expect(pairingMatches(pairing(), "Fall 2025")).toBe(true);
    expect(pairingMatches(pairing(), "spring 2026")).toBe(true);
    expect(pairingMatches(pairing({ fromSeason: "Winter 2025" }), "fall")).toBe(false);
  });

  it("finds them by how sure the app is", () => {
    expect(pairingMatches(pairing({ confidence: "strong" }), "strong")).toBe(true);
    expect(pairingMatches(pairing({ confidence: "likely" }), "strong")).toBe(false);
  });

  it("says no when nothing on the row says yes", () => {
    expect(pairingMatches(pairing(), "Cannon Ballers")).toBe(false);
  });
});
