import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GcGame, GcTeamSchedule } from "../gameChangerApi";
import { createGcImporter, tidyPool } from "../gameChangerImport";
import {
  buildScoutTeam,
  leagueScoutBridge,
  mergeScoutTeams,
  resolveOrCreateTeam,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";
import {
  coerceRetired,
  mergeRetired,
  mintedIds,
  NO_RETIRED,
  retireIds,
  storedRetired,
  withRetired,
  wasRetired,
} from "../teamRankings/retiredIds";
import { decodePoolTeams, encodeScoutTeams, retiredOfStored } from "../teamRankingsCompact";
import {
  coerceTeamRankingsBackup,
  parseTeamRankingsJson,
  readTeamRankingsBackup,
  teamRankingsJson,
  writeTeamRankingsBackup,
} from "../teamRankingsBackup";
import { deriveAllKnown, type LeagueSeasonData } from "../live/allKnown";
import {
  loadAgeGroups,
  loadRetiredIds,
  loadScoutGames,
  loadScoutTeams,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../teamRankingsStorage";

/*
 * A club's id freed by a fold or a deletion is never minted again (`retiredIds.ts`; README, "Which
 * club is which, answered once"): the pieces, the store and a backup, each mint. The server's own
 * runs of it are `clubIdsOnce.test.ts`. Placeholder names throughout.
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

const retired = (entries: [string, number][]) => new Map(entries);

describe("the high-water of the ids a pool let go of", () => {
  it("is each family's highest counter let go of, under the family its id reads as", () => {
    const after = new Set(["S-RIVE", "S-OAKH"]);
    expect(retireIds(NO_RETIRED, ["S-RIVE", "S-RIVE2", "S-RIVE4", "S-OAKH"], after)).toEqual(
      retired([["RIVE", 4]])
    );
    // An id no mint makes is no family's: a club made for a league team said to be elsewhere, or a
    // stand-in minted on the live page with letters after it.
    expect(retireIds(NO_RETIRED, ["S-off-A", "S-RIVE-lq3x9a", "LEAGUE"], after)).toBe(NO_RETIRED);
    // Nothing let go of: the very map it had, so a save that folds nothing writes what it had.
    const held = retired([["RIVE", 2]]);
    expect(retireIds(held, ["S-RIVE", "S-OAKH"], after)).toBe(held);
    expect(retireIds(held, ["S-RIVE2"], after)).toBe(held);
  });

  it("holds every counter at or under it, read every way a mint could have made the id", () => {
    const high = retired([["RIVE", 3]]);
    expect(["S-RIVE", "S-RIVE2", "S-RIVE3"].map((id) => wasRetired(high, id))).toEqual([
      true,
      true,
      true,
    ]);
    expect(wasRetired(high, "S-RIVE4")).toBe(false);
    expect(wasRetired(high, "S-OAKH")).toBe(false);
    // A name of three letters makes a family of three: RIV's second is the id RIV2's first is.
    const short = retireIds(NO_RETIRED, ["S-RIV2"], new Set());
    expect(wasRetired(short, "S-RIV2")).toBe(true);
    const mint = buildScoutTeam("Riv", withRetired(new Set(["S-RIV"]), short));
    expect(mint.id).toBe("S-RIV3");
  });

  it("merges two by each family's higher, and is stored and read back through the checks", () => {
    expect(
      mergeRetired(
        retired([["RIVE", 2]]),
        retired([
          ["RIVE", 5],
          ["OAKH", 1],
        ])
      )
    ).toEqual(
      retired([
        ["RIVE", 5],
        ["OAKH", 1],
      ])
    );
    expect(
      storedRetired(
        retired([
          ["RIVE", 2],
          ["OAKH", 1],
        ])
      )
    ).toEqual({ OAKH: 1, RIVE: 2 });
    expect(storedRetired(NO_RETIRED)).toBeUndefined();
    expect(coerceRetired({ RIVE: 2, rive: 3, TOOLONG: 1, OAKH: 0, ACES: 1.5, BEAR: "2" })).toEqual(
      retired([["RIVE", 2]])
    );
    expect(coerceRetired(["RIVE"])).toBe(NO_RETIRED);
  });

  it("rides in the roster's stored value, which is as it was for a pool that let none go", () => {
    const teams: ScoutTeam[] = [{ id: "S-RIVE", name: "Riverside Rays" }];
    expect(encodeScoutTeams(teams)).toEqual(encodeScoutTeams(teams, NO_RETIRED));
    expect(encodeScoutTeams(teams)).not.toHaveProperty("h");
    const stored = encodeScoutTeams(teams, retired([["RIVE", 2]]));
    expect(stored.h).toEqual({ RIVE: 2 });
    expect(retiredOfStored(JSON.parse(JSON.stringify(stored)))).toEqual(retired([["RIVE", 2]]));
    expect(decodePoolTeams(stored)).toEqual(teams);
    expect(retiredOfStored([{ id: "S-RIVE", name: "Riverside Rays" }])).toBe(NO_RETIRED);
  });
});

/* ------------------------------------------------------------------ the sweep's reproduction */

const AGE: AgeGroup = {
  id: "ag_9u_2027",
  name: "9U 2027",
  ageLevel: 9,
  year: 2027,
  seasonIds: ["season-x"],
};
const link = (teamId: string, name: string) => ({
  teamId,
  name,
  ageGroupId: AGE.id,
  season: "fall",
  seasonYear: 2026,
  ageLevel: 9,
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
const scheduleOf = (gcId: string, name: string, games: GcGame[]): GcTeamSchedule => ({
  profile: {
    id: gcId,
    name: `${name} 9U`,
    ageLevel: 9,
    season: { season: "fall", year: 2026 },
    state: "OH",
    city: "Cincinnati",
  },
  games,
  fetchedAt: "2026-09-29T07:20:00.000Z",
});

/** Riverside Rays, Riverside Rays Gold and Oak Hill Owls, minted in that order as a pull mints. */
const rosterOf = (): ScoutTeam[] => {
  const ids = new Set<string>();
  return [
    ["Riverside Rays", "gcRAYSFALL01"],
    ["Riverside Rays Gold", "gcRAYSGOLD01"],
    ["Oak Hill Owls", "gcOWLS000001"],
  ].map(([name, gcId]) => {
    const team = buildScoutTeam(name!, ids, {
      gcTeams: [link(gcId!, `${name} 9U`)],
      state: "OH",
    });
    ids.add(team.id);
    return team;
  });
};

const stored = () => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  games: loadScoutGames(),
});

/** The next pull files Oak Hill Owls' schedule, which names a club nobody has pulled. */
const nextPull = () => {
  const importer = createGcImporter(stored(), { retired: loadRetiredIds() });
  importer.add(
    scheduleOf("gcOWLS000001", "Oak Hill Owls", [game("o1", "Riverbend Robins", 0, 15)])
  );
  const robins = importer.state.teams.find((team) => team.name === "Riverbend Robins");
  if (!robins) throw new Error("the pull filed no Riverbend Robins");
  return { state: importer.state, robins };
};

/** The League Standings team that picked Riverside Rays Gold, as the bridge reads it. */
const bridgeOf = (state: { teams: ScoutTeam[]; games: ScoutGame[] }, pick: string) =>
  leagueScoutBridge(
    "season-x",
    [AGE],
    state.teams,
    state.games,
    [{ id: "RAYS", name: "Rays", scoutTeamId: pick }],
    []
  );

describe("a club let go of", () => {
  it("is not minted again after a fold, so a League pick of it reaches no other club", () => {
    const [rays, gold] = rosterOf();
    if (!rays || !gold) throw new Error("no roster");
    expect([rays.id, gold.id]).toEqual(["S-RIVE", "S-RIVE2"]);
    saveAgeGroups([AGE]);
    saveScoutTeams(rosterOf());
    saveScoutGames([]);
    // The owner keeps the pairing: the Gold squad is folded into the Rays.
    const merged = mergeScoutTeams(gold.id, rays.id, loadScoutTeams(), loadScoutGames(), [AGE]);
    saveScoutTeams(merged.teams);
    saveScoutGames(merged.games);
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["S-RIVE", "S-OAKH"]);

    const { state, robins } = nextPull();
    expect(robins).toMatchObject({ id: "S-RIVE3", nameOnly: true });
    // The pick names a club the pool no longer has, and is told so; the Robins' 15-0 is theirs.
    const bridge = bridgeOf(state, gold.id);
    expect(bridge.rows[0]).toMatchObject({ how: "none", staleScoutTeamId: "S-RIVE2" });
    expect(bridge.rows[0]?.suggestedName).not.toBe("Riverbend Robins");
    expect(bridge.results).toEqual([]);
  });

  it("is not minted again after a deletion", () => {
    saveAgeGroups([AGE]);
    saveScoutTeams(rosterOf());
    saveScoutGames([]);
    saveScoutTeams(loadScoutTeams().filter((team) => team.id !== "S-RIVE2"));
    const { state, robins } = nextPull();
    expect(robins.id).toBe("S-RIVE3");
    expect(bridgeOf(state, "S-RIVE2").results).toEqual([]);
  });

  it("is not minted again for a game typed in", () => {
    saveScoutTeams(rosterOf());
    saveScoutTeams(loadScoutTeams().filter((team) => team.id !== "S-RIVE2"));
    const typed = resolveOrCreateTeam(
      "Riverbend Robins",
      loadScoutTeams(),
      mintedIds(
        loadScoutTeams().map((team) => team.id),
        loadRetiredIds()
      )
    );
    expect(typed.teamId).toBe("S-RIVE3");
  });

  it("is not minted again by the tidy, nor later in the tidy that let it go", () => {
    // A stand-in named as a team's old page goes, and its games are kept against a slot apiece,
    // minted from its name: never under an id the pool let go of, nor the stand-in's own.
    const owls = buildScoutTeam("Oak Hill Owls", new Set(), {
      gcTeams: [link("gcOWLS000001", "Oak Hill Owls 9U")],
    });
    const oldPage: ScoutTeam = { id: "S-HOLL", name: "Hollowmere Hornets DNU", nameOnly: true };
    const row = (id: string, date: string): ScoutGame => ({
      id,
      ageGroupId: AGE.id,
      teamAId: owls.id,
      teamBId: oldPage.id,
      teamAScore: 6,
      teamBScore: 2,
      date,
      source: { kind: "gamechanger", teamId: "gcOWLS000001", gameId: id },
    });
    const pool = {
      ageGroups: [AGE],
      teams: [owls, oldPage],
      games: [row("g1", "2026-09-12"), row("g2", "2026-09-13")],
    };
    const slotsOf = (state: { teams: ScoutTeam[] }) =>
      state.teams.filter((team) => team.placeholder).map((team) => team.id);
    // As before for a pool that let none go: the stand-in's own id is held while it goes.
    expect(slotsOf(tidyPool(pool).state)).toEqual(["S-HOLL2", "S-HOLL3"]);
    const tidied = tidyPool(
      pool,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      retired([["HOLL", 3]])
    );
    expect(slotsOf(tidied.state)).toEqual(["S-HOLL4", "S-HOLL5"]);
    // A run's mints are held to every id the run began with, gone since or not.
    const ledger = mintedIds(["S-RIVE", "S-RIVE2"]);
    expect(buildScoutTeam("Riverbend Robins", ledger).id).toBe("S-RIVE3");
  });

  it("rides in a backup, and a restore keeps what this store and the file each let go of", () => {
    saveAgeGroups([AGE]);
    saveScoutTeams(rosterOf());
    saveScoutGames([]);
    saveScoutTeams(loadScoutTeams().filter((team) => team.id !== "S-RIVE2"));
    const backup = readTeamRankingsBackup();
    expect(backup.retired).toEqual({ RIVE: 2 });
    // The store moves on: Oak Hill Owls deleted too, then the older file restored over it.
    saveScoutTeams(loadScoutTeams().filter((team) => team.id !== "S-OAKH"));
    expect(writeTeamRankingsBackup(backup)).toBe(true);
    expect(loadScoutTeams().map((team) => team.id)).toEqual(["S-RIVE", "S-OAKH"]);
    expect(loadRetiredIds()).toEqual(
      retired([
        ["RIVE", 2],
        ["OAKH", 1],
      ])
    );
    expect(nextPull().robins.id).toBe("S-RIVE3");
  });

  it("rides every way a backup is written: the Team Rankings file, the whole-browser file, Undo", () => {
    saveScoutTeams(rosterOf());
    saveScoutTeams(loadScoutTeams().filter((team) => team.id !== "S-RIVE2"));
    const backup = readTeamRankingsBackup();
    // In the Team Rankings file, inside the roster as the store keeps it.
    const file = parseTeamRankingsJson(teamRankingsJson(backup, "2026-10-01T00:00:00.000Z"));
    expect(file?.retired).toEqual({ RIVE: 2 });
    // In the whole-browser file and an undo snapshot, as JSON, beside the roster.
    expect(coerceTeamRankingsBackup(JSON.parse(JSON.stringify(backup)))?.retired).toEqual({
      RIVE: 2,
    });
    // Restored on a device that never held the pool, the file's own are kept.
    resetTeamRankingsStore();
    backing.clear();
    expect(file && writeTeamRankingsBackup(file)).toBe(true);
    expect(loadRetiredIds()).toEqual(retired([["RIVE", 2]]));
    // A pool that let none go is written as it was before, with no field for it.
    resetTeamRankingsStore();
    backing.clear();
    saveScoutTeams(rosterOf());
    expect(readTeamRankingsBackup()).not.toHaveProperty("retired");
  });
});

describe("a club League Standings makes for a team on the page", () => {
  it("is minted under no id the roster let go of, nor found by a pick of the club that had it", () => {
    // The Gold squad folded into the Rays: RIVE's second is let go of.
    const roster = rosterOf().filter((team) => team.id !== "S-RIVE2");
    // Two seasons on the page: the first's Riverview Rockets nobody has pulled, and the second's
    // Rays Gold, picked as the Gold squad before it was folded away.
    const seasons: Record<string, LeagueSeasonData> = {
      "season-x": {
        teams: [
          { id: "RV", name: "Riverview Rockets" },
          { id: "OW", name: "Oak Hill Owls" },
        ],
        matchups: [{ id: "m1", date: "9/27", away: "RV", home: "OW" }],
        logs: {},
      },
      "season-y": {
        teams: [
          { id: "RG", name: "Rays Gold", scoutTeamId: "S-RIVE2" },
          { id: "OW", name: "Oak Hill Owls" },
        ],
        matchups: [{ id: "m2", date: "10/4", away: "RG", home: "OW" }],
        logs: {},
      },
    };
    const known = (retiredIds = NO_RETIRED) =>
      deriveAllKnown({
        ageGroups: [{ ...AGE, seasonIds: ["season-x", "season-y"] }],
        teams: roster,
        yearGames: [],
        readSeason: (id) => seasons[id] ?? { teams: [], matchups: [], logs: {} },
        autoRemoved: new Map(),
        retired: retiredIds,
      });
    const clubOf = (all: ReturnType<typeof known>, season: string, leagueTeam: string) =>
      all.leagueClubs.get(AGE.id)?.get(season)?.get(leagueTeam);
    // Before anything is let go of, as it always was: the next free id of the stem, and the
    // second season's pick of the folded club found that club under it.
    const before = known();
    expect(clubOf(before, "season-x", "RV")).toBe("S-RIVE2");
    expect(clubOf(before, "season-y", "RG")).toBe("S-RIVE2");
    // With the fold remembered, the Rockets take the stem's next id, and the pick finds nothing.
    const read = known(retired([["RIVE", 2]]));
    expect(clubOf(read, "season-x", "RV")).toBe("S-RIVE3");
    expect(clubOf(read, "season-y", "RG")).not.toBe("S-RIVE3");
    expect(read.teams.find((team) => team.id === "S-RIVE2")).toBeUndefined();
  });
});
