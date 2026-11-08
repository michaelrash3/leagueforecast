import { describe, expect, it } from "vitest";
import {
  IMPACT_RECAP_REMAINING_GAME_LIMIT,
  buildRankSnapshot,
  finalToggled,
  impactOfFinals,
  nameFrom,
  recapPoolOf,
  summarizeChanges,
  withFinal,
  type RecapPool,
} from "../impactRecap";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type RecapGrouping,
  type TeamBase,
} from "../types";
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
    expect(impactOfFinals(["ghost"], logs, pool(), nameOf)).toBeNull();
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
    const impact = impactOfFinals(["x0"], logs, pool({ matchups: many }), nameOf);
    expect(impact?.title).toBe("Latest Update — Aces vs Bruins");
    expect(impact?.scores).toEqual(["Aces 7, Bruins 4"]);
    expect(impact?.messages[0]).toContain("paused until");
    expect(impact?.recapItems).toEqual([]);
  });

  it("names the teams and the score of the game that just went final", () => {
    const logs: Record<string, GameLog> = { g1: scored("7", "4", true) };
    const impact = impactOfFinals(["g1"], logs, pool(), nameOf);
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
    const byDate = impactOfFinals(["g1"], logs, pool(), nameOf);
    expect(byDate?.scores).toHaveLength(2);

    const byGame = impactOfFinals(
      ["g1"],
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
    const impact = impactOfFinals(["g1"], logs, pool(), nameOf);
    expect(impact?.messages).toEqual([
      "This update was recorded; no standings-impact detail to summarize.",
    ]);
  });
});

/*
 * April 5th's two finals read whole, Aces 7-4 over the Bruins and the Ducks 9-2 over the Cubs:
 * every line of the recap, in the order the panel lists them, which is the order of their weight.
 * The League Story's beats are drawn from the same lines, and Copy Recap's bullets and the AI
 * write-up's facts are these lines.
 */
