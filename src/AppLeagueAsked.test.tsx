import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import type { LeagueFillPlan } from "./lib/leagueScoreFill";
import type { QueryOf } from "./lib/live/queries";
import { writeLiveBoard } from "./lib/preferences";
import { createSeason, saveMatchups, saveTeams, setActiveSeason } from "./lib/storage";

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
}));

vi.mock("./lib/live/leagueAsk", () => ({
  LEAGUE_UNANSWERED: "Team Rankings could not be asked.",
  askLeague: async (query: QueryOf<"league.bridge" | "league.clubs" | "league.fill">) => {
    server.asked.push(query);
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

// A member signed in, whose Team Rankings is the cloud's board.
vi.mock("./components/RankingsOpen", async (actual) => ({
  ...(await actual<typeof import("./components/RankingsOpen")>()),
  liveBoardWanted: () => true,
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
});
