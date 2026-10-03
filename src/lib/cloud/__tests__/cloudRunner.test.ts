import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { localDayKey } from "../../gameChangerSchedule";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadDroppedClubs,
  loadRefreshLog,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveDroppedClubs,
  saveKeptApart,
  saveRefreshCadence,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { DATA_SCHEMA } from "../cloudManifest";
import { LEAGUE_PART } from "../cloudPlan";
import type { CloudManifest } from "../cloudManifest";
import { loadPoolFrom, memoryIo, runCloudPull, type CloudPullDeps } from "../cloudRunner";
import { memoryCloud, type MemoryCloud } from "./memoryCloud";

/*
 * A pull run on the cloud copy (`runCloudPull`): it files what GameChanger answers into the copy's
 * pool as a pull in the browser would, and sends back the values that changed and nothing else —
 * never League Standings, never a value it did not change, and never over another device's save.
 */

const backing = new Map<string, string>();
beforeEach(() => {
  resetTeamRankingsStore();
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
});
afterEach(() => {
  resetTeamRankingsStore();
  vi.unstubAllGlobals();
});

const game = (
  id: string,
  opponentName: string,
  teamScore: number,
  opponentScore: number
): GcGame => ({
  id,
  date: "2026-09-20",
  startTs: "2026-09-20T15:00:00.000Z",
  opponentName,
  status: "completed",
  teamScore,
  opponentScore,
});
const schedule = (id: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id,
    name: `${name} 9U`,
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state: "OH",
    city: "Cincinnati",
  },
  games,
  fetchedAt: "2026-09-29T07:20:00.000Z",
});
const ACES = "gcACES000001";
const BEARS = "gcBEARS00001";
/** A schedule every result of which is on a day that has not happened: invented. */
const AHEAD = "gcAHEAD00001";
const schedules = new Map<string, GcTeamSchedule>([
  [ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)])],
  [BEARS, schedule(BEARS, "Bears", [game("b1", "Aces", 3, 5)])],
  [
    AHEAD,
    schedule(AHEAD, "Ahead", [
      { ...game("f1", "Aces", 9, 0), date: "2020-06-01", startTs: "2020-06-01T15:00:00.000Z" },
    ]),
  ],
]);

/** Answers from the schedules above, as `fetchGcTeams` gives them, each told as it comes. */
const answering =
  (before?: () => Promise<void>): CloudPullDeps["fetchTeams"] =>
  async (ids: string[], options: FetchGcTeamsOptions) => {
    await before?.();
    const answers = new Map<string, GcTeamResponse>();
    ids.forEach((teamId, at) => {
      const found = schedules.get(teamId);
      const result: GcTeamResponse = found
        ? { ok: true, schedule: found }
        : { ok: false, reason: "not-found", message: "No such team." };
      answers.set(teamId, result);
      options.onProgress?.({ done: at + 1, total: ids.length, teamId, result, attempts: 1 });
    });
    return answers;
  };

const LEAGUE = { seasons: ["the league's own"] };

/**
 * A cloud copy saved by a phone: whatever `write` puts in its pool, and a League Standings part
 * nothing here may touch.
 */
const seed = async (cloud: MemoryCloud, write: () => void = () => undefined) => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveKeptApart(new Set(["gcX|gcY"]));
  write();
  await flushPoolWrites();
  const changes: Change[] = await Promise.all(
    cloudPoolKeys().map(async (key) => ({ key, value: await readCloudPoolValue(key), at: 1 }))
  );
  changes.push({ key: LEAGUE_PART, value: LEAGUE, at: 1 });
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes,
    device: "phone",
    now: "2026-09-28T12:00:00.000Z",
  });
  if (!saved.ok) throw new Error("seed");
  resetTeamRankingsStore();
  return saved.manifest;
};

const deps = (
  cloud: MemoryCloud,
  at: string,
  extra: Partial<CloudPullDeps> = {}
): CloudPullDeps => ({
  store: cloud.store,
  fetchTeams: answering(),
  now: () => new Date(at),
  device: "cloud-pull",
  ...extra,
});

