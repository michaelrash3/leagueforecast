import { render, type RenderResult } from "@testing-library/react";
import { vi, type Mock } from "vitest";
import { GamesView } from "./GamesView";
import { blankLog } from "../../lib/util";
import type { GameLog, Matchup, TeamBase } from "../../lib/types";

/**
 * GamesView takes thirty-odd props because App.tsx owns every piece of season state and this view
 * only draws it. That is a lot to assemble, which is most of why the largest view in the app —
 * and the one people spend the most time in, since it is where scores get typed — had no test at
 * all. So the assembling lives here once.
 *
 * Defaults describe a plausible two-team season with one open game; a test overrides the parts it
 * is about and reads the spies for what the view asked App to do.
 */
type Props = Parameters<typeof GamesView>[0];

export type GamesViewSpies = {
  addGame: Mock<Props["addGame"]>;
  toggleFinal: Mock<Props["toggleFinal"]>;
  swapGame: Mock<Props["swapGame"]>;
  removeGame: Mock<Props["removeGame"]>;
  updateLog: Mock<Props["updateLog"]>;
  setMatchups: Mock<Props["setMatchups"]>;
  setNewDate: Mock<Props["setNewDate"]>;
  setScoreboardTeamFilter: Mock<Props["setScoreboardTeamFilter"]>;
  openScoreFill: Mock<Props["openScoreFill"]>;
};

export type GamesHarness = RenderResult & { spies: GamesViewSpies };

export const team = (id: string, name: string): TeamBase => ({ id, name });

export const matchup = (id: string, away: string, home: string, date = "5/1"): Matchup => ({
  id,
  date,
  away,
  home,
});

/** A log with whatever the test cares about; everything else blank, as a fresh game is. */
export const log = (over: Partial<GameLog> = {}): GameLog => ({ ...blankLog(), ...over });

type GamesViewOverrides = Partial<Props>;

/** No bracket drawn: what a season that has not finished its schedule has. */
const EMPTY_BRACKET = { rounds: [], seeds: [] } as unknown as Props["bracketProjection"];

export const renderGamesView = (over: GamesViewOverrides = {}): GamesHarness => {
  const spies: GamesViewSpies = {
    addGame: vi.fn(),
    toggleFinal: vi.fn(),
    swapGame: vi.fn(),
    removeGame: vi.fn(),
    updateLog: vi.fn(),
    setMatchups: vi.fn(),
    setNewDate: vi.fn(),
    setScoreboardTeamFilter: vi.fn(),
    openScoreFill: vi.fn(),
  };

  const teams = over.teams ?? [team("t1", "Rays"), team("t2", "Jays")];
  const games = over.scoreboardGames ?? [matchup("g1", "t1", "t2")];

  const result = render(
    <GamesView
      teams={teams}
      matchups={over.matchups ?? games}
      logs={over.logs ?? {}}
      scoreboardGames={games}
      scoreboardPredictions={over.scoreboardPredictions ?? new Map()}
      scoreboardTeamFilter={over.scoreboardTeamFilter ?? "ALL"}
      pitchMode={over.pitchMode ?? "coach"}
      trackErrors={over.trackErrors ?? false}
      runsOnly={over.runsOnly ?? false}
      setScoreboardTeamFilter={over.setScoreboardTeamFilter ?? spies.setScoreboardTeamFilter}
      newDate={over.newDate ?? ""}
      setNewDate={over.setNewDate ?? spies.setNewDate}
      newAway={over.newAway ?? ""}
      setNewAway={over.setNewAway ?? vi.fn()}
      newHome={over.newHome ?? ""}
      setNewHome={over.setNewHome ?? vi.fn()}
      addGameValid={over.addGameValid ?? false}
      addGame={over.addGame ?? spies.addGame}
      toggleFinal={over.toggleFinal ?? spies.toggleFinal}
      swapGame={over.swapGame ?? spies.swapGame}
      removeGame={over.removeGame ?? spies.removeGame}
      updateLog={over.updateLog ?? spies.updateLog}
      setMatchups={over.setMatchups ?? spies.setMatchups}
      gameStatusClasses={over.gameStatusClasses ?? (() => "")}
      seasonGamesFinalized={over.seasonGamesFinalized ?? false}
      bracketProjection={over.bracketProjection ?? EMPTY_BRACKET}
      silverBracketProjection={over.silverBracketProjection ?? EMPTY_BRACKET}
      updateBracketLog={over.updateBracketLog ?? vi.fn()}
      toggleBracketFinal={over.toggleBracketFinal ?? vi.fn()}
      scoreFillPlan={over.scoreFillPlan ?? null}
      openScoreFill={over.openScoreFill ?? spies.openScoreFill}
      closeScoreFill={over.closeScoreFill ?? vi.fn()}
      applyScoreFill={over.applyScoreFill ?? vi.fn()}
      seasonLabel={over.seasonLabel ?? "Test Season"}
    />
  );

  return Object.assign(result, { spies });
};
