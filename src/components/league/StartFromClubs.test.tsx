import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StartAnswer, StartDraft, StartQuery } from "../../lib/leagueStart";
import { EmptyState } from "./EmptyState";
import { clubsDraftLead, START_UNREAD, StartFromClubs, type StartAsker } from "./StartFromClubs";

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
const asker = (draft: StartDraft = DRAFT) => {
  const asked: StartQuery[] = [];
  const ask: StartAsker = (query) => {
    asked.push(query);
    const answer: StartAnswer = query.clubs
      ? { pages: PAGES, clubs: null, draft }
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

  /** Picks the first two clubs and finds their games, as a person would. */
  const findTheirGames = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(await screen.findByRole("button", { name: "Add Placeholder S-A" }));
    await user.click(screen.getByRole("button", { name: "Add Placeholder S-B" }));
    await user.click(screen.getByRole("button", { name: "Find their games" }));
  };

  /*
   * The review told a person to untick what was not the league's while every game a club played on
   * a day it played anybody else started unticked, and its button started an empty season at a tap.
   */
  it("says how many games start unticked and why, as the boxes below stand", async () => {
    const user = userEvent.setup();
    open(asker().ask);
    await findTheirGames(user);
    expect(
      await screen.findByText(
        /^2 games among these clubs\. 1 starts unticked, since it looks like a tournament game \(it says why\): tick it if it is the league's\. Untick any other that is not, and swap a game whose home side is the other one/
      )
    ).toBeTruthy();
  });

  it("asks before starting a season with none of its games, and starts it once told to", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const reason = "Entered under Placeholder Classic.";
    const allUnticked: StartDraft = {
      games: DRAFT.games.map((game) => ({ ...game, tournament: reason })),
      outside: 0,
    };
    open(asker(allUnticked).ask, onCreate);
    await findTheirGames(user);
    expect(
      await screen.findByText(
        /^2 games among these clubs, which all start unticked, since they look like tournament games \(each says why\): tick the ones that are the league's, and swap/
      )
    ).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start the season: 2 teams, 0 games" });
    await user.click(start);
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/^Start with 0 of 2 games\?/)).toBeTruthy();
    // Not yet: the question goes, and nothing is started.
    await user.click(screen.getByRole("button", { name: "Back to the games" }));
    expect(screen.queryByText(/^Start with 0 of 2 games\?/)).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(start);
    await user.click(screen.getByRole("button", { name: "Start with no games" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0].matchups).toEqual([]);
  });

  it("starts at once with a game ticked, the question gone", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const allUnticked: StartDraft = {
      games: DRAFT.games.map((game) => ({ ...game, tournament: "Entered under Placeholder Cup." })),
      outside: 0,
    };
    open(asker(allUnticked).ask, onCreate);
    await findTheirGames(user);
    await user.click(
      await screen.findByRole("button", { name: "Start the season: 2 teams, 0 games" })
    );
    expect(screen.getByText(/^Start with 0 of 2 games\?/)).toBeTruthy();
    const keep = screen.getByRole("checkbox", {
      name: "Keep Placeholder S-A at Placeholder S-B, 2026-09-13",
    });
    await user.click(keep);
    expect(screen.queryByText(/^Start with 0 of 2 games\?/)).toBeNull();
    // The words above say how the boxes started, which a tick leaves true; "all unticked" did not.
    expect(screen.getByText(/^2 games among these clubs, which all start unticked/)).toBeTruthy();
    // Unticked again, it is asked again only when the button is pressed.
    await user.click(keep);
    expect(screen.queryByText(/^Start with 0 of 2 games\?/)).toBeNull();
    await user.click(keep);
    await user.click(screen.getByRole("button", { name: "Start the season: 2 teams, 1 game" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0]![0].matchups).toHaveLength(1);
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

describe("what the review says above a start's games", () => {
  const game = (gameId: string, tournament?: string) => ({
    gameId,
    date: "2026-09-13",
    away: "S-A",
    home: "S-B",
    ...(tournament ? { tournament } : {}),
  });

  it("says each way the boxes can stand, and what is outside the days", () => {
    expect(clubsDraftLead({ games: [], outside: 0 })).toBe(
      "Team Rankings has no games among these clubs in those days. The season starts with its teams and no games, and games can be added on the Schedule."
    );
    // How the boxes start, which a tick or an untick since leaves true.
    expect(clubsDraftLead({ games: [game("g1"), game("g2")], outside: 1 })).toBe(
      "2 games among these clubs, which all start ticked. Untick a game that is not the league's, and swap a game whose home side is the other one: GameChanger's schedules do not say which side was at home. 1 more is outside those days."
    );
    expect(clubsDraftLead({ games: [game("g1")], outside: 0 })).toBe(
      "1 game among these clubs, which starts ticked. Untick a game that is not the league's, and swap a game whose home side is the other one: GameChanger's schedules do not say which side was at home."
    );
    expect(
      clubsDraftLead({ games: [game("g1", "Entered under Placeholder Cup.")], outside: 0 })
    ).toBe(
      "1 game among these clubs, which starts unticked, since it looks like a tournament game (it says why): tick it if it is the league's, and swap a game whose home side is the other one: GameChanger's schedules do not say which side was at home."
    );
    expect(
      clubsDraftLead({
        games: [game("g1", "x"), game("g2", "y"), game("g3")],
        outside: 3,
      })
    ).toBe(
      "3 games among these clubs. 2 start unticked, since they look like tournament games (each says why): tick the ones that are the league's. Untick any other that is not, and swap a game whose home side is the other one: GameChanger's schedules do not say which side was at home. 3 more are outside those days."
    );
  });
});

describe("the empty season's ways to start", () => {
  const empty = (startFromClubs?: (close: () => void) => React.ReactNode) =>
    render(
      <EmptyState
        importCSV={() => undefined}
        saveTeamList={() => undefined}
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
