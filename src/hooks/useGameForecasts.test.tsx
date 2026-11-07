import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGameForecasts, type GameForecastsInputs } from "./useGameForecasts";
import type { BracketProjection } from "../lib/bracket";
import { calculateTeams } from "../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../lib/types";

/**
 * The Schedule's pick for each open game, which the hook works out a chunk of games at a time
 * after the tab opens, each chunk in a task of its own.
 *
 * Six teams twice round, four games played and twenty-six to come: one full chunk of
 * twenty-four and a second of two, so the hand-over between chunks is in every run.
 */
const TEAMS: TeamBase[] = ["Aces", "Bears", "Cubs", "Ducks", "Eagles", "Foxes"].map((name) => ({
  id: name.toLowerCase(),
  name,
}));

const SCHEDULE: Matchup[] = [0, 1].flatMap((round) =>
  TEAMS.flatMap((away, i) =>
    TEAMS.slice(i + 1).map((home, j) => ({
      id: `r${round}-${away.id}-${home.id}`,
      date: `2026-0${4 + round}-${String(1 + i * 4 + j).padStart(2, "0")}`,
      away: round === 0 ? away.id : home.id,
      home: round === 0 ? home.id : away.id,
    }))
  )
);

const played = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "7",
  innings: "6",
  isFinal: true,
});

const LOGS: Record<string, GameLog> = {
  "r0-aces-bears": played(9, 2),
  "r0-aces-cubs": played(7, 3),
  "r0-bears-cubs": played(4, 5),
  "r0-ducks-eagles": played(1, 8),
};

const NO_BRACKET: BracketProjection = {
  size: 0,
  entrantCount: 0,
  rounds: [],
  champion: null,
  championSource: "none",
};

/** Made once, as App memoises them: the effect that fills the picks is keyed on their identity. */
const inputs = (): GameForecastsInputs => {
  const liveTeams = calculateTeams(TEAMS, SCHEDULE, LOGS, DEFAULT_SETTINGS);
  return {
    activeView: "games",
    bracketProjection: NO_BRACKET,
    bracketSeedingLocked: false,
    getGameScenarioImpactMap: new Map(),
    liveById: new Map(liveTeams.map((team) => [team.id, team])),
    liveTeams,
    logs: LOGS,
    matchups: SCHEDULE,
    remainingGames: SCHEDULE.filter((game) => !LOGS[game.id]),
    scoreboardTeamFilter: "ALL",
    seasonStart: 0,
    settings: DEFAULT_SETTINGS,
    silverBracketProjection: NO_BRACKET,
    teamBaseById: new Map(TEAMS.map((team) => [team.id, team])),
  };
};

const picks = (map: ReadonlyMap<string, { pickName: string; pickPct: number; spread: string }>) =>
  [...map].map(([id, pick]) => `${id} ${pick.pickName} ${pick.pickPct.toFixed(6)} ${pick.spread}`);

afterEach(() => {
  vi.useRealTimers();
});

describe("useGameForecasts: the Schedule's picks", () => {
  it("calls every open game once, as the Games tab shows it", async () => {
    const given = inputs();
    expect(given.remainingGames).toHaveLength(26);
    const { result } = renderHook(() => useGameForecasts(given));
    await waitFor(() => expect(result.current.scoreboardPredictions.size).toBe(26));
    expect(picks(result.current.scoreboardPredictions)).toMatchInlineSnapshot(`
      [
        "r0-aces-ducks Aces 0.550023 Aces -0.5",
        "r0-aces-eagles Aces 0.500000 Aces -0.5",
        "r0-aces-foxes Aces 0.548905 Aces -0.5",
        "r0-bears-ducks Bears 0.500000 Bears -0.5",
        "r0-bears-eagles Eagles 0.550023 Eagles -0.5",
        "r0-bears-foxes Foxes 0.548905 Foxes -0.5",
        "r0-cubs-ducks Cubs 0.550023 Cubs -0.5",
        "r0-cubs-eagles Eagles 0.550023 Eagles -0.5",
        "r0-cubs-foxes Cubs 0.500000 Cubs -0.5",
        "r0-ducks-foxes Foxes 0.547786 Foxes -0.5",
        "r0-eagles-foxes Eagles 0.547786 Eagles -0.5",
        "r1-aces-bears Aces 0.598705 Aces -8.5",
        "r1-aces-cubs Aces 0.585678 Aces -6.5",
        "r1-aces-ducks Aces 0.550023 Aces -0.5",
        "r1-aces-eagles Eagles 0.500000 Eagles -0.5",
        "r1-aces-foxes Aces 0.548905 Aces -0.5",
        "r1-bears-cubs Cubs 0.518552 Cubs -2.5",
        "r1-bears-ducks Ducks 0.500000 Ducks -0.5",
        "r1-bears-eagles Eagles 0.550023 Eagles -0.5",
        "r1-bears-foxes Foxes 0.548905 Foxes -0.5",
        "r1-cubs-ducks Cubs 0.550023 Cubs -0.5",
        "r1-cubs-eagles Eagles 0.550023 Eagles -0.5",
        "r1-cubs-foxes Foxes 0.500000 Foxes -0.5",
        "r1-ducks-eagles Eagles 0.548905 Eagles -0.5",
        "r1-ducks-foxes Foxes 0.547786 Foxes -0.5",
        "r1-eagles-foxes Eagles 0.547786 Eagles -0.5",
      ]
    `);
  });

  it("fills them a chunk of twenty-four at a time, each chunk in a task of its own", () => {
    vi.useFakeTimers();
    const given = inputs();
    const { result } = renderHook(() => useGameForecasts(given));
    expect(result.current.scoreboardPredictions.size).toBe(0);
    act(() => {
      vi.advanceTimersToNextTimer();
    });
    expect(result.current.scoreboardPredictions.size).toBe(24);
    act(() => {
      vi.advanceTimersToNextTimer();
    });
    expect(result.current.scoreboardPredictions.size).toBe(26);
  });

  it("works out none off the Games tab", () => {
    vi.useFakeTimers();
    const given = { ...inputs(), activeView: "standings" as const };
    const { result } = renderHook(() => useGameForecasts(given));
    act(() => {
      vi.runAllTimers();
    });
    expect(result.current.scoreboardPredictions.size).toBe(0);
  });
});
