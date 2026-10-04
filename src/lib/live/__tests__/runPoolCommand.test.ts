import { beforeEach, describe, expect, it, vi } from "vitest";
import { markTaken, resetCloudGuard } from "../../cloud/cloudGuard";
import {
  gamesShardLabel,
  loadRealClubs,
  loadScoutGamesForYear,
  loadScoutTeams,
  onCloudPoolWrite,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import { runPoolCommand, writtenTeams } from "../runPoolCommand";

/*
 * Commands on this browser's own store (`runPoolCommand.ts`): the parts a command changes are
 * written, and no others; a write the store refuses is said to be refused, and nothing is shown
 * as done. Placeholder names throughout.
 */

const backing = new Map<string, string>();

beforeEach(() => {
  resetTeamRankingsStore();
  resetCloudGuard();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  });
  saveAgeGroups([
    { id: "ag_10u_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
    { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  ]);
  saveScoutTeams([
    { id: "A", name: "Club A" },
    { id: "B", name: "Club B" },
  ]);
  saveScoutGames([
    {
      id: "old",
      ageGroupId: "ag_10u_2026",
      teamAId: "A",
      teamBId: "B",
      teamAScore: 2,
      teamBScore: 1,
    },
    {
      id: "new",
      ageGroupId: "ag_10u_2027",
      teamAId: "A",
      teamBId: "B",
      teamAScore: 40,
      teamBScore: 1,
    },
  ]);
});

/** The pool's keys written while `act` runs. */
const writtenBy = (act: () => void): string[] => {
  const keys: string[] = [];
  onCloudPoolWrite((key) => keys.push(key));
  try {
    act();
  } finally {
    onCloudPoolWrite(null);
  }
  return keys;
};

describe("a command on this browser's pool", () => {
  it("writes the year of the game it changes, and nothing else", () => {
    const keys = writtenBy(() => {
      expect(runPoolCommand({ kind: "game.confirm", year: 2027, gameId: "new" }).ok).toBe(true);
    });
    expect(keys).toHaveLength(1);
    expect(keys[0]?.endsWith(gamesShardLabel(2027))).toBe(true);
    expect(loadScoutGamesForYear(2027)[0]?.scoreConfirmed).toBe(39);
  });

  it("writes the roster, and hands it back, for a club's change", () => {
    const run = runPoolCommand({ kind: "team.state", teamId: "B", state: "KY" });
    expect(writtenTeams(run)?.[1]?.state).toBe("KY");
    expect(loadScoutTeams()[1]?.state).toBe("KY");
  });

  it("writes an answer list, and nothing when the answer is already given", () => {
    expect(
      runPoolCommand({ kind: "answers", list: "realClubs", add: ["gcA"], remove: [] }).ok
    ).toBe(true);
    expect([...loadRealClubs()]).toEqual(["gcA"]);
    const keys = writtenBy(() =>
      runPoolCommand({ kind: "answers", list: "realClubs", add: ["gcA"], remove: [] })
    );
    expect(keys).toEqual([]);
  });

  it("says a write the store refused was not made", () => {
    // Another tab took a newer copy of the pool in, so this one may not write over it.
    markTaken("pool", false);
    expect(runPoolCommand({ kind: "team.state", teamId: "B", state: "KY" })).toEqual({
      ok: false,
      why: "unsaved",
    });
    expect(loadScoutTeams()[1]).not.toHaveProperty("state");
  });

  it("says a command was not made when any part of it was refused", () => {
    // The roster is kept, the year's games are not: storage full, for that key alone.
    const games = gamesShardLabel(2027);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (k.endsWith(games)) throw new Error("quota");
        backing.set(k, v);
      },
      removeItem: (k: string) => {
        backing.delete(k);
      },
    });
    expect(
      runPoolCommand({
        kind: "batch",
        commands: [
          { kind: "team.state", teamId: "B", state: "KY" },
          { kind: "game.confirm", year: 2027, gameId: "new" },
        ],
      })
    ).toEqual({ ok: false, why: "unsaved" });
  });

  it("says what it names is not in the pool", () => {
    expect(runPoolCommand({ kind: "game.confirm", year: 2026, gameId: "new" })).toEqual({
      ok: false,
      why: "missing",
    });
  });
});
