import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StartAnswer, StartQuery } from "../../lib/leagueStart";
import { EmptyState } from "./EmptyState";
import { START_UNREAD, StartFromClubs, type StartAsker } from "./StartFromClubs";

/* Starting a season from its clubs on Team Rankings (3.7). Placeholder names throughout. */

const PAGES = [
  { id: "ag_9u_2027", name: "9U 2027", ageLevel: 9, year: 2027 },
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027 },
];
const CLUBS = ["S-A", "S-B", "S-C"].map((id) => ({
  id,
  label: `Placeholder ${id}`,
  detail: "Cincinnati, OH",
}));
const DRAFT = {
  games: [
    { gameId: "g1", date: "2026-09-13", away: "S-A", home: "S-B", awayRuns: 5, homeRuns: 3 },
    {
      gameId: "g2",
      date: "2026-09-20",
      away: "S-B",
      home: "S-A",
      tournament: "One of the two played somebody else that day, so it was likely a tournament.",
    },
  ],
  outside: 2,
};

/** Answers each step as the pool would, and keeps what it was asked. */
const asker = () => {
  const asked: StartQuery[] = [];
  const ask: StartAsker = (query) => {
    asked.push(query);
    const answer: StartAnswer = query.clubs
      ? { pages: PAGES, clubs: null, draft: DRAFT }
      : query.page
        ? { pages: PAGES, clubs: CLUBS, draft: null }
        : { pages: PAGES, clubs: null, draft: null };
    return Promise.resolve(answer);
  };
  return { ask, asked };
};

const open = (ask: StartAsker, onCreate = vi.fn()) =>
  render(
    <StartFromClubs
      ask={ask}
      live={false}
      today="2026-10-11"
      innings={6}
      onCreate={onCreate}
      onClose={() => undefined}
    />
  );

