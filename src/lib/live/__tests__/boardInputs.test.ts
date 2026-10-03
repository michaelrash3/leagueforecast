import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_TODAY, fingerprint, poolFixture } from "../../../../scripts/poolFixture";
import type { CloudManifest, ManifestPart } from "../../cloud/cloudManifest";
import { LEAGUE_PART } from "../../cloud/cloudPlan";
import { memoryIo } from "../../cloud/cloudRunner";
import { encodeScoutGames } from "../../teamRankingsCompact";
import {
  applyCloudPoolValues,
  cloudPoolKeys,
  initTeamRankingsStore,
  isBoardInputKey,
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  readCloudPoolValue,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveDroppedClubs,
  saveKeptApart,
  saveRefreshCadence,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../../teamRankingsStorage";
import { coerceLogs, coerceMatchups, coerceTeams } from "../../validate";
import type { SeasonReader } from "../allKnown";
import {
  BOARD_FAMILY,
  boardInputsPrint,
  boardsState,
  builtFrom,
  isBoardInput,
} from "../boardInputs";
import { BOARD_RULES, boardViews, buildAllBoards } from "../views/board";
import { LIVE_FORMAT, LIVE_SCHEMA, type LiveMeta } from "../viewStore";

/*
 * What the boards are built from (`boardInputs.ts`): the keys they read, a fingerprint of a copy's
 * inputs that moves exactly when one of them does, and whether the boards published are already
 * the copy's.
 */

const fixture = poolFixture({ seed: 11, clubsPerPage: 60 });
const readSeason: SeasonReader = (seasonId) => {
  const stored = fixture.seasons[seasonId];
  const teams = coerceTeams(stored?.teams ?? null);
  const matchups = coerceMatchups(stored?.matchups ?? null, teams);
  return { teams, matchups, logs: coerceLogs(stored?.logs ?? null, matchups) };
};

/** The fixture's boards, from whatever the store now holds, folded to one fingerprint. */
const boardsHeld = (): string => {
  const ageGroups = loadAgeGroups();
  return fingerprint(
    boardViews(
      ageGroups,
      buildAllBoards({
        ageGroups,
        teams: loadScoutTeams(),
        gamesOfYear: loadScoutGamesForYear,
        readSeason,
        today: FIXTURE_TODAY,
      })
    )
  );
};

/** The boards of a store holding only `values`, as a server laying in a copy's parts would. */
const boardsOf = async (values: ReadonlyMap<string, unknown>): Promise<string> => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  expect(await applyCloudPoolValues(values)).toBe(true);
  return boardsHeld();
};

/** Every value the fixture's pool puts in a cloud copy, with some no board reads beside it. */
let everything = new Map<string, unknown>();
let full = "";
beforeAll(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
  const someone = fixture.teams[0]?.id ?? "nobody";
  saveDroppedClubs(new Set([someone]));
  saveKeptApart(new Set([`${someone}|elsewhere`]));
  saveTidyStamp("r999|0|0|0|");
  saveRefreshCadence("daily");
  saveRefreshLog({ "9": "2027-04-14" });
  const keys = cloudPoolKeys();
  everything = new Map(
    await Promise.all(keys.map(async (key) => [key, await readCloudPoolValue(key)] as const))
  );
  full = boardsHeld();
});
afterAll(() => {
  resetTeamRankingsStore();
});

describe("the keys the boards read", () => {
  it("are enough: the boards of a store holding only them are the boards of the whole pool", async () => {
    const inputs = new Map([...everything].filter(([key]) => isBoardInputKey(key)));
    // Some keys left out, or the test proves nothing.
    expect(inputs.size).toBeLessThan(everything.size);
    expect(everything.size - inputs.size).toBeGreaterThanOrEqual(5);
    expect(await boardsOf(inputs)).toBe(full);
  });

  it("are each needed: without any one of them the boards are not the same", async () => {
    /*
     * The games' index aside: each year's shard is read by its own name, and the index only when
     * an older pool's games are split into years. It changes only with a shard, which changes the
     * fingerprint anyway, so keeping it costs no rebuild.
     */
    const inputs = [...everything.keys()].filter(
      (key) => isBoardInputKey(key) && key !== "league_forecast_scout_games_v2_index"
    );
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    for (const key of inputs) {
      const without = new Map([...everything].filter(([held]) => held !== key));
      let boards: string | null = null;
      try {
        boards = await boardsOf(without);
      } catch {
        // A build that cannot run without it needs it as surely as one that differs.
      }
      expect(boards, key).not.toBe(full);
    }
  });

  it("take in an older pool's games under its one key, which the year shards are split from", async () => {
    const legacy = new Map([...everything].filter(([key]) => !key.includes("scout_games_v2")));
    legacy.set("league_forecast_scout_games_v1", encodeScoutGames(fixture.games));
    expect(isBoardInputKey("league_forecast_scout_games_v1")).toBe(true);
    expect(await boardsOf(legacy)).toBe(full);
  });

  it("are, with League Standings, what a copy's board inputs are", () => {
    expect(isBoardInput(LEAGUE_PART)).toBe(true);
    expect(isBoardInput("league_forecast_gc_refresh_v1")).toBe(false);
    expect(isBoardInput("league_forecast_gc_tidy_v1")).toBe(false);
    expect(isBoardInput("league_forecast_scout_age_groups_v1")).toBe(true);
  });
});

