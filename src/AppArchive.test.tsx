import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import {
  archivedSeasonIds,
  createSeason,
  getActiveSeasonId,
  loadSettings,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  setSeasonArchived,
} from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * A League Standings season put away once it is over (`seasonArchive.ts`): archived from the
 * Dashboard's "Season over" card or the Seasons card, listed under Archived in the season picker
 * and the Seasons card, read-only until it is brought back. Placeholder names.
 */

beforeAll(() => prefetchAllViews());

const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const archivedOptions = () => {
  const group = screen
    .getByRole("combobox", { name: "Active season" })
    .querySelector('optgroup[label="Archived"]');
  return group ? [...group.querySelectorAll("option")].map((option) => option.textContent) : [];
};

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  saveTeams([
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
  ]);
  saveMatchups([
    { id: "g1", date: "5/1", away: "A", home: "B" },
    { id: "g2", date: "5/8", away: "B", home: "A" },
  ]);
  saveLogs({ g1: final("6", "2"), g2: final("1", "5") });
  saveSettings({ ...loadSettings(), postseasonFormat: "none", seasonLabel: "Spring 2027" });
});

describe("archiving the season that is over", () => {
  it("is offered on the Season over card, makes the season read-only, and is undone there", async () => {
    const user = userEvent.setup();
    render(<App />);

    const over = await screen.findByRole("region", { name: "Season over" });
    await user.click(within(over).getByRole("button", { name: "Archive this season" }));

    expect(
      await screen.findByText(/This season is archived, so it is read-only/, { selector: "div" })
    ).toBeInTheDocument();
    expect(archivedOptions()).toEqual(["Spring 2027"]);
    await waitFor(() => expect(loadSettings().archived).toBe(true));

    // Every control that edits the season is off.
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    const editFinal = await screen.findByRole("button", { name: "Edit final: Aces at Bears" });
    expect(editFinal).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Game" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Unarchive" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit final: Aces at Bears" })).toBeEnabled()
    );
    expect(screen.queryByText(/This season is archived/)).toBeNull();
    expect(archivedOptions()).toEqual([]);
    await waitFor(() => expect(loadSettings().archived).toBe(false));
  });
});

describe("archiving from the Seasons card", () => {
  it("lists a season archived under Archived, there and in the picker, and brings it back", async () => {
    const other = createSeason("Fall 2026");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Archive Fall 2026" }));

    const archived = await screen.findByRole("region", { name: "Archived seasons" });
    expect(within(archived).getByText("Fall 2026")).toBeInTheDocument();
    expect(archivedSeasonIds()).toEqual(new Set([other.id]));
    expect(archivedOptions()).toEqual(["Fall 2026"]);
    // The season on screen is as it was: in use, and editable.
    expect(getActiveSeasonId()).not.toBe(other.id);
    expect(screen.queryByText(/This season is archived/)).toBeNull();

    await user.click(within(archived).getByRole("button", { name: "Unarchive Fall 2026" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Archived seasons" })).toBeNull()
    );
    expect(archivedSeasonIds()).toEqual(new Set());
    expect(archivedOptions()).toEqual([]);
  });

  it("opens an archived season read-only", async () => {
    const other = createSeason("Fall 2026");
    setSeasonArchived(other.id, true);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const archived = await screen.findByRole("region", { name: "Archived seasons" });
    await user.click(within(archived).getByRole("button", { name: "Open" }));

    expect(getActiveSeasonId()).toBe(other.id);
    expect(
      await screen.findByText(/This season is archived, so it is read-only/, { selector: "div" })
    ).toBeInTheDocument();
  });
});
