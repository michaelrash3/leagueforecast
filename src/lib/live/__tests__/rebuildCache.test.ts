import { describe, expect, it } from "vitest";
import { poolFixture, FIXTURE_TODAY } from "../../../../scripts/poolFixture";
import { NO_REMOVALS } from "../../autoRemoved";
import { ageGroupYear } from "../../teamRankings";
import { restBoardBuildCache } from "../rebuildCache";
import {
  boardViews,
  buildBoardsAndFacts,
  buildBoardsWithCache,
  livePagesOf,
  type BoardBuildCache,
  type BuildInput,
  type PageBoard,
} from "../views/board";

const fixture = poolFixture({ seed: 8, clubsPerPage: 20 });
const input = (): BuildInput => ({
  ageGroups: structuredClone(fixture.ageGroups),
  teams: structuredClone(fixture.teams),
  gamesOfYear: (year) =>
    fixture.games.filter(
      (game) =>
        ageGroupYear(fixture.ageGroups.find((group) => group.id === game.ageGroupId)) === year
    ),
  readSeason: (id) => {
    const season = fixture.seasons[id];
    return {
      teams: Object.values(season?.teams ?? {}),
      matchups: Object.values(season?.matchups ?? {}),
      logs: season?.logs ?? {},
    };
  },
  autoRemoved: NO_REMOVALS,
  today: FIXTURE_TODAY,
});
const cache = () => {
  const values = new Map<string, PageBoard[]>();
  let writes = 0;
  const store: BoardBuildCache = {
    read: async (key) => (values.get(key) ? structuredClone(values.get(key)!) : null),
    write: async (key, boards) => {
      values.set(key, structuredClone(boards) as PageBoard[]);
      writes++;
    },
  };
  return { store, writes: () => writes, values };
};

describe("year and season rebuild checkpoints", () => {
  it("publishes identical rankings, movement, history and page facts after all stages are restored", async () => {
    const source = input();
    const normal = buildBoardsAndFacts(source);
    const saved = cache();
    const first = await buildBoardsWithCache(source, saved.store);
    const writes = saved.writes();
    const progress: boolean[] = [];
    const restored = await buildBoardsWithCache(source, saved.store, (step) =>
      progress.push(step.cached)
    );
    expect(boardViews(source.ageGroups, first)).toEqual(boardViews(source.ageGroups, normal));
    expect(boardViews(source.ageGroups, restored)).toEqual(boardViews(source.ageGroups, normal));
    expect(livePagesOf(restored, null, source.ageGroups)).toEqual(
      livePagesOf(normal, null, source.ageGroups)
    );
    expect(saved.writes()).toBe(writes);
    expect(progress.every(Boolean)).toBe(true);
  });
  it("keeps completed stages after an interruption and does not repeat them on restart", async () => {
    const saved = cache();
    let interrupted = false;
    const store = {
      ...saved.store,
      write: async (key: string, boards: readonly PageBoard[]) => {
        if (saved.writes() === 2 && !interrupted) {
          interrupted = true;
          throw new Error("Interrupted");
        }
        await saved.store.write(key, boards);
      },
    };
    await expect(buildBoardsWithCache(input(), store)).rejects.toThrow("Interrupted");
    const restored: boolean[] = [];
    await buildBoardsWithCache(input(), store, (step) => restored.push(step.cached));
    expect(restored.slice(0, 3)).toEqual([true, true, false]);
  });
  it("reuses other years after a score changes and invalidates a changed day or ranking input", async () => {
    const source = input();
    const saved = cache();
    await buildBoardsWithCache(source, saved.store);
    const target = fixture.games.find((game) => game.teamAScore !== undefined)!;
    const year = ageGroupYear(fixture.ageGroups.find((group) => group.id === target.ageGroupId));
    const changed = {
      ...source,
      gamesOfYear: (asked: number | undefined) =>
        source
          .gamesOfYear(asked)
          .map((game) =>
            game.id === target.id ? { ...game, teamAScore: game.teamAScore! + 1 } : game
          ),
    };
    const hits: boolean[] = [];
    const changedBuild = await buildBoardsWithCache(changed, saved.store, (step) =>
      hits.push(step.cached)
    );
    expect(boardViews(source.ageGroups, changedBuild)).toEqual(
      boardViews(source.ageGroups, buildBoardsAndFacts(changed))
    );
    expect(hits).toContain(true);
    expect(hits).toContain(false);
    expect(year).toBeDefined();
    const newDay: boolean[] = [];
    await buildBoardsWithCache({ ...source, today: "2027-04-16" }, saved.store, (step) =>
      newDay.push(step.cached)
    );
    expect(newDay.every((hit) => !hit)).toBe(true);
  });
  it("writes compressed chunks before their pointer and ignores missing or damaged cached work", async () => {
    const values = new Map<string, Record<string, unknown>>();
    const docs = {
      read: async (key: string) => values.get(key) ?? null,
      set: async (key: string, value: Record<string, unknown>) => {
        values.set(key, value);
      },
    };
    const store = restBoardBuildCache(docs);
    const boards = buildBoardsAndFacts(input()).boards;
    await store.write("key", boards);
    expect(await store.read("key")).toEqual(JSON.parse(JSON.stringify(boards)));
    const piece = [...values.keys()].find((key) => !key.endsWith("/boards"))!;
    values.set(piece, { data: new Uint8Array([0, 1, 2]) });
    expect(await store.read("key")).toBeNull();
    values.delete(piece);
    expect(await store.read("key")).toBeNull();
  });
});
