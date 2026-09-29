import { beforeEach, describe, expect, it, vi } from "vitest";
import { withListed, type GcTeamSchedule } from "../gameChangerApi";
import type { GcImportOutcome } from "../gameChangerImport";
import { persistPool } from "../poolPersist";
import { settleRunLists } from "../pullLists";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import {
  initTeamRankingsStore,
  loadAgeUnknown,
  loadRefusedClubs,
  loadScoutGames,
  loadScoutTeams,
  loadTooYoungClubs,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveTooYoungClubs,
  type PoolStoreIo,
} from "../teamRankingsStorage";

/*
 * What a pull in the browser and a pull run in the cloud share, so that neither can file a team,
 * save a pool or keep a list the other way: `persistPool`, `withListed` and `settleRunLists`.
 */

const backing = new Map<string, string>();
beforeEach(async () => {
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
  const store = new Map<string, unknown>();
  const io: PoolStoreIo = {
    keys: async () => [...store.keys()],
    get: async (key) => store.get(key) ?? null,
    set: async (key, value) => {
      store.set(key, value);
      return true;
    },
    readLocal: () => null,
    clearLocal: () => {},
  };
  await initTeamRankingsStore(io);
});

const groups: AgeGroup[] = [
  { id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "u9old", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
];
const teams: ScoutTeam[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
];
const game = (id: string, ageGroupId: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: "A",
  teamBId: "B",
  teamAScore: 5,
  teamBScore: 3,
  date: "2026-09-12",
});
const ids = (games: ScoutGame[]) => games.map((entry) => entry.id).sort();

describe("persistPool", () => {
  it("saves the whole pool, and a year the pool it is given has none of is a refusal", () => {
    saveAgeGroups(groups);
    saveScoutGames([game("old", "u9old"), game("a", "u9")]);
    const kept = persistPool({ ageGroups: groups, teams, games: [game("b", "u9")] }, undefined);
    // 2026 had games and the pool handed in has none there: spared, not emptied, and refused.
    expect(kept).toEqual({ saved: false, spared: [2026] });
    expect(ids(loadScoutGames())).toEqual(["b", "old"]);
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["A", "B"]);
    const whole = persistPool(
      { ageGroups: groups, teams, games: [game("old", "u9old"), game("b", "u9")] },
      undefined
    );
    expect(whole).toEqual({ saved: true, spared: [] });
  });

  it("replaces only the pages a section holds, leaving the rest of their year", () => {
    saveAgeGroups(groups);
    saveScoutGames([game("a9", "u9"), game("a10", "u10")]);
    const saved = persistPool(
      { ageGroups: groups, teams, games: [game("b9", "u9")] },
      {
        kind: "pages",
        ageGroupIds: ["u9"],
      }
    );
    expect(saved).toEqual({ saved: true, spared: [] });
    expect(ids(loadScoutGames())).toEqual(["a10", "b9"]);
  });

  it("lays a section of ids nobody had pulled over the pool by id, replacing nothing", () => {
    saveAgeGroups(groups);
    saveScoutGames([game("a9", "u9"), game("a10", "u10")]);
    const saved = persistPool(
      { ageGroups: groups, teams, games: [game("b9", "u9")] },
      { kind: "additions" }
    );
    expect(saved).toEqual({ saved: true, spared: [] });
    expect(ids(loadScoutGames())).toEqual(["a10", "a9", "b9"]);
  });
});

describe("withListed", () => {
  const schedule: GcTeamSchedule = {
    profile: { id: "gcACES000001", name: "Aces 9U", season: { season: "fall", year: 2026 } },
    games: [],
    fetchedAt: "2026-09-29T12:00:00.000Z",
  };

  it("leaves a schedule the list says nothing about as it came", () => {
    expect(withListed(schedule, undefined, undefined)).toBe(schedule);
    expect(withListed(schedule, { teamId: "gcACES000001", name: "Aces" }, undefined)).toBe(
      schedule
    );
  });

  it("carries the list's staff and roster size, and the age its league names first", () => {
    const listed = withListed(
      schedule,
      {
        teamId: "gcACES000001",
        staff: ["Coach One"],
        playerCount: 11,
        leagues: [{ name: "Metro 10U League" }],
        org: { name: "Aces 12U Organization" },
      },
      9
    );
    expect(listed.listed).toEqual({ staff: ["Coach One"], playerCount: 11, ageLevel: 10 });
    expect(listed.profile).toBe(schedule.profile);
  });

  it("falls back to the organization's name, then to the Organizations file's age", () => {
    const byOrg = withListed(schedule, { teamId: "x", org: { name: "GLL 8u Fall 2026" } }, 11);
    expect(byOrg.listed).toEqual({ ageLevel: 8 });
    // A tournament's name says nothing of its teams' age, so the file answers.
    const byFile = withListed(schedule, { teamId: "x", org: { name: "Fall Classic 8U" } }, 11);
    expect(byFile.listed).toEqual({ ageLevel: 11 });
    expect(withListed(schedule, undefined, 12).listed).toEqual({ ageLevel: 12 });
  });
});

describe("settleRunLists", () => {
  const NOW = "2026-09-29T12:00:00.000Z";
  const outcome = (gcTeamId: string, extra: Partial<GcImportOutcome> = {}): GcImportOutcome => ({
    gcTeamId,
    teamName: `Team ${gcTeamId}`,
    teamId: "pool-1",
    ageGroupId: "u9",
    ageGroupName: "9U 2027",
    createdAgeGroup: false,
    createdTeam: false,
    gamesAdded: 0,
    gamesUpdated: 0,
    gamesUnchanged: 0,
    gamesIgnored: 0,
    gamesOutOfSeason: 0,
    opponentsCreated: 0,
    opponentsMatchedByAvatar: 0,
    opponentsMatchedByName: 0,
    ...extra,
  });

  it("writes the waiting list, the refusals and the too-young, and names the invented", () => {
    const lists = settleRunLists(
      [
        outcome("NoAgeYet0001", { skip: "no-age", issue: "no age" }),
        outcome("HighSchool01", { skip: "high-school" }),
        outcome("TooYoung0001", { skip: "below-min-age" }),
        outcome("Invented0001", { skip: "invented" }),
        outcome("Filed0000001"),
      ],
      NOW
    );
    expect(lists.agelessSaved).toBe(true);
    expect(lists.ageless.map((entry) => entry.teamId)).toEqual(["NoAgeYet0001"]);
    expect(loadAgeUnknown()).toEqual(lists.ageless);
    expect(lists.refused?.forGood.has("HighSchool01")).toBe(true);
    expect(loadRefusedClubs().forGood.has("HighSchool01")).toBe(true);
    expect([...(lists.tooYoung ?? [])]).toEqual(["TooYoung0001"]);
    expect([...loadTooYoungClubs()]).toEqual(["TooYoung0001"]);
    expect(lists.invented).toEqual(["Invented0001"]);
  });

  it("names no new refusals or too-young where the run learned none", () => {
    saveTooYoungClubs(new Set(["TooYoung0001"]));
    const lists = settleRunLists([outcome("Filed0000001")], NOW);
    expect(lists.refused).toBeUndefined();
    expect(lists.tooYoung).toBeUndefined();
    expect(lists.invented).toEqual([]);
    expect([...loadTooYoungClubs()]).toEqual(["TooYoung0001"]);
  });
});
