import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SCENARIO_LINK,
  basisFor,
  coerceScenario,
  dropScenario,
  isStale,
  keepScenario,
  livePicks,
  presetPicks,
  readScenarios,
  rebaseScenario,
  scenarioLinkHash,
  scenarioTrouble,
  writeScenarios,
  type SavedScenario,
} from "../savedScenarios";
import { readScenarioLink, takeScenarioLink } from "../scenarioLink";
import type { GameLog, Matchup } from "../types";

/*
 * Saved playoff scenarios (2.7): what has happened to a scenario's games since it was saved, the
 * scenario brought up to date, the presets, reading a stored one back, keeping them on the device,
 * and the link that carries one to another device and is opened there (`scenarioLink.ts`).
 * Placeholder teams.
 */

const games: Matchup[] = [
  { id: "g1", date: "2026-05-02", away: "A", home: "B" },
  { id: "g2", date: "2026-05-09", away: "B", home: "C" },
  { id: "g3", date: "2026-05-16", away: "C", home: "A" },
];
const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const scenario = (picks: SavedScenario["picks"], matchups = games): SavedScenario => ({
  version: 1,
  id: "sc1",
  name: "Aces win out",
  seasonId: "s1",
  picks,
  basis: basisFor(picks, matchups),
  createdAt: "2026-05-01T12:00:00.000Z",
  modifiedAt: "2026-05-01T12:00:00.000Z",
});

describe("scenarioTrouble", () => {
  const saved = scenario({ g1: { winnerId: "A" }, g2: { winnerId: "C" }, g3: { winnerId: "A" } });

  it("finds nothing while the season is as it was", () => {
    expect(scenarioTrouble(saved, games, {})).toEqual([]);
    expect(isStale([])).toBe(false);
  });

  it("tells a game played, removed, given other teams, or only moved", () => {
    const now: Matchup[] = [
      games[0]!,
      { ...games[1]!, away: "A" },
      { ...games[2]!, date: "2026-05-17" },
    ];
    const trouble = scenarioTrouble(
      scenario({ ...saved.picks, g4: { winnerId: "B" } }, [
        ...games,
        { id: "g4", date: "2026-05-23", away: "B", home: "A" },
      ]),
      now,
      { g1: final("4", "2") }
    );
    expect(trouble.map((one) => [one.gameId, one.kind])).toEqual([
      ["g1", "played"],
      ["g2", "changed"],
      ["g3", "moved"],
      ["g4", "removed"],
    ]);
    expect(isStale(trouble)).toBe(true);
    expect(isStale(trouble.filter((one) => one.kind === "moved"))).toBe(false);
  });

  it("counts a pick whose winner is no longer in the game as changed", () => {
    const odd = {
      ...saved,
      picks: { g1: { winnerId: "C" } },
      basis: basisFor({ g1: { winnerId: "C" } }, games),
    };
    expect(scenarioTrouble(odd, games, {}).map((one) => one.kind)).toEqual(["changed"]);
  });
});

describe("rebaseScenario", () => {
  it("keeps the picks unaffected, drops the rest and notes games moved at their new dates", () => {
    const saved = scenario({
      g1: { winnerId: "A", awayRuns: 5, homeRuns: 3 },
      g2: { winnerId: "C" },
      g3: { winnerId: "A" },
    });
    const now: Matchup[] = [games[0]!, games[1]!, { ...games[2]!, date: "2026-05-17" }];
    const rebased = rebaseScenario(saved, now, { g2: final("1", "0") }, "2026-05-10T09:00:00.000Z");
    expect(rebased.scenario.picks).toEqual({
      g1: { winnerId: "A", awayRuns: 5, homeRuns: 3 },
      g3: { winnerId: "A" },
    });
    expect(rebased.scenario.basis.g3?.date).toBe("2026-05-17");
    expect(rebased.scenario.modifiedAt).toBe("2026-05-10T09:00:00.000Z");
    expect(rebased.dropped.map((one) => [one.gameId, one.kind])).toEqual([["g2", "played"]]);
    expect(rebased.moved.map((one) => one.gameId)).toEqual(["g3"]);
    expect(scenarioTrouble(rebased.scenario, now, { g2: final("1", "0") })).toEqual([]);
  });

  it("plays out only the picks that still apply", () => {
    const saved = scenario({ g1: { winnerId: "A" }, g2: { winnerId: "C" } });
    const trouble = scenarioTrouble(saved, games, { g1: final("4", "2") });
    expect(livePicks(saved.picks, trouble)).toEqual({ g2: { winnerId: "C" } });
  });
});

