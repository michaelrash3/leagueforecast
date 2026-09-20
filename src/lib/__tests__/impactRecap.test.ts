import { describe, expect, it } from "vitest";
import {
  IMPACT_RECAP_REMAINING_GAME_LIMIT,
  buildRankSnapshot,
  impactOfFinal,
  nameFrom,
  summarizeChanges,
  type RecapPool,
} from "../impactRecap";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";
import { blankLog } from "../util";

const teams: TeamBase[] = [
  { id: "aces", name: "Aces" },
  { id: "bruins", name: "Bruins" },
  { id: "cubs", name: "Cubs" },
  { id: "ducks", name: "Ducks" },
];

const byId = new Map(teams.map((team) => [team.id, team]));
const nameOf = nameFrom(byId);

const game = (id: string, away: string, home: string, date = "2026-04-05"): Matchup => ({
  id,
  date,
  away,
  home,
});

const matchups: Matchup[] = [
  game("g1", "aces", "bruins"),
  game("g2", "cubs", "ducks"),
  game("g3", "aces", "cubs", "2026-04-12"),
];

const scored = (away: string, home: string, isFinal: boolean): GameLog => ({
  ...blankLog("6"),
  awayRuns: away,
  homeRuns: home,
  isFinal,
});

const pool = (over: Partial<RecapPool> = {}): RecapPool => ({
  teams,
  matchups,
  settings: { ...DEFAULT_SETTINGS, goldCutoff: 2, recapGrouping: "date" },
  goldCutoff: 2,
  hasCutLine: true,
  ...over,
});

/**
 * The recap panel's whole supply, tested directly for the first time.
 *
 * It spent its life inside `App`, where reaching it meant rendering a three-thousand-line
 * component, so none of the numbers below were ever pinned. They are now.
 */
describe("the recap of a game going final", () => {
  it("says nothing about a game the season does not hold", () => {
    // The caller asks for any id its logs carry, and an orphaned log is a real thing after an
    // import that dropped a row. `null` is also what un-marking a final wants, so the two agree.
    const logs = { ghost: scored("3", "1", true) };
    expect(impactOfFinal("ghost", logs.ghost, logs, pool(), nameOf)).toBeNull();
  });

  it("pauses the detail when too many games are still to play, and says why", () => {
    /*
     * Above the limit the recap would have to project a whole season to say a game in April moved
     * nobody, and the manager waits for that. So it reports the score and stops — but it does
     * report the score, because a final that produced no visible response reads as a lost score.
     */
    const many = Array.from({ length: IMPACT_RECAP_REMAINING_GAME_LIMIT + 5 }, (_, i) =>
      game(`x${i}`, "aces", "bruins")
    );
    const logs: Record<string, GameLog> = { x0: scored("7", "4", true) };
    const impact = impactOfFinal("x0", logs.x0!, logs, pool({ matchups: many }), nameOf);
    expect(impact?.title).toBe("Latest Update — Aces vs Bruins");
    expect(impact?.scores).toEqual(["Aces 7, Bruins 4"]);
    expect(impact?.messages[0]).toContain("paused until");
    expect(impact?.recapItems).toEqual([]);
  });

  it("names the teams and the score of the game that just went final", () => {
    const logs: Record<string, GameLog> = { g1: scored("7", "4", true) };
    const impact = impactOfFinal("g1", logs.g1!, logs, pool(), nameOf);
    expect(impact?.scores).toEqual(["Aces 7, Bruins 4"]);
    // Grouped by date, which is the default, so the title is the date rather than the matchup —
    // and the date as a manager writes it, which is what `normalizeDateInput` is for.
    expect(impact?.title).toBe("Latest Update — 4/5");
  });

  it("groups by the window the settings ask for", () => {
    // Both of April 5th's games are final, so a date recap carries both and a game recap one.
    const logs: Record<string, GameLog> = {
      g1: scored("7", "4", true),
      g2: scored("2", "9", true),
    };
    const byDate = impactOfFinal("g1", logs.g1!, logs, pool(), nameOf);
    expect(byDate?.scores).toHaveLength(2);

    const byGame = impactOfFinal(
      "g1",
      logs.g1!,
      logs,
      pool({ settings: { ...DEFAULT_SETTINGS, goldCutoff: 2, recapGrouping: "game" } }),
      nameOf
    );
    expect(byGame?.scores).toEqual(["Aces 7, Bruins 4"]);
    expect(byGame?.title).toBe("Latest Update — Aces vs Bruins");
  });

  it("says something rather than nothing when the standings did not move", () => {
    /*
     * A tie is the case that reaches this: both sides take the same half point and the same
     * record, so no rank and no gold status moves and `summarizeChanges` has nothing to report.
     * The panel still has to say something — an empty recap reads as a lost score.
     *
     * A 1-0 final does not reach it, which is worth writing down: the first version of this test
     * used one, and it passed whether the fallback existed or not.
     */
    const logs: Record<string, GameLog> = { g1: scored("1", "1", true) };
    const impact = impactOfFinal("g1", logs.g1!, logs, pool(), nameOf);
    expect(impact?.messages).toEqual([
      "This update was recorded; no standings-impact detail to summarize.",
    ]);
  });
});

describe("what changed between two snapshots", () => {
  const snapshotWith = (logs: Record<string, GameLog>) => buildRankSnapshot(logs, pool());

  it("reports a team moving up and a team dropping", () => {
    const before = snapshotWith({});
    const after = snapshotWith({ g1: scored("9", "0", true), g2: scored("0", "9", true) });
    const messages = summarizeChanges(before, after, 2);
    expect(messages.join(" ")).toMatch(/moved up|dropped/);
  });

  it("is quiet when nothing moved", () => {
    const same = snapshotWith({});
    expect(summarizeChanges(same, same, 2)).toEqual([]);
  });
});

describe("the name a team is known by", () => {
  it("falls back to the id for a team that is not in the pool", () => {
    expect(nameOf("nobody")).toBe("nobody");
  });

  it("falls back to the id for a team whose name is empty", () => {
    /*
     * `||`, not `??`. The recap always read it this way; the projection explanations beside it
     * read `??` and so labelled such a team with an empty string. This pins the reading they now
     * share — and it is the one behaviour the move out of `App` changed.
     */
    const blank = nameFrom(new Map([["ghost", { id: "ghost", name: "" }]]));
    expect(blank("ghost")).toBe("ghost");
  });
});
