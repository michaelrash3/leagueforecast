import { afterEach, describe, expect, it, vi } from "vitest";
import { hashValue } from "../../cloud/cloudPack";
import type { SeasonSnapshot } from "../../storage";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type ModelAggression,
  type PitchMode,
  type PostseasonFormat,
  type RecapGrouping,
  type ScoreDetail,
  type Settings,
  type TeamBase,
  type TiebreakerFactor,
} from "../../types";
import { readCloudLeague } from "../cloudLeague";
import { storedBases } from "../leagueBase";
import {
  docToSeason,
  LEAGUE_DOC_FIELDS,
  LEAGUE_DOC_SCHEMA,
  seasonDocId,
  seasonToDoc,
  type LeagueDoc,
} from "../leagueDocs";
import { withChanges } from "../leagueLive";
import { meetSeasons } from "../leagueSeasons";
import { askLeagueRebuild } from "../rebuildPlan";
import { listing } from "./leagueDocsFixture";
import { memoryLeague } from "./memoryLeague";

/*
 * A League Standings season's document and the version of its layout (`LEAGUE_DOC_SCHEMA`).
 *
 * Every device writes a changed record whole: a game moved is `matchups.<game>`, the whole game,
 * as its build reads one. A build that predates a field reads the record without it and writes it
 * back without it, so an older build still open on a phone erases the field from every record it
 * touches. The layout's version is what stops that: a document of a later layout is read by no
 * build that predates it (`docToSeason`), which then holds the season read-only until it reloads.
 * It works only if it goes up with every field a season's document holds, and only once a season
 * already in the cloud carries the raise; the first write a device of this build sends a season
 * made at an earlier layout carries it (`writesFor`).
 */

const score = (away: string, home: string, more: Partial<GameLog> = {}): GameLog => ({
  awayRuns: away,
  awayHits: "",
  awayK: "",
  homeRuns: home,
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
  ...more,
});

/** A season holding every field a season's document can: each record's, and every setting's. */
const FULL: SeasonSnapshot = {
  id: "season-2",
  name: "Spring 2027",
  createdAt: "2027-02-01T00:00:00.000Z",
  updatedAt: "2027-04-10T18:00:00.000Z",
  teams: [
    { id: "ACES", name: "Aces", scoutTeamId: "S-ACES" },
    { id: "BEAR", name: "Bears" },
    { id: "COME", name: "Comets", scoutTeamId: "S-COME2" },
  ],
  matchups: [
    { id: "g1", date: "4/3", away: "ACES", home: "BEAR", startTs: "2027-04-03T15:00:00.000Z" },
    { id: "g2", date: "4/3", away: "COME", home: "ACES", startTs: "2027-04-03T17:00:00.000Z" },
    { id: "g3", date: "4/10", away: "BEAR", home: "COME" },
  ],
  logs: {
    g1: score("7", "4", {
      awayHits: "6",
      awayK: "3",
      homeHits: "5",
      homeK: "8",
      awayErrors: "1",
      homeErrors: "2",
      awayWalksAllowed: "4",
      homeWalksAllowed: "3",
    }),
    g2: score("", "", { isFinal: false }),
  },
  bracketLogs: { "final-1": score("5", "2") },
  settings: {
    ...DEFAULT_SETTINGS,
    seasonLabel: "Spring 2027",
    goldCutoff: 4,
    tiebreakerOrder: ["runsFor", "headToHead"],
    pitchMode: "machine",
    scoreDetail: "full",
    teamsLocked: true,
  },
};

/** A document as Firestore hands it back: through JSON, so with plain values only. */
const stored = (doc: LeagueDoc): Record<string, unknown> =>
  JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;

/** `doc` as a build of an earlier layout made it: the same records, at that layout. */
const atLayout = (doc: Record<string, unknown>, schema: number): Record<string, unknown> => ({
  ...doc,
  schema,
});

const DOC_ID = seasonDocId(FULL.id);

describe("a season written to its document and read back", () => {
  it("is the season it was written from, every field and setting kept", async () => {
    const doc = stored(seasonToDoc(FULL, 3));
    const read = docToSeason(doc, DOC_ID);
    if (!read.ok) throw new Error(`unread: ${read.reason}`);
    expect(read.season).toEqual(FULL);
    expect(read.rev).toBe(3);
    // The document itself, its layout's number aside, which is meant to move, to the byte.
    const { schema: _layout, ...records } = doc;
    expect(await hashValue(records)).toBe(
      "452f891214e2c78fbd6a0aac62916f7b46939ed3bf81c4df4a6c9e413064455c"
    );
  });
});

