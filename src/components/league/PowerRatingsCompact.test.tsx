import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildPredictionEngine } from "../../lib/predictionEngine";
import { calculateTeams } from "../../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../../lib/types";
import { PowerRatingsView } from "./PowerRatingsView";

/*
 * The Dashboard's power ratings cut every league at six, so an eight-team league's last two were
 * left off with nothing to say so. Up to ten are shown whole now; past that the top ten, said.
 * Placeholder teams.
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

const league = (size: number) => {
  const teams: TeamBase[] = Array.from({ length: size }, (_, i) => ({
    id: `t${i}`,
    name: `Team ${String.fromCharCode(65 + i)}`,
  }));
  const matchups: Matchup[] = teams.map((team, i) => ({
    id: `g${i}`,
    date: "5/2",
    away: team.id,
    home: teams[(i + 1) % size]?.id ?? team.id,
  }));
  const logs = Object.fromEntries(matchups.map((game, i) => [game.id, final(4 + (i % 3), 3)]));
  const live = calculateTeams(teams, matchups, logs, DEFAULT_SETTINGS);
  return buildPredictionEngine(live, matchups, logs, DEFAULT_SETTINGS);
};

describe("the Dashboard's power ratings", () => {
  it("lists every team of an eight-team league", () => {
    render(<PowerRatingsView engine={league(8)} compact />);
    expect(screen.getByText("Team H")).toBeInTheDocument();
    expect(screen.queryByText(/the Power Ratings tab lists every team/)).toBeNull();
  });

  it("lists a larger league's top ten and says so", () => {
    const engine = league(12);
    render(<PowerRatingsView engine={engine} compact />);
    expect(
      screen.getByText("The top 10 of 12; the Power Ratings tab lists every team.")
    ).toBeInTheDocument();
    const last = engine.powerRatings[11]?.teamName ?? "";
    expect(screen.queryAllByText(last)).toHaveLength(0);
  });
});
