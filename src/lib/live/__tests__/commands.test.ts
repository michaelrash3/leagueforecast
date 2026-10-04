import { describe, expect, it } from "vitest";
import type { ScoutGame, ScoutTeam } from "../../teamRankings/types";
import { encodeScoutGames, encodeScoutTeams } from "../../teamRankingsCompact";
import {
  applyCommand,
  coerceCommand,
  type AnswerList,
  type PoolCommand,
  type PoolRead,
  type PoolWrite,
} from "../commands";

/*
 * Team Rankings' edits as commands (`commands.ts`): each makes its change to the part it touches
 * and nothing else, and each comes with the command that takes it back exactly, every part it
 * touched restored to the value it held. Placeholder names throughout.
 */

type Parts = {
  teams: ScoutTeam[];
  games: Map<number | null, ScoutGame[]>;
  answers: Map<AnswerList, Set<string>>;
};

const applyWrites = (parts: Parts, writes: readonly PoolWrite[]) =>
  writes.forEach((one) => {
    if (one.part === "teams") parts.teams = one.teams;
    else if (one.part === "games") parts.games.set(one.year, one.games);
    else parts.answers.set(one.list, one.ids);
  });

const memory = (parts: Parts) => {
  const read: PoolRead = {
    teams: () => parts.teams,
    games: (year) => parts.games.get(year) ?? [],
    answers: (list) => parts.answers.get(list) ?? new Set(),
  };
  const write = (writes: readonly PoolWrite[]) => applyWrites(parts, writes);
  /** Applies, writes, and hands back what came of it; throws when it was not applied. */
  const run = (command: PoolCommand) => {
    const result = applyCommand(read, command);
    if (!result.ok) throw new Error(`not applied: ${result.why}`);
    write(result.writes);
    return result;
  };
  return { read, run, parts };
};

/** A part as storage would keep it, so that two equal values compare equal however built. */
const stored = (parts: Parts) => ({
  teams: JSON.stringify(encodeScoutTeams(parts.teams)),
  games: [...parts.games.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([year, games]) => [year, JSON.stringify(encodeScoutGames(games))]),
  answers: [...parts.answers.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([list, ids]) => [list, [...ids].sort()]),
});

const clone = (parts: Parts): Parts => ({
  teams: structuredClone(parts.teams),
  games: new Map([...parts.games].map(([year, games]) => [year, structuredClone(games)])),
  answers: new Map([...parts.answers].map(([list, ids]) => [list, new Set(ids)])),
});

const club = (id: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name: `Club ${id}`,
  ...extra,
});

const played = (id: string, a: string, b: string, scoreA: number, scoreB: number) => ({
  id,
  ageGroupId: "ag_10u_2027",
  teamAId: a,
  teamBId: b,
  teamAScore: scoreA,
  teamBScore: scoreB,
});

const POOL = (): Parts => ({
  teams: [
    club("A", {
      state: "OH",
      gcTeams: [{ teamId: "gcA", name: "Club A 10U", ageGroupId: "ag_10u_2027" }],
    }),
    club("B", {
      gcTeams: [
        { teamId: "gcB1", name: "Club B 10U", ageGroupId: "ag_10u_2027" },
        { teamId: "gcB2", name: "Club B Fall", ageGroupId: "ag_10u_2026" },
      ],
    }),
    club("C"),
  ],
  games: new Map<number | null, ScoutGame[]>([
    [2027, [played("g1", "A", "B", 5, 4), played("g2", "B", "C", 34, 0)]],
    [2026, [played("old", "A", "C", 2, 1)]],
    [null, [{ id: "open", ageGroupId: "ag_old", teamAId: "A", teamBId: "B" }]],
  ]),
  answers: new Map<AnswerList, Set<string>>([
    ["realClubs", new Set(["gcA"])],
    ["ageRight", new Set()],
    ["keptApart", new Set()],
  ]),
});

