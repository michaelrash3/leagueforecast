import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThisWeekCard } from "./ThisWeekCard";

describe("ThisWeekCard", () => {
  it("names the week's movers with where they were and are, each opening its club", () => {
    const open = vi.fn();
    render(
      <ThisWeekCard
        movers={{
          into: [
            { teamId: "up", name: "Aces", from: 40, to: 12 },
            { teamId: "new", name: "Bears", from: null, to: 20 },
          ],
          outOf: [{ teamId: "down", name: "Cubs", from: 8, to: 31 }],
          climbs: [{ teamId: "far", name: "Dukes", from: 210, to: 64 }],
        }}
        onOpenTeam={open}
      />
    );
    const week = screen.getByRole("region", { name: "This week" });
    expect(week.textContent).toContain("Into the top 25: Aces #40 → #12, Bears new → #20");
    expect(week.textContent).toContain("Out of the top 25: Cubs #8 → #31");
    expect(week.textContent).toContain("Biggest climbs: Dukes #210 → #64 (up 146)");
    fireEvent.click(screen.getByRole("button", { name: "Bears" }));
    expect(open).toHaveBeenCalledWith("new");
  });

  it("draws nothing when nobody moved", () => {
    const { container } = render(
      <ThisWeekCard movers={{ into: [], outOf: [], climbs: [] }} onOpenTeam={() => undefined} />
    );
    expect(container.textContent).toBe("");
  });
});
