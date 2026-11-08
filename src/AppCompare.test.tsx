import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { prefetchView } from "./components/league/leagueViews";
import { loadSettings, saveLogs, saveMatchups, saveSettings, saveTeams } from "./lib/storage";
import type { GameLog, Settings } from "./lib/types";

/*
 * The comparison of two teams shows the rows that mean something for the league it is in, decided
 * as the team's own panel decides them. It drew Gold Odds whatever the postseason, which read 100%
 * against 100% in a bracket every team makes and 0% against 0% with no postseason, and it drew the
 * strikeout rows in kid pitch, whose score form has no strikeout box, so they read 0.0 against 0.0
 * while the walks and errors the league does keep were not shown. Placeholder names.
 */

beforeAll(() => Promise.all([prefetchView("dashboard"), prefetchView("standings")]));

/*
 * What each score form takes (`GamesView`): kid pitch has runs, hits, errors and the walks each
 * side's pitchers gave up, with no strikeouts; machine and coach pitch have runs, hits and
 * strikeouts. The Aces win both games. In kid pitch their hitters draw 5 and 3 walks (4.0 a game)
 * to the Bears' 2 and 1 (1.5), and they make 1 and 0 errors (0.5) to the Bears' 3 and 2 (2.5).
 */
const kidPitch: Record<string, GameLog> = {
  g1: {
    awayRuns: "6",
    homeRuns: "2",
    awayHits: "7",
    homeHits: "3",
    awayK: "",
    homeK: "",
    awayErrors: "1",
    homeErrors: "3",
    awayWalksAllowed: "2",
    homeWalksAllowed: "5",
    innings: "6",
    isFinal: true,
  },
  g2: {
    awayRuns: "4",
    homeRuns: "5",
    awayHits: "5",
    homeHits: "6",
    awayK: "",
    homeK: "",
    awayErrors: "2",
    homeErrors: "0",
    awayWalksAllowed: "3",
    homeWalksAllowed: "1",
    innings: "6",
    isFinal: true,
  },
};

const machinePitch: Record<string, GameLog> = {
  g1: {
    awayRuns: "6",
    homeRuns: "2",
    awayHits: "7",
    homeHits: "3",
    awayK: "4",
    homeK: "9",
    innings: "6",
    isFinal: true,
  },
  g2: {
    awayRuns: "4",
    homeRuns: "5",
    awayHits: "5",
    homeHits: "6",
    awayK: "8",
    homeK: "2",
    innings: "6",
    isFinal: true,
  },
};

type CompareRow = { aces: string; bears: string; ahead?: "Aces" | "Bears" };

/**
 * Each row of the comparison's table, by its label: the Aces' value, the Bears', and which of them
 * the row has ahead, the side it draws in green.
 */
const compareRows = async (
  settings: Partial<Settings>,
  logs: Record<string, GameLog>
): Promise<Map<string, CompareRow>> => {
  saveSettings({ ...loadSettings(), scoreDetail: "full", ...settings });
  saveLogs(logs);
  window.history.replaceState(null, "", "/?team=A");
  const user = userEvent.setup();
  render(<App />);

  const panel = await screen.findByRole("dialog");
  await user.click(within(panel).getByRole("button", { name: "Compare" }));
  const compare = await screen.findByRole("dialog", { name: /Aces\s+vs\s+Bears/ });
  const rows = new Map<string, CompareRow>();
  const green = (cell: HTMLElement | undefined) => cell?.classList.contains("text-emerald-700");
  // The first row is the table's header.
  for (const row of within(compare).getAllByRole("row").slice(1)) {
    const [label, aces, bears] = within(row).getAllByRole("cell");
    rows.set(label?.textContent ?? "", {
      aces: aces?.textContent ?? "",
      bears: bears?.textContent ?? "",
      ahead: green(aces) ? "Aces" : green(bears) ? "Bears" : undefined,
    });
  }
  return rows;
};

const standingRows = ["Record", "Win %", "Run Diff", "Runs/Game", "Runs Allowed/Game"];
const seedRows = ["Current Seed", "Projected Seed"];

describe("the comparison of two teams", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    // Two played and one to come, so the season is still being forecast.
    saveMatchups([
      { id: "g1", date: "2026-10-01", away: "A", home: "B" },
      { id: "g2", date: "2026-10-08", away: "B", home: "A" },
      { id: "g3", date: "2026-10-15", away: "A", home: "B" },
    ]);
  });

  it("leaves out Gold Odds where every team makes the bracket, and strikeouts in kid pitch", async () => {
    const rows = await compareRows(
      { postseasonFormat: "all", pitchMode: "player", trackErrors: true },
      kidPitch
    );

    expect([...rows.keys()]).toEqual([
      ...standingRows,
      "Hits/Game",
      "BB/Game",
      "Errors/Game",
      ...seedRows,
    ]);
    // Walks drawn by each side's hitters and errors made in the field, as the team panel reads them;
    // the more walks drawn the better, and the fewer errors, as the stat leaderboards rank them.
    expect(rows.get("BB/Game")).toEqual({ aces: "4.0", bears: "1.5", ahead: "Aces" });
    expect(rows.get("Errors/Game")).toEqual({ aces: "0.5", bears: "2.5", ahead: "Aces" });
  });

  it("leaves out Gold Odds with no postseason, and errors where they are not scored", async () => {
    const rows = await compareRows(
      { postseasonFormat: "none", pitchMode: "player", trackErrors: false },
      kidPitch
    );

    expect([...rows.keys()]).toEqual([...standingRows, "Hits/Game", "BB/Game", ...seedRows]);
  });

  it("shows Gold Odds where there is a cut line, and strikeouts in machine pitch", async () => {
    const rows = await compareRows({ postseasonFormat: "cut", pitchMode: "machine" }, machinePitch);

    expect([...rows.keys()]).toEqual([
      ...standingRows,
      "Hits/Game",
      "K/Game (batting)",
      "Opp K/Game",
      "Gold Odds",
      ...seedRows,
    ]);
    // The hitters' own strikeouts, the fewer the better, and their pitchers', the more.
    expect(rows.get("K/Game (batting)")).toEqual({ aces: "3.0", bears: "8.5", ahead: "Aces" });
    expect(rows.get("Opp K/Game")).toEqual({ aces: "8.5", bears: "3.0", ahead: "Aces" });
  });

  it("shows strikeouts in coach pitch, which keeps them as machine pitch does", async () => {
    const rows = await compareRows({ postseasonFormat: "cut", pitchMode: "coach" }, machinePitch);

    expect(rows.has("K/Game (batting)")).toBe(true);
    expect(rows.has("Opp K/Game")).toBe(true);
    expect(rows.has("BB/Game")).toBe(false);
  });

  it("shows runs and nothing else of the box score where only runs are kept", async () => {
    const rows = await compareRows(
      { postseasonFormat: "cut", pitchMode: "player", scoreDetail: "runs" },
      kidPitch
    );

    expect([...rows.keys()]).toEqual([...standingRows, "Gold Odds", ...seedRows]);
  });
});