describe("the recap's lines", () => {
  const twoFinals: Record<string, GameLog> = {
    g1: scored("7", "4", true),
    g2: scored("2", "9", true),
  };
  const recapOfTwoFinals = () =>
    impactOfFinals(["g2"], twoFinals, pool(), nameOf)?.recapItems ?? [];

  it("are pinned for a day of two finals", () => {
    expect(recapOfTwoFinals().map((item) => `${item.kind}: ${item.text}`)).toEqual([
      "eliminated: Bruins were knocked out of Gold Bracket contention.",
      "crossed-cut-up: Ducks moved above the Gold cut line (#4 → #1).",
      "crossed-cut-down: Bruins dropped below the Gold cut line (#2 → #3).",
      "biggest-mover: Biggest mover: Ducks (+3 seeds).",
      "bubble-watch: Bubble watch: Aces hold the final Gold slot at #2, with Bruins first out at #3.",
      "dependency-chain: Ripple effect: those results moved the standings for Ducks, Aces, Bruins, Cubs.",
      "rank-change: Ducks climbed from #4 to #1. they took care of business vs Cubs in an upset; Cubs slipped to #4.",
      "rank-change: Aces slipped from #1 to #2. they took care of business vs Bruins; Bruins slipped to #3.",
      "rank-change: Bruins slipped from #2 to #3. they lost to Aces; Aces climbed to #2.",
      "rank-change: Cubs slipped from #3 to #4. they lost to Ducks in an upset; Ducks climbed to #1.",
      "summary: 2 games went final: Aces 7–Bruins 4; Cubs 2–Ducks 9.",
    ]);
  });

  it("state no Gold %, which neither snapshot has", () => {
    /*
     * The snapshots are ranked, not simulated. The Gold odds are the worker's, and when a final is
     * pressed they are at best the season's as it stood before it; the season after it has none
     * until the worker answers. Each snapshot carried 0 in their place, so the bubble line gave both
     * teams "(0%)", the Aces among them at 1-0 with a game to play, and an odds shift between two
     * zeros could never be reported.
     */
    const items = recapOfTwoFinals();
    expect(items.filter((item) => item.text.includes("%")).map((item) => item.text)).toEqual([]);
    // The League Story prints a line's context beside it, so the bubble's no longer speaks of odds.
    expect(items.find((item) => item.kind === "bubble-watch")?.why).toEqual([
      "The teams nearest the cut line create the clearest league-wide stakes.",
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

/**
 * The whole of what pressing "final" decides.
 *
 * One call rather than two because it is one decision, and because the caller must not make it
 * inside a state updater — which is where it used to live, and where React ran it twice under
 * `StrictMode`, costing two rank snapshots and two projections per final in development.
 */
describe("marking a game final", () => {
  it("flips the flag and hands back the recap together", () => {
    const { nextLogs, impact } = finalToggled("g1", {}, 6, pool(), nameOf);
    expect(nextLogs.g1?.isFinal).toBe(true);
    expect(impact).not.toBeNull();
  });

  it("clears the recap when a final is taken back", () => {
    // Un-marking says nothing about the standings, so the panel is emptied rather than left
    // explaining a game that is open again.
    const logs: Record<string, GameLog> = { g1: scored("7", "4", true) };
    const { nextLogs, impact } = finalToggled("g1", logs, 6, pool(), nameOf);
    expect(nextLogs.g1?.isFinal).toBe(false);
    expect(impact).toBeNull();
  });

  it("leaves every other game's log alone", () => {
    const logs: Record<string, GameLog> = { g2: scored("2", "9", true) };
    const { nextLogs } = finalToggled("g1", logs, 6, pool(), nameOf);
    expect(nextLogs.g2).toBe(logs.g2);
  });
});

/*
 * The whole recap of one game marked final, in each of the three windows a recap can be grouped
 * by, to the digit: pinned before the recap was asked of several games at once, so the one game's
 * recap holds exactly through that. A season of six games over three weeks, two final, one scored
 * and about to be marked final, and three still to play, so the standings, the cut line and the
 * projection all have something to say.
 */
describe("the recap of one game marked final, pinned", () => {
  const schedule: Matchup[] = [
    game("p1", "aces", "bruins", "2026-04-05"),
    game("p2", "cubs", "ducks", "2026-04-05"),
    game("p3", "aces", "cubs", "2026-04-08"),
    game("p4", "bruins", "ducks", "2026-04-11"),
    game("p5", "ducks", "aces", "2026-04-15"),
    game("p6", "cubs", "bruins", "2026-04-15"),
  ];
  const logs: Record<string, GameLog> = {
    p1: scored("7", "4", true),
    p2: scored("2", "9", true),
    p3: scored("1", "6", false),
    p4: scored("3", "3", true),
  };
  const markP3 = (recapGrouping: "game" | "date" | "week") =>
    finalToggled(
      "p3",
      logs,
      6,
      pool({
        matchups: schedule,
        settings: { ...DEFAULT_SETTINGS, goldCutoff: 2, recapGrouping },
      }),
      nameOf
    ).impact;

  it("by date", () => {
    expect(markP3("date")).toMatchInlineSnapshot(`
      {
        "messages": [
          "Cubs moved up from #4 to #2",
          "Cubs moved above the Gold cut line into Gold position",
          "Aces dropped from #2 to #3",
          "Aces dropped below the Gold cut line",
          "Bruins dropped from #3 to #4",
        ],
        "projectionExplanations": [
          {
            "items": [
              "Tiebreak movement pushed the projected finish down by 2 spots.",
            ],
            "teamId": "aces",
            "teamName": "Aces",
          },
          {
            "items": [
              "Recent results lifted the projected finish by 1 spot.",
            ],
            "teamId": "bruins",
            "teamName": "Bruins",
          },
          {
            "items": [
              "Projected points nudged up by 1, lifting the Gold outlook.",
              "Standings points moved up by 1 after recent results.",
            ],
            "teamId": "cubs",
            "teamName": "Cubs",
          },
        ],
        "recapItems": [
          {
            "impactScore": 85,
            "kind": "crossed-cut-up",
            "text": "Cubs moved above the Gold cut line (#4 → #2).",
            "why": [
              "Seed moved from outside to inside the cutoff.",
              "Team now controls its path more directly.",
            ],
          },
          {
            "impactScore": 85,
            "kind": "crossed-cut-down",
            "text": "Aces dropped below the Gold cut line (#2 → #3).",
            "why": [
              "Seed moved from inside to outside the cutoff.",
              "Cut-line movement can swing weekly priorities.",
            ],
          },
          {
            "impactScore": 70,
            "kind": "bubble-watch",
            "text": "Bubble watch: Cubs hold the final Gold slot at #2, with Aces first out at #3.",
            "why": [
              "The teams nearest the cut line create the clearest league-wide stakes.",
            ],
          },
          {
            "impactScore": 66,
            "kind": "dependency-chain",
            "text": "Ripple effect: those results moved the standings for Cubs, Aces, Bruins.",
            "why": [
              "Finalized results changed standings order for multiple teams.",
              "Cut-line pressure can move teams through opponent and competitor results, not just their own games.",
            ],
          },
          {
            "impactScore": 58,
            "kind": "rank-change",
            "text": "Cubs climbed from #4 to #2. they took care of business vs Aces in an upset; Aces slipped to #3.",
          },
          {
            "impactScore": 58,
            "kind": "rank-change",
            "text": "Aces slipped from #2 to #3. they lost to Cubs in an upset; Cubs climbed to #2.",
          },
          {
            "impactScore": 58,
            "kind": "rank-change",
            "text": "Bruins slipped from #3 to #4. final scores across the board scrambled the order.",
          },
          {
            "impactScore": 40,
            "kind": "summary",
            "text": "1 game finalized: Aces 1, Cubs 6.",
          },
        ],
        "scores": [
          "Aces 1, Cubs 6",
        ],
        "title": "Latest Update — 4/8",
      }
    `);
  });

  it("by week", () => {
    expect(markP3("week")).toMatchInlineSnapshot(`
      {
        "messages": [
          "Cubs moved up from #4 to #2",
          "Cubs moved above the Gold cut line into Gold position",
          "Aces dropped from #2 to #3",
          "Aces dropped below the Gold cut line",
          "Bruins dropped from #3 to #4",
        ],
        "projectionExplanations": [
          {
            "items": [
              "Tiebreak movement pushed the projected finish down by 2 spots.",
            ],
            "teamId": "aces",
            "teamName": "Aces",
          },
          {
            "items": [
              "Tiebreak movement lifted the projected finish by 1 spot.",
              "Projected points nudged up by 0.5, lifting the Gold outlook.",
            ],
            "teamId": "bruins",
            "teamName": "Bruins",
          },
          {
            "items": [
              "Projected points nudged up by 1, lifting the Gold outlook.",
              "Standings points moved up by 1 after recent results.",
            ],
            "teamId": "cubs",
            "teamName": "Cubs",
          },
          {
            "items": [
              "Projected points nudged up by 0.5, lifting the Gold outlook.",
              "Standings points moved up by 0.5 after recent results.",
            ],
            "teamId": "ducks",
            "teamName": "Ducks",
          },
        ],
        "recapItems": [
          {
            "impactScore": 85,
            "kind": "crossed-cut-up",
            "text": "Cubs moved above the Gold cut line (#4 → #2).",
            "why": [
              "Seed moved from outside to inside the cutoff.",
              "Team now controls its path more directly.",
            ],
          },
          {
            "impactScore": 85,
            "kind": "crossed-cut-down",
            "text": "Aces dropped below the Gold cut line (#2 → #3).",
            "why": [
              "Seed moved from inside to outside the cutoff.",
              "Cut-line movement can swing weekly priorities.",
            ],
          },
          {
            "impactScore": 70,
            "kind": "bubble-watch",
            "text": "Bubble watch: Cubs hold the final Gold slot at #2, with Aces first out at #3.",
            "why": [
              "The teams nearest the cut line create the clearest league-wide stakes.",
            ],
          },
          {
            "impactScore": 66,
            "kind": "dependency-chain",
            "text": "Ripple effect: those results moved the standings for Cubs, Aces, Bruins.",
            "why": [
              "Finalized results changed standings order for multiple teams.",
              "Cut-line pressure can move teams through opponent and competitor results, not just their own games.",
            ],
          },
          {
            "impactScore": 58,
            "kind": "rank-change",
            "text": "Cubs climbed from #4 to #2. they took care of business vs Aces in an upset; Aces slipped to #3.",
          },
          {
            "impactScore": 58,
            "kind": "rank-change",
            "text": "Aces slipped from #2 to #3. they lost to Cubs in an upset; Cubs climbed to #2.",
          },
          {
            "impactScore": 58,
            "kind": "rank-change",
            "text": "Bruins slipped from #3 to #4. final scores across the board scrambled the order.",
          },
          {
            "impactScore": 40,
            "kind": "summary",
            "text": "2 games went final: Aces 1–Cubs 6; Bruins 3–Ducks 3.",
          },
        ],
        "scores": [
          "Aces 1, Cubs 6",
          "Bruins 3, Ducks 3",
        ],
        "title": "Latest Update — Week Ending 4/12",
      }
    `);
  });

  it("by game", () => {
    // The game's window is the game alone, as the date's is in this season, so the two recaps are
    // one recap under two titles.
    expect(markP3("game")).toEqual({ ...markP3("date"), title: "Latest Update — Aces vs Cubs" });
  });
});

/*
 * Several games made final at once, as Fill scores, Data Quality's Mark them final and a pasted
 * schedule's scores make them: one update, recapped over every window they fall in. Three
 * weekends: both games of the first Saturday and one of the second made final together, the first
 * Sunday's game marked final by hand before, the second Sunday's still open, and the third weekend
 * still to play.
 */
describe("the recap of several games made final at once", () => {
  const weekends: Matchup[] = [
    game("w1", "aces", "bruins", "2026-04-04"),
    game("w2", "cubs", "ducks", "2026-04-04"),
    game("w3", "aces", "cubs", "2026-04-05"),
    game("w4", "bruins", "ducks", "2026-04-11"),
    game("w5", "ducks", "aces", "2026-04-12"),
    game("w6", "cubs", "bruins", "2026-04-18"),
  ];
  const before: Record<string, GameLog> = {
    w1: scored("7", "4", false),
    w2: scored("2", "9", false),
    w3: scored("1", "6", true),
    w4: scored("3", "5", false),
    w5: scored("4", "4", false),
  };
  const made = ["w1", "w2", "w4"];
  const logs: Record<string, GameLog> = {
    ...before,
    ...Object.fromEntries(made.map((id) => [id, { ...before[id]!, isFinal: true }])),
  };
  const seasonPool = (recapGrouping: RecapGrouping) =>
    pool({ matchups: weekends, settings: { ...DEFAULT_SETTINGS, goldCutoff: 2, recapGrouping } });
  const recap = (recapGrouping: RecapGrouping, ids: string[] = made) =>
    impactOfFinals(ids, logs, seasonPool(recapGrouping), nameOf);
  const madeScores = ["Aces 7, Bruins 4", "Cubs 2, Ducks 9", "Bruins 3, Ducks 5"];

  it("recaps the finals of every date they fall on, from the first date to the last", () => {
    const impact = recap("date");
    expect(impact?.title).toBe("Latest Update — 4/4 to 4/11");
    expect(impact?.scores).toEqual(madeScores);
    // Read against the standings with those two dates' finals taken back and no other: the first
    // Sunday's stays final on both sides.
    const without = buildRankSnapshot(before, seasonPool("date"));
    const withThem = buildRankSnapshot(logs, seasonPool("date"));
    expect(impact?.messages).toEqual(summarizeChanges(without, withThem, 2));
    expect(impact?.messages.length).toBeGreaterThan(0);
    expect(impact?.recapItems.find((item) => item.kind === "summary")?.text).toBe(
      "3 games went final: Aces 7–Bruins 4; Cubs 2–Ducks 9; Bruins 3–Ducks 5."
    );
  });

  it("recaps every final of each week they fall in, those made before among them", () => {
    const impact = recap("week");
    expect(impact?.title).toBe("Latest Update — Weeks Ending 4/5 to 4/12");
    expect(impact?.scores).toEqual([
      "Aces 7, Bruins 4",
      "Cubs 2, Ducks 9",
      "Aces 1, Cubs 6",
      "Bruins 3, Ducks 5",
    ]);
  });

  it("recaps the games alone by game, and counts them in the title", () => {
    const impact = recap("game");
    expect(impact?.title).toBe("Latest Update — 3 Games");
    expect(impact?.scores).toEqual(madeScores);
  });

  it("over one window, gives what marking the last of them final on the Schedule does", () => {
    // The first Saturday's two games, final together, against the second marked after the first.
    const firstMarked = { ...before, w1: logs.w1! };
    for (const recapGrouping of ["date", "week"] as const) {
      expect(
        impactOfFinals(
          ["w1", "w2"],
          { ...firstMarked, w2: logs.w2! },
          seasonPool(recapGrouping),
          nameOf
        )
      ).toEqual(finalToggled("w2", firstMarked, 6, seasonPool(recapGrouping), nameOf).impact);
    }
  });

  it("lists the scores in the schedule's order, whatever order the games come in", () => {
    expect(recap("date", ["w4", "w2", "w1"])).toEqual(recap("date"));
  });

  it("leaves out a game still open or not the season's, and says nothing with none left", () => {
    expect(recap("date", [...made, "w5", "ghost"])).toEqual(recap("date"));
    expect(recap("date", ["w5", "ghost"])).toBeNull();
    expect(recap("date", [])).toBeNull();
  });

  it("says every one of their scores when too many games are still to play for the detail", () => {
    const later = Array.from({ length: IMPACT_RECAP_REMAINING_GAME_LIMIT }, (_, i) =>
      game(`x${i}`, "aces", "bruins", "2026-05-02")
    );
    const impact = impactOfFinals(made, logs, pool({ matchups: [...weekends, ...later] }), nameOf);
    expect(impact?.title).toBe("Latest Update — 3 Games");
    expect(impact?.scores).toEqual(madeScores);
    expect(impact?.messages[0]).toMatch(/^Finals saved\. .* paused until/);
    expect(impact?.recapItems).toEqual([]);
  });
});

describe("the pool a season's recap reads against", () => {
  const settings = { ...DEFAULT_SETTINGS, goldCutoff: 6, regularSeasonGamesPerTeam: 5 };
  const season = { teams, matchups, bracketLogs: {}, settings };

  it("is the season's teams and games, and the cut line its format gives its own teams", () => {
    // Six asked of four teams is all four, as the page reads a cut line.
    expect(recapPoolOf(season)).toEqual({
      teams,
      matchups,
      settings,
      goldCutoff: 4,
      hasCutLine: true,
    });
    // A league where every team goes on has no line to be inside of.
    expect(
      recapPoolOf({ ...season, settings: { ...settings, postseasonFormat: "all" } })
    ).toMatchObject({ goldCutoff: 4, hasCutLine: false });
  });

  it("reads the regular season as scheduled once the bracket has a kept score", () => {
    const begun = recapPoolOf({ ...season, bracketLogs: { b1: scored("3", "2", true) } });
    expect(begun.settings).toEqual({ ...settings, regularSeasonGamesPerTeam: 0 });
  });
});

/*
 * The final as the handler writes it: onto the scores as they are by then, which can hold a score
 * typed just before the press, and set rather than flipped, so an updater asked twice agrees.
 */
describe("writing a final onto the scores as they are", () => {
  it("keeps a score the handler never saw, and sets the final", () => {
    // What the handler saw: nothing for g1. What there is by the time it writes: a score.
    const latest: Record<string, GameLog> = { g1: scored("7", "3", false) };
    expect(withFinal(latest, "g1", true, 6).g1).toEqual(scored("7", "3", true));
  });

  it("sets rather than flips, and gives back the same scores when nothing changes", () => {
    const final: Record<string, GameLog> = { g1: scored("7", "3", true) };
    expect(withFinal(final, "g1", true, 6)).toBe(final);
    expect(withFinal(final, "g1", false, 6).g1?.isFinal).toBe(false);
  });

  it("starts a game with no log from a blank one, and leaves the others alone", () => {
    const other: Record<string, GameLog> = { g2: scored("2", "9", true) };
    const next = withFinal(other, "g1", true, 6);
    expect(next.g1).toEqual({ ...blankLog("6"), isFinal: true });
    expect(next.g2).toBe(other.g2);
    // An open game with no log yet is written, though it is open, so the game has a log.
    expect(withFinal({}, "g1", false, 6).g1).toEqual(blankLog("6"));
  });
});
