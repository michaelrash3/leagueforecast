import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { setGcAuthorization } from "./lib/gcAuthorization";
import { buildLeagueSummaryPrompt, sanitizeLeagueSummaryRequest } from "./lib/leagueSummary";
import { writeSummaryMode } from "./lib/preferences";
import { saveLogs, saveMatchups, saveTeams } from "./lib/storage";
import type { GameLog, Matchup, TeamBase } from "./lib/types";

/*
 * What the Forecast's write-up is told of each team's Range: the best and worst seed one remaining
 * result can move it to, from the scenario walk (`useSeedRanges`). With more games left than the
 * walk is run for (60), every range was the projection at both ends, and the writer was told each
 * as a "realistic seed range #3–#3", a finish nothing left to play can move, while the table it
 * writes about showed a dash and said the range was paused. Placeholder names.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "6",
  homeHits: "5",
  awayK: "4",
  homeK: "5",
  innings: "6",
  isFinal: true,
});

/** Opens the Forecast, signed in and fetching write-ups itself, and gives back the writer's prompt. */
const forecastPrompt = async () => {
  const bodies: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(typeof init?.body === "string" ? init.body : "");
      return new Response(JSON.stringify({ summary: "A write-up.", model: "test-model" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole("tab", { name: "Forecast" }));
  // Read back as the function reads it, so the prompt is the one the writer is handed.
  const request = await waitFor(
    () => {
      const asked = bodies
        .map((body) => sanitizeLeagueSummaryRequest(JSON.parse(body)))
        .find((item) => item?.kind === "forecast");
      if (!asked) throw new Error("The Forecast's write-up has not been asked for yet.");
      return asked;
    },
    { timeout: 10_000 }
  );
  return buildLeagueSummaryPrompt(request);
};

/** Each team's range as the prompt gives it, by name. */
const rangesIn = (prompt: string) =>
  Object.fromEntries(
    [...prompt.matchAll(/^- #\d+ (\w+)\b.*, realistic seed range (#\d+–#\d+)$/gm)].map(
      ([, name, range]) => [name, range]
    )
  );

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
  // Signed in, and fetching the write-up without a press, so opening the Forecast asks for one.
  setGcAuthorization(async () => "member-token");
  writeSummaryMode("auto");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setGcAuthorization(async () => null);
});

describe("the write-up's seed ranges, few enough games out for the walk", () => {
  beforeEach(() => {
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
      { id: "D", name: "Ducks" },
    ]);
    // Every side one and one, with two games left: Aces against Comets, Bears against Ducks.
    saveMatchups([
      { id: "g1", date: "4/1", away: "A", home: "B" },
      { id: "g2", date: "4/1", away: "C", home: "D" },
      { id: "g3", date: "4/8", away: "B", home: "C" },
      { id: "g4", date: "4/8", away: "D", home: "A" },
      { id: "g5", date: "12/1", away: "A", home: "C" },
      { id: "g6", date: "12/1", away: "B", home: "D" },
    ]);
    saveLogs({ g1: final(5, 3), g2: final(4, 2), g3: final(6, 1), g4: final(3, 2) });
  });

  it("tells the writer each team's range as the walk works it out", async () => {
    // Pinned before the change: the walk's own ranges, to the digit.
    expect(rangesIn(await forecastPrompt())).toEqual({
      Aces: "#1–#4",
      Bears: "#2–#3",
      Comets: "#2–#3",
      Ducks: "#1–#4",
    });
  }, 60_000);
});

describe("the write-up's seed ranges, too many games out for the walk", () => {
  const TEAMS: TeamBase[] = ["Aces", "Bears", "Comets", "Ducks", "Eagles", "Foxes"].map((name) => ({
    id: name[0] ?? name,
    name,
  }));
  /** Each pair meets five times, a week apart: 75 games, of which the first six are played. */
  const GAMES: Matchup[] = Array.from({ length: 5 }, (_, round) =>
    TEAMS.flatMap((away, at) =>
      TEAMS.slice(at + 1).map((home) => ({ away: away.id, home: home.id }))
    ).map((pair, at) => ({
      ...pair,
      id: `r${round + 1}-${at + 1}`,
      date: `2026-${String(4 + round).padStart(2, "0")}-${String(1 + at).padStart(2, "0")}`,
    }))
  ).flat();
  const SCORES: Record<string, GameLog> = Object.fromEntries(
    GAMES.slice(0, 6).map((game, at) => [game.id, final(3 + (at % 4), 2 + (at % 3))])
  );

  beforeEach(() => {
    saveTeams(TEAMS);
    saveMatchups(GAMES);
    saveLogs(SCORES);
  });

  it("tells the writer no range, since none has been worked out", async () => {
    expect(GAMES.length - Object.keys(SCORES).length).toBeGreaterThan(60);
    const prompt = await forecastPrompt();
    // Every team's projected finish is still there to write about.
    for (const { name } of TEAMS) expect(prompt).toMatch(new RegExp(`^- #\\d+ ${name}\\b`, "m"));
    expect(prompt).not.toMatch(/seed range/);
  }, 60_000);
});