describe("a command's change", () => {
  it("writes the one year a game is in, and no other", () => {
    const pool = memory(POOL());
    const result = pool.run({
      kind: "game.score",
      year: null,
      gameId: "open",
      teamAScore: 6,
      teamBScore: 3,
    });
    expect(result.writes.map((write) => write.part)).toEqual(["games"]);
    expect(pool.parts.games.get(null)?.[0]).toMatchObject({ teamAScore: 6, teamBScore: 3 });
    expect(pool.parts.games.get(2027)).toEqual(POOL().games.get(2027));
  });

  it("vouches for a lopsided score at the margin it reads now, and nothing for one unplayed", () => {
    const pool = memory(POOL());
    pool.run({ kind: "game.confirm", year: 2027, gameId: "g2" });
    expect(pool.parts.games.get(2027)?.[1]?.scoreConfirmed).toBe(34);
    expect(pool.run({ kind: "game.confirm", year: null, gameId: "open" }).writes).toEqual([]);
  });

  it("keeps a game out of the maths and puts it back, the field gone when it counts", () => {
    const pool = memory(POOL());
    pool.run({ kind: "game.exclude", year: 2027, gameId: "g1", excluded: true });
    expect(pool.parts.games.get(2027)?.[0]?.excluded).toBe(true);
    pool.run({ kind: "game.exclude", year: 2027, gameId: "g1", excluded: false });
    expect(pool.parts.games.get(2027)?.[0]).not.toHaveProperty("excluded");
  });

  it("finds no game that is not in the year named", () => {
    const pool = memory(POOL());
    expect(applyCommand(pool.read, { kind: "game.confirm", year: 2026, gameId: "g2" })).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("refuses a score that is not a count of runs, and a state that is not two letters", () => {
    const pool = memory(POOL());
    const score = (teamAScore: number) =>
      applyCommand(pool.read, {
        kind: "game.score",
        year: 2027,
        gameId: "g1",
        teamAScore,
        teamBScore: 1,
      });
    expect(score(-1)).toEqual({ ok: false, why: "refused" });
    expect(score(2.5)).toEqual({ ok: false, why: "refused" });
    expect(applyCommand(pool.read, { kind: "team.state", teamId: "A", state: "Ohio" })).toEqual({
      ok: false,
      why: "refused",
    });
  });

  it("sets a club's state, normalised, and clears it", () => {
    const pool = memory(POOL());
    pool.run({ kind: "team.state", teamId: "C", state: "ky" });
    expect(pool.parts.teams[2]?.state).toBe("KY");
    pool.run({ kind: "team.state", teamId: "C", state: null });
    expect(pool.parts.teams[2]).not.toHaveProperty("state");
  });

  it("adds a club League Standings made only when it is given a state, and only that club", () => {
    const pool = memory(POOL());
    const adopt = club("S-LEAGUE");
    expect(pool.run({ kind: "team.state", teamId: "S-LEAGUE", state: null, adopt }).writes).toEqual(
      []
    );
    pool.run({ kind: "team.state", teamId: "S-LEAGUE", state: "IN", adopt });
    expect(pool.parts.teams.map((team) => team.id)).toEqual(["A", "B", "C", "S-LEAGUE"]);
    expect(pool.parts.teams[3]?.state).toBe("IN");
    expect(applyCommand(pool.read, { kind: "team.state", teamId: "S-NONE", state: "IN" })).toEqual({
      ok: false,
      why: "missing",
    });
  });

  it("takes one GameChanger id off a club, leaving the rest", () => {
    const pool = memory(POOL());
    pool.run({ kind: "team.unlinkGc", teamId: "B", gcTeamId: "gcB2" });
    expect(pool.parts.teams[1]?.gcTeams?.map((link) => link.teamId)).toEqual(["gcB1"]);
    expect(pool.run({ kind: "team.unlinkGc", teamId: "B", gcTeamId: "gcB2" }).writes).toEqual([]);
  });

  it("adds and takes answers, writing nothing when nothing changes", () => {
    const pool = memory(POOL());
    pool.run({ kind: "answers", list: "realClubs", add: ["gcB1", "gcB2"], remove: ["gcA"] });
    expect([...pool.parts.answers.get("realClubs")!].sort()).toEqual(["gcB1", "gcB2"]);
    expect(
      pool.run({ kind: "answers", list: "realClubs", add: ["gcB1"], remove: ["gcA"] }).writes
    ).toEqual([]);
  });

  it("lays each command of a batch over the last, writing each part once", () => {
    const pool = memory(POOL());
    const result = pool.run({
      kind: "batch",
      commands: [
        { kind: "team.state", teamId: "A", state: "KY" },
        { kind: "team.unlinkGc", teamId: "A", gcTeamId: "gcA" },
        { kind: "game.exclude", year: 2027, gameId: "g1", excluded: true },
      ],
    });
    expect(result.writes.map((write) => write.part)).toEqual(["teams", "games"]);
    expect(pool.parts.teams[0]).toEqual({ id: "A", name: "Club A", state: "KY" });
  });
});

/** A small seeded generator, so a failing draw can be run again. */
const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** A command a person could have asked of `parts`, drawn by `next`. */
const drawCommand = (parts: Parts, next: () => number): PoolCommand => {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const year = pick([2027, 2026, null] as const);
  const games = parts.games.get(year) ?? [];
  const game = games.length > 0 ? pick(games) : undefined;
  const team = pick(parts.teams);
  const ids = ["gcA", "gcB1", "gcB2", "gcC", "gcZ"];
  switch (Math.floor(next() * 8)) {
    case 0:
      return game
        ? {
            kind: "game.score",
            year,
            gameId: game.id,
            teamAScore: Math.floor(next() * 12),
            teamBScore: Math.floor(next() * 12),
          }
        : { kind: "none" };
    case 1:
      return game
        ? { kind: "game.exclude", year, gameId: game.id, excluded: next() < 0.5 }
        : { kind: "none" };
    case 2:
      return game ? { kind: "game.confirm", year, gameId: game.id } : { kind: "none" };
    case 3:
      return {
        kind: "team.state",
        teamId: team.id,
        state: next() < 0.3 ? null : pick(["KY", "oh", "IN"]),
      };
    case 4: {
      const link = team.gcTeams?.[0];
      return link
        ? { kind: "team.unlinkGc", teamId: team.id, gcTeamId: link.teamId }
        : { kind: "none" };
    }
    case 5:
      return {
        kind: "team.state",
        teamId: `S-L${Math.floor(next() * 3)}`,
        state: "KY",
        adopt: club(`S-L${Math.floor(next() * 3)}`),
      };
    case 6:
      return {
        kind: "answers",
        list: pick(["realClubs", "ageRight", "keptApart"] as const),
        add: ids.filter(() => next() < 0.3),
        remove: ids.filter(() => next() < 0.3),
      };
    default:
      return {
        kind: "batch",
        commands: [drawCommand(parts, next), drawCommand(parts, next)],
      };
  }
};

describe("a command's inverse", () => {
  it("puts every part the command touched back as it was, over many drawn edits", () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const next = seeded(seed);
      const pool = memory(POOL());
      // A few edits first, so the commands land on pools of every shape.
      for (let warm = 0; warm < 3; warm += 1) {
        const result = applyCommand(pool.read, drawCommand(pool.parts, next));
        if (result.ok) applyWrites(pool.parts, result.writes);
      }
      const before = stored(clone(pool.parts));
      const command = drawCommand(pool.parts, next);
      const result = applyCommand(pool.read, command);
      if (!result.ok) continue;
      applyWrites(pool.parts, result.writes);
      const undone = applyCommand(pool.read, result.inverse);
      expect([seed, undone.ok]).toEqual([seed, true]);
      if (undone.ok) applyWrites(pool.parts, undone.writes);
      expect([seed, stored(pool.parts)]).toEqual([seed, before]);
    }
  });
});

