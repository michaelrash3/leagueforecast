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
import { GAMES_SHOWN_FIRST, GAMES_SHOWN_STEP } from "./GamesSection";
import { ROWS_SHOWN_FIRST, ROWS_SHOWN_STEP } from "./RankingsSection";

/**
 * The two lists that used to render a whole nationwide page as DOM. A page can hold tens of
 * thousands of pulled games and rows, and each row is a dozen elements, so the list was more
 * memory than the pool behind it - for a list nobody scrolls to the end of. Both now show a first
 * page and offer the rest.
 *
 * A ladder rather than a random schedule: each team beats the next, so every result is connected
 * and the fit has an opinion about all of them, and the counts are exact.
 */
const TEAMS = 260;
const GAMES = TEAMS - 1;

const hugePool = (): Pool => {
  const teams = Array.from({ length: TEAMS }, (_, index) =>
    team(`S-${index}`, `Team ${index}`, { state: "KY" })
  );
  const games = Array.from({ length: GAMES }, (_, index) =>
    game(`g${index}`, "ag_10u_2027", `S-${index}`, `S-${index + 1}`, 6, 2, {
      date: seasonDate(2027),
    })
  );
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

/** The card holding a "Showing N of M" line, so the count is scoped to that list and no other. */
const cardShowing = (shown: number, total: number): HTMLElement =>
  screen.getByText(`Showing ${shown} of ${total}`).closest<HTMLElement>("div.rounded-lg")!;

describe("bounding the long lists", () => {
  it("shows the first page of the full table and offers the rest", async () => {
    const user = userEvent.setup();
    renderTeamRankings(hugePool());
    await user.click(screen.getByRole("button", { name: `Show all ${TEAMS} teams` }));

    const bodyRows = () => document.querySelectorAll("tbody tr").length;
    expect(bodyRows()).toBe(ROWS_SHOWN_FIRST);
    expect(screen.getByText(`Showing ${ROWS_SHOWN_FIRST} of ${TEAMS}`)).toBeInTheDocument();

    const more = Math.min(ROWS_SHOWN_STEP, TEAMS - ROWS_SHOWN_FIRST);
    await user.click(screen.getByRole("button", { name: `Show ${more} more` }));
    expect(bodyRows()).toBe(Math.min(TEAMS, ROWS_SHOWN_FIRST + ROWS_SHOWN_STEP));
  });

  it("shows the first page of logged games and offers the rest", async () => {
    const user = userEvent.setup();
    renderTeamRankings(hugePool());
    await user.click(screen.getByRole("tab", { name: /^games$/i }));

    const card = cardShowing(GAMES_SHOWN_FIRST, GAMES);
    expect(within(card).getAllByRole("listitem")).toHaveLength(GAMES_SHOWN_FIRST);

    const more = Math.min(GAMES_SHOWN_STEP, GAMES - GAMES_SHOWN_FIRST);
    await user.click(within(card).getByRole("button", { name: `Show ${more} more` }));
    expect(within(card).getAllByRole("listitem")).toHaveLength(
      Math.min(GAMES, GAMES_SHOWN_FIRST + GAMES_SHOWN_STEP)
    );
  });
});
