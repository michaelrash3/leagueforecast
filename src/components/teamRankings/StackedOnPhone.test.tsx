import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/**
 * The rankings table, read on a phone.
 *
 * Eight columns is four too many for one, and this is the table a phone is most likely to be
 * holding: the nationwide pool, at a field. So below `sm` the same rows are stacked into cards.
 *
 * One of the two is rendered, chosen by reading the breakpoint, rather than both with CSS hiding
 * one — this list is bounded to a first page precisely because rendering a nationwide page was
 * more memory than the pool behind it, and rendering every visible row twice puts half of that
 * straight back. The cost of choosing is that there are two shapes to keep in step, and a column
 * added to the table and not to the card is invisible on a phone with nothing to say so. That is
 * what these compare.
 */
const pool = (): Pool => {
  const teams = [
    team("S-1", "Rays", { state: "KY" }),
    team("S-2", "Jays", { state: "KY" }),
    team("S-3", "Owls", { state: "KY" }),
  ];
  const games = [
    game("g1", "ag_10u_2027", "S-1", "S-2", 6, 2, { date: seasonDate(2027) }),
    game("g2", "ag_10u_2027", "S-2", "S-3", 5, 3, { date: seasonDate(2027) }),
    game("g3", "ag_10u_2027", "S-1", "S-3", 7, 1, { date: seasonDate(2027) }),
  ];
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

/** jsdom has no `matchMedia` at all, so a width is something a test has to say out loud. */
const atWidth = (wide: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: wide,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  );
};

/** The full table is collapsed by default: a nationwide pool is thousands of rows. */
const openFullTable = async () => {
  renderTeamRankings(pool());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
};

const stackedCards = (): HTMLElement[] =>
  screen
    .getAllByRole("listitem")
    .filter((item) => /Record/.test(item.textContent ?? "") && /SOS/.test(item.textContent ?? ""));

describe("the rankings table on a phone", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is a table on a wide screen and cards on a narrow one, never both", async () => {
    atWidth(true);
    await openFullTable();
    expect(screen.getByRole("columnheader", { name: "Best guess" })).toBeInTheDocument();
    expect(stackedCards()).toHaveLength(0);

    cleanup();
    atWidth(false);
    await openFullTable();
    // Not a table hidden by a class: no table at all, so a phone renders one set of rows.
    expect(screen.queryByRole("columnheader", { name: "Best guess" })).toBeNull();
    expect(stackedCards().length).toBeGreaterThan(0);
  });

  it("carries every column the table has, so nothing is invisible on a phone", async () => {
    atWidth(true);
    await openFullTable();
    const headers = within(
      screen.getByRole("columnheader", { name: "Best guess" }).closest("table") as HTMLElement
    )
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent ?? "")
      /*
       * Rank, Team and Rating are the card's headline line rather than labelled pairs — they are
       * the reading, so they go at the top — and Actions is the screen-reader name of a column of
       * buttons. The three are checked by value below, which is the stronger assertion anyway.
       */
      .filter((label) => !["Rank", "Team", "Rating", "Actions"].includes(label));
    const rows = within(
      screen.getByRole("columnheader", { name: "Best guess" }).closest("table") as HTMLElement
    ).getAllByRole("row").length;

    cleanup();
    atWidth(false);
    await openFullTable();
    const cards = stackedCards();

    expect(cards).toHaveLength(rows - 1);
    headers.forEach((label) => {
      expect(within(cards[0]!).getByText(label)).toBeInTheDocument();
    });
  });

  it("names the same team, at the same rank, with the same rating", async () => {
    atWidth(true);
    await openFullTable();
    const firstRow = within(
      screen.getByRole("columnheader", { name: "Best guess" }).closest("table") as HTMLElement
    ).getAllByRole("row")[1]!;
    const rating = within(firstRow).getAllByRole("cell")[3]!.textContent!.trim();
    expect(firstRow.textContent).toContain("Rays");
    expect(rating).toMatch(/^[+-]?\d/);

    cleanup();
    atWidth(false);
    await openFullTable();
    const firstCard = stackedCards()[0]!;

    // The ladder makes Rays the top side, so both shapes have to say so, and say the same number.
    expect(firstCard.textContent).toContain("Rays");
    expect(firstCard.textContent).toContain("#1");
    expect(firstCard.textContent).toContain(rating);
  });

  it("keeps the actions on the card, so a phone can still mark a team", async () => {
    atWidth(false);
    await openFullTable();

    const firstCard = stackedCards()[0]!;
    expect(
      within(firstCard).getByRole("button", { name: /mark mine|my team/i })
    ).toBeInTheDocument();
  });

  /*
   * The name is a button, and to a CSS ellipsis a button is one box that fits whole or goes whole.
   * A long name with the League tag after it did not fit a phone's line, so the card read
   * "#84 #3874 …" and gave no way to tell which club it was. jsdom lays nothing out, so what is
   * checked is the cause: nothing between the card and the name may clip it.
   */
  it("never swaps a team's name for an ellipsis", async () => {
    atWidth(false);
    await openFullTable();

    const name = within(stackedCards()[0]!).getByRole("button", { name: "Rays" });
    const card = name.closest("li")!;
    for (let node: HTMLElement | null = name; node && node !== card; node = node.parentElement) {
      expect(node.className).not.toMatch(/\b(truncate|text-ellipsis|overflow-hidden)\b/);
    }
  });
});
