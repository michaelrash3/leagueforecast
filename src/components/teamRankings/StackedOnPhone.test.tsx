import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
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
 * holding: the nationwide pool, at a field. The answer everywhere else in this app is a stacked
 * card below `sm` beside the table above it — `PowerRatingsView` does it, the standings do it —
 * and the cost of that answer is that there are now two shapes to keep in step. A column added to
 * the table and not to the card is invisible on a phone and nothing would say so.
 *
 * So this asserts the two carry the same readings. jsdom applies no media queries, so both are in
 * the document at once; that is what makes them comparable here, and it is the only way to compare
 * them at all without a real viewport.
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

/** The full table, found by the header row only it has. */
const fullTable = (): HTMLElement => {
  const header = screen.getByRole("columnheader", { name: "Best guess" });
  return header.closest("table") as HTMLElement;
};

/** The stacked list beside it: the one whose items carry a Record term. */
const stackedCards = (): HTMLElement[] =>
  screen
    .getAllByRole("listitem")
    .filter((item) => /Record/.test(item.textContent ?? "") && /SOS/.test(item.textContent ?? ""));

/** The full table is collapsed by default: a nationwide pool is thousands of rows. */
const openFullTable = async () => {
  renderTeamRankings(pool());
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
};

describe("the rankings table on a phone", () => {
  it("offers the same rows stacked, not only a table to drag sideways", async () => {
    await openFullTable();

    const cards = stackedCards();
    const rows = within(fullTable()).getAllByRole("row").slice(1);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards).toHaveLength(rows.length);
  });

  it("carries every column the table has, so nothing is invisible on a phone", async () => {
    await openFullTable();

    const headers = within(fullTable())
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent ?? "")
      /*
       * Rank, Team and Rating are the card's headline line rather than labelled pairs — they are
       * the reading, so they go at the top the way `PowerRatingsView` puts them — and Actions is
       * the screen-reader name of a column of buttons. The three are checked by value in the test
       * below instead, which is the stronger assertion anyway.
       */
      .filter((label) => !["Rank", "Team", "Rating", "Actions"].includes(label));
    const card = stackedCards()[0]!;

    headers.forEach((label) => {
      expect(within(card).getByText(label)).toBeInTheDocument();
    });
  });

  it("names the same team, at the same rank, with the same rating", async () => {
    await openFullTable();

    const firstRow = within(fullTable()).getAllByRole("row")[1]!;
    const firstCard = stackedCards()[0]!;

    // The ladder makes Rays the top side, so both shapes have to say so.
    expect(firstRow.textContent).toContain("Rays");
    expect(firstCard.textContent).toContain("Rays");
    expect(firstCard.textContent).toContain("#1");

    // And the rating itself, which is the card's headline number rather than a labelled pair.
    const rating = within(firstRow).getAllByRole("cell")[3]!.textContent!.trim();
    expect(rating).toMatch(/^[+-]?\d/);
    expect(firstCard.textContent).toContain(rating);
  });

  it("keeps the actions on the card, so a phone can still mark a team", async () => {
    await openFullTable();

    const firstCard = stackedCards()[0]!;
    expect(
      within(firstCard).getByRole("button", { name: /mark mine|my team/i })
    ).toBeInTheDocument();
  });
});