describe("a season at either layout, read by everything that reads one", () => {
  const AT_ONE = atLayout(stored(seasonToDoc(FULL, 3)), 1);
  const AT_TWO = atLayout(stored(seasonToDoc(FULL, 3)), 2);

  it("reads alike, saying which layout it is at (`docToSeason`)", () => {
    expect(docToSeason(AT_ONE, DOC_ID)).toEqual({ ok: true, season: FULL, rev: 3, schema: 1 });
    expect(docToSeason(AT_TWO, DOC_ID)).toEqual({ ok: true, season: FULL, rev: 3, schema: 2 });
  });

  it("reaches the boards alike, as every server reads the seasons (`readCloudLeague`)", async () => {
    const read = async (fields: Record<string, unknown>) => {
      const league = await readCloudLeague(listing([{ id: DOC_ID, fields }]));
      if (!league.ok || league.from !== "docs") throw new Error("not read from the documents");
      return { season: league.readSeason(FULL.id), print: league.print };
    };
    const one = await read(AT_ONE);
    expect(one.season).toEqual({ teams: FULL.teams, matchups: FULL.matchups, logs: FULL.logs });
    expect(await read(AT_TWO)).toEqual(one);
  });

  it("comes down to a device meeting the cloud's seasons (`meetSeasons`)", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("old"), atLayout(stored(seasonToDoc({ ...FULL, id: "old" })), 1));
    cloud.put(seasonDocId("new"), atLayout(stored(seasonToDoc({ ...FULL, id: "new" })), 2));
    const held: SeasonSnapshot[] = [];
    const met = await meetSeasons({
      store: cloud.store,
      local: {
        list: () => [],
        read: () => null,
        add: (more) => {
          held.push(...more);
          return true;
        },
      },
      bases: { read: () => null, write: () => {}, remove: () => {} },
      openId: () => "",
    });
    expect(met).toMatchObject({ added: ["new", "old"], unread: [] });
    expect(held).toEqual([
      { ...FULL, id: "new" },
      { ...FULL, id: "old" },
    ]);
  });

  describe("kept as this device's base", () => {
    const kept = new Map<string, string>();
    afterEach(() => {
      kept.clear();
      vi.unstubAllGlobals();
    });

    it("reads back, an older build's base at the first layout included (`storedBases`)", () => {
      vi.stubGlobal("localStorage", {
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => kept.set(key, value),
        removeItem: (key: string) => kept.delete(key),
      });
      for (const doc of [AT_ONE, AT_TWO]) {
        kept.set(`lf_league_base_${DOC_ID}_v1`, JSON.stringify({ doc, landed: [] }));
        expect(storedBases.read(DOC_ID)).toEqual({ season: FULL, rev: 3, landed: [] });
      }
    });
  });

  it("takes in a write that raised it as one that changes nothing else (`withChanges`)", () => {
    const raised = [
      { path: ["logs", "g3"], value: score("1", "0") },
      { path: ["schema"], value: 2 },
      { path: ["rev"], value: 4 },
    ];
    // As a version of the document is compared: without when it was saved (`unsaved`).
    const { updatedAt: _saved, ...unsaved } = FULL;
    expect(withChanges(FULL, raised)).toEqual({
      ...unsaved,
      logs: { ...FULL.logs, g3: score("1", "0") },
    });
  });

  it("asks for the boards again only where a board's input moved, the raise moving none (`askLeagueRebuild`)", async () => {
    const renamed = stored(seasonToDoc({ ...FULL, name: "Spring" }, 4));
    expect(await askLeagueRebuild(AT_ONE, atLayout(renamed, 2), DOC_ID)).toEqual({
      skip: "no-board-input",
    });
    const scored = stored(seasonToDoc({ ...FULL, logs: { ...FULL.logs, g3: score("2", "9") } }, 4));
    expect(await askLeagueRebuild(AT_ONE, atLayout(scored, 2), DOC_ID)).toEqual({
      ask: { kind: "league", season: DOC_ID },
    });
  });
});

/** Every field of `T`, as a list the compiler holds to it. */
const fieldsOf =
  <T>() =>
  <const L extends readonly (keyof T & string)[]>(
    fields: L & ([keyof T] extends [L[number]] ? unknown : { missing: Exclude<keyof T, L[number]> })
  ): readonly string[] =>
    fields;

/** Every value of a union of words, as a list the compiler holds to it. */
const wordsOf =
  <U extends string>() =>
  <const L extends readonly U[]>(
    words: L & ([U] extends [L[number]] ? unknown : { missing: Exclude<U, L[number]> })
  ): readonly string[] =>
    words;

/*
 * The tripwire for `LEAGUE_DOC_SCHEMA`, as `cloudSchema.test.ts` is the cloud copy's. Every field a
 * season's document holds is listed here, record by record, and the compiler holds each list to
 * its type: a field added to a type and not to its list fails the typecheck, naming it. Added to
 * the list, it changes the layout's fingerprint, which is then no longer the last in `LAYOUTS`, and
 * the test fails until an entry is added under the next number, which `LEAGUE_DOC_SCHEMA` must then
 * equal. A setting's words count too: an older build reads one it does not know as its default.
 */
