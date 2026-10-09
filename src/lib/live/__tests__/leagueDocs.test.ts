import { describe, expect, it } from "vitest";
import rules from "../../../../firestore.rules?raw";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS, type GameLog, type Settings } from "../../types";
import { coerceLogs, coerceMatchups, coerceSettings, coerceTeams } from "../../validate";
import {
  applyChanges,
  decodeKey,
  docChanges,
  docToSeason,
  encodeKey,
  LEAGUE_DOC_FIELDS,
  LEAGUE_DOC_SCHEMA,
  readBack,
  seasonDocId,
  seasonToDoc,
  storableSeason,
  type LeagueDoc,
} from "../leagueDocs";

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

/** A season as storage reads one back: every part through the validators. */
const coerced = (raw: {
  id: string;
  name: string;
  createdAt: string;
  updatedAt?: string;
  teams: unknown;
  matchups: unknown;
  logs: unknown;
  bracketLogs: unknown;
  settings: unknown;
}): SeasonSnapshot => {
  const teams = coerceTeams(raw.teams);
  const matchups = coerceMatchups(raw.matchups, teams);
  return {
    id: raw.id,
    name: raw.name,
    createdAt: raw.createdAt,
    ...(raw.updatedAt === undefined ? {} : { updatedAt: raw.updatedAt }),
    teams,
    matchups,
    logs: coerceLogs(raw.logs, matchups),
    bracketLogs: coerceLogs(raw.bracketLogs, []),
    settings: coerceSettings(raw.settings),
  };
};

/** A season with ids of every kind: the app's own, and ones a schedule file brought in. */
const SEASON = coerced({
  id: "season-2",
  name: "Spring 2027",
  createdAt: "2027-02-01T00:00:00.000Z",
  updatedAt: "2027-04-10T18:00:00.000Z",
  teams: [
    { id: "TRAS", name: "Trash Pandas", scoutTeamId: "gc-9" },
    { id: "Team A/1", name: "Team A" },
    { id: "a.b", name: "Dots" },
    { id: "Équipe", name: "Équipe" },
    { id: "__name__", name: "Reserved" },
  ],
  matchups: [
    { id: "game_1712345678_12", date: "2027-04-03", away: "TRAS", home: "Team A/1" },
    { id: "Row 7: Dots @ Équipe", date: "2027-04-03", away: "a.b", home: "Équipe" },
    { id: "~already", date: "2027-04-10", away: "__name__", home: "TRAS" },
    { id: "g2", date: "2027-04-10", away: "Team A/1", home: "a.b" },
  ],
  logs: {
    game_1712345678_12: score("7", "4"),
    "Row 7: Dots @ Équipe": score("3", "3", { awayErrors: "2", homeErrors: "1" }),
    "~already": score("", "", { isFinal: false }),
  },
  bracketLogs: { "sf/1": score("5", "2"), final: score("1", "0") },
  settings: { ...DEFAULT_SETTINGS, goldCutoff: 4, tiebreakerOrder: ["runsFor", "headToHead"] },
});

const read = (doc: unknown, id = seasonDocId(SEASON.id)): SeasonSnapshot => {
  const result = docToSeason(doc, id);
  if (!result.ok) throw new Error(`unread: ${result.reason}`);
  return result.season;
};

/** A document as Firestore hands it back: through JSON, every map's fields in key order. */
const asStored = (doc: LeagueDoc): unknown =>
  JSON.parse(
    JSON.stringify(doc, (_key, value: unknown) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, (value as Record<string, unknown>)[key]])
          )
        : value
    )
  );

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

const ODD = ["", " ", ".", "/", "~", "`", "[", "]", "_", "-", "é", "😀", "__", "#", "*", "\\"];