const part = (key: string, hash: string, more: Partial<ManifestPart> = {}): ManifestPart => ({
  key,
  hash,
  bytes: 10,
  chunks: 1,
  id: "0123456789abcdef",
  at: 1,
  by: "phone",
  ...more,
});
const h = (n: number) => n.toString(16).padStart(64, "0");
const manifest = (parts: ManifestPart[], more: Partial<CloudManifest> = {}): CloudManifest => ({
  format: 2,
  schema: 1,
  copy: "c0ffee",
  version: 4,
  save: "s",
  updatedAt: "2027-04-15T10:00:00.000Z",
  device: "phone",
  parts,
  kept: [],
  ...more,
});
const PARTS = [
  part(LEAGUE_PART, h(1)),
  part("league_forecast_scout_teams_v1", h(2)),
  part("league_forecast_scout_age_groups_v1", h(3)),
  part("league_forecast_scout_games_v2_index", h(4)),
  part("league_forecast_scout_games_v2:2027", h(5)),
  part("league_forecast_gc_refresh_v1", h(6)),
];

describe("a copy's board inputs, as one fingerprint", () => {
  it("moves with every input's value, and with nothing else", async () => {
    const base = await boardInputsPrint(manifest(PARTS));
    for (const [at, input] of PARTS.entries()) {
      const changed = PARTS.map((one, index) => (index === at ? { ...one, hash: h(99) } : one));
      const print = await boardInputsPrint(manifest(changed));
      if (isBoardInput(input.key)) expect(print, input.key).not.toBe(base);
      else expect(print, input.key).toBe(base);
    }
    // Who saved it, when, under which upload, the earlier versions kept, the copy's version and
    // the order the parts are listed in say nothing about what the boards read.
    const restamped = PARTS.map((one) => ({ ...one, at: 9, by: "laptop", id: "fedcba9876543210" }));
    expect(
      await boardInputsPrint(
        manifest([...restamped].reverse(), {
          version: 9,
          kept: [{ ...part(LEAGUE_PART, h(7)), group: "g", keptAt: "x", why: "replaced" }],
        })
      )
    ).toBe(base);
    // An input taken out moves it too.
    expect(await boardInputsPrint(manifest(PARTS.slice(1)))).not.toBe(base);
  });
});

describe("where the published boards stand against a copy", () => {
  const copy = manifest(PARTS);
  const metaWith = async (more: Partial<LiveMeta["built"][string]> = {}, schema = LIVE_SCHEMA) => {
    const from = { ...(await builtFrom(copy, "2027-04-15")), ...more };
    const meta: LiveMeta = {
      format: LIVE_FORMAT,
      schema,
      today: from.today,
      builtAt: "x",
      copy: { id: from.k, version: from.v },
      marks: { [from.k]: from.v },
      inline: {},
      views: {},
      retired: [],
      built: { [BOARD_FAMILY]: from },
    };
    return meta;
  };

  it("are current only when the copy, its version, its inputs, the day, the rules and the shape all match", async () => {
    expect(await boardsState(await metaWith(), copy, "2027-04-15")).toBe("current");
    // An older version with the same inputs is not: answering current would leave the copy's mark
    // behind, and a slower build of a version in between could publish over them.
    expect(await boardsState(await metaWith({ v: 1 }), copy, "2027-04-15")).toBe("stale");
    expect(await boardsState(await metaWith({ k: "other" }), copy, "2027-04-15")).toBe("stale");
    expect(await boardsState(await metaWith({ inputs: h(5) }), copy, "2027-04-15")).toBe("stale");
    expect(await boardsState(await metaWith(), copy, "2027-04-16")).toBe("stale");
    expect(await boardsState(await metaWith({ rules: BOARD_RULES - 1 }), copy, "2027-04-15")).toBe(
      "stale"
    );
    expect(await boardsState(await metaWith({}, LIVE_SCHEMA - 1), copy, "2027-04-15")).toBe(
      "stale"
    );
    expect(await boardsState(null, copy, "2027-04-15")).toBe("stale");
    const unbuilt = { ...(await metaWith()), built: {} };
    expect(await boardsState(unbuilt, copy, "2027-04-15")).toBe("stale");
    // A floor, which a late publish leaves when no build vouches for every board, is never current.
    expect(await boardsState(await metaWith({ k: "", v: 0, inputs: "" }), copy, "2027-04-15")).toBe(
      "stale"
    );
  });

  it("are another build's to leave when newer rules built them, and a passed day's when built later", async () => {
    expect(await boardsState(await metaWith({ rules: BOARD_RULES + 1 }), copy, "2027-04-15")).toBe(
      "older-rules"
    );
    expect(await boardsState(await metaWith(), copy, "2027-04-14")).toBe("older-day");
    expect(await boardsState(await metaWith({}, LIVE_SCHEMA + 1), copy, "2027-04-15")).toBe(
      "newer-schema"
    );
  });
});