const LAYOUT_NOW = {
  doc: fieldsOf<LeagueDoc>()([
    "schema",
    "rev",
    "name",
    "createdAt",
    "updatedAt",
    "teams",
    "teamOrder",
    "matchups",
    "order",
    "logs",
    "bracketLogs",
    "settings",
  ]),
  team: fieldsOf<TeamBase>()(["id", "name", "scoutTeamId"]),
  game: fieldsOf<Matchup>()(["id", "date", "away", "home", "startTs"]),
  score: fieldsOf<GameLog>()([
    "awayRuns",
    "awayHits",
    "awayK",
    "homeRuns",
    "homeHits",
    "homeK",
    "awayErrors",
    "homeErrors",
    "awayWalksAllowed",
    "homeWalksAllowed",
    "innings",
    "isFinal",
  ]),
  settings: fieldsOf<Settings>()([
    "goldCutoff",
    "postseasonFormat",
    "seasonLabel",
    "regularSeasonGamesPerTeam",
    "defaultGameInnings",
    "winPoints",
    "tiePoints",
    "runDiffTiebreaker",
    "tiebreakerOrder",
    "maxScoreCap",
    "maxRunDifferential",
    "autoRunDiffCap",
    "useScoutResults",
    "modelAggression",
    "pitchMode",
    "scoreDetail",
    "trackErrors",
    "recapGrouping",
    "teamsLocked",
  ]),
  tiebreakers: wordsOf<TiebreakerFactor>()([
    "headToHead",
    "runDifferential",
    "runsAgainst",
    "runsFor",
  ]),
  postseasonFormats: wordsOf<PostseasonFormat>()(["cut", "all", "none"]),
  scoreDetails: wordsOf<ScoreDetail>()(["runs", "full"]),
  pitchModes: wordsOf<PitchMode>()(["machine", "coach", "player"]),
  aggressions: wordsOf<ModelAggression>()(["Conservative", "Balanced", "Aggressive"]),
  recapGroupings: wordsOf<RecapGrouping>()(["game", "date", "week"]),
};

/**
 * Every layout a season's document has had, oldest first. A field added above adds an entry here,
 * under the next number, with the fingerprint the failing test prints, and raises
 * `LEAGUE_DOC_SCHEMA` to match. An entry is never edited once a build that writes it is out: a
 * season saved under it is in the cloud.
 */
const LAYOUTS: readonly { schema: number; fingerprint: string }[] = [
  // As the documents were first made (1.6e): every field above but the two the next one added.
  { schema: 1, fingerprint: "f22db85e5d46778257c5b414dd76139845652eb11eb03f7a8a2017f77cd950ad" },
  // A season says its team list is set (`Settings.teamsLocked`), and a game keeps its start
  // (`Matchup.startTs`), which an older build's move or edit of the game erased.
  { schema: 2, fingerprint: "0dc4042495b2f5fd317c1fb5a8b71fd69261193920c21a32978f818b9643128b" },
];

/** Order-free, so a list tidied into another order is not taken for a new layout. */
const sorted = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sorted).sort();
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => [key, sorted(inner)])
    );
  }
  return value;
};

describe("the layout of a season's document", () => {
  it("names today's fields, as the last layout in the list, and is what this build writes", async () => {
    const fingerprint = await hashValue(sorted(LAYOUT_NOW));
    const last = LAYOUTS[LAYOUTS.length - 1];
    const next = (last?.schema ?? 0) + 1;
    expect(
      fingerprint,
      `A field of a League Standings season's document changed. Raise LEAGUE_DOC_SCHEMA in ` +
        `src/lib/live/leagueDocs.ts to ${next}, and add { schema: ${next}, fingerprint: ` +
        `"${fingerprint}" } to LAYOUTS: an older build still open would otherwise drop the field ` +
        `from every record it writes.`
    ).toBe(last?.fingerprint);
    expect(
      LEAGUE_DOC_SCHEMA,
      `LAYOUTS ends at ${last?.schema}: raise LEAGUE_DOC_SCHEMA in src/lib/live/leagueDocs.ts to ` +
        `it, or a season's document is written at a layout that does not name its fields.`
    ).toBe(last?.schema);
    expect(seasonToDoc(FULL).schema).toBe(LEAGUE_DOC_SCHEMA);
  });

  it("only ever goes up, a step at a time, and never names the same fields twice", () => {
    LAYOUTS.forEach((entry, i) => {
      const before = LAYOUTS[i - 1];
      if (before) expect(entry.schema).toBe(before.schema + 1);
    });
    expect(new Set(LAYOUTS.map((entry) => entry.fingerprint)).size).toBe(LAYOUTS.length);
  });

  it("lists each field and word once, and the document's fields as it writes them", () => {
    for (const list of Object.values(LAYOUT_NOW)) expect(new Set(list).size).toBe(list.length);
    expect([...LAYOUT_NOW.doc]).toEqual([...LEAGUE_DOC_FIELDS]);
  });
});
