import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FEW_OUTSIDE_NATIONAL_TOP,
  FEW_OUTSIDE_STATE_TOP,
  type FewOutsideLeader,
  type FewOutsideList,
} from "../../lib/fewOutside";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import { FewOutsideSection } from "./FewOutsideSection";
import { NATIONAL_TOP, STATE_TOP } from "./RankingsSection";

/*
 * Pool health's leaders with few outside games as the card draws them (`FewOutsideSection`), on a
 * list written out by hand, and as the device's own card finds them when asked to look. Every club
 * is made up.
 */

/** The words the owner asked never to see of a club or its group on this list. */
const UNSAID = /closed|isolated|island/i;

const leader = (
  teamId: string,
  name: string,
  group: number,
  {
    stateRank = 1,
    state = "OH",
    rank = 1,
    opponents = [],
  }: Partial<Pick<FewOutsideLeader, "stateRank" | "rank" | "opponents">> & { state?: string } = {}
): FewOutsideLeader => ({
  teamId,
  name,
  pageId: "ag_10u_2027",
  page: "10U 2027",
  year: 2027,
  ...(stateRank === null ? {} : { state }),
  stateRank,
  rank,
  record: "8-0",
  group,
  opponents,
});

const LIST: FewOutsideList = {
  leaders: [
    leader("RICH", "Ridgefield Legends", 0, {
      rank: 26,
      opponents: [
        { teamId: "N1", name: "Alder Comets", games: 1, rated: 3 },
        { teamId: "N2", name: "Birchwood Owls", games: 2, rated: 2 },
      ],
    }),
    // Played none of its own: its group's names, with more than a row draws.
    leader("CALE", "Copperton Huskies", 1, { state: "MI", rank: 21 }),
    // Every side of its group pulled, a TBD among them.
    leader("DOVE", "Dovecote Juniors", 2, { state: "KY", rank: 40 }),
    // In a group drawn above, once with names of its own and once without.
    leader("RICH2", "Ridgefield Legends Gold", 0, {
      stateRank: 2,
      rank: 30,
      opponents: [{ teamId: "N1", name: "Alder Comets", games: 1, rated: 3 }],
    }),
    leader("CALE2", "Copperton Huskies Blue", 1, { stateRank: 2, state: "MI", rank: 44 }),
    // No state: listed by the national top 25 alone.
    leader("JAYS", "Juniper Jays", 3, { stateRank: null, rank: 5 }),
    // Enough more in one group to be past the twelve drawn.
    ...Array.from({ length: 8 }, (_, at) =>
      leader(`F${at}`, `Fernvale Club ${at + 1}`, 4, { stateRank: 3 + at, rank: 60 + at })
    ),
  ],
  groups: [
    {
      sides: 24,
      pulled: 11,
      byHand: 0,
      nameOnly: 10,
      slots: 3,
      outside: 0,
      toFind: [{ teamId: "N1", name: "Alder Comets", rated: 3 }],
    },
    {
      sides: 18,
      pulled: 3,
      byHand: 1,
      nameOnly: 14,
      slots: 0,
      outside: 2,
      toFind: Array.from({ length: 14 }, (_, at) => ({
        teamId: `G${at}`,
        name: `Gorse Side ${at + 1}`,
        rated: 14 - at,
      })),
    },
    { sides: 4, pulled: 3, byHand: 0, nameOnly: 0, slots: 1, outside: 0, toFind: [] },
    {
      sides: 2,
      pulled: 1,
      byHand: 0,
      nameOnly: 1,
      slots: 0,
      outside: 1,
      toFind: [{ teamId: "N9", name: "Elmstead Wrens", rated: 1 }],
    },
    { sides: 9, pulled: 9, byHand: 0, nameOnly: 0, slots: 0, outside: 0, toFind: [] },
  ],
};

