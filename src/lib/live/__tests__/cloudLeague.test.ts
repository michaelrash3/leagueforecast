import { describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import { leaguePrintOf, NO_LEAGUE_DOCS, readCloudLeague, restLeagueDocs } from "../cloudLeague";
import { LEAGUE_COLLECTION, LEAGUE_DOC_SCHEMA } from "../leagueDocs";
import { seasonReaderOf } from "../publishCopy";
import { docsOf, listing, seasonsOf, type ListedDoc } from "./leagueDocsFixture";

/*
 * The League Standings seasons a server builds the boards with (`cloudLeague.ts`): their documents
 * once there are any, read as a device reads them, and the copy's part until then. Placeholder
 * names throughout, from the seeded pool fixture.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 40 });
const EMPTY = { teams: [], matchups: [], logs: {} };
const SEASONS = seasonsOf(fixture.seasons);

/** The same seasons as a browser puts them in the copy's `league` part. */
const PART = { seasons: SEASONS };

const read = async (docs: readonly ListedDoc[]) => {
  const league = await readCloudLeague(listing(docs));
  if (!league.ok || league.from !== "docs") throw new Error("not read from the documents");
  return league;
};

describe("the seasons a server builds the boards with", () => {
  it("are the copy's part's while no season has a document, which fingerprints as nothing", async () => {
    const league = await readCloudLeague(NO_LEAGUE_DOCS);
    expect(league).toEqual({ ok: true, from: "copy" });
    if (!league.ok) throw new Error("refused");
    expect(leaguePrintOf(league)).toBe("");
  });

  it("are the documents' once there are any, each season as the copy's part held it, to the record", async () => {
    expect(SEASONS.length).toBeGreaterThan(1);
    const league = await read(docsOf(SEASONS));
    const fromPart = seasonReaderOf(JSON.parse(JSON.stringify(PART)));
    if (!fromPart) throw new Error("the part did not read");
    for (const { id } of SEASONS) {
      expect(league.readSeason(id)).toEqual(fromPart(id));
      expect(league.readSeason(id).matchups.length).toBeGreaterThan(0);
    }
    expect(league.seasons).toBe(SEASONS.length);
    // A season with no document reads empty, as a browser with no such season does.
    expect(league.readSeason("not-a-season")).toEqual(EMPTY);
  });

  it("leave a season deleted from the documents out, though the copy's part still holds it", async () => {
    const [gone, ...kept] = SEASONS;
    if (!gone) throw new Error("no seasons");
    const league = await read(docsOf(kept));
    expect(league.readSeason(gone.id)).toEqual(EMPTY);
  });

  it("fingerprint a score or a game changed, and not a name, a setting, the write or the listing's order", async () => {
    const base = (await read(docsOf(SEASONS))).print;
    const [first, ...rest] = SEASONS;
    const game = first?.matchups[0];
    if (!first || !game) throw new Error("no game");
    const scored: SeasonSnapshot = {
      ...first,
      logs: {
        ...first.logs,
        [game.id]: {
          awayRuns: "9",
          awayHits: "",
          awayK: "",
          homeRuns: "0",
          homeHits: "",
          homeK: "",
          innings: "6",
          isFinal: true,
        },
      },
    };
    const moved: SeasonSnapshot = {
      ...first,
      matchups: first.matchups.map((one) =>
        one.id === game.id ? { ...one, date: "2027-06-30" } : one
      ),
    };
    const renamed: SeasonSnapshot = {
      ...first,
      name: "Another name",
      settings: { ...DEFAULT_SETTINGS, goldCutoff: DEFAULT_SETTINGS.goldCutoff + 1 },
    };
    expect((await read(docsOf([scored, ...rest]))).print).not.toBe(base);
    expect((await read(docsOf([moved, ...rest]))).print).not.toBe(base);
    expect((await read(docsOf(rest))).print).not.toBe(base);
    expect((await read(docsOf([renamed, ...rest]))).print).toBe(base);
    expect((await read(docsOf(SEASONS, 7))).print).toBe(base);
    expect((await read(docsOf([...SEASONS].reverse()))).print).toBe(base);
  });

  it("are refused when a document is of a later layout, or is not a season's at all", async () => {
    const docs = docsOf(SEASONS);
    const [first, ...rest] = docs;
    if (!first) throw new Error("no documents");
    const newer = { ...first, fields: { ...first.fields, schema: LEAGUE_DOC_SCHEMA + 1 } };
    expect(await readCloudLeague(listing([...rest, newer]))).toEqual({
      ok: false,
      reason: "newer-league",
    });
    const junk = { ...first, fields: { schema: LEAGUE_DOC_SCHEMA } };
    expect(await readCloudLeague(listing([...rest, junk]))).toEqual({
      ok: false,
      reason: "league-unreadable",
    });
  });

  it("are listed from the seasons' collection when read through REST", async () => {
    const asked: string[] = [];
    const docs = restLeagueDocs({
      list: async (collection) => {
        asked.push(collection);
        return [];
      },
    });
    expect(await docs()).toEqual([]);
    expect(asked).toEqual([LEAGUE_COLLECTION]);
  });
});
