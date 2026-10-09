import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { LeagueFillPlan } from "./lib/leagueScoreFill";
import type { LeagueBridgeAnswer } from "./lib/live/leagueAnswers";
import type { QueryOf } from "./lib/live/queries";
import { writeLiveBoard } from "./lib/preferences";
import {
  createSeason,
  loadLogs,
  saveLogs,
  saveMatchups,
  saveTeams,
  setActiveSeason,
} from "./lib/storage";
import { blankLog } from "./lib/util";

/*
 * League Standings on a member's device, where Team Rankings is the cloud's (1.6e): what Team
 * Rankings has for the season, and the scores it could fill in, are asked of the server, since the
 * device holds no pool to work them out from. Placeholder names throughout.
 */

const server = vi.hoisted(() => ({
  asked: [] as QueryOf<"league.bridge" | "league.clubs" | "league.fill">[],
  plan: null as LeagueFillPlan | null,
  /** The squad year the server's bridge gives the season, where it answers one. */
  squadYear: null as number | null,
  /** Held until let go, where set: the fill's answer coming while the page moves on. */
  hold: null as Promise<void> | null,
  /** Whether the member's sign-in has come through, as the cloud's status says. */
  signedIn: true,
  /** Whether Team Rankings is the cloud's here; not, the device's own pool is read. */
  live: true,
  /** The season's bridge, where the server answers one. */
  bridge: null as LeagueBridgeAnswer | null,
}));

vi.mock("./lib/live/leagueAsk", () => ({
  LEAGUE_UNANSWERED: "Team Rankings could not be asked.",
  askLeague: async (query: QueryOf<"league.bridge" | "league.clubs" | "league.fill">) => {
    server.asked.push(query);
    if (query.kind === "league.bridge" && server.bridge)
      return { kind: "league.bridge", ...server.bridge };
    if (query.kind === "league.bridge" && server.squadYear !== null)
      return {
        kind: "league.bridge",
        bridge: {
          results: [],
          seasonLinked: false,
          rows: [],
          linkedCount: 0,
          countedResults: 0,
          squadYear: server.squadYear,
        },
        candidates: [],
      };
    if (query.kind !== "league.fill") return null;
    await server.hold;
    return server.plan && { kind: "league.fill", plan: server.plan };
  },
}));

// A member signed in, whose Team Rankings is the cloud's board, drawn here as a stand-in.
vi.mock("./components/RankingsOpen", async (actual) => ({
  ...(await actual<typeof import("./components/RankingsOpen")>()),
  liveBoardWanted: () => server.live,
  RankingsOpen: () => <p>The cloud&apos;s board</p>,
}));

// This device's own pool, where it is read, plans what the server's would.
vi.mock("./lib/leagueScoreFill", async (actual) => ({
  ...(await actual<typeof import("./lib/leagueScoreFill")>()),
  planLeagueScoreFill: () => server.plan,
}));

vi.mock("./lib/live/leagueWanted", async (actual) => ({
  ...(await actual<typeof import("./lib/live/leagueWanted")>()),
  memberSignedIn: () => server.signedIn,
}));

const PLAN: LeagueFillPlan = {
  rows: [
    {
      matchupId: "g1",
      date: "5/1",
      awayTeamId: "A",
      awayName: "Aces",
      homeTeamId: "B",
      homeName: "Bears",
      awayRuns: 6,
      homeRuns: 2,
      action: "fill",
    },
  ],
  unmatched: 0,
  unusedResults: 0,
  seasonLinked: true,
};

