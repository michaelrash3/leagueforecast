import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";

/*
 * The boards are per half of the baseball year, not per year. Today is in the autumn of 2027, so
 * that is the half a link naming no half opens on; a finished year opens on its spring.
 */
const pages: AgeGroup[] = [ageGroup(9, 2027), ageGroup(9, 2026)];

const teams: ScoutTeam[] = [
  team("S-AUT", "Autumn Aces", { state: "KY" }),
  team("S-BOTH", "Both Badgers", { state: "KY" }),
  team("S-SPR", "Spring Cougars", { state: "OH" }),
];

const on = (
  id: string,
  page: string,
  a: string,
  b: string,
  sa: number,
  sb: number,
  date: string
): ScoutGame => game(id, page, a, b, sa, sb, { date });

/** Autumn and spring of baseball year 2027, with one club in both and one in each. */
const bothHalves = (): ScoutGame[] => [
  on("f1", "ag_9u_2027", "S-AUT", "S-BOTH", 9, 1, "2026-09-12"),
  on("f2", "ag_9u_2027", "S-AUT", "S-BOTH", 8, 2, "2026-10-10"),
  on("f3", "ag_9u_2027", "S-AUT", "S-BOTH", 7, 2, "2026-11-14"),
  on("s1", "ag_9u_2027", "S-SPR", "S-BOTH", 9, 1, "2027-03-06"),
  on("s2", "ag_9u_2027", "S-SPR", "S-BOTH", 8, 2, "2027-04-10"),
  on("s3", "ag_9u_2027", "S-SPR", "S-BOTH", 7, 2, "2027-05-15"),
];

const board = () =>
  within(
    screen.getByRole("heading", { name: /National top/ }).closest("div")!
      .parentElement as HTMLElement
  );

describe("the two halves of a baseball year", () => {
  it("opens on the half we are in, and says so on the board", () => {
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });

    // Today is September 2026 — the autumn of baseball year 2027.
    expect(screen.getByRole("button", { name: /Fall 2026/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.getByRole("heading", { name: /National top 25 · Fall 2026/ })
    ).toBeInTheDocument();
  });

  it("ranks only that half's games", () => {
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });

    // The autumn: Autumn Aces beat Both Badgers three times and Spring Cougars was not there.
    expect(board().getByText("Autumn Aces")).toBeInTheDocument();
    expect(board().queryByText("Spring Cougars")).toBeNull();
  });

  it("swaps the whole board when the other half is opened", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });
    await user.click(screen.getByRole("button", { name: /Spring 2027/ }));

    expect(
      screen.getByRole("heading", { name: /National top 25 · Spring 2027/ })
    ).toBeInTheDocument();
    expect(board().getByText("Spring Cougars")).toBeInTheDocument();
    expect(board().queryByText("Autumn Aces")).toBeNull();
  });

  it("gives a club that played both halves each half's own record", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });

    // Both Badgers lost three in the autumn and three in the spring. Neither board says 0-6.
    expect(board().getByText(/0-3/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Spring 2027/ }));
    expect(board().getByText(/0-3/)).toBeInTheDocument();
  });

  it("is a link somebody can send", () => {
    renderTeamRankings({
      ageGroups: pages,
      teams,
      games: bothHalves(),
      search: "?view=rankings&age=9&year=2027&half=spring",
    });
    expect(
      screen.getByRole("heading", { name: /National top 25 · Spring 2027/ })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Spring 2027/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("writes the half into the URL when it is chosen, and not before", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });
    // Nothing chosen yet: the app's own guess is not pinned into a link the reader might share.
    expect(window.location.search).not.toContain("half=");

    await user.click(screen.getByRole("button", { name: /Spring 2027/ }));
    expect(window.location.search).toContain("half=spring");
  });

  it("says a half is empty rather than telling you to add a game", async () => {
    const user = userEvent.setup();
    const autumnOnly = bothHalves().filter((one) => one.id.startsWith("f"));
    renderTeamRankings({ ageGroups: pages, teams, games: autumnOnly });

    await user.click(screen.getByRole("button", { name: /Spring 2027/ }));
    // The games exist — they are in the other half — so "add a game" would be the wrong reason.
    expect(screen.getByText(/Nothing has been played in Spring 2027 yet/)).toBeInTheDocument();
    expect(screen.getByText(/Fall 2026 has 3 games/)).toBeInTheDocument();
  });

  it("marks a half nobody has played on its own tab", () => {
    const autumnOnly = bothHalves().filter((one) => one.id.startsWith("f"));
    renderTeamRankings({ ageGroups: pages, teams, games: autumnOnly });
    expect(screen.getByRole("button", { name: /Spring 2027/ })).toHaveTextContent("not played");
    expect(screen.getByRole("button", { name: /Fall 2026/ })).not.toHaveTextContent("not played");
  });

  it("opens the half that has games when the calendar's is empty", () => {
    /*
     * A league that plays its whole season in one half should not land on an empty board and be
     * left to work out why. Only where the URL named no half — a link that names one is obeyed.
     */
    const springOnly = bothHalves().filter((one) => one.id.startsWith("s"));
    renderTeamRankings({ ageGroups: pages, teams, games: springOnly });

    expect(
      screen.getByRole("heading", { name: /National top 25 · Spring 2027/ })
    ).toBeInTheDocument();
    // And the URL is still not written to: the app guessed, the reader did not ask.
    expect(window.location.search).not.toContain("half=");
  });

  it("obeys a link to an empty half rather than moving the reader", () => {
    const springOnly = bothHalves().filter((one) => one.id.startsWith("s"));
    renderTeamRankings({
      ageGroups: pages,
      teams,
      games: springOnly,
      search: "?view=rankings&age=9&year=2027&half=fall",
    });
    expect(screen.getByText(/Nothing has been played in Fall 2026 yet/)).toBeInTheDocument();
  });

  it("opens a finished year on its spring", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: pages,
      teams,
      games: [
        ...bothHalves(),
        on("p1", "ag_9u_2026", "S-AUT", "S-SPR", 6, 2, "2025-09-13"),
        on("p2", "ag_9u_2026", "S-AUT", "S-SPR", 5, 1, "2026-04-11"),
      ],
    });
    await user.selectOptions(screen.getByLabelText("Season"), "2026");

    // A season that is over is read at its end, so the spring rather than the autumn before it.
    expect(
      screen.getByRole("heading", { name: /National top 25 · Spring 2026/ })
    ).toBeInTheDocument();
  });
});

