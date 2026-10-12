import { hashValue } from "../cloud/cloudPack";
import type { FirestoreRestDocuments } from "../cloud/firestoreRest";
import type { LeagueSeasonData, SeasonReader } from "./allKnown";
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
  ReadonlyArray<{ id: string; fields: Record<string, unknown> }>
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
    readSeason: (seasonId) => seasons.get(seasonId) ?? NOTHING,
    print: await hashValue(held),
    seasons: held.length,
  };
};

/** The fingerprint a board's record carries for `league`: none when League is the copy's part. */
export const leaguePrintOf = (league: Extract<CloudLeague, { ok: true }>): string =>
  league.from === "docs" ? league.print : "";