describe("League Standings asking the server what Team Rankings has", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    );
    server.asked = [];
    server.plan = PLAN;
    server.squadYear = null;
    server.hold = null;
    server.signedIn = true;
    server.live = true;
    server.bridge = null;
    writeLiveBoard(true);
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears", scoutTeamId: "S-BEARS" },
    ]);
    saveMatchups([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the season's bridge, from its teams and fixtures as this device holds them", async () => {
    render(<App />);
    // Asked once the season's teams have stood still for 0.8 s, which a busy machine stretches.
    await waitFor(
      () => expect(server.asked.map((query) => query.kind)).toContain("league.bridge"),
      { timeout: 5_000 }
    );
    expect(server.asked.find((query) => query.kind === "league.bridge")).toMatchObject({
      teams: [
        { id: "A", name: "Aces" },
        { id: "B", name: "Bears", scoutTeamId: "S-BEARS" },
      ],
      fixtures: [{ away: "Aces", home: "Bears", date: "5/1" }],
    });
  });

  it("reads a CSV's bare dates in the squad year the server's bridge gives the season", async () => {
    // A nil-nil is a result only on a day gone by, which a bare "M/D" needs the year to say; this
    // device holds no pages to read the year off.
    const nilNil = new File(
      [
        [
          "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Home Team,Home Runs,Home Hits,Home K",
          "g1,4/5,Aces,6,0,9,,Bears,0,6,",
        ].join("\n"),
      ],
      "schedule.csv",
      { type: "text/csv" }
    );
    const scored = /1 imported scored game will load into the Scoreboard/;
    const importing = async () => {
      fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
      fireEvent.change(screen.getByLabelText("Import schedule CSV"), {
        target: { files: [nilNil] },
      });
      return screen.findByRole("heading", { name: "Import schedule CSV?" });
    };
    const answered = () =>
      waitFor(() => expect(server.asked.map((query) => query.kind)).toContain("league.bridge"), {
        timeout: 5_000,
      });

    // With no year from the server there is none to read the date in.
    const { unmount } = render(<App />);
    await answered();
    expect((await importing()).closest("[role=dialog]")?.textContent).not.toMatch(scored);
    unmount();

    server.squadYear = 2020;
    server.asked = [];
    render(<App />);
    await answered();
    // The answer lands a tick after it is asked.
    await act(async () => {});
    expect((await importing()).closest("[role=dialog]")?.textContent).toMatch(scored);
  });

  it("asks for the scores to fill, and opens them", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    expect(
      await screen.findByRole("heading", { name: "Fill scores from Team Rankings" })
    ).toBeTruthy();
    expect(server.asked.find((query) => query.kind === "league.fill")).toMatchObject({
      teams: [
        { id: "A", name: "Aces" },
        { id: "B", name: "Bears", scoutTeamId: "S-BEARS" },
      ],
      matchups: [{ id: "g1", date: "5/1", away: "A", home: "B" }],
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
  });

  it("says so when the server could not be asked, and opens nothing", async () => {
    server.plan = null;
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    expect(await screen.findByText("Team Rankings could not be asked.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Fill scores from Team Rankings" })).toBeNull();
  });

  it("opens no season's scores on another season switched to while it was asked", async () => {
    // A season of its own games, where the first season's plan would read as though it were its.
    const fall = createSeason("Fall");
    setActiveSeason(fall.id);
    saveTeams([
      { id: "C", name: "Comets" },
      { id: "D", name: "Ducks" },
    ]);
    saveMatchups([{ id: "g9", date: "9/1", away: "C", home: "D" }]);
    setActiveSeason("default");
    let letGo = () => {};
    server.hold = new Promise<void>((resolve) => (letGo = resolve));
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    fireEvent.change(screen.getByRole("combobox", { name: /active season/i }), {
      target: { value: fall.id },
    });
    await act(async () => letGo());
    expect(server.asked.filter((query) => query.kind === "league.fill")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Fill scores from Team Rankings" })).toBeNull();
  });

  it("fills no game over a score typed in while the plan was being asked for", async () => {
    let letGo = () => {};
    server.hold = new Promise<void>((resolve) => (letGo = resolve));
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    // The plan is coming, and the member goes on and records the game themselves meanwhile.
    fireEvent.change(screen.getByLabelText("Aces Runs"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Bears Runs"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Mark game as final" }));
    await waitFor(() => expect(loadLogs().g1).toMatchObject({ awayRuns: "3", homeRuns: "1" }));
    await act(async () => letGo());
    expect(
      await screen.findByRole("heading", { name: "Fill scores from Team Rankings" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Fill \d+ games?$/ }));
    expect(
      await screen.findByText("Nothing was filled in: 1 game changed here since, left as it is.")
    ).toBeTruthy();
    // Scores are saved 0.5 s after they change.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(loadLogs().g1).toMatchObject({ awayRuns: "3", homeRuns: "1", isFinal: true });
  });

  /** Fills the open plan's one game, and reads back what was stored once it is saved. */
  const fillTheGame = async () => {
    expect(
      await screen.findByRole("heading", { name: "Fill scores from Team Rankings" })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Fill \d+ games?$/ }));
    // Scores are saved 0.5 s after they change.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    return loadLogs().g1;
  };

  it("fills a game scored in part when it was asked, as the plan saw it", async () => {
    // One box typed in, so nothing is recorded yet and the plan offers it as a fill.
    saveLogs({ g1: { ...blankLog(), awayRuns: "3" } });
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    expect(await fillTheGame()).toMatchObject({ awayRuns: "6", homeRuns: "2", isFinal: true });
  });

  it("on this device's own pool, fills a game as the panel saw it, and none scored since", async () => {
    server.live = false;
    saveLogs({ g1: { ...blankLog(), awayRuns: "3" } });
    const { unmount } = render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    expect(await fillTheGame()).toMatchObject({ awayRuns: "6", homeRuns: "2", isFinal: true });
    unmount();

    // The panel is open while the member scores the game by hand.
    saveLogs({});
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Fill scores from Team Rankings" }));
    fireEvent.change(screen.getByLabelText("Aces Runs"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Bears Runs"), { target: { value: "1" } });
    expect(await fillTheGame()).toMatchObject({ awayRuns: "3", homeRuns: "1" });
    expect(server.asked.filter((query) => query.kind === "league.fill")).toEqual([]);
  });

  it("says the scores are being asked for, and asks once however often it is pressed", async () => {
    let letGo = () => {};
    server.hold = new Promise<void>((resolve) => (letGo = resolve));
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: /schedule/i }));
    const button = await screen.findByRole("button", { name: "Fill scores from Team Rankings" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    fireEvent.click(button);
    await act(async () => letGo());
    expect(
      await screen.findByRole("heading", { name: "Fill scores from Team Rankings" })
    ).toBeTruthy();
    expect(server.asked.filter((query) => query.kind === "league.fill")).toHaveLength(1);
  });

  it("says in Settings that it is asking, then that it could not, not that nothing claims it", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    expect(screen.getByText(/Asking Team Rankings in the cloud what it has for/)).toBeTruthy();
    expect(
      await screen.findByText(/could not be asked about/, {}, { timeout: 5_000 })
    ).toBeTruthy();
    expect(screen.queryByText(/No age group claims/)).toBeNull();
  });

  it("says in Settings when the wide list of clubs could not be asked for", async () => {
    server.bridge = {
      bridge: {
        results: [],
        seasonLinked: true,
        rows: [{ leagueTeamId: "A", leagueTeamName: "Aces", how: "none" }],
        linkedCount: 0,
        countedResults: 0,
      },
      candidates: [{ name: "Aces", clubs: [] }],
    };
    render(<App />);
    fireEvent.click(await screen.findByRole("tab", { name: "Settings" }));
    fireEvent.click(
      await screen.findByRole(
        "checkbox",
        { name: /search every gamechanger club/i },
        { timeout: 5_000 }
      )
    );
    expect(await screen.findByText(/could not be asked for its clubs just now/)).toBeTruthy();
    expect(server.asked.filter((query) => query.kind === "league.clubs")).toHaveLength(1);
  });

  it("asks for the bridge again on coming back from Team Rankings", async () => {
    render(<App />);
    const bridges = () => server.asked.filter((query) => query.kind === "league.bridge");
    await waitFor(() => expect(bridges()).toHaveLength(1), { timeout: 5_000 });
    // The member ticks this season on the cloud's Setup, and comes back.
    fireEvent.click(screen.getByRole("tab", { name: "Team Rankings" }));
    expect(await screen.findByText("The cloud's board")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "League Standings" }));
    // Asked once the 0.8 s after it pass, well before an unanswered question's first retry at 5 s.
    await waitFor(() => expect(bridges()).toHaveLength(2), { timeout: 3_000 });
  });

  it("asks for the bridge again the moment the member's sign-in comes through", async () => {
    // Opened while the sign-in was still loading, as a slow boot does: the first question fails.
    server.signedIn = false;
    render(<App />);
    const bridges = () => server.asked.filter((query) => query.kind === "league.bridge");
    await waitFor(() => expect(bridges()).toHaveLength(1), { timeout: 5_000 });
    server.signedIn = true;
    // Anything that draws the page again reads the status anew; the cloud's moving on draws it.
    fireEvent.click(screen.getByRole("tab", { name: "Settings" }));
    await waitFor(() => expect(bridges()).toHaveLength(2), { timeout: 3_000 });
  });
});
