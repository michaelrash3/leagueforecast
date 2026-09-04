import { describe, expect, it } from "vitest";
import { SCHEDULE_IMAGE_LIMITS, sanitizeScheduleImageResponse } from "../scheduleImage";

describe("sanitizeScheduleImageResponse", () => {
  it("keeps a well-formed played game", () => {
    const { subjectTeam, games } = sanitizeScheduleImageResponse({
      subjectTeam: "South Lexington Red 9u",
      games: [
        { date: "2026-08-22", opponent: "Velocirabbits 9U", isHome: true, teamScore: 6, opponentScore: 5 },
      ],
    });
    expect(subjectTeam).toBe("South Lexington Red 9u");
    expect(games).toEqual([
      { opponent: "Velocirabbits 9U", date: "2026-08-22", isHome: true, teamScore: 6, opponentScore: 5 },
    ]);
  });

  it("keeps a score-less row as a scheduled game rather than inventing a result", () => {
    const { games } = sanitizeScheduleImageResponse({
      games: [{ date: "2026-09-05", opponent: "NV Stars" }],
    });
    expect(games).toEqual([{ opponent: "NV Stars", date: "2026-09-05" }]);
  });

  it("drops a half-read score, which would otherwise be a phantom result", () => {
    const { games } = sanitizeScheduleImageResponse({
      games: [{ opponent: "NV Stars", teamScore: 6 }],
    });
    expect(games[0]).toEqual({ opponent: "NV Stars" });
  });

  it("drops rows with no opponent", () => {
    const { games } = sanitizeScheduleImageResponse({
      games: [{ opponent: "  " }, { teamScore: 3, opponentScore: 1 }, { opponent: "Cubs" }],
    });
    expect(games).toEqual([{ opponent: "Cubs" }]);
  });

  it("drops a date that is not a plain ISO day", () => {
    const { games } = sanitizeScheduleImageResponse({
      games: [
        { opponent: "Cubs", date: "Aug 22" },
        { opponent: "Bears", date: "2026-8-2" },
      ],
    });
    expect(games.every((game) => game.date === undefined)).toBe(true);
  });

  it("rejects impossible scores instead of rounding them into the ratings", () => {
    const { games } = sanitizeScheduleImageResponse({
      games: [
        { opponent: "Cubs", teamScore: -1, opponentScore: 4 },
        { opponent: "Bears", teamScore: 4, opponentScore: SCHEDULE_IMAGE_LIMITS.maxScore + 1 },
        { opponent: "Aces", teamScore: 6.4, opponentScore: 5 },
      ],
    });
    // The first two lose their scores entirely (half a score is no score); the third rounds.
    expect(games[0]).toEqual({ opponent: "Cubs" });
    expect(games[1]).toEqual({ opponent: "Bears" });
    expect(games[2]).toEqual({ opponent: "Aces", teamScore: 6, opponentScore: 5 });
  });

  it("caps how many rows one screenshot can produce", () => {
    const rows = Array.from({ length: SCHEDULE_IMAGE_LIMITS.games + 10 }, (_, i) => ({
      opponent: `Team ${i}`,
    }));
    expect(sanitizeScheduleImageResponse({ games: rows }).games).toHaveLength(
      SCHEDULE_IMAGE_LIMITS.games
    );
  });

  it("clamps a runaway name and collapses its whitespace", () => {
    const { games } = sanitizeScheduleImageResponse({
      games: [{ opponent: `  Velocirabbits\n  9U  ${"x".repeat(200)}` }],
    });
    expect(games[0]!.opponent.length).toBe(SCHEDULE_IMAGE_LIMITS.nameLength);
    expect(games[0]!.opponent.startsWith("Velocirabbits 9U x")).toBe(true);
  });

  it("survives junk instead of a response", () => {
    expect(sanitizeScheduleImageResponse(null)).toEqual({ games: [] });
    expect(sanitizeScheduleImageResponse({ games: "nope" })).toEqual({ games: [] });
    expect(sanitizeScheduleImageResponse({ games: [null, 7] })).toEqual({ games: [] });
  });
});
