import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";
import { forgetWatchList, toggleWatch, WATCH_MAX, watchedOn } from "../../lib/watchList";

/*
 * The clubs a reader watches, up to five a page, on this device (`watchList.ts`), and the card at
 * the top of that page's board (`WatchCard`), watched from a club's panel.
 */

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-12T12:00:00"));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  window.localStorage.removeItem("lf_watch_v1");
  forgetWatchList();
});

const PAGE = "ag_10u_2027";
const NAMES = ["Aces", "Bears", "Cubs", "Ducks", "Eagles", "Foxes", "Gulls"];

/** A ladder: each club beats the next, so the board ranks them in this order. */
const pool = (): Pool => ({
  ageGroups: [ageGroup(10, 2027), ageGroup(11, 2027)],
  teams: NAMES.map((name) => team(`S-${name}`, name)),
  games: NAMES.slice(1).map((name, at) =>
    game(`g${at}`, PAGE, `S-${NAMES[at]}`, `S-${name}`, 8, 2, { date: "2026-08-22" })
  ),
});

const openClub = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(within(screen.getByRole("table")).getByRole("button", { name }));
  return screen.findByRole("region", { name });
};
const closeSheet = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
const watchCard = () => screen.queryByRole("region", { name: "Watching" });

describe("the clubs watched on a page", () => {
  it("are watched from a club's panel and listed at the top of the board, a tap from the panel", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=10&year=2027" });
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    expect(watchCard()).toBeNull();

    const panel = await openClub(user, "Cubs");
    const watch = within(panel).getByRole("button", { name: "Watch" });
    expect(watch).toHaveAttribute("aria-pressed", "false");
    await user.click(watch);
    expect(within(panel).getByRole("button", { name: "Watching" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await closeSheet(user);

    const card = watchCard();
    expect(card).not.toBeNull();
    if (!card) return;
    // Third on the ladder, 1-1, with its rating.
    expect(card).toHaveTextContent(/#3\s*Cubs/);
    expect(card).toHaveTextContent(/1-1 · [+-]\d\.\d/);
    await user.click(within(card).getByRole("button", { name: "Cubs" }));
    expect(await screen.findByRole("dialog", { name: "Cubs" })).toBeInTheDocument();
    await closeSheet(user);

    await user.click(within(card).getByRole("button", { name: "Stop watching Cubs" }));
    expect(watchCard()).toBeNull();
    expect(watchedOn(PAGE)).toEqual([]);
  });

  it("are five at most, and a sixth's Watch is off until one is let go", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=10&year=2027" });
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    act(() => {
      NAMES.slice(0, WATCH_MAX).forEach((name) =>
        expect(toggleWatch(PAGE, { id: `S-${name}`, name })).toBe(true)
      );
      expect(toggleWatch(PAGE, { id: "S-Gulls", name: "Gulls" })).toBe(false);
    });
    expect(within(watchCard() as HTMLElement).getAllByRole("listitem")).toHaveLength(WATCH_MAX);

    const panel = await openClub(user, "Gulls");
    expect(within(panel).getByRole("button", { name: "Watch" })).toBeDisabled();
    await closeSheet(user);
    await user.click(screen.getByRole("button", { name: "Stop watching Aces" }));
    const again = await openClub(user, "Gulls");
    expect(within(again).getByRole("button", { name: "Watch" })).toBeEnabled();
  });

  it("are each page's own, and kept on this device across a visit", async () => {
    toggleWatch(PAGE, { id: "S-Aces", name: "Aces" });
    expect(watchedOn("ag_11u_2027")).toEqual([]);
    // Read again from storage, as the next visit reads it.
    forgetWatchList();
    expect(watchedOn(PAGE)).toEqual([{ id: "S-Aces", name: "Aces" }]);
    // A store not as written is read as nothing watched, not an error.
    window.localStorage.setItem("lf_watch_v1", "{not json");
    forgetWatchList();
    expect(watchedOn(PAGE)).toEqual([]);
  });

  it("names a watched club the board on screen has no row for", async () => {
    renderTeamRankings({ ...pool(), search: "?age=10&year=2027" });
    await screen.findByRole("button", { name: /show all \d+ teams/i });
    // Watched once the page is open (the harness starts from empty storage), drawn at once.
    act(() => {
      toggleWatch(PAGE, { id: "S-Gone", name: "Long Gone" });
    });
    const card = watchCard();
    expect(card).toHaveTextContent("Long Gone");
    expect(card).toHaveTextContent("Not on this board");
  });
});
