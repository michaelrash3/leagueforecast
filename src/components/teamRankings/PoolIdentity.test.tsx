import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/*
 * An age tab inside one squad year hands the rankings worker the pool it already holds.
 *
 * The worker is sent the year again whenever the games array it is handed is a new one, and the
 * view built a new one on every switch from 9U to 10U, filtered from the same year to the same
 * games. On the 18:40 pool that was about a second of encoding and copying on the main thread per
 * tap, and the worker then refitted the year it already had.
 */
const handed = vi.hoisted(() => ({ games: [] as unknown[] }));
vi.mock("../../hooks/useRankingsWorker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../hooks/useRankingsWorker")>();
  return {
    ...actual,
    useRankingsWorker: (input: Parameters<typeof actual.useRankingsWorker>[0]) => {
      handed.games.push(input.games);
      return actual.useRankingsWorker(input);
    },
  };
});

const pool = () => ({
  ageGroups: [ageGroup(9, 2027), ageGroup(10, 2027), ageGroup(9, 2028)],
  teams: [
    team("S-A", "Aces"),
    team("S-B", "Badgers"),
    team("S-C", "Comets"),
    team("S-D", "Dukes"),
    team("S-E", "Eagles"),
    team("S-F", "Falcons"),
  ],
  games: [
    game("g1", "ag_9u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) }),
    game("g2", "ag_10u_2027", "S-C", "S-D", 4, 2, { date: seasonDate(2027) }),
    game("g3", "ag_9u_2028", "S-E", "S-F", 3, 2, { date: seasonDate(2028) }),
  ],
  search: "?view=rankings&age=9&year=2027",
});
const pickAge = async (label: string) => {
  const user = userEvent.setup();
  const tabs = screen.getByRole("navigation", { name: "Age level" });
  await user.click(within(tabs).getByRole("button", { name: label }));
  expect(tabs.querySelector('[aria-current="page"]')?.textContent).toBe(label);
};

describe("switching age tabs inside a squad year", () => {
  it("hands the rankings worker the same games, so the year is not sent again", async () => {
    renderTeamRankings(pool());
    const before = handed.games[handed.games.length - 1];
    await pickAge("10U");
    expect(handed.games[handed.games.length - 1]).toBe(before);
    await pickAge("9U");
    expect(handed.games[handed.games.length - 1]).toBe(before);
  });
});
