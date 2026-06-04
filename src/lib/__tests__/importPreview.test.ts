import { describe, expect, it } from "vitest";
import { buildSeasonImportPreview, formatSeasonImportPreview } from "../importPreview";
import type { GameLog, Matchup, TeamBase } from "../types";

const log = (isFinal: boolean): GameLog => ({
  innings: "6",
  awayRuns: isFinal ? "7" : "",
  awayHits: isFinal ? "9" : "",
  awayK: isFinal ? "3" : "",
  homeRuns: isFinal ? "4" : "",
  homeHits: isFinal ? "6" : "",
  homeK: isFinal ? "2" : "",
  isFinal,
});

describe("season import previews", () => {
  it("counts replacement deltas and final/open games", () => {
    const currentTeams: TeamBase[] = [{ id: "a", name: "Aces" }];
    const incomingTeams: TeamBase[] = [
      { id: "a", name: "Aces" },
      { id: "b", name: "Bruins" },
    ];
    const currentMatchups: Matchup[] = [{ id: "old", date: "", away: "a", home: "a" }];
    const incomingMatchups: Matchup[] = [
      { id: "g1", date: "2026-04-05", away: "a", home: "b" },
      { id: "g2", date: "2026-04-12", away: "b", home: "a" },
    ];
    const preview = buildSeasonImportPreview(
      incomingTeams,
      incomingMatchups,
      { g1: log(true), g2: log(false) },
      currentTeams,
      currentMatchups,
      (teamId) => incomingTeams.find((team) => team.id === teamId)?.name ?? teamId
    );

    expect(preview).toMatchObject({
      teams: 2,
      games: 2,
      finals: 1,
      open: 1,
      addedTeams: 1,
      removedTeams: 0,
      addedGames: 2,
      removedGames: 1,
    });
    expect(formatSeasonImportPreview(preview)).toContain("Change summary: +1/-0 teams");
  });
});