const rowOf = (name: string) => {
  const row = screen.getByRole("button", { name }).closest("li");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

afterEach(() => vi.unstubAllGlobals());

describe("the leaders with few outside games, as the card draws them", () => {
  it("leads with the boards' own tops", () => {
    expect([FEW_OUTSIDE_STATE_TOP, FEW_OUTSIDE_NATIONAL_TOP]).toEqual([STATE_TOP, NATIONAL_TOP]);
  });

  it("says each club's page, place, group and the opponents to find", () => {
    render(<FewOutsideSection list={LIST} openTeam={() => undefined} />);
    expect(screen.getByRole("heading", { name: "Leaders with few outside games" })).toBeVisible();
    const rich = rowOf("Ridgefield Legends");
    expect(rich.getByText("#1 in OH")).toBeVisible();
    // Past the national top 25, so no national place is said.
    expect(rich.queryByText(/nationally/)).toBeNull();
    expect(
      rich.getByText(
        "Its group: 24 entries (11 pulled, 10 known only by name, 3 TBDs) and 0 games outside it."
      )
    ).toBeVisible();
    expect(
      rich.getByText(
        /Pull these opponents to connect its group: Alder Comets \(1 game against it, 3 in all\) · Birchwood Owls \(2 games\)/
      )
    ).toBeVisible();

    const cale = rowOf("Copperton Huskies");
    expect(cale.getByText(/#21 nationally/)).toBeVisible();
    expect(cale.getByText(/1 entered by hand/)).toBeVisible();
    expect(cale.getByText(/It played no opponent known only by name/)).toBeVisible();
    expect(cale.getByText(/Gorse Side 12 \(3 games\), and 2 more in the copy/)).toBeVisible();

    expect(
      rowOf("Dovecote Juniors").getByText(
        /Every team in its group is already pulled, and a TBD names nobody/
      )
    ).toBeVisible();
    // A group once: the later clubs in it say whose row holds it.
    expect(
      rowOf("Ridgefield Legends Gold").getByText("In the same group as Ridgefield Legends, above.")
    ).toBeVisible();
    expect(
      rowOf("Copperton Huskies Blue").getByText(
        /its group's are listed with Copperton Huskies, above/
      )
    ).toBeVisible();
    const jays = rowOf("Juniper Jays");
    expect(jays.queryByText(/^#\d+ in /)).toBeNull();
    expect(jays.getByText(/#5 nationally/)).toBeVisible();
  });

  it("opens a club's own panel, in the squad year of its row", async () => {
    const user = userEvent.setup();
    const opened: Array<[string, number | undefined]> = [];
    render(
      <FewOutsideSection list={LIST} openTeam={(teamId, year) => opened.push([teamId, year])} />
    );
    await user.click(screen.getByRole("button", { name: "Juniper Jays" }));
    expect(opened).toEqual([["JAYS", 2027]]);
  });

  it("copies the names to find, one a line, each once", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<FewOutsideSection list={LIST} />);
    const rich = screen.getByText("Ridgefield Legends").closest("li")!;
    await user.click(within(rich).getByRole("button", { name: "Copy the names" }));
    expect(writeText).toHaveBeenLastCalledWith("Alder Comets\nBirchwood Owls");
    expect(await within(rich).findByRole("button", { name: "Copied" })).toBeVisible();
    // A club with none of its own copies its group's, every one, past the twelve drawn.
    const cale = screen.getByText("Copperton Huskies").closest("li")!;
    await user.click(within(cale).getByRole("button", { name: "Copy the names" }));
    expect(writeText).toHaveBeenLastCalledWith(
      Array.from({ length: 14 }, (_, at) => `Gorse Side ${at + 1}`).join("\n")
    );
    // And every name on the list at once, each once.
    await user.click(screen.getByRole("button", { name: "Copy every name to find (17)" }));
    const every = (writeText.mock.lastCall as unknown as [string])[0].split("\n");
    expect(every).toHaveLength(17);
    expect(new Set(every).size).toBe(17);
  });

  it("draws twelve, by state rank, and all when asked", async () => {
    const user = userEvent.setup();
    render(<FewOutsideSection list={LIST} />);
    const list = screen.getByRole("list", { name: "Leaders with few outside games" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
    expect(screen.getByText(/Drawing 12 of 14, by state rank/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show all 14" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(14);
  });

  it("never calls a club or its group closed, isolated or an island", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<FewOutsideSection list={LIST} />);
    await user.click(screen.getByRole("button", { name: "Show all 14" }));
    const section = screen.getByTestId("pool-few-outside");
    expect(section.textContent).not.toMatch(UNSAID);
    // Nor in any label, title or name a reader's software reads out.
    section.querySelectorAll("*").forEach((element) => {
      for (const { value } of Array.from(element.attributes)) expect(value).not.toMatch(UNSAID);
    });
    for (const button of within(section).getAllByRole("button", { name: /copy/i })) {
      await user.click(button);
    }
    for (const [text] of writeText.mock.calls as unknown as [string][]) {
      expect(text).not.toMatch(UNSAID);
    }
  });

  it("draws nothing for a list with no one on it", () => {
    const { container } = render(<FewOutsideSection list={{ leaders: [], groups: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the leaders with few outside games on the device's own card", () => {
  it("are found when the pool is looked at, off the boards the page builds", async () => {
    const user = userEvent.setup();
    // Two clubs that have played only each other: both lead Kentucky's 10U board.
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [
        team("S-HOME", "Home Club", { state: "KY" }),
        team("S-AWAY", "Away Club", { state: "KY" }),
      ],
      games: [game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, { date: seasonDate(2027) })],
    });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    expect(screen.queryByText("Leaders with few outside games")).toBeNull();
    await user.click(screen.getByRole("button", { name: /check the pool/i }));
    const section = await screen.findByTestId("pool-few-outside");
    expect(within(section).getByRole("button", { name: "Home Club" })).toBeVisible();
    expect(within(section).getByText("#2 in KY")).toBeVisible();
    expect(section.textContent).not.toMatch(UNSAID);
  });
});
