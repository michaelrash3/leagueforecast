import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../../types";
import type { SeasonSnapshot } from "../../storage";
import { isEmptyLeague, joinLeagues, mergeLeague, type LeagueValue } from "../leagueMerge";

/*
 * League Standings from two devices, merged record by record. The case that matters most is the
 * ordinary one: scores for different games entered on different devices, each of which must
 * survive. Placeholder names throughout.
 */

const log = (away: number, home: number, isFinal = true): GameLog => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal,
});

const team = (id: string, name = `Team ${id}`): TeamBase => ({ id, name });
const game = (id: string, away: string, home: string, date = "2026-10-01"): Matchup => ({
  id,
  date,
  away,
  home,
});

const season = (
  id: string,
  extra: Partial<SeasonSnapshot> = {},
  createdAt = "2026-08-01T00:00:00.000Z"
): SeasonSnapshot => ({
  id,
  name: `Season ${id}`,
  createdAt,
  teams: [team("t1"), team("t2"), team("t3"), team("t4")],
  matchups: [game("g1", "t1", "t2"), game("g2", "t3", "t4"), game("g3", "t1", "t3")],
  logs: {},
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS },
  ...extra,
});

const league = (...seasons: SeasonSnapshot[]): LeagueValue => ({ seasons });

/** A copy of `value` with `edit` applied to season `id`. */
const edit = (
  value: LeagueValue,
  id: string,
  change: (season: SeasonSnapshot) => SeasonSnapshot
): LeagueValue => ({
  seasons: value.seasons.map((one) => (one.id === id ? change(structuredClone(one)) : one)),
});

const seasonOf = (value: LeagueValue, id: string): SeasonSnapshot => {
  const found = value.seasons.find((one) => one.id === id);
  if (!found) throw new Error(`no season ${id}`);
  return found;
};