describe("presetPicks", () => {
  const favoriteOf = (game: Matchup) => game.home;

  it("has one team win or lose every game it has left, leaving its others as they were", () => {
    const current = { g2: { winnerId: "B" } };
    expect(presetPicks("winOut", { remaining: games, current, favoriteOf, teamId: "A" })).toEqual({
      g1: { winnerId: "A" },
      g2: { winnerId: "B" },
      g3: { winnerId: "A" },
    });
    expect(presetPicks("loseOut", { remaining: games, current, favoriteOf, teamId: "A" })).toEqual({
      g1: { winnerId: "B" },
      g2: { winnerId: "B" },
      g3: { winnerId: "C" },
    });
    expect(presetPicks("winOut", { remaining: games, current, favoriteOf, teamId: null })).toEqual(
      current
    );
  });

  it("has the favorites win every game, or fill every game not yet picked", () => {
    const current = { g1: { winnerId: "A" } };
    expect(presetPicks("favorites", { remaining: games, current, favoriteOf })).toEqual({
      g1: { winnerId: "B" },
      g2: { winnerId: "C" },
      g3: { winnerId: "A" },
    });
    expect(presetPicks("fillFavorites", { remaining: games, current, favoriteOf })).toEqual({
      g1: { winnerId: "A" },
      g2: { winnerId: "C" },
      g3: { winnerId: "A" },
    });
  });
});