describe("starting a season from its clubs on Team Rankings", () => {
  it("picks clubs on the year's page, finds their games, and makes the season the review leaves", async () => {
    const user = userEvent.setup();
    const { ask, asked } = asker();
    const onCreate = vi.fn();
    open(ask, onCreate);
    // The page of the baseball year being played opens first, with its clubs.
    expect(await screen.findByRole("button", { name: "Add Placeholder S-A" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Team Rankings page" })).toHaveValue("ag_9u_2027");
    const find = screen.getByRole("button", { name: "Find their games" });
    expect(find).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add Placeholder S-A" }));
    await user.click(screen.getByRole("button", { name: "Add Placeholder S-B" }));
    expect(
      within(screen.getByRole("list", { name: "Clubs picked" })).getAllByRole("button")
    ).toHaveLength(2);
    await user.click(find);
    expect(asked[asked.length - 1]).toEqual({
      today: "2026-10-11",
      page: "ag_9u_2027",
      clubs: ["S-A", "S-B"],
      from: "2026-08-01",
      to: "2026-12-31",
    });
    // The likely tournament meeting starts unticked.
    const first = await screen.findByRole("checkbox", {
      name: "Keep Placeholder S-A at Placeholder S-B, 2026-09-13",
    });
    expect(first).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Keep Placeholder S-B at Placeholder S-A, 2026-09-20" })
    ).not.toBeChecked();
    expect(screen.getByText(/2 more are outside those days/)).toBeTruthy();
    await user.click(
      screen.getByRole("button", {
        name: "Swap home and away for Placeholder S-A at Placeholder S-B, 2026-09-13",
      })
    );
    expect(screen.getByText("3–5")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start the season: 2 teams, 1 game" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [season, page] = onCreate.mock.calls[0]!;
    expect(page).toEqual(PAGES[0]);
    expect(season.teams).toEqual([
      { id: expect.any(String), name: "Placeholder S-A", scoutTeamId: "S-A" },
      { id: expect.any(String), name: "Placeholder S-B", scoutTeamId: "S-B" },
    ]);
    const [hive, owls] = season.teams;
    expect(season.matchups).toEqual([
      expect.objectContaining({ date: "9/13", away: owls.id, home: hive.id }),
    ]);
  });

  it("starts again on another page, with nothing of the last one's picked", async () => {
    const user = userEvent.setup();
    const { ask, asked } = asker();
    open(ask);
    await user.click(await screen.findByRole("button", { name: "Add Placeholder S-A" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Team Rankings page" }),
      "ag_10u_2027"
    );
    expect(asked[asked.length - 1]).toEqual({ today: "2026-10-11", page: "ag_10u_2027" });
    await screen.findByRole("button", { name: "Add Placeholder S-A" });
    expect(screen.queryByRole("list", { name: "Clubs picked" })).toBeNull();
  });

  it("says so when Team Rankings did not answer, and asks again when told to", async () => {
    const user = userEvent.setup();
    const { ask } = asker();
    let refuse = true;
    open((query) => (refuse ? Promise.resolve(null) : ask(query)));
    expect(await screen.findByText(START_UNREAD)).toBeTruthy();
    refuse = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Add Placeholder S-A" })).toBeTruthy();
    expect(screen.queryByText(START_UNREAD)).toBeNull();
  });

  it("starts from an organization in one question: its clubs picked on its page, the review open", async () => {
    const user = userEvent.setup();
    const { ask: byPage, asked } = asker();
    const ask: StartAsker = (query) => {
      if (query.org === undefined) return byPage(query);
      asked.push(query);
      return Promise.resolve({
        pages: PAGES,
        page: "ag_10u_2027",
        clubs: CLUBS,
        picked: ["S-A", "S-B"],
        draft: DRAFT,
        org: { found: true, name: "Placeholder League", teams: 3, pulled: 2 },
      });
    };
    const onCreate = vi.fn();
    open(ask, onCreate);
    await screen.findByRole("button", { name: "Add Placeholder S-A" });
    const box = screen.getByRole("textbox", { name: /GameChanger organization ID or link/ });
    const start = screen.getByRole("button", { name: "Start from the organization" });
    expect(start).toBeDisabled();
    await user.type(box, "not an id!");
    expect(start).toBeDisabled();
    expect(screen.getByText(/not an organization ID/)).toBeTruthy();
    await user.clear(box);
    await user.type(box, "https://web.gc.com/organizations/NRsPUpJj6Eed/home");
    await user.click(start);
    // The pages, the first page's clubs, then the organization: no more than picking by hand.
    expect(asked).toHaveLength(3);
    expect(asked[2]).toEqual({
      today: "2026-10-11",
      org: "NRsPUpJj6Eed",
      from: "2026-08-01",
      to: "2026-12-31",
    });
    expect(
      await screen.findByText(
        "Placeholder League: 2 clubs on 10U 2027, all picked. 1 of its teams is not pulled into Team Rankings yet."
      )
    ).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Team Rankings page" })).toHaveValue("ag_10u_2027");
    expect(
      within(screen.getByRole("list", { name: "Clubs picked" })).getAllByRole("button")
    ).toHaveLength(2);
    // A club of the page that is not the organization's can still be added.
    expect(screen.getByRole("button", { name: "Add Placeholder S-C" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start the season: 2 teams, 1 game" }));
    const [season, page] = onCreate.mock.calls[0]!;
    expect(page).toEqual(PAGES[1]);
    expect(season.teams.map((team: { scoutTeamId: string }) => team.scoutTeamId)).toEqual([
      "S-A",
      "S-B",
    ]);
  });

  it("says why nothing was picked for an organization", async () => {
    const user = userEvent.setup();
    const { ask: byPage } = asker();
    let org: StartAnswer["org"] = { found: false };
    open((query) =>
      query.org === undefined
        ? byPage(query)
        : Promise.resolve({ pages: PAGES, clubs: null, draft: null, org })
    );
    await screen.findByRole("button", { name: "Add Placeholder S-A" });
    await user.type(
      screen.getByRole("textbox", { name: /GameChanger organization ID or link/ }),
      "NRsPUpJj6Eed"
    );
    await user.click(screen.getByRole("button", { name: "Start from the organization" }));
    expect(await screen.findByText(/is not in the Organizations file/)).toBeTruthy();
    // The page's clubs stay as they were, ready to pick by hand.
    expect(screen.getByRole("button", { name: "Add Placeholder S-A" })).toBeTruthy();
    org = { found: true, name: "Placeholder League", teams: 4, pulled: 0 };
    await user.click(screen.getByRole("button", { name: "Start from the organization" }));
    expect(
      await screen.findByText(
        "Placeholder League lists 4 teams, and none is a club Team Rankings has pulled yet."
      )
    ).toBeTruthy();
  });

  it("says where to begin when Team Rankings has no page yet", async () => {
    open(() => Promise.resolve({ pages: [], clubs: null, draft: null }));
    expect(await screen.findByText("Team Rankings has no pages yet.")).toBeTruthy();
  });
});

describe("the empty season's ways to start", () => {
  const empty = (startFromClubs?: (close: () => void) => React.ReactNode) =>
    render(
      <EmptyState
        importCSV={() => undefined}
        createSeasonFromTeamList={() => undefined}
        downloadRoundRobinCSV={() => undefined}
        seasonBuilderText=""
        setSeasonBuilderText={() => undefined}
        teams={[]}
        loadDemoSeason={() => undefined}
        openTour={() => undefined}
        {...(startFromClubs ? { startFromClubs } : {})}
      />
    );

  it("offers Team Rankings clubs where they can be read, and opens and closes the start", async () => {
    const user = userEvent.setup();
    empty((close) => (
      <button type="button" onClick={close}>
        The start
      </button>
    ));
    expect(screen.queryByText("Review season data")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Pick clubs" }));
    await user.click(screen.getByRole("button", { name: "The start" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "The start" })).toBeNull());
  });

  it("keeps the review step where they cannot", () => {
    empty();
    expect(screen.getByText("Review season data")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pick clubs" })).toBeNull();
  });
});
