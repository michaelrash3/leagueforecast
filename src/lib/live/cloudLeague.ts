import { coerceBackup } from "../backup";
import { fetchValues, type CloudStore } from "../cloud/cloudEngine";
import type { CloudManifest } from "../cloud/cloudManifest";
import { hashValue } from "../cloud/cloudPack";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import type { FirestoreRestDocuments } from "../cloud/firestoreRest";
import { seasonsReader, type LeagueSeasonData, type SeasonReader } from "./allKnown";
import { docToSeason, LEAGUE_COLLECTION } from "./leagueDocs";

/**
 * The League Standings seasons a server builds the boards with, from where League is kept: the
 * seasons' own documents (`league/{season}`, `leagueDocs.ts`) once there are any, and until then
 * the cloud copy's `league` part, as it has been.
 *
 * A device with League live writes its seasons to their documents and leaves the copy's part alone
 * (`cloudSession.ts`), and on its first visit sends up every season it holds that the cloud lacks
 * (`leagueSeasons.ts`), so once any document is there, the documents are League and the copy's part
 * is only what the devices held before. Reading a season from the part beside the documents would
 * bring back one deleted since: the part keeps it, and nothing tells the two apart.
 */

/** Every document of the seasons' collection, with its id and its fields as plain values. */
export type LeagueDocsList = () => Promise<
  ReadonlyArray<{ id: string; fields: Record<string, unknown>; updatedAt?: string }>
>;

/** None: what a server with no documents to read, or a test, hands over. */
export const NO_LEAGUE_DOCS: LeagueDocsList = async () => [];

/** The seasons' documents as a server reads them, through Firestore's REST interface. */
export const restLeagueDocs =
  (docs: Pick<FirestoreRestDocuments, "list">): LeagueDocsList =>
  () =>
    docs.list(LEAGUE_COLLECTION);

export type CloudLeague =
  /** No season has a document: the copy's own part is League, as it was before. */
  | { ok: true; from: "copy" }
  | {
      ok: true;
      from: "docs";
      readSeason: SeasonReader;
      /**
       * A fingerprint of what the boards read of the seasons, each one's teams, games and scores by
       * its id, in id order: a score or a game changes it, and a season's name or settings, which no
       * board reads, leave it as it was.
       */
      print: string;
      seasons: number;
      /** The seasons' ids, in id order: whose answers are published beside the boards. */
      ids: string[];
    }
  /**
   * `newer-league`: a season's document is of a later layout than this build reads, written by a
   * newer version of the app; `league-unreadable`: one is not a season's document at all.
   */
  | { ok: false; reason: "newer-league" | "league-unreadable" };

const NOTHING: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

/**
 * The seasons the documents `list` hands back hold, read as a device reads them (`docToSeason`:
 * every record through the validators storage reads with), so a server and a device holding the
 * same season hand the boards the same teams, games and scores. A season's document that cannot be
 * read stops the read, as a copy's part that cannot be is: boards built without it would drop its
 * games from every rating it reaches.
 */
export const readCloudLeague = async (list: LeagueDocsList): Promise<CloudLeague> => {
  const docs = await list();
  if (docs.length === 0) return { ok: true, from: "copy" };
  const seasons = new Map<string, LeagueSeasonData>();
  for (const { id, fields } of docs) {
    const read = docToSeason(fields, id);
    if (!read.ok) {
      return { ok: false, reason: read.reason === "newer" ? "newer-league" : "league-unreadable" };
    }
    const { teams, matchups, logs } = read.season;
    seasons.set(read.season.id, { teams, matchups, logs });
  }
  const held = [...seasons].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    ok: true,
    from: "docs",
    readSeason: seasonsReader(seasons),
    print: await hashValue(held),
    seasons: held.length,
    ids: held.map(([id]) => id),
  };
};

/** The fingerprint a board's record carries for `league`: none when League is the copy's part. */
export const leaguePrintOf = (league: Extract<CloudLeague, { ok: true }>): string =>
  league.from === "docs" ? league.print : "";

/**
 * The seasons a copy's `league` part holds, as a `SeasonReader`: each read the way a backup file
 * is (`coerceBackup`), which coerces teams, schedule and results as a browser's storage loaders do,
 * so a server and a browser holding the same copy hand the boards the same seasons. A copy with no
 * part, or one with no seasons, reads every id as empty, as a browser with no such season does.
 * Null for a part that holds something else, which a browser would refuse to take in.
 */
export const seasonReaderOf = (league: unknown): SeasonReader | null => {
  if (league === undefined || league === null) return () => NOTHING;
  const record = league as { seasons?: unknown };
  if (Array.isArray(record.seasons) && record.seasons.length === 0) return () => NOTHING;
  const parsed = coerceBackup(league);
  if (parsed?.kind !== "full") return null;
  const seasons = new Map(
    parsed.backup.seasons.map(({ id, teams, matchups, logs }) => [id, { teams, matchups, logs }])
  );
  return seasonsReader(seasons);
};

/**
 * The League Standings seasons as the boards read them for `manifest` (`publishCopyViews`): their
 * documents once there are any, and until then the copy's own part, read apart from the pool,
 * which a pull loads without it. Null where they cannot be read: a document of a newer layout or
 * none at all, the part missing, damaged or of something else, or the store not answering. A
 * caller that guards on what League links has to know it could not look, not be handed nobody.
 */
export const leagueSeasonsOf = async (
  store: CloudStore,
  manifest: CloudManifest,
  leagueDocs: LeagueDocsList
): Promise<SeasonReader | null> => {
  try {
    const league = await readCloudLeague(leagueDocs);
    if (!league.ok) return null;
    if (league.from === "docs") return league.readSeason;
    const part = manifest.parts.find((one) => one.key === LEAGUE_PART);
    if (!part) return seasonReaderOf(undefined);
    const fetched = await fetchValues({ store, parts: [part] });
    return fetched.ok ? seasonReaderOf(fetched.values.get(LEAGUE_PART)) : null;
  } catch {
    return null;
  }
};
