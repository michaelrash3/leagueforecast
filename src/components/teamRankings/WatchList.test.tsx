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
import {
  forgetWatchList,
  toggleWatch,
  WATCH_MAX,
  watchedNow,
  watchedOn,
} from "../../lib/watchList";
import { clubLookupOf } from "../../lib/teamRankings/leagueBridge";
import { GONE_CLUB } from "../../lib/teamRankings/rememberedClub";

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

const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: PAGE });

/*
 * A watched club is kept with a GameChanger id it carried (`Watched.gc`), and read by it
 * (`readClub`): a club folded into another stays watched as that club, and a club whose id the pool
 * has given to another is shown gone, never as the club now under its id.
 */
describe("a watched club whose id no longer names it", () => {
  const ACES = team("S-Aces", "Aces", { gcTeams: [link("gcAces001")] });
  const ACES_GOLD = team("S-Aces2", "Aces Gold", { gcTeams: [link("gcAcesGld")] });

  it("stays watched as the club it was folded into", () => {
    toggleWatch(PAGE, { id: "S-Aces2", name: "Aces Gold", gc: "gcAcesGld" });
    const folded = clubLookupOf([{ ...ACES, gcTeams: [link("gcAces001"), link("gcAcesGld")] }]);
    expect(watchedNow(watchedOn(PAGE), folded)).toEqual([
      { id: "S-Aces", name: "Aces Gold", gc: "gcAcesGld" },
    ]);
    // Stopped as the club it is shown as, it goes.
    expect(toggleWatch(PAGE, { id: "S-Aces", name: "Aces" }, folded)).toBe(true);
    expect(watchedOn(PAGE)).toEqual([]);
  });

  it("is shown gone where its id is another club's now and no club carries its id", () => {
    toggleWatch(PAGE, { id: "S-Aces2", name: "Aces Gold", gc: "gcAcesGld" });
    const again = clubLookupOf([
      ACES,
      team("S-Aces2", "Aces Academy", { gcTeams: [link("gcAcesAca")] }),
    ]);
    const shown = watchedNow(watchedOn(PAGE), again);
    expect(shown).toEqual([{ id: `${GONE_CLUB}S-Aces2`, name: "Aces Gold", gc: "gcAcesGld" }]);
    // Watching the club now under the id is watching another club, which is not watched yet.
    expect(shown.some((club) => club.id === "S-Aces2")).toBe(false);
    expect(toggleWatch(PAGE, { id: "S-Aces2", name: "Aces Academy", gc: "gcAcesAca" }, again)).toBe(
      true
    );
    expect(watchedOn(PAGE)).toHaveLength(2);
    // And the one shown gone stops as it is shown.
    expect(toggleWatch(PAGE, shown[0] ?? { id: "", name: "" }, again)).toBe(true);
    expect(watchedOn(PAGE)).toEqual([{ id: "S-Aces2", name: "Aces Academy", gc: "gcAcesAca" }]);
  });

  it("is read back with its GameChanger id, and not at all with one that is not text", () => {
    window.localStorage.setItem(
      "lf_watch_v1",
      JSON.stringify({
        [PAGE]: [
          { id: "S-Aces", name: "Aces", gc: "gcAces001" },
          { id: "S-Bears", name: "Bears", gc: 7 },
          { id: "S-Cubs", name: "Cubs" },
        ],
      })
    );
    forgetWatchList();
    expect(watchedOn(PAGE)).toEqual([
      { id: "S-Aces", name: "Aces", gc: "gcAces001" },
      { id: "S-Cubs", name: "Cubs" },
    ]);
  });

  it("is one club where two watched clubs were folded into one", () => {
    toggleWatch(PAGE, { id: "S-Aces", name: "Aces", gc: "gcAces001" });
    toggleWatch(PAGE, { id: "S-Aces2", name: "Aces Gold", gc: "gcAcesGld" });
    const folded = clubLookupOf([{ ...ACES, gcTeams: [link("gcAces001"), link("gcAcesGld")] }]);
    expect(watchedNow(watchedOn(PAGE), folded).map((club) => club.id)).toEqual(["S-Aces"]);
    expect(toggleWatch(PAGE, { id: "S-Aces", name: "Aces" }, folded)).toBe(true);
    expect(watchedOn(PAGE)).toEqual([]);
  });

  it("is as it always was where it was kept with no GameChanger id, or nothing says otherwise", () => {
    toggleWatch(PAGE, { id: "S-Aces2", name: "Aces Gold" });
    const list = watchedOn(PAGE);
    const again = clubLookupOf([
      ACES,
      team("S-Aces2", "Aces Academy", { gcTeams: [link("gcAcesAca")] }),
    ]);
    expect(watchedNow(list, again)).toBe(list);
    expect(watchedNow(list, null)).toBe(list);
    // And a list read with what holds it as it is, is that list.
    toggleWatch(PAGE, { id: "S-Aces", name: "Aces", gc: "gcAces001" });
    const both = watchedOn(PAGE);
    expect(watchedNow(both, clubLookupOf([ACES, ACES_GOLD]))).toBe(both);
  });

  it("is watched from its panel with its GameChanger id, and followed on the board", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const roster = pool();
    const withIds: Pool = {
      ...roster,
      teams: roster.teams.map((one) => ({ ...one, gcTeams: [link(`gc${one.name}`)] })),
    };
    renderTeamRankings({ ...withIds, search: "?age=10&year=2027" });
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    const panel = await openClub(user, "Cubs");
    await user.click(within(panel).getByRole("button", { name: "Watch" }));
    expect(watchedOn(PAGE)).toEqual([{ id: "S-Cubs", name: "Cubs", gc: "gcCubs" }]);
    await closeSheet(user);
    // Kept under an id since folded into Cubs, and under an id now another club's.
    act(() => {
      toggleWatch(PAGE, { id: "S-Cubs", name: "Cubs" });
      toggleWatch(PAGE, { id: "S-Old", name: "Cubs Gold", gc: "gcCubs" });
      toggleWatch(PAGE, { id: "S-Aces", name: "Old Aces", gc: "gcOldAces" });
    });
    const card = watchCard();
    if (!card) throw new Error("no card");
    expect(card).toHaveTextContent(/#3\s*Cubs/);
    expect(card).toHaveTextContent("Old Aces");
    expect(card).not.toHaveTextContent(/#1\s*Aces/);
    expect(within(card).getAllByText("Not on this board")).toHaveLength(1);
    const cubs = await openClub(user, "Cubs");
    expect(within(cubs).getByRole("button", { name: "Watching" })).toBeInTheDocument();
    await closeSheet(user);
    const aces = await openClub(user, "Aces");
    expect(within(aces).getByRole("button", { name: "Watch" })).toBeInTheDocument();
  });
});