describe("keys", () => {
  it("keeps the ids this app makes as they are", () => {
    for (const id of ["TRAS", "TRA1", "game_1712345678_12", "season-2", "default", "a".repeat(64)])
      expect(encodeKey(id)).toBe(id);
  });

  it("writes any other id in a form every path takes, and reads it back", () => {
    for (const id of ["a.b", "Team A/1", "Équipe", "__name__", "~x", "a".repeat(65), "a b", "`"]) {
      const key = encodeKey(id);
      expect(key).toMatch(/^~[A-Za-z0-9_-]+$/);
      expect(decodeKey(key)).toBe(id);
    }
  });

  it("reads no key it never writes", () => {
    // A plain id written the long way, a padded or broken encoding, and text no path takes.
    for (const key of [`~${btoa("ABC").replace(/=+$/, "")}`, "~QQ==", "~QR", "~", "~a", "a.b", ""])
      expect(decodeKey(key)).toBeNull();
    expect(decodeKey("~QQ")).toBeNull();
    expect(decodeKey(encodeKey("A.B"))).toBe("A.B");
  });

  it("gives every id its own key, and back", () => {
    const random = seeded(7);
    const seen = new Map<string, string>();
    for (let n = 0; n < 2000; n += 1) {
      const length = 1 + Math.floor(random() * 12);
      let id = "";
      for (let i = 0; i < length; i += 1) {
        id +=
          random() < 0.3
            ? (ODD[Math.floor(random() * ODD.length)] ?? "")
            : String.fromCharCode(48 + Math.floor(random() * 75));
      }
      if (!id) continue;
      const key = encodeKey(id);
      expect(decodeKey(key)).toBe(id);
      expect(seen.get(key) ?? id).toBe(id);
      seen.set(key, id);
    }
  });
});