describe("a command as it arrives from elsewhere", () => {
  it("reads back every command exactly as it was sent", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const command = drawCommand(POOL(), seeded(seed));
      expect(coerceCommand(JSON.parse(JSON.stringify(command)))).toEqual(command);
    }
    const put: PoolCommand = { kind: "game.put", year: 2027, game: played("g1", "A", "B", 5, 4) };
    expect(coerceCommand(JSON.parse(JSON.stringify(put)))).toEqual(put);
    const back: PoolCommand = { kind: "team.put", team: club("A", { state: "OH" }) };
    expect(coerceCommand(JSON.parse(JSON.stringify(back)))).toEqual(back);
  });

  it("reads nothing that is not exactly a command", () => {
    for (const raw of [
      null,
      "game.score",
      { kind: "game.drop", gameId: "g1" },
      { kind: "game.score", year: "2027", gameId: "g1", teamAScore: 1, teamBScore: 2 },
      { kind: "game.score", year: 2027, gameId: "", teamAScore: 1, teamBScore: 2 },
      { kind: "answers", list: "everything", add: [], remove: [] },
      { kind: "answers", list: "realClubs", add: [1], remove: [] },
      { kind: "team.state", teamId: "A", state: 5 },
      { kind: "team.put", team: { name: "No id" } },
      { kind: "batch", commands: [{ kind: "none" }, { kind: "nope" }] },
      {
        kind: "batch",
        commands: [
          {
            kind: "batch",
            commands: [{ kind: "batch", commands: [{ kind: "batch", commands: [] }] }],
          },
        ],
      },
    ])
      expect([raw, coerceCommand(raw)]).toEqual([raw, null]);
  });
});