/*
 * A rating is a margin against the average of everyone a club's schedule can reach. Early in a
 * season most of the country has not played anyone in common, so most of a national board is not
 * on one scale — on the real pool, 1,655 of 3,097 ranked clubs in 9U 2027's autumn, with 39 of the
 * top 100 outside the main group. A board that did not say so would be asserting an order it does
 * not have.
 */
describe("a board that is not all one ranking", () => {
  const islanded = (): ScoutGame[] => [
    // A main group of four that all play each other.
    on("m1", "ag_9u_2027", "S-AUT", "S-BOTH", 6, 3, "2026-09-12"),
    on("m2", "ag_9u_2027", "S-BOTH", "S-SPR", 5, 4, "2026-09-19"),
    on("m3", "ag_9u_2027", "S-SPR", "S-AUT", 4, 5, "2026-09-26"),
    // And two clubs that played only each other.
    on("i1", "ag_9u_2027", "S-ISLE1", "S-ISLE2", 11, 0, "2026-10-03"),
    on("i2", "ag_9u_2027", "S-ISLE1", "S-ISLE2", 10, 1, "2026-10-10"),
  ];
  const withIslands: ScoutTeam[] = [
    ...teams,
    team("S-ISLE1", "Island Winners", { state: "TN" }),
    team("S-ISLE2", "Island Losers", { state: "TN" }),
  ];

  it("says how much of the board is not connected to the main group", () => {
    renderTeamRankings({ ageGroups: pages, teams: withIslands, games: islanded() });
    expect(screen.getByText(/2 of 5 clubs here are not connected/)).toBeInTheDocument();
    expect(screen.getByText(/largest such group holds 3 clubs/)).toBeInTheDocument();
  });

  it("marks the unconnected rows in the full table", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams: withIslands, games: islanded() });
    await user.click(screen.getByRole("button", { name: /Show all/ }));

    // Scoped to the full table: the boards above list the same clubs by name.
    const table = within(screen.getByRole("table"));
    const row = table.getByText("Island Winners").closest("td") as HTMLElement;
    expect(within(row).getByText("separate group of 2")).toBeInTheDocument();
    // A club in the main group carries no marker.
    const main = table.getByText("Autumn Aces").closest("td") as HTMLElement;
    expect(within(main).queryByText(/separate group of/)).toBeNull();
  });

  it("says nothing when the board really is one ranking", () => {
    // Every club joined to every other: a line explaining connectivity would be noise here, and
    // it is on every mature season's board.
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });
    expect(screen.queryByText(/not connected to the main group/)).toBeNull();
  });
});