describe("coerceScenario", () => {
  const saved = scenario({ g1: { winnerId: "A", awayRuns: 4, homeRuns: 2 } });

  it("reads a stored scenario back as it was written", () => {
    expect(coerceScenario(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  it("leaves a later version alone, and refuses what is not a scenario", () => {
    expect(coerceScenario({ ...saved, version: 2 })).toBeNull();
    expect(coerceScenario({ ...saved, name: 7 })).toBeNull();
    expect(coerceScenario(null)).toBeNull();
    expect(coerceScenario({ ...saved, picks: [] })).toBeNull();
  });

  it("drops a pick it cannot read and keeps the rest", () => {
    const read = coerceScenario({
      ...saved,
      picks: { g1: { winnerId: "A", awayRuns: -3 }, g2: { winnerId: "" }, g3: "C" },
    });
    expect(read?.picks).toEqual({ g1: { winnerId: "A" } });
  });
});

describe("scenario links", () => {
  const saved = scenario({
    g1: { winnerId: "B", awayRuns: 2, homeRuns: 5 },
    g3: { winnerId: "C" },
  });

  it("carry a scenario's name, picks and games there and back", () => {
    const hash = scenarioLinkHash(saved);
    expect(hash).not.toBeNull();
    expect(readScenarioLink(`#${hash ?? ""}`)).toEqual({
      name: "Aces win out",
      picks: saved.picks,
      basis: saved.basis,
    });
  });

  it("are refused when they would be too long for a link", () => {
    const many: Matchup[] = Array.from({ length: 200 }, (_, at) => ({
      id: `game-with-a-long-id-${at}`,
      date: "2026-05-02",
      away: "a-team-with-a-long-id",
      home: "another-team-with-a-long-id",
    }));
    const big = scenario(
      Object.fromEntries(many.map((game) => [game.id, { winnerId: game.home }])),
      many
    );
    expect(scenarioLinkHash(big)).toBeNull();
    expect(readScenarioLink(`#scenario=${"x".repeat(MAX_SCENARIO_LINK + 1)}`)).toBeNull();
  });

  it("read nothing from a link that is not one", () => {
    expect(readScenarioLink("")).toBeNull();
    expect(readScenarioLink("#scenario=not-base64-json")).toBeNull();
    expect(readScenarioLink("#s=abc")).toBeNull();
    const wrongSide = btoa(
      JSON.stringify({ v: 1, n: "x", p: [["g1", 2]], b: { g1: ["A", "B", ""] } })
    );
    expect(readScenarioLink(`#scenario=${wrongSide}`)).toBeNull();
    const noGame = btoa(JSON.stringify({ v: 1, n: "x", p: [["g9", 0]], b: {} }));
    expect(readScenarioLink(`#scenario=${noGame}`)).toBeNull();
  });
});

const backing = new Map<string, string>();
let refuse = false;
beforeEach(() => {
  backing.clear();
  refuse = false;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (refuse) throw new Error("QuotaExceededError");
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});

const named = (id: string, modifiedAt: string, seasonId = "s1"): SavedScenario => ({
  ...scenario({ g1: { winnerId: "A" } }),
  id,
  name: `Scenario ${id}`,
  seasonId,
  modifiedAt,
});

describe("scenarios kept on this device", () => {
  it("are kept per season, the most recently changed first", () => {
    writeScenarios("s1", [
      named("old", "2026-05-01T00:00:00.000Z"),
      named("new", "2026-05-03T00:00:00.000Z"),
    ]);
    writeScenarios("s2", [named("other", "2026-05-02T00:00:00.000Z", "s2")]);
    expect(readScenarios("s1").map((one) => one.id)).toEqual(["new", "old"]);
    expect(readScenarios("s2").map((one) => one.id)).toEqual(["other"]);
    expect(readScenarios("s3")).toEqual([]);
  });

  it("keep a later app's scenario as it was, unread, through every change", () => {
    const later = { ...named("later", "2026-05-02T00:00:00.000Z"), version: 2, extra: [1] };
    backing.set("lf_league_scenarios_v1", JSON.stringify({ s1: [later] }));
    expect(readScenarios("s1")).toEqual([]);
    keepScenario(named("mine", "2026-05-03T00:00:00.000Z"));
    dropScenario("s1", "mine");
    expect(JSON.parse(backing.get("lf_league_scenarios_v1") ?? "{}")).toEqual({ s1: [later] });
  });

  it("are changed as stored, so one kept in another tab meanwhile stays", () => {
    keepScenario(named("here", "2026-05-01T00:00:00.000Z"));
    // Another tab keeps one from a link, behind this tab's back.
    writeScenarios("s1", [...readScenarios("s1"), named("there", "2026-05-02T00:00:00.000Z")]);
    const kept = keepScenario({ ...named("here", "2026-05-03T00:00:00.000Z"), name: "Renamed" });
    expect(kept?.list.map((one) => [one.id, one.name])).toEqual([
      ["here", "Renamed"],
      ["there", "Scenario there"],
    ]);
    expect(dropScenario("s1", "here")?.list.map((one) => one.id)).toEqual(["there"]);
  });

  it("say which were let go to make room past thirty", () => {
    writeScenarios(
      "s1",
      Array.from({ length: 30 }, (_, at) =>
        named(`n${at}`, `2026-05-01T00:00:${String(at).padStart(2, "0")}.000Z`)
      )
    );
    const kept = keepScenario(named("newest", "2026-05-02T00:00:00.000Z"));
    expect(kept?.list).toHaveLength(30);
    expect(kept?.list[0]?.id).toBe("newest");
    expect(kept?.pushedOut.map((one) => one.id)).toEqual(["n0"]);
  });

  it("are not claimed kept when the browser will not store them", () => {
    refuse = true;
    expect(keepScenario(named("x", "2026-05-01T00:00:00.000Z"))).toBeNull();
    expect(readScenarios("s1")).toEqual([]);
  });
});

describe("opening a scenario link", () => {
  const nameOf = (id: string) => ({ A: "Aces", B: "Bears", C: "Comets" })[id] ?? id;
  // The Bears' typed score has the Aces ahead, so it is played, and shown, as no score.
  const sent = scenario({
    g3: { winnerId: "A", awayRuns: 2, homeRuns: 6 },
    g1: { winnerId: "B", awayRuns: 7, homeRuns: 3 },
    g2: { winnerId: "C" },
  });
  const hash = `#${scenarioLinkHash({ ...sent, name: "Bears and Aces" }) ?? ""}`;
  const open = (overrides: Partial<Parameters<typeof takeScenarioLink>[0]> = {}) => {
    const ask = vi.fn(async () => true);
    const outcome = takeScenarioLink({
      hash,
      seasonId: "mine",
      seasonName: "Spring 2026",
      matchups: games,
      logs: {},
      nameOf,
      ask,
      now: "2026-05-05T10:00:00.000Z",
      id: "sc-new",
      ...overrides,
    });
    return { ask, outcome };
  };

  it("shows the picks, soonest first, and what no longer applies, before keeping anything", async () => {
    const ask = vi.fn(async () => false);
    const { outcome } = open({ ask, logs: { g2: final("1", "0") } });
    expect(await outcome).toEqual({ kind: "declined" });
    expect(ask).toHaveBeenCalledTimes(1);
    const question = (ask.mock.calls[0] as unknown as [{ title: string; message: string }])[0];
    expect(question.title).toBe("Keep this scenario?");
    expect(question.message.split("\n")).toEqual([
      "“Bears and Aces”: 3 picks.",
      "• Bears over Aces, 5/2",
      "• Aces over Comets 6–2, 5/16",
      "1 is left out, as it no longer applies here:",
      "• Bears at Comets was played (1–0).",
      "",
      "Keeping it adds it to your saved scenarios for Spring 2026 on this device, open in the Forecast tab's playoff machine. Nothing in the season changes.",
    ]);
    expect(readScenarios("mine")).toEqual([]);
  });

  it("keeps only the picks that apply here, on the games as this season has them", async () => {
    const moved = games.map((game) => (game.id === "g1" ? { ...game, date: "2026-05-03" } : game));
    const { ask, outcome } = open({ matchups: moved, logs: { g2: final("1", "0") } });
    const kept = await outcome;
    expect(kept.kind).toBe("kept");
    // Shown on the day this season has the game, not the day the link was made with.
    const question = (ask.mock.calls[0] as unknown as [{ message: string }])[0];
    expect(question.message).toContain("• Bears over Aces, 5/3");
    const [stored] = readScenarios("mine");
    expect(stored).toMatchObject({
      id: "sc-new",
      name: "Bears and Aces",
      seasonId: "mine",
      picks: {
        g1: { winnerId: "B", awayRuns: 7, homeRuns: 3 },
        g3: { winnerId: "A", awayRuns: 2, homeRuns: 6 },
      },
      basis: {
        g1: { away: "A", home: "B", date: "2026-05-03" },
        g3: { away: "C", home: "A", date: "2026-05-16" },
      },
      createdAt: "2026-05-05T10:00:00.000Z",
    });
    expect(scenarioTrouble(stored!, moved, { g2: final("1", "0") })).toEqual([]);
  });

  it("asks nothing when the link cannot be read, or none of it applies here", async () => {
    const unreadable = open({ hash: "#scenario=cut-short" });
    expect(await unreadable.outcome).toEqual({ kind: "unreadable" });
    expect(unreadable.ask).not.toHaveBeenCalled();

    const elsewhere = open({ matchups: [{ id: "x1", date: "2026-05-02", away: "A", home: "B" }] });
    expect(await elsewhere.outcome).toEqual({ kind: "nothing-applies", name: "Bears and Aces" });
    expect(elsewhere.ask).not.toHaveBeenCalled();
    expect(readScenarios("mine")).toEqual([]);
  });

  it("says so when the browser will not keep it", async () => {
    refuse = true;
    expect(await open().outcome).toEqual({ kind: "not-stored" });
  });
});
