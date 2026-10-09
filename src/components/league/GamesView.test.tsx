import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log, matchup, renderGamesView, team } from "./gamesViewHarness";
import { RUN_SCORE_CAP } from "../../lib/types";

/**
 * The screen scores get typed into, and the largest view in the app — and until now the least
 * covered of anything in it, at one and a half percent of its lines. Nothing under
 * `components/league/` had a test file at all, which is a poor place for the gap to be: this is
 * where a season is actually entered, one game at a time, often on a phone at the field.
 */
const open = matchup("g-open", "t1", "t2", "5/1");
const done = matchup("g-done", "t2", "t1", "5/2");
const teams = [team("t1", "Rays"), team("t2", "Jays")];

const finished = { [done.id]: log({ awayRuns: "7", homeRuns: "3", isFinal: true }) };

describe("entering a score", () => {
  it("keeps the digits and drops everything else", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({ teams, scoreboardGames: [open] });

    await user.type(screen.getByLabelText("Rays Runs"), "4x");

    // Typed one character at a time, so the letter arrives as its own event and is simply not
    // there afterwards rather than clearing what came before it.
    expect(spies.updateLog).toHaveBeenLastCalledWith("g-open", "awayRuns", "4");
  });

  it("will not take a score above the cap", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({ teams, scoreboardGames: [open] });

    await user.type(screen.getByLabelText("Rays Runs"), "99");

    /*
     * A youth game does not end 99-0, and a stray keystroke in a numeric field is far likelier
     * than a real runaway. The cap is on runs only — a hits or strikeout box is not clamped.
     */
    expect(spies.updateLog).toHaveBeenLastCalledWith("g-open", "awayRuns", String(RUN_SCORE_CAP));
  });

  it("gives a runs-only league one box per team and no others", () => {
    renderGamesView({ teams, scoreboardGames: [open], runsOnly: true });

    expect(screen.getByLabelText("Rays Runs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rays Hits")).toBeNull();
    expect(screen.queryByLabelText("Rays Strikeouts")).toBeNull();
  });

  it("asks for walks against the other side when a league pitches its own", () => {
    renderGamesView({ teams, scoreboardGames: [open], pitchMode: "player", trackErrors: true });

    expect(screen.getByLabelText("Rays Errors")).toBeInTheDocument();
    expect(screen.getByLabelText("Rays Walks")).toBeInTheDocument();
    // Player-pitch leagues count walks, not strikeouts, so the K box is gone.
    expect(screen.queryByLabelText("Rays Strikeouts")).toBeNull();
  });
});

describe("a game that is finished", () => {
  it("collapses to one line rather than staying a form", () => {
    renderGamesView({ teams, scoreboardGames: [done], logs: finished });

    // The score is there to read; the boxes that would let you retype it are not.
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByLabelText("Jays Runs")).toBeNull();
    expect(screen.getByRole("button", { name: /edit final/i })).toBeInTheDocument();
  });

  it("puts the full card back when a correction is needed", async () => {
    const user = userEvent.setup();
    renderGamesView({ teams, scoreboardGames: [done], logs: finished });

    await user.click(screen.getByRole("button", { name: /edit final/i }));

    expect(screen.getByLabelText("Jays Runs")).toBeInTheDocument();
  });
});

describe("finding the game you came to enter", () => {
  const both = { teams, scoreboardGames: [open, done], logs: finished };

  it("shows every game until asked otherwise", () => {
    renderGamesView(both);

    expect(screen.getByLabelText("Rays Runs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit final/i })).toBeInTheDocument();
  });

  it("hides the finished ones on Open Games", async () => {
    const user = userEvent.setup();
    renderGamesView(both);

    await user.click(screen.getByRole("button", { name: "Open Games" }));

    expect(screen.getByLabelText("Rays Runs")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit final/i })).toBeNull();
  });

  it("scrolls the next open game into view, and has nothing to jump to when none is", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    renderGamesView(both);

    await user.click(screen.getByRole("button", { name: "Next Unfinalized" }));
    expect(scrollIntoView).toHaveBeenCalled();

    renderGamesView({ teams, scoreboardGames: [done], logs: finished });
    const [, second] = screen.getAllByRole("button", { name: "Next Unfinalized" });
    expect(second).toBeDisabled();
  });
});

