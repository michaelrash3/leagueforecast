import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StatRankingMetric } from "../../lib/teamStats";
import { StatRankingsPanel } from "./StatRankingsPanel";

/*
 * League Stats' lists across a wide screen. A league that keeps final scores only has two, and in
 * the six columns a box-score league's lists need they sat in a third of the card with every name
 * cut short ("Lakesi…") beside four empty columns. Placeholder names.
 */
const metric = (key: string): StatRankingMetric => ({
  key,
  label: key,
  direction: "desc",
  average: 9.5,
  entries: [{ teamId: "A", teamName: "Lakeside Legends", games: 5, rank: 1, value: 12 }],
});

const grid = () => screen.getByTestId("stat-rankings");
const name = () => screen.getAllByText("Lakeside Legends")[0]!;

describe("League Stats' lists", () => {
  it("share the card's width, names whole, where a league keeps only runs for and against", () => {
    render(
      <StatRankingsPanel rankings={{ sampleGames: 18, metrics: [metric("R/G"), metric("RA/G")] }} />
    );
    expect(grid().className).not.toContain("xl:grid-cols-6");
    expect(name().className).not.toContain("truncate");
  });

  it("run six across a wide screen for a league that keeps box scores", () => {
    const keys = ["R/G", "H/G", "K/G", "Opp K/G", "RA/G", "HA/G"];
    render(<StatRankingsPanel rankings={{ sampleGames: 18, metrics: keys.map(metric) }} />);
    expect(grid().className).toContain("xl:grid-cols-6");
    expect(name().className).toContain("xl:truncate");
  });
});
