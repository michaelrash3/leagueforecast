import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

/**
 * The clock this file reasons from.
 *
 * Its fixtures describe a whole squad year, August to July, and a game dated in a day that has not
 * happened does not count towards a record — you cannot score a game early. Read against the wall
 * clock, half of a squad year is always in the future and the suite would answer differently as
 * the year moved. Pinned to the last day of squad year 2027 so every fixture is genuinely behind
 * us and the tests say what they mean.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2027-07-31T12:00:00"));
});
afterAll(() => vi.useRealTimers());

describe("the two halves of a baseball year", () => {
  it("opens on the half we are in, and says so on the board", () => {
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });

    /*
     * The clock this file pins is 31 July 2027 — the last day of the spring half of baseball year
     * 2027, and the last day on which every fixture here is a game that has been played. It has to
     * be the end of the year rather than the autumn of it, because a game dated in a day that has
     * not happened does not count towards a record, so the spring fixtures only mean anything once
     * the spring has been.
     */
    expect(screen.getByRole("button", { name: /Spring 2027/ })).toHaveAttribute(
      "aria-current",
      "page"
    );
    expect(
      screen.getByRole("heading", { name: /National top 25 · Spring 2027/ })
    ).toBeInTheDocument();
  });

  it("ranks only that half's games", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });
    // Opened rather than assumed: the board opens on the half the clock is in, which is the spring.
    await user.click(screen.getByRole("button", { name: /Fall 2026/ }));

    // The autumn: Autumn Aces beat Both Badgers three times and Spring Cougars was not there.
    expect(board().getByText("Autumn Aces")).toBeInTheDocument();
    expect(board().queryByText("Spring Cougars")).toBeNull();
  });

  it("swaps the whole board when the other half is opened", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams, games: bothHalves() });
    // From the autumn to the spring, so the swap is a swap rather than where it already was.
    await user.click(screen.getByRole("button", { name: /Fall 2026/ }));
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
    await user.click(screen.getByRole("button", { name: /Fall 2026/ }));
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
 * The rankings table does not editorialise about connectivity, and that is deliberate.
 *
 * It used to: a line above the boards counting rows outside the main group, and a chip on each such
 * row. Both were measuring the *pull* and printing it on the team. On a real part-pulled pool 73% of
 * the unpulled names carry exactly one game, and 1,702 of 2,106 groups are cut off at one of them —
 * so a club looked isolated because the club that connects it was still a name on a list. Setup
 * already lists which clubs those are, which is where that belongs.
 */
describe("what the rankings table does not claim", () => {
  const islanded = (): ScoutGame[] => [
    on("m1", "ag_9u_2027", "S-AUT", "S-BOTH", 6, 3, "2026-09-12"),
    on("m2", "ag_9u_2027", "S-BOTH", "S-SPR", 5, 4, "2026-09-19"),
    on("m3", "ag_9u_2027", "S-SPR", "S-AUT", 4, 5, "2026-09-26"),
    on("i1", "ag_9u_2027", "S-ISLE1", "S-ISLE2", 11, 0, "2026-10-03"),
    on("i2", "ag_9u_2027", "S-ISLE1", "S-ISLE2", 10, 1, "2026-10-10"),
  ];
  const withIslands: ScoutTeam[] = [
    ...teams,
    team("S-ISLE1", "Island Winners", { state: "TN" }),
    team("S-ISLE2", "Island Losers", { state: "TN" }),
  ];

  it("ranks a club whose opponents nobody else has played, and says nothing about it", async () => {
    const user = userEvent.setup();
    renderTeamRankings({ ageGroups: pages, teams: withIslands, games: islanded() });

    // Ranked, listed, unremarked. It played real games and the table is not the place to
    // second-guess how much of the country has been pulled.
    expect(screen.queryByText(/not connected to the main group/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /Show all/ }));
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Island Winners")).toBeInTheDocument();
    expect(table.queryByText(/separate group of/)).toBeNull();
    expect(table.queryByText(/island of/)).toBeNull();
  });
});