describe("merging League Standings two devices both changed", () => {
  const base = league(season("fall"));

  it("keeps a score entered on each device for different games", () => {
    const phone = edit(base, "fall", (one) => ({ ...one, logs: { ...one.logs, g1: log(5, 3) } }));
    const laptop = edit(base, "fall", (one) => ({ ...one, logs: { ...one.logs, g2: log(1, 7) } }));
    const merged = mergeLeague(base, phone, laptop, "cloud");
    expect(merged.conflicts).toBe(0);
    expect(seasonOf(merged.value, "fall").logs).toEqual({ g1: log(5, 3), g2: log(1, 7) });
  });

  it("settles a game scored differently on each device toward the side preferred, and counts it", () => {
    const phone = edit(base, "fall", (one) => ({ ...one, logs: { g1: log(5, 3) } }));
    const laptop = edit(base, "fall", (one) => ({ ...one, logs: { g1: log(6, 3) } }));
    expect(mergeLeague(base, phone, laptop, "local")).toMatchObject({ conflicts: 1 });
    expect(seasonOf(mergeLeague(base, phone, laptop, "local").value, "fall").logs.g1).toEqual(
      log(5, 3)
    );
    expect(seasonOf(mergeLeague(base, phone, laptop, "cloud").value, "fall").logs.g1).toEqual(
      log(6, 3)
    );
  });

  it("sees no conflict where both devices entered the same score", () => {
    const phone = edit(base, "fall", (one) => ({ ...one, logs: { g1: log(5, 3) } }));
    const laptop = edit(base, "fall", (one) => ({ ...one, logs: { g1: log(5, 3) } }));
    const merged = mergeLeague(base, phone, laptop, "cloud");
    expect(merged.conflicts).toBe(0);
    expect(merged.value).toEqual(phone);
  });

  it("keeps a game added on one device and a team renamed on the other", () => {
    const phone = edit(base, "fall", (one) => ({
      ...one,
      matchups: [...one.matchups, game("g4", "t2", "t4", "2026-10-08")],
    }));
    const laptop = edit(base, "fall", (one) => ({
      ...one,
      teams: one.teams.map((t) => (t.id === "t2" ? { ...t, name: "Renamed" } : t)),
    }));
    const merged = seasonOf(mergeLeague(base, phone, laptop, "cloud").value, "fall");
    expect(merged.matchups.map((m) => m.id)).toEqual(["g1", "g2", "g3", "g4"]);
    expect(merged.teams.find((t) => t.id === "t2")?.name).toBe("Renamed");
  });

  it("takes a deletion made on one side where the other left the record alone", () => {
    const phone = edit(base, "fall", (one) => ({
      ...one,
      matchups: one.matchups.filter((m) => m.id !== "g3"),
    }));
    const merged = seasonOf(mergeLeague(base, phone, base, "cloud").value, "fall");
    expect(merged.matchups.map((m) => m.id)).toEqual(["g1", "g2"]);
  });

  it("keeps a record one side deleted and the other edited: no work is lost to a deletion", () => {
    const phone = edit(base, "fall", (one) => ({
      ...one,
      matchups: one.matchups.filter((m) => m.id !== "g3"),
    }));
    const laptop = edit(base, "fall", (one) => ({
      ...one,
      matchups: one.matchups.map((m) => (m.id === "g3" ? { ...m, date: "2026-10-09" } : m)),
    }));
    const merged = seasonOf(mergeLeague(base, phone, laptop, "local").value, "fall");
    expect(merged.matchups.find((m) => m.id === "g3")?.date).toBe("2026-10-09");
  });

  /*
   * A deletion loses to an edit across records too. Merged record by record, a score entered for a
   * game the other side deleted would outlive its game, and be dropped as a stray when the seasons
   * are read back (`coerceLogs`), with nothing kept: the score lost to a deletion after all.
   */
  it("keeps the game of a score entered on one side, where the other deleted the game", () => {
    const phone = edit(base, "fall", (one) => ({ ...one, logs: { g1: log(5, 3) } }));
    const laptop = edit(base, "fall", (one) => ({
      ...one,
      matchups: one.matchups.filter((m) => m.id !== "g1"),
    }));
    const merged = seasonOf(mergeLeague(base, phone, laptop, "cloud").value, "fall");
    expect(merged.matchups.map((m) => m.id)).toEqual(["g1", "g2", "g3"]);
    expect(merged.logs).toEqual({ g1: log(5, 3) });
  });

  it("keeps the teams of a game added on one side, where the other deleted a team", () => {
    const phone = edit(base, "fall", (one) => ({
      ...one,
      matchups: [...one.matchups, game("g4", "t2", "t4", "2026-10-08")],
      logs: { g4: log(2, 1) },
    }));
    const laptop = edit(base, "fall", (one) => ({
      ...one,
      teams: one.teams.filter((t) => t.id !== "t4"),
      matchups: one.matchups.filter((m) => m.away !== "t4" && m.home !== "t4"),
    }));
    const merged = seasonOf(mergeLeague(base, phone, laptop, "cloud").value, "fall");
    expect(merged.teams.map((t) => t.id)).toEqual(["t1", "t2", "t3", "t4"]);
    // The game only this side still had goes; the one added here, and its score, stay.
    expect(merged.matchups.map((m) => m.id)).toEqual(["g1", "g3", "g4"]);
    expect(merged.logs).toEqual({ g4: log(2, 1) });
  });

  it("keeps the team and game a score leans on, where the other side deleted both", () => {
    const scored = league(season("fall", { logs: { g2: log(0, 0, false) } }));
    const phone = edit(scored, "fall", (one) => ({ ...one, logs: { g2: log(4, 4) } }));
    const laptop = edit(scored, "fall", (one) => ({
      ...one,
      teams: one.teams.filter((t) => t.id !== "t3"),
      matchups: one.matchups.filter((m) => m.away !== "t3" && m.home !== "t3"),
      logs: {},
    }));
    const merged = seasonOf(mergeLeague(scored, phone, laptop, "cloud").value, "fall");
    expect(merged.teams.map((t) => t.id)).toContain("t3");
    expect(merged.matchups.map((m) => m.id)).toEqual(["g1", "g2"]);
    expect(merged.logs).toEqual({ g2: log(4, 4) });
  });

  it("lets a deleted game take its score along when nobody changed the score", () => {
    const scored = league(season("fall", { logs: { g1: log(1, 0) } }));
    const laptop = edit(scored, "fall", (one) => ({
      ...one,
      matchups: one.matchups.filter((m) => m.id !== "g1"),
      logs: {},
    }));
    const merged = seasonOf(mergeLeague(scored, scored, laptop, "cloud").value, "fall");
    expect(merged.matchups.map((m) => m.id)).toEqual(["g2", "g3"]);
    expect(merged.logs).toEqual({});
  });

  it("deletes a season one side deleted, unless the other side changed it since", () => {
    const withSpring = league(season("fall"), season("spring"));
    const phone = league(season("fall"));
    expect(
      mergeLeague(withSpring, phone, withSpring, "cloud").value.seasons.map((s) => s.id)
    ).toEqual(["fall"]);
    const laptop = edit(withSpring, "spring", (one) => ({ ...one, logs: { g1: log(2, 2) } }));
    const kept = mergeLeague(withSpring, phone, laptop, "local").value;
    expect(kept.seasons.map((s) => s.id)).toEqual(["fall", "spring"]);
    expect(seasonOf(kept, "spring").logs).toEqual({ g1: log(2, 2) });
  });

  it("merges settings field by field", () => {
    const phone = edit(base, "fall", (one) => ({
      ...one,
      settings: { ...one.settings, goldCutoff: 6 },
    }));
    const laptop = edit(base, "fall", (one) => ({
      ...one,
      settings: { ...one.settings, winPoints: 3 },
    }));
    const merged = mergeLeague(base, phone, laptop, "cloud");
    expect(merged.conflicts).toBe(0);
    expect(seasonOf(merged.value, "fall").settings).toMatchObject({ goldCutoff: 6, winPoints: 3 });
  });

  it("keeps apart two new seasons that happened to be given the same id", () => {
    const phone = league(
      season("fall"),
      season("season-2", { name: "Phone's" }, "2026-09-01T00:00:00Z")
    );
    const laptop = league(
      season("fall"),
      season("season-2", { name: "Laptop's" }, "2026-09-02T00:00:00Z")
    );
    const merged = mergeLeague(base, phone, laptop, "cloud");
    expect(merged.conflicts).toBe(0);
    expect(merged.value.seasons.map((s) => [s.id, s.name])).toEqual([
      ["fall", "Season fall"],
      ["season-2", "Laptop's"],
      ["season-3", "Phone's"],
    ]);
    expect(merged.renamed).toEqual({ "season-2": "season-3" });
  });

  it("takes the other side's new season in place of an old one this side never touched", () => {
    const old = league(season("fall"), season("season-2", {}, "2026-08-10T00:00:00Z"));
    const replaced = league(
      season("fall"),
      season("season-2", { name: "New" }, "2026-09-20T00:00:00Z")
    );
    const merged = mergeLeague(old, old, replaced, "local");
    expect(merged.value).toEqual(replaced);
    expect(merged.renamed).toEqual({});
  });

  it("keeps this side's edits to a season the other side replaced, under a new id", () => {
    const old = league(season("fall"), season("season-2", {}, "2026-08-10T00:00:00Z"));
    const edited = edit(old, "season-2", (one) => ({ ...one, logs: { g1: log(4, 0) } }));
    const replaced = league(
      season("fall"),
      season("season-2", { name: "New" }, "2026-09-20T00:00:00Z")
    );
    const merged = mergeLeague(old, edited, replaced, "cloud");
    expect(merged.value.seasons.map((s) => s.id)).toEqual(["fall", "season-2", "season-3"]);
    expect(seasonOf(merged.value, "season-2").name).toBe("New");
    expect(seasonOf(merged.value, "season-3").logs).toEqual({ g1: log(4, 0) });
  });

  it("keeps a rearrangement made on one side, with the other side's additions after it", () => {
    const phone = edit(base, "fall", (one) => ({ ...one, teams: [...one.teams].reverse() }));
    const laptop = edit(base, "fall", (one) => ({ ...one, teams: [...one.teams, team("t5")] }));
    const merged = seasonOf(mergeLeague(base, phone, laptop, "cloud").value, "fall");
    expect(merged.teams.map((t) => t.id)).toEqual(["t4", "t3", "t2", "t1", "t5"]);
  });

  it("carries the later of the two last-changed times", () => {
    const phone = edit(base, "fall", (one) => ({
      ...one,
      updatedAt: "2026-10-02T00:00:00Z",
      logs: { g1: log(1, 0) },
    }));
    const laptop = edit(base, "fall", (one) => ({
      ...one,
      updatedAt: "2026-10-03T00:00:00Z",
      logs: { g2: log(0, 1) },
    }));
    expect(seasonOf(mergeLeague(base, phone, laptop, "local").value, "fall").updatedAt).toBe(
      "2026-10-03T00:00:00Z"
    );
  });

  it("reads a record with its fields in another order as the same record", () => {
    // The laptop's copy came back from Firestore, which hands a record's fields back in an order
    // of its own; the phone changed the score.
    const reordered = (one: GameLog): GameLog =>
      Object.fromEntries(Object.entries(one).reverse()) as GameLog;
    const scored = league(season("fall", { logs: { g1: log(1, 0), g2: log(2, 2) } }));
    const phone = edit(scored, "fall", (one) => ({
      ...one,
      logs: { ...one.logs, g1: log(5, 3) },
    }));
    const laptop = edit(scored, "fall", (one) => ({
      ...one,
      logs: Object.fromEntries(Object.entries(one.logs).map(([id, one]) => [id, reordered(one)])),
      settings: Object.fromEntries(
        Object.entries(one.settings).reverse()
      ) as SeasonSnapshot["settings"],
    }));
    for (const prefer of ["cloud", "local"] as const) {
      const merged = mergeLeague(scored, phone, laptop, prefer);
      expect(merged.conflicts).toBe(0);
      expect(seasonOf(merged.value, "fall").logs.g1).toEqual(log(5, 3));
    }
  });

  it("changes nothing where neither side did, and takes one side's changes whole", () => {
    expect(mergeLeague(base, base, base, "cloud").value).toEqual(base);
    const phone = edit(base, "fall", (one) => ({ ...one, logs: { g1: log(5, 3) } }));
    expect(mergeLeague(base, phone, base, "cloud").value).toEqual(phone);
    expect(mergeLeague(base, base, phone, "local").value).toEqual(phone);
  });

  it("keeps every score from many games split between two devices", () => {
    const games = Array.from({ length: 40 }, (_, at) => game(`g${at}`, "t1", "t2"));
    const start = league(season("fall", { matchups: games }));
    const scores = (from: number, step: number) =>
      Object.fromEntries(
        games.filter((_, at) => at % step === from).map((g, at) => [g.id, log(at, 1)])
      );
    const phone = edit(start, "fall", (one) => ({ ...one, logs: scores(0, 2) }));
    const laptop = edit(start, "fall", (one) => ({ ...one, logs: scores(1, 2) }));
    const merged = mergeLeague(start, phone, laptop, "cloud");
    expect(merged.conflicts).toBe(0);
    expect(Object.keys(seasonOf(merged.value, "fall").logs).sort()).toEqual(
      games.map((g) => g.id).sort()
    );
  });
});

