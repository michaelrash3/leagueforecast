import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { backtestPredictions } from "../../lib/backtest";
import { forecastGame } from "../../lib/gameForecast";
import { buildPredictionEngine } from "../../lib/predictionEngine";
import { attachAdjustedRatings, calculateTeams } from "../../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../../lib/types";
import { DashboardView } from "./DashboardView";

/*
 * Where the Dashboard sets its power ratings on a wide screen. Beside two or three predictions the
 * side column held Data Quality alone, a card a seventh of their height, with the ratings below
 * both; they go in that column now, in the stacked rows that fit it. Beside fewer they keep the
 * page's width, since a column of ratings beside one short card leaves the same gap on the other
 * side. Placeholder teams.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];
const played: Matchup[] = [
  { id: "g1", date: "5/2", away: "A", home: "B" },
  { id: "g2", date: "5/9", away: "B", home: "C" },
  { id: "g3", date: "5/16", away: "C", home: "A" },
];
const logs = { g1: final(8, 2), g2: final(5, 4), g3: final(3, 6) };

/** The Dashboard of a season with this many games still to play. */
const draw = (left: number) => {
  const matchups: Matchup[] = [
    ...played,
    ...Array.from({ length: left }, (_, i) => ({
      id: `u${i}`,
      date: `5/${23 + i}`,
      away: teams[i % 3]?.id ?? "A",
      home: teams[(i + 1) % 3]?.id ?? "B",
    })),
  ];
  const settings = DEFAULT_SETTINGS;
  const live = calculateTeams(teams, matchups, logs, settings);
  const engine = buildPredictionEngine(live, matchups, logs, settings);
  const rated = attachAdjustedRatings(live, engine.ratings);
  render(
    <DashboardView
      engine={engine}
      backtestResult={backtestPredictions([], [], {}, settings)}
      teamsById={new Map(live.map((team) => [team.id, team]))}
      matchups={matchups}
      setActiveView={vi.fn()}
      findings={[]}
      gameForecast={(game) => forecastGame(game, rated, settings)}
    />
  );
  const ratings = screen.getByRole("region", { name: "Power Ratings" });
  return {
    ratings,
    /** The grid of two columns: the predictions, and the column beside them. */
    grid: screen.getByRole("heading", { name: "Upcoming Game Predictions" }).closest("section"),
    rows: ratings.querySelector("ul"),
    table: ratings.querySelector("table"),
  };
};

describe("the Dashboard's power ratings on a wide screen", () => {
  it("stand in the side column, in stacked rows, beside two predictions or more", () => {
    const { ratings, grid, rows, table } = draw(2);
    // Under Data Quality, in the one column with it: the grid's second child.
    expect(ratings.previousElementSibling?.tagName).toBe("ASIDE");
    expect(ratings.parentElement).toBe(grid?.children[1]);
    expect(rows?.className).toContain("lg:block");
    expect(table?.className).toContain("lg:hidden");
  });

  it("keep the page's width, as a table, beside one prediction", () => {
    const { ratings, grid, rows, table } = draw(1);
    // After the two columns, not in either.
    expect(ratings.previousElementSibling).toBe(grid);
    expect(rows?.className).not.toContain("lg:block");
    expect(table?.className).not.toContain("lg:hidden");
  });

  it("keep the page's width once nothing is left to predict", () => {
    const { ratings, grid } = draw(0);
    expect(ratings.previousElementSibling).toBe(grid);
  });

  it("are drawn once either way", () => {
    draw(3);
    expect(screen.getAllByRole("region", { name: "Power Ratings" })).toHaveLength(1);
  });
});
