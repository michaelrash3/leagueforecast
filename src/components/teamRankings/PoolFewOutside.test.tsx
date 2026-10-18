import { render, screen, waitFor, within } from "@testing-library/react";
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
import type { AutoRemoval } from "../../lib/autoRemoved";
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
    ...page
  }: Partial<
    Pick<FewOutsideLeader, "stateRank" | "rank" | "opponents" | "pageId" | "page" | "year">
  > & { state?: string; segment?: FewOutsideLeader["segment"] } = {}
): FewOutsideLeader => ({
  teamId,
  name,
  pageId: "ag_10u_2027",
  page: "10U 2027",
  year: 2027,
  segment: "fall",
  ...page,
  ...(stateRank === null ? {} : { state }),
  stateRank,
  rank,
  record: "8-0",
  group,
  opponents,
});

/** A side to find, by name. */
const side = (teamId: string, name: string, rated: number) => ({ teamId, name, rated });

const LIST: FewOutsideList = {
  leaders: [
    leader("L1", "Ridgefield Legends", 0, {
      state: "KS",
      rank: 26,
      opponents: [
        { teamId: "N1", name: "Alder Comets", games: 1, rated: 3 },
        { teamId: "N2", name: "Birchwood Owls", games: 2, rated: 2 },
      ],
    }),
    // Played none of its own: its group's names, with more than a row draws, and one club in it
    // entered by hand. The national top 25's last.
    leader("L2", "Copperton Huskies", 1, { state: "NE", rank: 25 }),
    // Every side of its group pulled, a TBD among them, on a page with no year.
    leader("DOVE", "Dovecote Juniors", 2, {
      state: "KY",
      rank: 40,
      pageId: "ag_showcase",
      page: "Showcase",
      year: null,
      segment: null,
    }),
    // A League Standings team's group: nothing known only by name, five clubs entered by hand.
    leader("BRAM", "Bramble Rec 10U", 5, { state: "ME", rank: 52 }),
    // In a group drawn above, once with names of its own and once without.
    leader("L1B", "Ridgefield Legends Gold", 0, {
      stateRank: 2,
      state: "KS",
      rank: 30,
      opponents: [{ teamId: "N1", name: "Alder Comets", games: 1, rated: 3 }],
    }),
    leader("L2B", "Copperton Huskies Blue", 1, { stateRank: 2, state: "NE", rank: 44 }),
    // No state: listed by the national top 25 alone.
    leader("JAYS", "Juniper Jays", 3, { stateRank: null, rank: 5 }),
    // Enough more in one group to be past the twelve drawn.
    ...Array.from({ length: 8 }, (_, at) =>
      leader(`F${at}`, `Fernvale Club ${at + 1}`, 4, { stateRank: 3 + at, rank: 60 + at })
    ),
  ],
  groups: [
    {
      sides: 17,
      pulled: 6,
      byHand: 0,
      nameOnly: 8,
      slots: 3,
      outside: 0,
      toFind: [side("N1", "Alder Comets", 3)],
      byHandSides: [],
    },
    {
      sides: 18,
      pulled: 3,
      byHand: 1,
      nameOnly: 14,
      slots: 0,
      outside: 2,
      toFind: Array.from({ length: 14 }, (_, at) =>
        side(`G${at}`, `Gorse Side ${at + 1}`, 14 - at)
      ),
      byHandSides: [side("H1", "Heathfield Rec", 2)],
    },
    {
      sides: 4,
      pulled: 3,
      byHand: 0,
      nameOnly: 0,
      slots: 1,
      outside: 0,
      toFind: [],
      byHandSides: [],
    },
    {
      sides: 2,
      pulled: 1,
      byHand: 0,
      nameOnly: 1,
      slots: 0,
      outside: 1,
      toFind: [side("N9", "Elmstead Wrens", 1)],
      byHandSides: [],
    },
    {
      sides: 9,
      pulled: 9,
      byHand: 0,
      nameOnly: 0,
      slots: 0,
      outside: 0,
      toFind: [],
      byHandSides: [],
    },
    {
      sides: 6,
      pulled: 1,
      byHand: 5,
      nameOnly: 0,
      slots: 0,
      outside: 0,
      toFind: [],
      byHandSides: ["Otters", "Badgers", "Voles", "Minks", "Wrens"].map((name, at) =>
        side(`B${at}`, `Bramble Rec ${name}`, 5 - at)
      ),
    },
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
    expect(rich.getByText("#1 in KS")).toBeVisible();
    // Its page and the half of the year its board is of.
    expect(rich.getByText(/10U 2027, Fall 2026/)).toBeVisible();
    // Past the national top 25, so no national place is said.
    expect(rich.queryByText(/nationally/)).toBeNull();
    expect(
      rich.getByText(
        "Its group: 17 entries (6 pulled, 8 known only by name, 3 TBDs) and 0 games outside it."
      )
    ).toBeVisible();
    expect(
      rich.getByText(
        /Pull these opponents to connect its group: Alder Comets \(1 game against it, 3 in all\) · Birchwood Owls \(2 games\)/
      )
    ).toBeVisible();

    const cale = rowOf("Copperton Huskies");
    // The national top 25's last, so its place is said.
    expect(cale.getByText(/#25 nationally/)).toBeVisible();
    expect(cale.getByText(/1 entered by hand/)).toBeVisible();
    expect(cale.getByText(/It played no opponent known only by name/)).toBeVisible();
    expect(cale.getByText(/Gorse Side 12 \(3 games\), and 2 more in the copy/)).toBeVisible();
    // Its group's club entered by hand is one to find as well.
    expect(
      cale.getByText(
        /1 of its group's entries was entered by hand and has no GameChanger link; find it on GameChanger and pull it too: Heathfield Rec \(2 games\)/
      )
    ).toBeVisible();

    const dove = rowOf("Dovecote Juniors");
    expect(
      dove.getByText(/Every team in its group is already pulled, and a TBD names nobody/)
    ).toBeVisible();
    // A page with no year has one board, the whole year's, and no half to name.
    expect(
      screen.getByRole("button", { name: "Dovecote Juniors" }).closest("li")?.textContent
    ).toMatch(/#1 in KY Showcase · 8-0/);

    // A group with no team known only by name is not all pulled when some were entered by hand.
    const bram = rowOf("Bramble Rec 10U");
    expect(
      bram.getByText("Its group: 6 entries (1 pulled, 5 entered by hand) and 0 games outside it.")
    ).toBeVisible();
    expect(bram.queryByText(/already pulled/)).toBeNull();
    expect(
      bram.getByText(
        /It played no opponent known only by name, and no team in its group is known only by name\. 5 of its group's entries were entered by hand and have no GameChanger link; find them on GameChanger and pull them to connect its group: Bramble Rec Otters \(5 games\) · Bramble Rec Badgers \(4 games\)/
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

  it("opens a club's own panel, in the squad year of its row and on the page it leads", async () => {
    const user = userEvent.setup();
    const opened: Array<[string, number | undefined, string | undefined]> = [];
    render(
      <FewOutsideSection
        list={LIST}
        openTeam={(teamId, year, pageId) => opened.push([teamId, year, pageId])}
      />
    );
    await user.click(screen.getByRole("button", { name: "Juniper Jays" }));
    await user.click(screen.getByRole("button", { name: "Dovecote Juniors" }));
    expect(opened).toEqual([
      ["JAYS", 2027, "ag_10u_2027"],
      ["DOVE", undefined, "ag_showcase"],
    ]);
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
    // A club with none of its own copies its group's, every one, past the twelve drawn, and then
    // its club entered by hand.
    const cale = screen.getByText("Copperton Huskies").closest("li")!;
    await user.click(within(cale).getByRole("button", { name: "Copy the names" }));
    expect(writeText).toHaveBeenLastCalledWith(
      [...Array.from({ length: 14 }, (_, at) => `Gorse Side ${at + 1}`), "Heathfield Rec"].join(
        "\n"
      )
    );
    // A group with only clubs entered by hand to find copies them.
    const bram = screen.getByText("Bramble Rec 10U").closest("li")!;
    await user.click(within(bram).getByRole("button", { name: "Copy the names" }));
    expect(writeText).toHaveBeenLastCalledWith(
      ["Otters", "Badgers", "Voles", "Minks", "Wrens"]
        .map((name) => `Bramble Rec ${name}`)
        .join("\n")
    );
    // And every name on the list at once, each once: two of the Legends', the Huskies' group's
    // fifteen, the Bramble group's five and the Jays' one.
    await user.click(screen.getByRole("button", { name: "Copy every name to find (23)" }));
    const every = (writeText.mock.lastCall as unknown as [string])[0].split("\n");
    expect(every).toHaveLength(23);
    expect(new Set(every).size).toBe(23);
    expect(every).toEqual(expect.arrayContaining(["Heathfield Rec", "Bramble Rec Wrens"]));
  });

  it("draws twelve, by state rank, and all when asked", async () => {
    const user = userEvent.setup();
    render(<FewOutsideSection list={LIST} />);
    const list = screen.getByRole("list", { name: "Leaders with few outside games" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
    expect(screen.getByText(/Drawing 12 of 15, by state rank/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Show all 15" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(15);
  });

  it("never calls a club or its group closed, isolated or an island", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<FewOutsideSection list={LIST} />);
    await user.click(screen.getByRole("button", { name: "Show all 15" }));
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
  /** Two clubs entered by hand that have played only each other, both on Kentucky's 10U board. */
  const twoClubs = () => ({
    ageGroups: [ageGroup(10, 2027)],
    teams: [
      team("S-HOME", "Home Club", { state: "KY" }),
      team("S-AWAY", "Away Club", { state: "KY" }),
    ],
    games: [game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, { date: seasonDate(2027) })],
  });

  /** The section's clubs, in the order it lists them. */
  const listed = (section: HTMLElement) =>
    within(within(section).getByRole("list", { name: "Leaders with few outside games" }))
      .getAllByRole("listitem")
      .map((item) => item.querySelector("button")?.textContent);

  it("are found when the pool is looked at, off the boards the page builds", async () => {
    const user = userEvent.setup();
    renderTeamRankings(twoClubs());
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    expect(screen.queryByText("Leaders with few outside games")).toBeNull();
    await user.click(screen.getByRole("button", { name: /check the pool/i }));
    const section = await screen.findByTestId("pool-few-outside");
    expect(within(section).getByRole("button", { name: "Home Club" })).toBeVisible();
    expect(within(section).getByText("#2 in KY")).toBeVisible();
    // Neither is pulled, so neither is said to be: both are offered as teams to find.
    expect(section.textContent).not.toMatch(/already pulled/);
    expect(section.textContent).toMatch(/2 of its group's entries were entered by hand/);
    expect(section.textContent).not.toMatch(UNSAID);
  });

  /*
   * A club with no GameChanger id of its own carries no page to open on but the row's: the device
   * card handed only the club on, and its panel opened on the page already on screen, which holds
   * none of the games the list had named.
   */
  it("open a club on the page whose board it leads, from another page", async () => {
    const user = userEvent.setup();
    const eleven = twoClubs();
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027), ageGroup(11, 2027)],
      teams: [
        ...eleven.teams,
        team("S-ELEVEN-A", "Larch Eleven", { state: "OH" }),
        team("S-ELEVEN-B", "Sorrel Eleven", { state: "OH" }),
      ],
      games: [
        ...eleven.games,
        game("eleven", "ag_11u_2027", "S-ELEVEN-A", "S-ELEVEN-B", 7, 3, {
          date: seasonDate(2027),
        }),
      ],
    });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    expect(window.location.search).not.toContain("age=11");
    await user.click(screen.getByRole("button", { name: /check the pool/i }));
    const section = await screen.findByTestId("pool-few-outside");
    await user.click(within(section).getByRole("button", { name: "Larch Eleven" }));
    await waitFor(() => expect(window.location.search).toContain("age=11"));
  });

  /*
   * The tidy's own look, which the card asks for again once it has settled the stand-ins, is
   * asked with what the boards read too: without it the list went away with the first tidy.
   */
  it("are found again in the look after a tidy", async () => {
    const user = userEvent.setup();
    const pool = twoClubs();
    renderTeamRankings({
      ...pool,
      teams: [...pool.teams, team("S-TBD", "TBD- 3:00 PM", { placeholder: true })],
      games: [
        game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
          date: seasonDate(2027),
          source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
        }),
        game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
          date: seasonDate(2027),
          source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
        }),
      ],
    });
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(screen.getByRole("button", { name: /check the pool/i }));
    expect(listed(await screen.findByTestId("pool-few-outside"))).toContain("Home Club");
    await user.click(await screen.findByRole("button", { name: /settle 1 of them/i }));
    expect(await screen.findByText(/nothing is waiting/i)).toBeInTheDocument();
    expect(listed(screen.getByTestId("pool-few-outside"))).toContain("Home Club");
  });

  /*
   * The marks of a club taken off as plainly made up, and League Standings' seasons, which keep a
   * club a League team links whatever its marks: the boards read both, so the look is handed both.
   */
  const marked = (seasons: boolean) => {
    const pool = twoClubs();
    const link = { teamId: "gcDEMO", name: "Demo Club", ageGroupId: "ag_10u_2027", ageLevel: 10 };
    const mark: AutoRemoval = {
      gcTeamId: "gcDEMO",
      name: "Demo Club",
      on: "2026-10-11",
      signs: ["named"],
      word: "demo",
    };
    return {
      ...pool,
      ageGroups: [ageGroup(10, 2027, seasons ? { seasonIds: ["lg-demo"] } : {})],
      teams: [...pool.teams, team("S-DEMO", "Demo Club", { state: "KY", gcTeams: [link] })],
      games: [
        ...pool.games,
        game("demo", "ag_10u_2027", "S-DEMO", "S-HOME", 9, 0, {
          date: seasonDate(2027),
          source: { kind: "gamechanger", teamId: "gcDEMO", gameId: "d1" },
        }),
      ],
      autoRemoved: new Map([["gcDEMO", mark]]),
      ...(seasons
        ? {
            leagueSeasons: {
              "lg-demo": {
                teams: [{ id: "lg-1", name: "Demo Club", scoutTeamId: "S-DEMO" }],
                matchups: [],
                logs: {},
              },
            },
          }
        : {}),
    };
  };

  it("leave out a club the boards leave out as plainly made up", async () => {
    const user = userEvent.setup();
    renderTeamRankings(marked(false));
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(screen.getByRole("button", { name: /check the pool/i }));
    expect(listed(await screen.findByTestId("pool-few-outside"))).toEqual([
      "Home Club",
      "Away Club",
    ]);
  });

  it("keep a club so marked that a League Standings team links, as the boards do", async () => {
    const user = userEvent.setup();
    renderTeamRankings(marked(true));
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(screen.getByRole("button", { name: /check the pool/i }));
    expect(listed(await screen.findByTestId("pool-few-outside"))).toEqual([
      "Demo Club",
      "Home Club",
      "Away Club",
    ]);
  });
});
