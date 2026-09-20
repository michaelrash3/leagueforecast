import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, { settleSide } from "./App";
import { createSeason, saveTeams, setActiveSeason } from "./lib/storage";

/**
 * The two selects on the Schedule form are App state, seeded from the team list the first time
 * there is one. The seeding only ever filled an empty value, so once set they held whatever they
 * held — and `teams` is replaced wholesale by a season switch, a restored backup, an undo, the
 * season builder and Reset Season, none of which touched them.
 *
 * What that leaves is a form that looks blank and is not. A select whose value names no option
 * shows nothing selected, but the state behind it still holds the old id, and Add Game is enabled
 * on exactly that state — two non-empty ids that differ. Pressing it books a game between two
 * teams that are not in this season, and the schedule then carries a row nothing can rate.
 */
describe("settling a select against the team list it names", () => {
  const teams = [
    { id: "t1", name: "Aces" },
    { id: "t2", name: "Bears" },
  ];

  it("keeps an id that is still a team here", () => {
    // A choice somebody made is a choice, and must not be overwritten on the next render.
    expect(settleSide(teams, "t2", 0)).toBe("t2");
  });

  it("replaces an id from a season that has been switched away from", () => {
    expect(settleSide(teams, "gone", 0)).toBe("t1");
    expect(settleSide(teams, "gone", 1)).toBe("t2");
  });

  it("holds nothing when there is no team to hold", () => {
    // Reset Season, or a league that has not been built yet: an empty value is what disables the
    // button, and a leftover id is what used to keep it live.
    expect(settleSide([], "gone", 0)).toBe("");
    expect(settleSide(teams, "gone", 5)).toBe("");
  });
});

describe("the add-a-game selects across a season switch", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("names teams from the season on screen, not the one left behind", async () => {
    const user = userEvent.setup();
    // Two seasons whose teams share no id, which is the ordinary case: ids are minted per season.
    saveTeams([
      { id: "AAAA", name: "Aces" },
      { id: "BBBB", name: "Bears" },
    ]);
    const other = createSeason("Fall 2026");
    setActiveSeason(other.id);
    saveTeams([
      { id: "CCCC", name: "Comets" },
      { id: "DDDD", name: "Ducks" },
    ]);
    setActiveSeason("default");

    render(<App />);
    await user.click(screen.getByRole("tab", { name: /schedule/i }));
    const away = screen.getByRole("combobox", { name: /away team/i });
    await waitFor(() => expect(away).toHaveValue("AAAA"));

    await user.selectOptions(screen.getByRole("combobox", { name: /active season/i }), other.id);

    // The selects must now name Comets and Ducks. Holding AAAA would leave Add Game live on two
    // ids this season has never heard of.
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: /away team/i })).toHaveValue("CCCC")
    );
    expect(screen.getByRole("combobox", { name: /home team/i })).toHaveValue("DDDD");
  });
});
