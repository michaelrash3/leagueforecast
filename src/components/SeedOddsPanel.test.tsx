import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeedOddsPanel } from "./SeedOddsPanel";

/*
 * The seed odds grid's Likely column (2.10): the seeds each team finishes in, eight simulated
 * seasons in ten, beside the chance of each. Placeholder teams.
 */

describe("SeedOddsPanel", () => {
  it("gives each team the seeds it finishes in eight seasons in ten", () => {
    render(
      <SeedOddsPanel
        teams={[
          { id: "A", name: "Aces" },
          { id: "B", name: "Bears" },
          { id: "C", name: "Comets" },
        ]}
        bracketOdds={{
          seedDistribution: { A: [95, 5, 0], B: [5, 60, 35], C: [0, 35, 65] },
          championOdds: { A: 60, B: 30, C: 10 },
          finalsOdds: { A: 80, B: 70, C: 50 },
          iterations: 1000,
        }}
        cutoff={2}
        cardClassName=""
      />
    );
    const grid = screen.getByRole("table");
    expect(within(grid).getByRole("columnheader", { name: "Likely" })).toBeInTheDocument();
    const likelyOf = (abbr: string) =>
      within(grid).getByRole("rowheader", { name: abbr }).closest("tr")?.lastElementChild
        ?.textContent;
    expect(likelyOf("ACE")).toBe("1");
    expect(likelyOf("BEA")).toBe("2–3");
    expect(likelyOf("COM")).toBe("2–3");
  });
});