const list = {
  kind: "list",
  entries: [{ teamId: ACES }, { teamId: BEARS }],
  seasonYears: [2027],
} as const;

describe("a pull run on the cloud copy", () => {
  it("files a pasted list into the copy and sends only the values it changed", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const result = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(result).toMatchObject({ end: "finished", asked: 2, answered: 2, failed: 0, filed: 2 });
    expect(result.version).toBe(before.version + 1);
    // The copy the store in memory now is: what was just saved.
    expect(result.manifest).toEqual(cloud.manifest());

    const after = cloud.manifest()!;
    const part = (key: string) => after.parts.find((entry) => entry.key === key);
    // League Standings and a pool value the pull did not change are the phone's still.
    expect(part(LEAGUE_PART)).toEqual(before.parts.find((entry) => entry.key === LEAGUE_PART));
    const kept = before.parts.find((entry) => entry.key === "league_forecast_gc_apart_v1")!;
    expect(part(kept.key)).toEqual(kept);
    expect(result.changed).not.toContain(LEAGUE_PART);
    expect(result.changed).not.toContain(kept.key);
    result.changed.forEach((key) => expect(part(key)?.by).toBe("cloud-pull"));

    // And the copy now holds the two clubs and their one game, tidied and stamped.
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(
      loadScoutTeams().flatMap((team) => team.gcTeams?.map((link) => link.teamId) ?? [])
    ).toEqual(expect.arrayContaining([ACES, BEARS]));
    expect(loadScoutGames()).toHaveLength(1);
    expect(loadTidyStamp()).toMatch(/^r\d+\|/);
  });

  it("leaves the copy as it was when a pull changes nothing in it", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const first = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const writes = cloud.costs.writes;
    const again = await runCloudPull(list, deps(cloud, "2026-09-29T14:00:00.000Z"));
    expect(again).toMatchObject({ end: "finished", changed: [], version: first.version });
    expect(cloud.costs.writes).toBe(writes);
    expect(again.manifest).toEqual(cloud.manifest());
  });

  it("names the copy it read when nothing is due", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud, () => saveDroppedClubs(new Set([ACES, BEARS])));
    const result = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(result).toMatchObject({ end: "nothing-due", asked: 0 });
    expect(result.manifest).toEqual(before);
  });

  it("never asks about a club the copy has thrown out", async () => {
    const cloud = memoryCloud();
    // The phone threw the Bears out; the list sent before it did still names them.
    await seed(cloud, () => saveDroppedClubs(new Set([BEARS])));
    const asked: string[][] = [];
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", {
        fetchTeams: async (ids, options) => {
          asked.push(ids);
          return answering()(ids, options);
        },
      })
    );
    expect(result.asked).toBe(1);
    expect(asked).toEqual([[ACES]]);
  });

  it("throws out a club whose every result is on a day that has not happened", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const invented = { kind: "list", entries: [{ teamId: AHEAD }], seasonYears: [2027] } as const;
    // On the run's own day, not the machine's: the result is dated after the one and long before
    // the other.
    const result = await runCloudPull(invented, deps(cloud, "2020-01-01T13:00:00.000Z"));
    expect(result.filed).toBe(0);
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadDroppedClubs()]).toEqual([AHEAD]);
  });

  it("tidies the whole pool, not only what it pulled", async () => {
    const cloud = memoryCloud();
    const ag9 = { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 };
    const pulledClub = (id: string, name: string, gcId: string) => ({
      id,
      name,
      state: "OH",
      gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9", ageLevel: 9 }],
    });
    // A stand-in of "Cubs" named by an Ohio club on a day the one pulled Cubs of Ohio played:
    // the tidy files it onto the club (`refileStandIns`).
    await seed(cloud, () => {
      saveAgeGroups([ag9]);
      saveScoutTeams([
        pulledClub("S-CUBS", "Cubs", "gcCUBS000001"),
        pulledClub("S-PULL", "Pullers", "gcPULLER0001"),
        { id: "S-CUBS2", name: "Cubs", nameOnly: true },
        { id: "S-DUKES", name: "Dukes", nameOnly: true },
      ]);
      saveScoutGames([
        {
          id: "gc_gcCUBS000001_c1",
          teamAId: "S-CUBS",
          teamBId: "S-DUKES",
          teamAScore: 4,
          teamBScore: 1,
          ageGroupId: "ag9",
          date: "2026-09-20",
          source: { kind: "gamechanger", teamId: "gcCUBS000001", gameId: "c1" },
        },
        {
          id: "gc_gcPULLER0001_p1",
          teamAId: "S-PULL",
          teamBId: "S-CUBS2",
          teamAScore: 2,
          teamBScore: 6,
          ageGroupId: "ag9",
          date: "2026-09-21",
          source: { kind: "gamechanger", teamId: "gcPULLER0001", gameId: "p1" },
        },
      ]);
    });
    const aces = { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] } as const;
    await runCloudPull(aces, deps(cloud, "2026-09-29T13:00:00.000Z"));
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadScoutGames().find((entry) => entry.id === "gc_gcPULLER0001_p1")?.teamBId).toBe(
      "S-CUBS"
    );
  });

  it("files a list in the squad years it was sent for and no other", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const lastYear = { ...list, seasonYears: [2026] };
    const result = await runCloudPull(lastYear, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(result).toMatchObject({ answered: 2, filed: 0 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadScoutGames()).toEqual([]);
  });

  it("pulls the teams due today, and logs the day only once every one was asked", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    // Three days on, the rota is both clubs, pulled again and the day logged.
    const day = "2026-10-02T07:17:00.000Z";
    const asked: string[][] = [];
    const rota = await runCloudPull(
      { kind: "rota" },
      deps(cloud, day, {
        fetchTeams: async (ids, options) => {
          asked.push([...ids].sort());
          return answering()(ids, options);
        },
      })
    );
    expect(asked).toEqual([[ACES, BEARS]]);
    expect(rota.end).toBe("finished");
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()["9"]).toBe(localDayKey(new Date(day)));

    // Refused half way the next day: what came is kept, and the day is not logged.
    const next = "2026-10-03T07:17:00.000Z";
    const refused = await runCloudPull(
      { kind: "rota" },
      deps(cloud, next, {
        fetchTeams: async (ids, options) => {
          options.onRefused?.(3);
          return answering()(ids.slice(0, 1), options);
        },
      })
    );
    expect(refused.end).toBe("gave-up");
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()["9"]).toBe(localDayKey(new Date(day)));
  });

  it("pulls only the first teams due on a trial run, and leaves the day unlogged", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const day = "2026-10-02T07:17:00.000Z";
    const asked: string[][] = [];
    const trial = await runCloudPull(
      { kind: "rota", limit: 1 },
      deps(cloud, day, {
        fetchTeams: async (ids, options) => {
          asked.push(ids);
          return answering()(ids, options);
        },
      })
    );
    expect(asked.map((ids) => ids.length)).toEqual([1]);
    expect(trial).toMatchObject({ end: "finished", asked: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()["9"]).toBeUndefined();
  });

  it("keeps what it replaced as an earlier version any device can bring back, when asked to", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const first = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    expect(cloud.manifest()?.kept).toEqual([]);
    const before = cloud.manifest()!;
    // The next night's run changes the games and the teams, and keeps what they were.
    schedules.set(
      ACES,
      schedule(ACES, "Aces", [game("a1", "Bears", 5, 3), game("a2", "Cubs", 1, 2)])
    );
    try {
      const again = await runCloudPull(
        list,
        deps(cloud, "2026-09-30T07:17:00.000Z", { keep: true })
      );
      expect(again.version).toBe((first.version ?? 0) + 1);
    } finally {
      schedules.set(ACES, schedule(ACES, "Aces", [game("a1", "Bears", 5, 3)]));
    }
    const kept = cloud.manifest()!.kept;
    expect(kept.length).toBeGreaterThan(0);
    kept.forEach((part) => {
      expect(part.why).toBe("replaced");
      // The very value the copy held before, pieces and all.
      expect(before.parts.find((entry) => entry.key === part.key)?.hash).toBe(part.hash);
    });
    expect(new Set(kept.map((part) => part.group)).size).toBe(1);
  });

  it("files the same answers onto a copy another device saved meanwhile, keeping its change", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    // While GameChanger answers, the phone throws the Bears out.
    const phoneSaves = async () => {
      const current = cloud.manifest()!;
      const saved = await commitChanges({
        store: cloud.store,
        base: current,
        changes: [{ key: "league_forecast_gc_dropped_clubs_v1", value: [BEARS], at: 2 }],
        device: "phone",
        now: "2026-09-29T13:00:30.000Z",
      });
      if (!saved.ok) throw new Error("phone");
    };
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", { fetchTeams: answering(phoneSaves) })
    );
    expect(result).toMatchObject({ end: "finished", replays: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    // The phone's change stands, and the pull honoured it: the Bears were not filed.
    expect([...loadDroppedClubs()]).toEqual([BEARS]);
    const pulled = loadScoutTeams().flatMap(
      (team) => team.gcTeams?.map((link) => link.teamId) ?? []
    );
    expect(pulled).toContain(ACES);
    expect(pulled).not.toContain(BEARS);
    expect(cloud.manifest()?.version).toBe(result.version);
  });

  it("files nothing into a copy deleted and started again while it fetched", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    let fresh: CloudManifest | null = null;
    // While GameChanger answers, the copy is deleted and somebody starts a new one.
    const startAgain = async () => {
      cloud.setManifest(null);
      const saved = await commitChanges({
        store: cloud.store,
        base: null,
        changes: [{ key: LEAGUE_PART, value: { seasons: ["a fresh start"] }, at: 3 }],
        device: "laptop",
        now: "2026-09-29T13:00:30.000Z",
      });
      if (!saved.ok) throw new Error("start again");
      fresh = saved.manifest;
    };
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:01:00.000Z", { fetchTeams: answering(startAgain) })
    );
    expect(result).toMatchObject({ end: "copy-replaced", changed: [] });
    expect(result.manifest).toBeUndefined();
    expect(cloud.manifest()).toEqual(fresh);
  });

  it("gives up on a copy that keeps moving, writing nothing and leaving no pieces behind", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const pieces = cloud.chunks.size;
    const moving = { ...cloud.store, commitManifest: async () => false };
    const result = await runCloudPull(list, {
      ...deps(cloud, "2026-09-29T13:00:00.000Z"),
      store: moving,
    });
    expect(result).toMatchObject({ end: "copy-kept-changing", changed: [] });
    expect(result.manifest).toBeUndefined();
    expect(cloud.manifest()).toEqual(before);
    expect(cloud.chunks.size).toBe(pieces);
  });

  it("leaves alone a copy saved by a newer build or tidied by newer rules, asking nothing", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const fetchTeams = vi.fn(answering());
    cloud.setManifest({ ...before, schema: DATA_SCHEMA + 1 });
    const newer = await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams }));
    expect(newer.end).toBe("newer-copy");
    expect(newer.manifest).toBeUndefined();

    const other = memoryCloud();
    await seed(other, () => saveTidyStamp("r999|0|0|0|"));
    const rules = await runCloudPull(list, deps(other, "2026-09-29T13:00:00.000Z", { fetchTeams }));
    expect(rules.end).toBe("newer-copy");
    expect(fetchTeams).not.toHaveBeenCalled();
  });

  it("says so when there is no copy, and refuses one holding a key this build does not keep", async () => {
    const empty = memoryCloud();
    const none = await runCloudPull(list, deps(empty, "2026-09-29T13:00:00.000Z"));
    expect(none.end).toBe("no-copy");
    expect(none.manifest).toBeUndefined();

    const cloud = memoryCloud();
    const before = await seed(cloud);
    const unknown = await commitChanges({
      store: cloud.store,
      base: before,
      changes: [{ key: "league_forecast_from_the_future_v9", value: 1, at: 3 }],
      device: "phone",
      now: "2026-09-29T12:00:00.000Z",
    });
    expect(unknown.ok).toBe(true);
    await expect(runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"))).rejects.toThrow(
      /pool key this build does not keep/
    );
  });
});
