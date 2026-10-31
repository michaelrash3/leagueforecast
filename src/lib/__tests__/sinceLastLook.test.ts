import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changesSince,
  readLook,
  saveLook,
  takeLook,
  type LookGame,
  type LookRow,
  type LookSnapshot,
} from "../sinceLastLook";

/*
 * What changed between two visits to a League season, told about the team followed. Placeholder
 * names: Aces are followed; they win one they were given 42% in, and climb past Bears and Comets.
 */
const before: LookRow[] = [
  { id: "B", name: "Bears", rank: 1, goldPct: 90 },
  { id: "C", name: "Comets", rank: 2, goldPct: 70 },
  { id: "A", name: "Aces", rank: 3, goldPct: 61 },
  { id: "D", name: "Ducks", rank: 4, goldPct: 10 },
];
const after: LookRow[] = [
  { id: "A", name: "Aces", rank: 1, goldPct: 78 },
  { id: "B", name: "Bears", rank: 2, goldPct: 80 },
  { id: "C", name: "Comets", rank: 3, goldPct: 60 },
  { id: "D", name: "Ducks", rank: 4, goldPct: 9 },
];
const open = (id: string, away: string, home: string): LookGame => ({
  id,
  away,
  home,
  final: false,
  awayRuns: "",
  homeRuns: "",
});
const done = (game: LookGame, awayRuns: string, homeRuns: string): LookGame => ({
  ...game,
  final: true,
  awayRuns,
  homeRuns,
});

const g1 = open("g1", "A", "B");
const g2 = open("g2", "D", "C");
const g0 = done(open("g0", "B", "C"), "5", "3");
const calls = [
  { gameId: "g1", teamAId: "A", pA: 0.42 },
  { gameId: "g2", teamAId: "D", pA: 0.31 },
];

describe("what changed since the last look", () => {
  const prev = takeLook(1_000, before, [g0, g1, g2], calls, true);
  const games = [g0, done(g1, "9", "4"), done(g2, "7", "6")];
  const now = takeLook(5_000, after, games, [], true);

  it("tells the followed team's place, Gold odds, and its results with the chance it had", () => {
    const changes = changesSince(prev, now, after, games, "A");
    expect(changes?.since).toBe(1_000);
    expect(changes?.team).toEqual({
      name: "Aces",
      placeBefore: 3,
      placeNow: 1,
      goldBefore: 61,
      goldNow: 78,
    });
    expect(changes?.results).toEqual([
      { gameId: "g1", opponent: "Bears", won: true, score: "9–4", chance: 0.42 },
    ]);
    expect(changes?.newFinals).toBe(2);
  });

  it("names the upset: the winner given the smallest chance", () => {
    const changes = changesSince(prev, now, after, games, "A");
    expect(changes?.upset).toEqual({
      winner: "Ducks",
      loser: "Comets",
      score: "7–6",
      chance: 0.31,
    });
  });

  it("says who passed the team and whom it passed", () => {
    const changes = changesSince(prev, now, after, games, "A");
    expect(changes?.youPassed.sort()).toEqual(["Bears", "Comets"]);
    expect(changes?.passedYou).toEqual([]);
  });

  it("with no team followed, names the team that climbed most", () => {
    const changes = changesSince(prev, now, after, games, null);
    expect(changes?.team).toBeUndefined();
    expect(changes?.results).toEqual([]);
    expect(changes?.climber).toEqual({ name: "Aces", from: 3, to: 1 });
  });

  it("says nothing when nothing changed", () => {
    const same = takeLook(9_000, before, [g0, g1, g2], calls, true);
    expect(changesSince(prev, same, before, [g0, g1, g2], "A")).toBeNull();
  });
});

describe("the look kept on this device", () => {
  // These tests run in Node, which has no browser storage: a map stands in for it.
  beforeEach(() => {
    const kept = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("is read back as kept, per season, and an unreadable one is none", () => {
    const look = takeLook(1_000, before, [g1], calls, true);
    saveLook("s1", look);
    expect(readLook("s1")).toEqual(look);
    expect(readLook("s2")).toBeNull();
    window.localStorage.setItem("lf_last_look_v1_s3", "{not json");
    expect(readLook("s3")).toBeNull();
  });

  it("is none for a season made at another moment than the one it was kept of", () => {
    const look = { ...takeLook(1_000, before, [g1], calls, true), createdAt: "2026-03-01" };
    saveLook("s1", look);
    expect(readLook("s1", "2026-03-01")).toEqual(look);
    expect(readLook("s1", "2026-10-30")).toBeNull();
    // A season, or a look, from before the moment was kept reads as the same season.
    expect(readLook("s1", "")).toEqual(look);
    const older = takeLook(1_000, before, [g1], calls, true);
    saveLook("s2", older);
    expect(readLook("s2", "2026-10-30")).toEqual(older);
    saveLook("s3", { ...older, createdAt: 7 } as unknown as LookSnapshot);
    expect(readLook("s3")).toBeNull();
  });
});