describe("a season's document", () => {
  it("reads back as the season it was written from, ids of every kind and all", () => {
    const doc = seasonToDoc(SEASON);
    expect(doc.schema).toBe(LEAGUE_DOC_SCHEMA);
    expect(read(asStored(doc))).toEqual(SEASON);
  });

  it("keeps the schedule's order, which a map does not", () => {
    const doc = seasonToDoc(SEASON);
    const stored = asStored(doc) as LeagueDoc;
    // The maps come back in key order, unlike the season's; the orders beside them do not.
    expect(Object.keys(stored.matchups)).not.toEqual(
      SEASON.matchups.map((game) => encodeKey(game.id))
    );
    expect(read(stored).matchups.map((game) => game.id)).toEqual(
      SEASON.matchups.map((game) => game.id)
    );
    expect(read(stored).teams.map((team) => team.id)).toEqual(SEASON.teams.map((team) => team.id));
  });

  it("is named by the season's id in a form every path takes", () => {
    expect(seasonDocId("season-2")).toBe("season-2");
    expect(seasonDocId("Fall 2026")).toMatch(/^~/);
    const named = { ...SEASON, id: "Fall 2026" };
    expect(read(asStored(seasonToDoc(named)), seasonDocId("Fall 2026")).id).toBe("Fall 2026");
  });

  it("carries no field set to nothing, which Firestore refuses", () => {
    const season: SeasonSnapshot = {
      ...SEASON,
      updatedAt: undefined,
      teams: [
        { id: "A", name: "A", scoutTeamId: undefined },
        { id: "B", name: "B" },
      ],
      matchups: [{ id: "g", date: "", away: "A", home: "B" }],
      logs: { g: { ...score("1", "0"), isFinal: undefined, awayErrors: undefined } },
      // A setting spread in from a control that had no value.
      settings: { ...SEASON.settings, ...{ seasonLabel: undefined } } as unknown as Settings,
    };
    const undefinedAt: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (value === undefined) undefinedAt.push(path);
      else if (value && typeof value === "object")
        for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    };
    walk(seasonToDoc(season), "doc");
    expect(undefinedAt).toEqual([]);
  });

  it("puts a record two devices left out of the order in one place on every device", () => {
    const doc = asStored(seasonToDoc(SEASON)) as LeagueDoc;
    // One device added g2 while another wrote an order without it.
    const torn = {
      ...doc,
      order: doc.order.filter((id) => id !== "g2"),
      teamOrder: [],
      // In whatever order a device's copy of the map has its fields.
      teams: Object.fromEntries(Object.entries(doc.teams).reverse()),
    };
    const season = read(torn);
    expect(season.matchups.map((game) => game.id)).toEqual([
      "game_1712345678_12",
      "Row 7: Dots @ Équipe",
      "~already",
      "g2",
    ]);
    // With no order at all, the teams come in key order, the same on every device.
    expect(season.teams.map((team) => team.id)).toEqual(
      [...SEASON.teams.map((team) => team.id)].sort((a, b) =>
        encodeKey(a) < encodeKey(b) ? -1 : 1
      )
    );
  });

  it("reads no record kept under a key that is not its own id's, nor an order naming none", () => {
    const doc = asStored(seasonToDoc(SEASON)) as LeagueDoc;
    const season = read({
      ...doc,
      teams: { ...doc.teams, ZZZZ: { id: "YYYY", name: "Misfiled" } },
      order: ["missing", ...doc.order],
      logs: { ...doc.logs, "a.b": score("9", "9"), "~QR": score("8", "8") },
    });
    expect(season.teams.map((team) => team.id)).not.toContain("YYYY");
    expect(season.matchups).toEqual(SEASON.matchups);
    expect(season.logs).toEqual(SEASON.logs);
  });

  it("checks every record as storage does", () => {
    const doc = asStored(seasonToDoc(SEASON)) as LeagueDoc;
    const season = read({
      ...doc,
      logs: { ...doc.logs, g2: { ...score("99999", "x"), innings: "40" } },
      settings: { ...doc.settings, goldCutoff: 900, pitchMode: "robot" },
    });
    expect(season.logs.g2).toMatchObject({
      awayRuns: expect.any(String),
      homeRuns: "",
      isFinal: false,
    });
    expect(season.settings.goldCutoff).toBe(64);
    expect(season.settings.pitchMode).toBe(DEFAULT_SETTINGS.pitchMode);
  });

  it("is left unread when a later version of the app wrote it, or it is no season", () => {
    const doc = asStored(seasonToDoc(SEASON)) as LeagueDoc;
    const id = seasonDocId(SEASON.id);
    expect(docToSeason({ ...doc, schema: LEAGUE_DOC_SCHEMA + 1 }, id)).toEqual({
      ok: false,
      reason: "newer",
    });
    for (const raw of [null, [], "season", { ...doc, schema: undefined }, { ...doc, schema: 0 }])
      expect(docToSeason(raw, id)).toEqual({ ok: false, reason: "unreadable" });
    expect(docToSeason(doc, "a.b")).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("the changes between two versions of a season's document", () => {
  const BASE = seasonToDoc(SEASON);
  const changed = (edit: (season: SeasonSnapshot) => SeasonSnapshot) =>
    docChanges(BASE, seasonToDoc(edit(SEASON)));

  it("are one field for one score, under the game's own key", () => {
    expect(
      changed((season) => ({
        ...season,
        logs: { ...season.logs, "Row 7: Dots @ Équipe": score("4", "3") },
      }))
    ).toEqual([{ path: ["logs", encodeKey("Row 7: Dots @ Équipe")], value: score("4", "3") }]);
  });

  it("are the game and the order for a game added, and the record taken out for one removed", () => {
    const added = { id: "g3", date: "2027-04-17", away: "TRAS", home: "a.b" };
    expect(changed((season) => ({ ...season, matchups: [...season.matchups, added] }))).toEqual([
      { path: ["matchups", "g3"], value: added },
      { path: ["order"], value: [...BASE.order, "g3"] },
    ]);
    expect(
      changed((season) => ({ ...season, teams: season.teams.filter((team) => team.id !== "a.b") }))
    ).toEqual([
      { path: ["teams", encodeKey("a.b")], remove: true },
      { path: ["teamOrder"], value: BASE.teamOrder.filter((id) => id !== "a.b") },
    ]);
  });

  it("are one field for one setting, and the name and time when they change", () => {
    expect(
      changed((season) => ({
        ...season,
        name: "Spring",
        updatedAt: undefined,
        settings: { ...season.settings, winPoints: 2 },
      }))
    ).toEqual([
      { path: ["name"], value: "Spring" },
      { path: ["updatedAt"], remove: true },
      { path: ["settings", "winPoints"], value: 2 },
    ]);
  });

  it("are nothing for a document read back from Firestore unchanged", () => {
    expect(docChanges(asStored(BASE) as LeagueDoc, BASE)).toEqual([]);
    expect(docChanges(BASE, asStored(BASE) as LeagueDoc)).toEqual([]);
  });
});

describe("the rules for a season's document", () => {
  it("allow exactly the fields a season's document has", () => {
    const listed = /function leagueFields\(\) \{\s*return \[([^\]]*)\];/.exec(rules)?.[1];
    expect(listed?.split(",").map((field) => field.trim().replace(/"/g, ""))).toEqual([
      ...LEAGUE_DOC_FIELDS,
    ]);
    expect(Object.keys(seasonToDoc(SEASON)).sort()).toEqual([...LEAGUE_DOC_FIELDS].sort());
  });
});

describe("the write a season's document is at", () => {
  it("is written with the document, and read back with the season", () => {
    expect(seasonToDoc(SEASON).rev).toBe(1);
    const doc = asStored(seasonToDoc(SEASON, 7));
    const result = docToSeason(doc, seasonDocId(SEASON.id));
    expect(result.ok && result.rev).toBe(7);
  });

  it("leaves a document unread without one, as no device could tell its writes apart", () => {
    const doc = asStored(seasonToDoc(SEASON)) as LeagueDoc;
    const id = seasonDocId(SEASON.id);
    for (const rev of [undefined, 0, -1, 1.5, "2", null])
      expect(docToSeason({ ...doc, rev }, id)).toEqual({ ok: false, reason: "unreadable" });
  });
});

describe("ids named as an object's own members", () => {
  /** Ids a schedule file could hold that an object already answers to. */
  const NAMED = coerced({
    id: "constructor",
    name: "Named",
    createdAt: "2027-02-01T00:00:00.000Z",
    teams: [
      { id: "constructor", name: "Builders" },
      { id: "__proto__", name: "Protos" },
      { id: "toString", name: "Strings" },
    ],
    matchups: [
      { id: "hasOwnProperty", date: "2027-04-03", away: "constructor", home: "__proto__" },
      { id: "__proto__", date: "2027-04-10", away: "toString", home: "constructor" },
    ],
    logs: { hasOwnProperty: score("2", "1") },
    bracketLogs: { constructor: score("4", "3") },
    settings: DEFAULT_SETTINGS,
  });

  it("are kept as any other id, through a document and back", () => {
    expect(NAMED.teams.map((team) => team.id)).toEqual(["constructor", "__proto__", "toString"]);
    expect(read(asStored(seasonToDoc(NAMED)), seasonDocId(NAMED.id))).toEqual(NAMED);
  });

  it("set no object's prototype on the way", () => {
    const doc = seasonToDoc(NAMED);
    expect(Object.getPrototypeOf(doc.teams)).toBe(Object.prototype);
    expect(Object.keys(doc.teams)).toContain("constructor");
    expect(Object.keys(doc.bracketLogs)).toEqual(["constructor"]);
  });

  it("are changed as any other field", () => {
    const base = { teams: {}, logs: { other: 1 } };
    const next = applyChanges(base, [
      { path: ["teams", "constructor"], value: { id: "constructor" } },
      { path: ["teams", "__proto__"], value: { id: "__proto__" } },
      { path: ["logs", "other"], remove: true },
    ]);
    expect(Object.keys(next.teams as object)).toEqual(["constructor", "__proto__"]);
    expect(Object.getPrototypeOf(next.teams)).toBe(Object.prototype);
    expect(next.logs).toEqual({});
  });
});

describe("changes made to a document", () => {
  it("set and take out each field by its path, making the maps on the way", () => {
    const doc = { name: "Spring", logs: { g1: { awayRuns: "1" } }, settings: { winPoints: 3 } };
    expect(
      applyChanges(doc, [
        { path: ["logs", "g2"], value: { awayRuns: "4" } },
        { path: ["logs", "g1"], remove: true },
        { path: ["bracketLogs", "final"], value: { awayRuns: "2" } },
        { path: ["name"], value: "Fall" },
        { path: ["settings"], remove: true },
      ])
    ).toEqual({
      name: "Fall",
      logs: { g2: { awayRuns: "4" } },
      bracketLogs: { final: { awayRuns: "2" } },
    });
  });

  it("leave the document they are made to, and the values they carry, as they were", () => {
    const doc = { logs: { g1: { awayRuns: "1" } } };
    const value = { awayRuns: "5" };
    const next = applyChanges(doc, [{ path: ["logs", "g1"], value }]);
    value.awayRuns = "6";
    expect(doc).toEqual({ logs: { g1: { awayRuns: "1" } } });
    expect(next).toEqual({ logs: { g1: { awayRuns: "5" } } });
  });

  it("turn a document into the next, as its changes say", () => {
    const next = seasonToDoc({
      ...SEASON,
      teams: SEASON.teams.slice(1),
      logs: { ...SEASON.logs, g2: score("9", "8") },
    });
    const base = seasonToDoc(SEASON);
    expect(applyChanges(base, docChanges(base, next))).toEqual(next);
  });
});

describe("a season holding one id twice", () => {
  it("keeps the first record under it, as storage's readers do", () => {
    const twice = { ...SEASON, teams: [...SEASON.teams, { id: "TRAS", name: "Second Pandas" }] };
    const doc = seasonToDoc(twice);
    expect(doc.teams.TRAS).toEqual({ id: "TRAS", name: "Trash Pandas", scoutTeamId: "gc-9" });
    expect(doc.teamOrder.filter((id) => id === "TRAS")).toHaveLength(1);
    expect(coerceTeams(twice.teams).find((team) => team.id === "TRAS")?.name).toBe("Trash Pandas");
  });
});

describe("a season as every device reads it back", () => {
  it("is the season through the readers storage uses, with nothing a reader would change again", () => {
    const typed = { ...SEASON, name: "Spring 2027  " };
    const back = readBack(typed);
    expect(back.name).toBe("Spring 2027");
    expect(back).not.toHaveProperty("updatedAt");
    expect(readBack(back)).toEqual(back);
  });

  it("leaves a season whose document could not be read as it is", () => {
    const odd = { ...SEASON, id: "" };
    expect(readBack(odd)).toBe(odd);
  });
});

describe("a season the cloud can keep", () => {
  /** An id whose key is `bytes` long: `~` and the id's base64url, 4 characters for every 3. */
  const idOf = (bytes: number) => "x".repeat(((bytes - 1) * 3) / 4);

  it("has every key within what Firestore takes as a field's name", () => {
    expect(encodeKey(idOf(1000)).length).toBe(1000);
    expect(encodeKey(idOf(1004)).length).toBe(1004);
    expect(storableSeason(SEASON)).toBe(true);
    const long = idOf(1000);
    const longer = idOf(1004);
    const team = (id: string) => ({ id, name: "Long" });
    const game = (id: string) => ({ id, date: "4/3", away: "TRAS", home: "a.b" });
    const cases: [string, (id: string) => SeasonSnapshot][] = [
      ["season", (id) => ({ ...SEASON, id })],
      ["team", (id) => ({ ...SEASON, teams: [...SEASON.teams, team(id)] })],
      ["game", (id) => ({ ...SEASON, matchups: [...SEASON.matchups, game(id)] })],
      ["score", (id) => ({ ...SEASON, logs: { ...SEASON.logs, [id]: score("1", "0") } })],
      ["bracket", (id) => ({ ...SEASON, bracketLogs: { [id]: score("1", "0") } })],
    ];
    for (const [what, make] of cases) {
      expect([what, storableSeason(make(long))]).toEqual([what, true]);
      expect([what, storableSeason(make(longer))]).toEqual([what, false]);
    }
  });
});
