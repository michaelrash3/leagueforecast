import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ageGroup, renderTeamRankings } from "../../test/teamRankingsHarness";

/*
 * Team Rankings' section tabs on a wide screen are a row of their own that stays at the top of the
 * screen (`RankingsHeader`), as League Standings' views do; inside the header's card they scrolled
 * away with it. A phone's are the bar along the bottom, as before.
 */

/** A screen of one width or the other, answering each media query as a browser would. */
const atWidth = (narrow: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: narrow ? query.includes("max-width") : query.includes("min-width"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
};

const tabs = () => screen.getByRole("tablist", { name: "Team Rankings section" });
const headerCard = () =>
  screen.getByRole("heading", { name: "Team Rankings", level: 1 }).parentElement;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Team Rankings' section tabs", () => {
  it("stay at the top of a wide screen, in a row of their own below the header", () => {
    atWidth(false);
    renderTeamRankings({ ageGroups: [ageGroup(10, 2027)], teams: [], games: [] });
    const row = tabs().closest(".sticky");
    expect(row).not.toBeNull();
    expect(row).toHaveClass("top-0");
    expect(headerCard()?.contains(tabs())).toBe(false);
  });

  it("are the bar along the bottom of a phone, which stays put by itself", () => {
    atWidth(true);
    renderTeamRankings({ ageGroups: [ageGroup(10, 2027)], teams: [], games: [] });
    expect(tabs().closest(".fixed")).not.toBeNull();
    expect(tabs().closest(".sticky")).toBeNull();
  });
});
