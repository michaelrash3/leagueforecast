import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { FORECAST_SECTIONS } from "./components/league/ModelView";
import { prefetchAllViews } from "./components/league/leagueViews";
import { writeOurTeam } from "./lib/preferences";
import { loadSettings, saveLogs, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import type { GameLog, Matchup } from "./lib/types";

// League's views load on demand (2.1); loaded first here, so a tab is drawn as soon as it opens.
beforeAll(() => prefetchAllViews());

/*
 * Two leagues that set games per team and have entered only part of their schedules, as League
 * Standings shows them: the Dashboard with a team followed, the Standings, the Forecast's outlook and
 * brackets, and each team's Magic Numbers, pinned as `AppLeagueNumbers.test.tsx` pins a league that
 * owes nothing. The forecast is seeded from the season, so it comes out the same every run. A change
 * meant to move one of these numbers updates the snapshot, and its commit says which moved.
 * Placeholder names.
 */

const final = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const TEAMS = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Ducks" },
];

/** One round robin, every game of it played: the Aces win all three, the Bears two, the Comets one. */
const ROUND: Matchup[] = [
  { id: "g1", date: "2026-05-01", away: "A", home: "B" },
  { id: "g2", date: "2026-05-01", away: "C", home: "D" },
  { id: "g3", date: "2026-05-08", away: "A", home: "C" },
  { id: "g4", date: "2026-05-08", away: "B", home: "D" },
  { id: "g5", date: "2026-05-15", away: "A", home: "D" },
  { id: "g6", date: "2026-05-15", away: "B", home: "C" },
];

/** The same, with the Aces and the Bears to meet twice more. */
const TWICE: Matchup[] = [
  ...ROUND,
  { id: "g7", date: "2026-05-22", away: "B", home: "A" },
  { id: "g8", date: "2026-05-29", away: "A", home: "B" },
];

const SCORES: Record<string, GameLog> = {
  g1: final(6, 2),
  g2: final(5, 3),
  g3: final(7, 1),
  g4: final(4, 2),
  g5: final(8, 3),
  g6: final(5, 4),
};

/**
 * What a tab shows: its tables' rows whole, the lines that say what a team has clinched, needs or
 * cannot do, and every other number on it in order. Nothing while the tab is still loading (2.1),
 * whose placeholder is no reading of it.
 */
const reading = (): string => {
  const main = document.querySelector("main");
  if (!main) return "";
  const loading = [...main.querySelectorAll('[role="status"]')].some((status) =>
    /^Loading .*…$/.test(status.textContent ?? "")
  );
  if (loading) return "";
  const rows = [...main.querySelectorAll("tr")].map((row) =>
    (row.textContent ?? "").replace(/\s+/g, " ").trim()
  );
  const rest = main.cloneNode(true) as HTMLElement;
  rest.querySelectorAll("table").forEach((table) => table.remove());
  // Whole lines, and a box's own words where it holds no element of its own ("No paths yet.").
  const lines = [...rest.querySelectorAll("p, li, div")]
    .filter((line) => line.tagName !== "DIV" || line.childElementCount === 0)
    .map((line) => (line.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((line) => /clinch|elimin|paused|needs|win|los[es]|beat|path/i.test(line));
  const numbers = (rest.textContent ?? "").match(/[-+−]?\d+(?:[.,:]\d+)*%?/g) ?? [];
  return [...rows, ...lines, `numbers: ${numbers.join(" ")}`].join("\n");
};

/** The tab's reading once it has held for four looks in a row, 250 ms apart. */
const settled = async (what: string, read: () => string = reading): Promise<string> => {
  let last = "";
  let held = 0;
  try {
    await waitFor(
      () => {
        const now = read();
        held = now === last && now !== "" ? held + 1 : 0;
        last = now;
        expect(held).toBeGreaterThanOrEqual(3);
      },
      { interval: 250, timeout: 20_000 }
    );
  } catch {
    throw new Error(`${what} never held still; it last read:\n${last}`);
  }
  return last;
};

/** A team's Magic Numbers, read from its panel once both lines are worked out. */
const magicNumbers = (): string => {
  const panel = screen.queryByRole("dialog");
  const heading = panel ? within(panel).queryByRole("heading", { name: /Magic Numbers/ }) : null;
  const text = (heading?.closest("section")?.textContent ?? "").replace(/\s+/g, " ").trim();
  return /M \(Gold clinch\).+\.\s?E \(Gold elimination\).+\.$/.test(text) ? text : "";
};

const leagues: Array<{ name: string; games: Matchup[]; gamesPerTeam: number; follow: string }> = [
  { name: "nine games owed by every team", games: ROUND, gamesPerTeam: 12, follow: "A" },
  { name: "two owed by the Comets and the Ducks", games: TWICE, gamesPerTeam: 5, follow: "C" },
];

describe("League Standings with games owed beyond the schedule (pin)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-05-18T16:00:00Z"));
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
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(leagues)(
    "$name",
    async ({ games, gamesPerTeam, follow }) => {
      saveTeams(TEAMS);
      saveMatchups(games);
      saveLogs(SCORES);
      saveSettings({ ...loadSettings(), goldCutoff: 2, regularSeasonGamesPerTeam: gamesPerTeam });
      writeOurTeam("default", follow);
      const user = userEvent.setup();
      render(<App />);
      const pinned: Record<string, string> = {};
      for (const tab of ["Dashboard", "Standings"]) {
        await user.click(await screen.findByRole("tab", { name: tab }));
        pinned[tab] = await settled(tab);
      }
      for (const team of TEAMS) {
        const [link] = await screen.findAllByRole("link", { name: `View stats for ${team.name}` });
        if (!link) throw new Error(`No link to ${team.name}`);
        await user.click(link);
        pinned[`${team.name}' panel`] = await settled(`${team.name}' panel`, magicNumbers);
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      }
      await user.click(await screen.findByRole("tab", { name: "Forecast" }));
      for (const { label } of FORECAST_SECTIONS.filter(({ key }) => key !== "games")) {
        await user.click(await screen.findByRole("button", { name: label }));
        pinned[`Forecast · ${label}`] = await settled(label);
      }
      expect(pinned).toMatchSnapshot();
    },
    120_000
  );
});
