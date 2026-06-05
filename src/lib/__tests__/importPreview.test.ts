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

  it("surfaces reconciliation risks before destructive imports", () => {
    const teams: TeamBase[] = [
      { id: "a", name: "Aces" },
      { id: "b", name: "Bruins" },
      { id: "c", name: "Comets" },
    ];
    const incomingTeams = teams.slice(0, 2);
    const currentMatchups: Matchup[] = [
      { id: "g1", date: "2026-04-05", away: "a", home: "b" },
      { id: "removed", date: "2026-04-12", away: "c", home: "a" },
    ];
    const incomingMatchups: Matchup[] = [
      { id: "g1", date: "2026-04-05", away: "a", home: "b" },
      { id: "dup1", date: "2026-04-06", away: "a", home: "b" },
      { id: "dup2", date: "2026-04-06", away: "a", home: "b" },
      { id: "flip", date: "2026-04-06", away: "b", home: "a" },
    ];

    const preview = buildSeasonImportPreview(
      incomingTeams,
      incomingMatchups,
      { g1: { ...log(true), awayRuns: "8" } },
      teams,
      currentMatchups,
      (teamId) => teams.find((team) => team.id === teamId)?.name ?? teamId,
      { g1: log(true), removed: log(true) }
    );

    expect(preview).toMatchObject({
      duplicateGames: 1,
      reversedDuplicateGames: 1,
      changedFinals: 1,
      removedFinalGames: 1,
      removedTeamsWithFinals: 1,
    });
    expect(formatSeasonImportPreview(preview)).toContain("Reconciliation checks:");
    expect(formatSeasonImportPreview(preview)).toContain("completed score change");
  });
});