describe("joining League Standings that have never been merged", () => {
  it("drops this browser's untouched first season where the other side has one of that id", () => {
    const fresh = league(season("default", { teams: [], matchups: [] }, "2026-09-29T00:00:00Z"));
    const cloud = league(season("default"), season("spring"));
    const joined = joinLeagues(fresh, cloud, "cloud");
    expect(joined.value).toEqual(cloud);
  });

  it("keeps two first seasons made on different browsers as two seasons", () => {
    const phone = league(season("default", { name: "Phone league" }, "2026-05-01T00:00:00Z"));
    const laptop = league(season("default", { name: "Laptop league" }, "2026-08-01T00:00:00Z"));
    const joined = joinLeagues(phone, laptop, "cloud");
    expect(joined.value.seasons.map((s) => [s.id, s.name])).toEqual([
      ["default", "Laptop league"],
      ["season-2", "Phone league"],
    ]);
    expect(joined.renamed).toEqual({ default: "season-2" });
  });

  it("joins one season restored on both browsers, keeping every game and score either has", () => {
    const shared = season("fall");
    const phone = league({ ...shared, logs: { g1: log(3, 1) } });
    const laptop = league({
      ...shared,
      matchups: [...shared.matchups, game("g9", "t2", "t3")],
      logs: { g2: log(0, 2) },
    });
    const joined = seasonOf(joinLeagues(phone, laptop, "cloud").value, "fall");
    expect(joined.matchups.map((m) => m.id)).toEqual(["g1", "g2", "g3", "g9"]);
    expect(joined.logs).toEqual({ g1: log(3, 1), g2: log(0, 2) });
  });

  it("settles a score the two hold differently toward the side preferred", () => {
    const shared = season("fall");
    const phone = league({ ...shared, logs: { g1: log(3, 1) } });
    const laptop = league({ ...shared, logs: { g1: log(4, 1) } });
    const joined = joinLeagues(phone, laptop, "cloud");
    expect(joined.conflicts).toBe(1);
    expect(seasonOf(joined.value, "fall").logs.g1).toEqual(log(4, 1));
  });

  it("keeps a season only this browser has", () => {
    const phone = league(season("fall"), season("summer", {}, "2026-06-01T00:00:00Z"));
    const laptop = league(season("fall"));
    expect(joinLeagues(phone, laptop, "cloud").value.seasons.map((s) => s.id)).toEqual([
      "fall",
      "summer",
    ]);
  });
});

describe("a league with nothing in it", () => {
  it("is one whose every season is empty", () => {
    expect(isEmptyLeague(league(season("default", { teams: [], matchups: [] })))).toBe(true);
    expect(isEmptyLeague(league(season("default")))).toBe(false);
    expect(isEmptyLeague(null)).toBe(true);
  });
});