describe("today", () => {
  beforeEach(() => {
    // The view reads the clock to work out what "today" is; a fixture dated to a real day would
    // pass or fail depending on the day the suite runs.
    // `shouldAdvanceTime` so user-event's own waits still resolve; only the clock is pinned.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows only the games dated today", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderGamesView({
      teams,
      scoreboardGames: [
        matchup("g-today", "t1", "t2", "5/1"),
        matchup("g-later", "t2", "t1", "6/9"),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Today" }));

    /*
     * By card, not by team: both clubs have a score row on every card they are in, so a team name
     * says nothing about which games are on screen.
     */
    expect(document.getElementById("game-card-g-today")).not.toBeNull();
    expect(document.getElementById("game-card-g-later")).toBeNull();
  });

  /*
   * Today is the day on the wall where the phone is. Read in UTC it turned over at 8 in the
   * evening on the East Coast in summer and 7 in Chicago, so a coach entering a night game's score
   * after dinner pressed Today and got tomorrow's games.
   */
  it("is the day where the reader is, not the day in UTC", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    try {
      // Nine at night on 1 May in Chicago, which is already 2 May in UTC.
      vi.setSystemTime(new Date("2026-05-02T02:00:00Z"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderGamesView({
        teams,
        scoreboardGames: [
          matchup("g-tonight", "t1", "t2", "5/1"),
          matchup("g-tomorrow", "t2", "t1", "5/2"),
        ],
      });

      await user.click(screen.getByRole("button", { name: "Today" }));

      expect(document.getElementById("game-card-g-tonight")).not.toBeNull();
      expect(document.getElementById("game-card-g-tomorrow")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("is the day the button is pressed, however long the page has been open", async () => {
    vi.stubEnv("TZ", "America/Chicago");
    try {
      vi.setSystemTime(new Date("2026-05-01T17:00:00Z"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderGamesView({
        teams,
        scoreboardGames: [
          matchup("g-first", "t1", "t2", "5/1"),
          matchup("g-second", "t2", "t1", "5/2"),
        ],
      });
      // Left open overnight, as a phone at a two-day tournament is.
      vi.setSystemTime(new Date("2026-05-02T15:00:00Z"));

      await user.click(screen.getByRole("button", { name: "Today" }));

      expect(document.getElementById("game-card-g-second")).not.toBeNull();
      expect(document.getElementById("game-card-g-first")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("the date on a game", () => {
  it("is written back in the app's own form, whatever was typed", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({ teams, scoreboardGames: [open] });
    const field = screen.getByLabelText("Date for Rays vs Jays");

    await user.clear(field);
    await user.type(field, "2026-06-09");
    await user.tab();

    // The field commits on blur, through the same normaliser the rest of the app dates by.
    expect(spies.setMatchups).toHaveBeenCalled();
    const update = spies.setMatchups.mock.calls[0]?.[0] as (
      prev: (typeof open)[]
    ) => (typeof open)[];
    expect(update([open])[0]?.date).toBe("6/9");
  });
});

describe("adding a game", () => {
  it("will not let two of the same team be scheduled against each other", () => {
    renderGamesView({ teams, newAway: "t1", newHome: "t1", addGameValid: false });

    expect(screen.getByRole("button", { name: "Add Game" })).toBeDisabled();
    expect(screen.getByText(/pick two different teams/i)).toBeInTheDocument();
  });

  it("says nothing about it before anybody has chosen", () => {
    renderGamesView({ teams, addGameValid: false });

    expect(screen.queryByText(/pick two different teams/i)).toBeNull();
  });
});

describe("when there is nothing to show", () => {
  it("tells a new season it has no games rather than that its filter matched none", () => {
    renderGamesView({ teams, scoreboardGames: [], matchups: [] });

    expect(screen.getByText("No games yet.")).toBeInTheDocument();
  });

  it("tells a finished season its filter matched none", () => {
    renderGamesView({ teams, scoreboardGames: [], matchups: [], seasonGamesFinalized: true });

    expect(screen.getByText("No games match this filter.")).toBeInTheDocument();
  });
});

describe("what a game card can do to the schedule", () => {
  it("hands the swap and the delete back with the game they were pressed on", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({ teams, scoreboardGames: [open] });
    const card = document.getElementById("game-card-g-open") as HTMLElement;

    await user.click(within(card).getByRole("button", { name: "Swap home and away teams" }));
    await user.click(within(card).getByRole("button", { name: "Delete game" }));

    expect(spies.swapGame).toHaveBeenCalledWith("g-open");
    expect(spies.removeGame).toHaveBeenCalledWith("g-open");
  });

  it("offers to finalise, and says which press it is", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({
      teams,
      scoreboardGames: [open],
      logs: { [open.id]: log({ awayRuns: "6", homeRuns: "2" }) },
    });

    // Scores are in but nobody has said the game is over, so the button asks for that and no more.
    await user.click(screen.getByRole("button", { name: "Verify Final" }));

    expect(spies.toggleFinal).toHaveBeenCalledWith("g-open");
  });
});

describe("filling scores from Team Rankings", () => {
  it("says the scores are being asked for, and takes no second press meanwhile", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({ teams, scoreboardGames: [open], scoreFillAsking: true });

    const button = screen.getByRole("button", { name: "Fill scores from Team Rankings" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText(/Asking Team Rankings in the cloud/)).toBeInTheDocument();
    await user.click(button);

    expect(spies.openScoreFill).not.toHaveBeenCalled();
  });

  it("asks when pressed, with nothing being asked", async () => {
    const user = userEvent.setup();
    const { spies } = renderGamesView({ teams, scoreboardGames: [open] });

    await user.click(screen.getByRole("button", { name: "Fill scores from Team Rankings" }));

    expect(spies.openScoreFill).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Asking Team Rankings in the cloud/)).toBeNull();
  });
});
