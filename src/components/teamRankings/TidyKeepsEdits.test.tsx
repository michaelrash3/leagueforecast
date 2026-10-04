import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { GcImportState } from "../../lib/gameChangerImport";
import { runPoolCommand } from "../../lib/live/runPoolCommand";
import {
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
} from "../../lib/teamRankingsStorage";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";

/*
 * The tidy runs in the background on a copy of the pool, and what it changed is laid onto the pool
 * record by record when it finishes (`changeBetween`), rather than its copy saved whole. On this
 * page an edit already restarts the tidy on the pool as it is; laying it down record by record is
 * what the server needs, where an edit from another device can land while a tidy works.
 * Placeholder names throughout.
 */
let held: GcImportState | null = null;
let finish: ((state: GcImportState) => void) | null = null;
vi.mock("../../hooks/usePoolTidy", () => ({
  usePoolTidy: () => ({
    busy: null,
    inspect: async () => null,
    tidy: (state: GcImportState) =>
      new Promise((resolve) => {
        held = state;
        finish = (next) =>
          resolve({
            state: next,
            tidy: {
              named: 0,
              folded: 0,
              paired: 0,
              collapsed: 0,
              pruned: 0,
              reclaimed: 0,
              refiled: 0,
              claimed: 0,
              releveled: 0,
            },
          });
      }),
  }),
}));

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const page = ageGroup(10, 2027);

describe("a tidy and an edit", () => {
  it("lays down what the tidy changed, keeping the edit", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [page],
      teams: [team("S-RAYS", "Rays"), team("S-JAYS", "Jays"), team("S-OWLS", "Owls")],
      games: [
        game("played", page.id, "S-RAYS", "S-JAYS", 5, 4, { date: "2026-09-12" }),
        game("other", page.id, "S-OWLS", "S-JAYS", 3, 1, { date: "2026-09-19" }),
      ],
      search: "?section=games&age=10&year=2027",
      untidied: true,
    });
    await waitFor(() => expect(finish).not.toBeNull());
    // A game kept out of the maths, which starts the tidy again on the pool as it now is.
    const showAll = screen.queryByRole("button", { name: /^Show all \d+ games$/ });
    if (showAll) await user.click(showAll);
    const card = screen.getByText(/^Logged games/).closest<HTMLElement>("div.rounded-lg")!;
    const row = within(card)
      .getAllByRole("listitem")
      .find((item) => item.textContent?.includes("2026-09-12")) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Don't count" }));
    await waitFor(() =>
      expect(loadScoutGamesForYear(2027).find((one) => one.id === "played")?.excluded).toBe(true)
    );
    // The tidy, on the copy it was given, changes another game and a club.
    const copy = held!;
    finish!({
      ...copy,
      teams: copy.teams.map((one) => (one.id === "S-OWLS" ? { ...one, state: "OH" } : one)),
      games: copy.games.map((one) => (one.id === "other" ? { ...one, ageLevelA: 10 } : one)),
    });
    await waitFor(() =>
      expect(loadScoutTeams().find((one) => one.id === "S-OWLS")?.state).toBe("OH")
    );
    const games = loadScoutGamesForYear(2027);
    expect(games.find((one) => one.id === "other")?.ageLevelA).toBe(10);
    expect(games.find((one) => one.id === "played")?.excluded).toBe(true);
  });

  it("leaves the pool alone, quietly, when what it changed is gone, and comes round again", async () => {
    finish = null;
    const harness = renderTeamRankings({
      ageGroups: [page],
      teams: [team("S-RAYS", "Rays"), team("S-JAYS", "Jays")],
      games: [game("played", page.id, "S-RAYS", "S-JAYS", 5, 4, { date: "2026-09-12" })],
      search: "?section=games&age=10&year=2027",
      untidied: true,
    });
    await waitFor(() => expect(finish).not.toBeNull());
    const copy = held!;
    // Removed behind the page's back (another device, once the server runs it), while it worked.
    expect(runPoolCommand({ kind: "game.remove", year: 2027, gameIds: ["played"] }).ok).toBe(true);
    finish!({ ...copy, games: copy.games.map((one) => ({ ...one, ageLevelA: 10 })) });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(loadScoutGamesForYear(2027)).toEqual([]);
    expect(harness.toasts()).toEqual([]);
    expect(loadTidyStamp()).toBeNull();
  });
});
