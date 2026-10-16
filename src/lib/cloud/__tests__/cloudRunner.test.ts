import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamResponse, GcTeamSchedule } from "../../gameChangerApi";
import type { FetchGcTeamsOptions } from "../../gameChangerClient";
import { localDayKey } from "../../gameChangerSchedule";
import {
  cloudPoolKeys,
  flushPoolWrites,
  initTeamRankingsStore,
  loadAutoRemoved,
  loadDroppedClubs,
  loadRefreshLog,
  loadRefusedClubs,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveDroppedClubs,
  saveKeptApart,
  saveRefreshCadence,
  saveRealClubs,
  saveRefreshLog,
  saveRefusedClubs,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
  saveTooYoungClubs,
} from "../../teamRankingsStorage";
import { commitChanges, type Change } from "../cloudEngine";
import { DATA_SCHEMA } from "../cloudManifest";
import { LEAGUE_PART } from "../cloudPlan";
import type { CloudManifest } from "../cloudManifest";
import {
  loadPoolFrom,
  memoryIo,
  runCloudPull,
  selectImportTeams,
  finishStagedImport,
  workOutRefresh,
  type CloudPullDeps,
  type CloudPullJob,
} from "../cloudRunner";
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
  it("reconsiders an unaged club after all its opponents arrive, before the single final tidy", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const unknown = schedule("gcUNAGED0001", "Unaged", [
      game("u1", "Alpha", 3, 2),
      { ...game("u2", "Bravo", 3, 2), date: "2026-09-21" },
      { ...game("u3", "Charlie", 3, 2), date: "2026-09-22" },
    ]);
    unknown.profile.name = "Unaged";
    delete unknown.profile.ageLevel;
    const anchors = ["Alpha", "Bravo", "Charlie"].map((name, n) =>
      schedule(`gcANCHOR000${n}`, name, [
        { ...game(`a${n}`, "Unaged", 2, 3), date: `2026-09-${20 + n}` },
      ])
    );
    let tidies = 0;
    const selections: (string[] | undefined)[] = [];
    let consumed = 0;
    const source = (ids?: ReadonlySet<string>) =>
      (async function* () {
        selections.push(ids ? [...ids] : undefined);
        for (const schedule of [unknown, ...anchors]) {
          if (ids && !ids.has(schedule.profile.id)) continue;
          consumed++;
          yield schedule;
        }
      })();
    const result = await finishStagedImport(
      {
        kind: "list",
        entries: [unknown, ...anchors].map((s) => ({ teamId: s.profile.id })),
        seasonYears: [2027],
      },
      source,
      base.copy,
      { asked: 4, answered: 4, failed: 0 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00Z"),
        device: "test",
        beforeTidy: async () => {
          tidies++;
        },
      }
    );
    expect(result.filed).toBe(4);
    expect(
      loadScoutTeams().some((t) => t.gcTeams?.some((link) => link.teamId === unknown.profile.id))
    ).toBe(true);
    expect(tidies).toBe(1);
    expect(selections).toEqual([undefined]);
    expect(consumed).toBe(4);
  });
  it("rereads only uncached unresolved teams when an import exceeds the age cache", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const unknown = Array.from({ length: 2001 }, (_, n) => {
      const letters = [Math.floor(n / 676), Math.floor(n / 26) % 26, n % 26]
        .map((letter) => String.fromCharCode(65 + letter))
        .join("");
      const team = schedule(`gc${String(n).padStart(10, "0")}`, `Unaged Club ${letters}`, [
        game(`u${n}`, "Unknown rival", 3, 2),
      ]);
      team.profile.name = `Unaged Club ${letters}`;
      delete team.profile.ageLevel;
      return team;
    });
    const selections: (string[] | undefined)[] = [];
    const source = (ids?: ReadonlySet<string>) =>
      (async function* () {
        selections.push(ids ? [...ids] : undefined);
        for (const team of unknown) if (!ids || ids.has(team.profile.id)) yield team;
      })();
    let tidies = 0;
    const result = await finishStagedImport(
      {
        kind: "list",
        entries: unknown.map((team) => ({ teamId: team.profile.id })),
        seasonYears: [2027],
      },
      source,
      base.copy,
      { asked: 2001, answered: 2001, failed: 0 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00Z"),
        device: "test",
        beforeTidy: async () => {
          tidies++;
        },
      }
    );
    expect(result.end).toBe("finished");
    expect(result.filed).toBe(0);
    expect(selections).toEqual([undefined, [unknown[2000]!.profile.id]]);
    expect(tidies).toBe(1);
  });
  it("selects from the team index without downloading games, in a stable import order", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () =>
      saveScoutGames([
        {
          id: "untouched",
          teamAId: "x",
          teamBId: "y",
          ageGroupId: "9",
          date: "2026-09-20",
          teamAScore: 1,
          teamBScore: 2,
        },
      ])
    );
    const chunkReads = vi.spyOn(cloud.store, "getChunk");
    const selected = await selectImportTeams(cloud.store, {
      ...list,
      entries: [...list.entries].reverse(),
    });
    expect(selected.entries.map((e) => e.teamId)).toEqual(
      [...list.entries].map((e) => e.teamId).sort()
    );
    const gameParts = cloud.manifest()!.parts.filter((p) => p.key.includes("scout_games"));
    for (const part of gameParts)
      expect(chunkReads.mock.calls.every(([id]) => !id.startsWith(part.id))).toBe(true);
  });

  it("streams the entire downloaded set through one final tidy and one save, without fetching teams again", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const commit = vi.spyOn(cloud.store, "commitManifest");
    let tidyCalls = 0;
    let consumed = 0;
    const source = () =>
      (async function* () {
        consumed++;
        yield schedules.get(ACES)!;
        consumed++;
        yield schedules.get(BEARS)!;
      })();
    const result = await finishStagedImport(
      list,
      source,
      base.copy,
      { asked: 2, answered: 2, failed: 0 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00.000Z"),
        device: "import-test",
        beforeTidy: async () => {
          tidyCalls++;
          expect(consumed).toBe(2);
        },
      }
    );
    expect(result.end).toBe("finished");
    expect(result.filed).toBe(2);
    expect(tidyCalls).toBe(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(loadScoutGames()).toHaveLength(1);
    expect(loadTidyStamp()).toBeTruthy();
  });
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

  it("pulls a paste's teams the pool lacks, a catch-up's every one, and none refused or too young", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    await runCloudPull(
      { kind: "list", entries: [{ teamId: ACES }], seasonYears: [2027] },
      deps(cloud, "2026-09-29T13:00:00.000Z")
    );
    // A paste with one team the pool has and one it lacks asks only for the one it lacks.
    const paste = await runCloudPull(list, deps(cloud, "2026-09-29T14:00:00.000Z"));
    expect(paste.asked).toBe(1);
    // Past a handful, a paste asks only for what the pool lacks, and a catch-up for every one.
    const many = {
      ...list,
      entries: [
        ...list.entries,
        ...Array.from({ length: 24 }, (_, at) => ({
          teamId: `gcNONE${String(at).padStart(6, "0")}`,
        })),
      ],
    };
    expect((await runCloudPull(many, deps(cloud, "2026-09-29T15:00:00.000Z"))).asked).toBe(24);
    const catchUp = await runCloudPull(
      { ...many, refresh: true },
      deps(cloud, "2026-09-29T16:00:00.000Z")
    );
    expect(catchUp.asked).toBe(26);
    // Refused for good, or too young to rank, costs no request, as on the device.
    const refused = memoryCloud();
    await seed(refused, () => {
      saveRefusedClubs({ forGood: new Set([ACES]), bySeason: new Map() });
      saveTooYoungClubs(new Set([BEARS]));
    });
    const none = await runCloudPull(
      { ...list, refresh: true },
      deps(refused, "2026-09-29T13:00:00.000Z")
    );
    expect(none).toMatchObject({ asked: 0, end: "nothing-due" });
  });

  /*
   * A pasted list's slugs and names, which GameChanger answers with HTTP 400 (`invalid-id`), were
   * asked about again on every paste of the list. Remembered with the clubs refused for good, a
   * paste asks about them once.
   */
  it("remembers the ids GameChanger said are not team ids, so a paste does not ask again", async () => {
    const cloud = memoryCloud();
    await seed(cloud);
    const slug = "bears-baseball-10u";
    const asked: string[][] = [];
    const fetchTeams: CloudPullDeps["fetchTeams"] = async (ids, options) => {
      asked.push([...ids]);
      const answers = new Map<string, GcTeamResponse>();
      for (const teamId of ids) {
        const found = schedules.get(teamId);
        const result: GcTeamResponse = found
          ? { ok: true, schedule: found }
          : { ok: false, reason: "invalid-id", message: "Not a team id." };
        answers.set(teamId, result);
        options.onProgress?.({ done: 1, total: ids.length, teamId, result, attempts: 1 });
      }
      return answers;
    };
    const paste = { kind: "list", entries: [{ teamId: ACES }, { teamId: slug }], seasonYears: [] };
    const first = await runCloudPull(
      paste as CloudPullJob,
      deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams })
    );
    expect(first).toMatchObject({ asked: 2, answered: 1, failed: 1 });
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadRefusedClubs().forGood]).toEqual([slug]);
    // Pasted again: the slug costs no request; the one club, a handful, is read again.
    await runCloudPull(
      paste as CloudPullJob,
      deps(cloud, "2026-09-29T14:00:00.000Z", { fetchTeams })
    );
    expect(asked).toEqual([[ACES, slug], [ACES]]);
  });

  it("remembers them from a staged import's final phase too", async () => {
    const cloud = memoryCloud();
    const base = await seed(cloud);
    const source = () =>
      (async function* () {
        yield schedules.get(ACES)!;
      })();
    await finishStagedImport(
      list,
      source,
      base.copy,
      { asked: 2, answered: 1, failed: 1 },
      {
        store: cloud.store,
        now: () => new Date("2026-09-29T13:00:00.000Z"),
        device: "import-test",
        invalidIds: ["bears-baseball-10u"],
      }
    );
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect([...loadRefusedClubs().forGood]).toEqual(["bears-baseball-10u"]);
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

  /*
   * The sweep for clubs plainly made up (`obviousFakes.ts`) runs on the copy after a refresh's tidy,
   * the nightly's or a leg of Refresh now's, and on one with nothing left to pull, its marks saved in
   * the run's one commit. A list's legs never sweep, a paste's or a catch-up's, nor does a list with
   * nothing due: every list leg is kept as light as it can be, and the nightly sweeps what they filed
   * that night.
   */
  describe("the sweep for clubs plainly made up", () => {
    const MARKS = "league_forecast_gc_auto_removed_v1";
    const ROUTER = "gcROUTER0001";
    // Two wins by 40 over clubs nobody pulled, at 9U: sign A at any age.
    const routs = schedule(ROUTER, "Router", [
      game("r1", "Owls", 40, 0),
      { ...game("r2", "Hawks", 41, 0), id: "r2", date: "2026-09-21" },
    ]);
    const routerAnswers = async (ids: string[]) =>
      new Map(ids.map((id) => [id, { ok: true, schedule: routs } as GcTeamResponse]));
    const demo = (gcId: string) => () =>
      saveScoutTeams([
        {
          id: "S-DEMO",
          name: "Demo Squad",
          gcTeams: [{ teamId: gcId, name: "Demo Squad", ageGroupId: "ag_9u_2027", ageLevel: 9 }],
        },
      ]);
    /** A leg of Refresh now, these teams its share. */
    const leg = (teamIds: string[]): CloudPullJob => ({
      kind: "rota",
      walk: {
        teamIds,
        ageLevels: [9, 12],
        markOn: null,
        workedAt: new Date("2026-09-29T12:00:00.000Z"),
      },
    });
    const marksInCopy = async (cloud: MemoryCloud) => {
      resetTeamRankingsStore();
      await loadPoolFrom(cloud.store);
      return loadAutoRemoved();
    };

    it("marks a club a refresh filed with two routs no loser's schedule lists, in the same commit", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud);
      const result = await runCloudPull(
        leg([ROUTER]),
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: routerAnswers })
      );
      expect(result).toMatchObject({ end: "finished", filed: 1 });
      expect(result.version).toBe(before.version + 1);
      expect(result.changed).toEqual(
        expect.arrayContaining([MARKS, "league_forecast_scout_teams_v1"])
      );
      expect((await marksInCopy(cloud)).get(ROUTER)?.signs).toEqual(["wins"]);
    });

    /*
     * Both kinds of list leg the page sends: a paste, and a catch-up (`refresh`) such as "Ask again
     * about teams nobody could age" or "Check short rosters again", which asks about every team on
     * it and still is a list, not a refresh of the pool.
     */
    const lists = [
      ["pasted list", {}],
      ["catch-up list", { refresh: true }],
    ] as const;

    it.each(lists)("files a %s's leg without sweeping it", async (_, kind) => {
      const cloud = memoryCloud();
      const before = await seed(cloud);
      const result = await runCloudPull(
        { kind: "list", entries: [{ teamId: ROUTER }], seasonYears: [2027], ...kind },
        deps(cloud, "2026-09-29T13:00:00.000Z", { fetchTeams: routerAnswers })
      );
      expect(result).toMatchObject({ end: "finished", filed: 1 });
      expect(result.version).toBe(before.version + 1);
      expect(result.changed).toContain("league_forecast_scout_teams_v1");
      expect(result.changed).not.toContain(MARKS);
      expect((await marksInCopy(cloud)).size).toBe(0);
      // The next refresh sweeps what the list filed, though it has nothing left to pull.
      const night = await runCloudPull(leg([]), deps(cloud, "2026-09-30T07:17:00.000Z"));
      expect(night).toMatchObject({ end: "finished", asked: 0, changed: [MARKS] });
      expect((await marksInCopy(cloud)).get(ROUTER)?.signs).toEqual(["wins"]);
    });

    it("commits only the marks on a refresh with nothing left to pull", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud, () => {
        saveDroppedClubs(new Set([ACES, BEARS]));
        demo("gcDEMO000001")();
      });
      const result = await runCloudPull(
        leg([ACES, BEARS]),
        deps(cloud, "2026-09-29T13:00:00.000Z")
      );
      expect(result).toMatchObject({ end: "finished", asked: 0, changed: [MARKS] });
      expect(result.version).toBe(before.version + 1);
      expect(result.manifest).toEqual(cloud.manifest());
      expect([...(await marksInCopy(cloud)).keys()]).toEqual(["gcDEMO000001"]);
      // And the next night, with nothing new, writes nothing.
      const again = await runCloudPull(leg([ACES, BEARS]), deps(cloud, "2026-09-30T13:00:00.000Z"));
      expect(again).toMatchObject({ end: "finished", changed: [], version: result.version });
    });

    it("sweeps on a nightly with nothing due", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud, () => {
        saveDroppedClubs(new Set([ACES, BEARS, "gcDEMO000001"]));
        demo("gcDEMO000001")();
      });
      const result = await runCloudPull({ kind: "rota" }, deps(cloud, "2026-09-29T13:00:00.000Z"));
      expect(result).toMatchObject({ end: "nothing-due", asked: 0, changed: [MARKS] });
      expect(result.version).toBe(before.version + 1);
    });

    it.each(lists)(
      "writes nothing for a %s with nothing due, whatever the copy holds",
      async (_, kind) => {
        const cloud = memoryCloud();
        const before = await seed(cloud, () => {
          saveDroppedClubs(new Set([ACES, BEARS]));
          demo("gcDEMO000001")();
        });
        const writes = cloud.costs.writes;
        const result = await runCloudPull(
          { ...list, ...kind },
          deps(cloud, "2026-09-29T13:00:00.000Z")
        );
        expect(result).toMatchObject({ end: "nothing-due", asked: 0, changed: [] });
        expect(result.manifest).toEqual(before);
        expect(cloud.manifest()).toEqual(before);
        expect(cloud.costs.writes).toBe(writes);
        expect((await marksInCopy(cloud)).size).toBe(0);
      }
    );

    it("never marks a club said to be real", async () => {
      const cloud = memoryCloud();
      const before = await seed(cloud, () => {
        saveDroppedClubs(new Set([ACES, BEARS]));
        demo("gcDEMO000001")();
        saveRealClubs(new Set(["gcDEMO000001"]));
      });
      const result = await runCloudPull(
        leg([ACES, BEARS]),
        deps(cloud, "2026-09-29T13:00:00.000Z")
      );
      expect(result).toMatchObject({ end: "finished", changed: [] });
      expect(result.manifest).toEqual(before);
    });
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

  it("walks a refresh's teams as worked out at its start, and logs its levels only from its last leg", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const day = "2026-10-02T07:17:00.000Z";
    const asked: string[][] = [];
    const asking = (extra: Partial<CloudPullDeps> = {}) =>
      deps(cloud, day, {
        fetchTeams: async (ids, options) => {
          asked.push([...ids]);
          return answering()(ids, options);
        },
        ...extra,
      });
    const logged = async () => {
      resetTeamRankingsStore();
      await loadPoolFrom(cloud.store);
      const log = loadRefreshLog();
      resetTeamRankingsStore();
      return log;
    };
    // Worked out the day before the legs run.
    const workedOut = new Date("2026-10-01T15:00:00.000Z");
    // A leg before the last: its share of the list, worked out afresh by nothing, and no level
    // logged, whatever the rota would say now.
    const first = await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [BEARS], ageLevels: [9], markOn: null, workedAt: workedOut },
      },
      asking()
    );
    expect(first).toMatchObject({ end: "finished", asked: 1 });
    expect(asked).toEqual([[BEARS]]);
    expect((await logged())["9"]).toBeUndefined();

    // The last leg: its share, and the levels logged on the day the refresh was worked out for,
    // here the day before the leg runs.
    await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [ACES], ageLevels: [9], markOn: workedOut, workedAt: workedOut },
      },
      asking()
    );
    expect(asked).toEqual([[BEARS], [ACES]]);
    expect((await logged())["9"]).toBe(localDayKey(workedOut));

    // A last leg that did not ask about every team logs nothing.
    const refusing = await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [ACES, BEARS], ageLevels: [10], markOn: workedOut, workedAt: workedOut },
      },
      asking({
        fetchTeams: async (ids, options) => {
          options.onRefused?.(3);
          return answering()(ids.slice(0, 1), options);
        },
      })
    );
    expect(refusing.end).toBe("gave-up");
    expect((await logged())["10"]).toBeUndefined();
  });

  it("never logs a level back to an earlier day than the log already has it", async () => {
    const cloud = memoryCloud();
    const later = new Date("2026-10-03T15:00:00.000Z");
    await seed(cloud, () => {
      saveRefreshCadence("daily");
      saveRefreshLog({ "9": localDayKey(later) });
    });
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    // A refresh worked out the day before the nightly logged 9U ends after it did.
    const workedOut = new Date("2026-10-02T15:00:00.000Z");
    await runCloudPull(
      {
        kind: "rota",
        walk: { teamIds: [ACES], ageLevels: [9, 10], markOn: workedOut, workedAt: workedOut },
      },
      deps(cloud, "2026-10-03T16:00:00.000Z")
    );
    resetTeamRankingsStore();
    await loadPoolFrom(cloud.store);
    expect(loadRefreshLog()).toMatchObject({
      "9": localDayKey(later),
      "10": localDayKey(workedOut),
    });
  });

  it("works out Refresh now's teams from the copy, or says why there are none to work out", async () => {
    const cloud = memoryCloud();
    await seed(cloud, () => saveRefreshCadence("daily"));
    await runCloudPull(list, deps(cloud, "2026-09-29T13:00:00.000Z"));
    const day = new Date("2026-10-02T07:17:00.000Z");
    const worked = await workOutRefresh(cloud.store, day);
    expect(worked).toMatchObject({ ok: true, again: false, heldBack: 0 });
    expect(worked.ok && [...worked.teamIds].sort()).toEqual([ACES, BEARS].sort());

    expect(await workOutRefresh(memoryCloud().store, day)).toEqual({
      ok: false,
      end: "no-copy",
    });
    const newer = memoryCloud();
    await seed(newer, () => saveTidyStamp("r999|0|0|0|"));
    expect(await workOutRefresh(newer.store, day)).toEqual({ ok: false, end: "newer-copy" });
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

  it("ends at once when stopped while it reads the copy, asking and saving nothing", async () => {
    const cloud = memoryCloud();
    // A copy of several values, so a read that went on past the stop would show.
    const before = await seed(cloud, () => {
      saveAgeGroups([{ id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 }]);
      saveScoutTeams([{ id: "S-ONE", name: "One" }]);
      saveScoutGames([
        {
          id: "g1",
          teamAId: "S-ONE",
          teamBId: "S-ONE",
          teamAScore: 1,
          teamBScore: 0,
          ageGroupId: "ag9",
          date: "2026-09-20",
        },
      ]);
    });
    expect(before.parts.filter((part) => part.key !== LEAGUE_PART).length).toBeGreaterThan(2);
    const stop = new AbortController();
    // The stop arrives as the copy's first value is being read.
    let reads = 0;
    const store = {
      ...cloud.store,
      getChunk: (id: string) => {
        reads += 1;
        stop.abort();
        return cloud.store.getChunk(id);
      },
    };
    const asked = vi.fn(answering());
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", { store, fetchTeams: asked, signal: stop.signal })
    );
    expect(result).toMatchObject({ end: "stopped", asked: 0, answered: 0, filed: 0, changed: [] });
    expect(asked).not.toHaveBeenCalled();
    // Only the value being read when the stop came was read: none after it.
    const first = before.parts.find((part) => part.key !== LEAGUE_PART)!;
    expect(reads).toBe(first.chunks);
    expect(cloud.manifest()).toEqual(before);
  });

  it("lays nothing into the pool store when stopped as the copy's last value is read", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud, () => saveScoutTeams([{ id: "S-ONE", name: "One" }]));
    const parts = before.parts.filter((part) => part.key !== LEAGUE_PART);
    const last = parts[parts.length - 1]!;
    const stop = new AbortController();
    const store = {
      ...cloud.store,
      getChunk: (id: string) => {
        if (id.startsWith(last.id)) stop.abort();
        return cloud.store.getChunk(id);
      },
    };
    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    expect(await loadPoolFrom(store, stop.signal)).toBeNull();
    expect(loadScoutTeams()).toEqual([]);
    // Unstopped, the same copy lays its club in.
    expect(await loadPoolFrom(cloud.store)).not.toBeNull();
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["S-ONE"]);
  });

  it("ends at once when stopped before any answer, without tidying or saving the pool", async () => {
    const cloud = memoryCloud();
    // A pool the tidy would change, so a tidy that ran would save.
    const before = await seed(cloud, () => {
      saveScoutGames([
        {
          id: "gc_gcACES000001_old",
          teamAId: "S-ONE",
          teamBId: "S-TWO",
          teamAScore: 1,
          teamBScore: 0,
          ageGroupId: "nowhere",
          date: "2099-01-01",
        },
      ]);
    });
    const stop = new AbortController();
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", {
        signal: stop.signal,
        fetchTeams: async () => {
          stop.abort();
          return new Map();
        },
      })
    );
    expect(result).toMatchObject({ end: "stopped", answered: 0, filed: 0, changed: [] });
    expect(result.version).toBe(before.version);
    expect(cloud.manifest()).toEqual(before);
  });

  it("still files and saves what it fetched before a stop", async () => {
    const cloud = memoryCloud();
    const before = await seed(cloud);
    const stop = new AbortController();
    const firstOnly: CloudPullDeps["fetchTeams"] = async (ids, options) => {
      const answers = await answering()(ids.slice(0, 1), options);
      stop.abort();
      return answers;
    };
    const result = await runCloudPull(
      list,
      deps(cloud, "2026-09-29T13:00:00.000Z", { signal: stop.signal, fetchTeams: firstOnly })
    );
    expect(result).toMatchObject({ end: "stopped", answered: 1, filed: 1 });
    expect(result.version).toBe(before.version + 1);
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
