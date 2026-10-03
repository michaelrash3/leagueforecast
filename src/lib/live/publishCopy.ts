import { coerceBackup } from "../backup";
import { fetchValues, type CloudStore } from "../cloud/cloudEngine";
import type { CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import { latestImportedAt } from "../gameChangerImport";
import {
  loadAgeGroups,
  loadNamedAges,
  loadScoutGamesForYear,
  loadScoutTeams,
} from "../teamRankingsStorage";
import type { LeagueSeasonData, SeasonReader } from "./allKnown";
import { BOARD_FAMILY, builtFrom } from "./boardInputs";
import { boardViews, buildBoardsAndFacts, livePagesOf } from "./views/board";
import { clubViews } from "./views/clubs";
import { CLUB_FAMILY } from "./views/clubShape";
import { publishViews, sweepViews, type LiveStore, type PublishResult } from "./viewStore";

/**
 * What a server publishes after it has saved the copy: every board, built from the pool its own
 * store holds in memory and the copy's League Standings, published to `live/` (`viewStore.ts`), and
 * then a sweep of what readers can no longer be fetching. The nightly refresh runs it; it is kept
 * out of the script so it is tested.
 */

const NOTHING: LeagueSeasonData = { teams: [], matchups: [], logs: {} };

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
  return (seasonId) => seasons.get(seasonId) ?? NOTHING;
};

/** The collation the boards were built under: rows that tie are put in name order by it. */
export const boardLocale = (): string => new Intl.Collator().resolvedOptions().locale;

/**
 * `store` with nothing written or deleted, for a dry run. What it would have deleted it leaves out
 * of its listing, as the store would be after the deletes, so a sweep does not count a piece it
 * would have deleted as a stray as well.
 */
export const dryLiveStore = (store: LiveStore): LiveStore => {
  const gone = new Set<string>();
  return {
    readMeta: () => store.readMeta(),
    commitMeta: async () => true,
    putChunk: async () => undefined,
    getChunk: (id) => store.getChunk(id),
    deleteChunk: async (id) => {
      gone.add(id);
    },
    listChunks: async () => (await store.listChunks()).filter(({ id }) => !gone.has(id)),
  };
};

export type CopyPublish =
  | {
      ok: true;
      /** The boards and the buckets of club cards built, and how long building them took. */
      boards: number;
      clubs: number;
      buildMs: number;
      publish: Extract<PublishResult, { ok: true }>;
      /** The sweep after it, or why it stopped: the views are published either way. */
      sweep: { ok: true; deleted: number; strays: number } | { ok: false; why: string };
    }
  | {
      ok: false;
      /**
       * `copy-moved`: the copy no longer names the League Standings part this run's copy did,
       * because a device saved it during the run, so the pool held here is not the copy's and
       * nothing is published; the next run publishes. `copy-replaced`: the copy was deleted and
       * started again by the time the boards were to be committed, so they are another copy's;
       * publishing them would replace the fresh copy's, since two copies have no order.
       */
      reason:
        | "locale"
        | "league-unreadable"
        | "copy-moved"
        | "copy-replaced"
        | Exclude<Extract<PublishResult, { ok: false }>["reason"], "not-current">;
    };

/**
 * Builds every board on every page, year and half from the pool in this process's store, which
 * must be the copy `manifest` names (the run that saved it, or found nothing to save, says so), and
 * publishes them under that copy and version for the members' day `today`.
 *
 * It refuses under any collation but English, the one the members' browsers sort ties by, rather
 * than publish boards whose tied rows sit in another order than the page would put them. The
 * League Standings seasons come from the copy itself, read from `copyStore`: a pull never touches
 * them, so a dry run's would-be copy still names the copy's own pieces, unless a device saved them
 * during the run, which deletes the pieces they replace at once. A part that cannot be read is put
 * down to that when the copy no longer names it, and to damage only when it still does.
 */
export const publishCopyViews = async ({
  copyStore,
  liveStore,
  manifest,
  today,
  now,
  readSeason: seasonsHeld,
  sweep: sweeping = "full",
  locale = boardLocale(),
}: {
  copyStore: CloudStore;
  liveStore: LiveStore;
  manifest: CloudManifest;
  today: string;
  /** The time, as an ISO string, asked for as each step starts. */
  now: () => string;
  /** The seasons of `manifest`'s own League Standings part, when the caller has read them. */
  readSeason?: SeasonReader;
  /**
   * `full`, a sweep after the publish, strays and all (the nightly's); `due`, only the retired
   * uploads past their grace, taken out by the publish's own commit when it writes anyway.
   */
  sweep?: "full" | "due";
  locale?: string;
}): Promise<CopyPublish> => {
  if (!/^en(-|$)/.test(locale)) return { ok: false, reason: "locale" };
  const leagueOf = (copy: CloudManifest | null) =>
    copy?.parts.find((one) => one.key === LEAGUE_PART) ?? null;
  const ours = leagueOf(manifest);
  const fetched = seasonsHeld
    ? null
    : await fetchValues({ store: copyStore, parts: ours ? [ours] : [] });
  const readSeason =
    seasonsHeld ?? (fetched?.ok ? seasonReaderOf(fetched.values.get(LEAGUE_PART)) : null);
  if (!readSeason) {
    // By part, not by version: a dry run's would-be copy has a version the store never had.
    const current = await copyStore.readManifest();
    const theirs = leagueOf(current);
    const moved =
      current?.copy !== manifest.copy || theirs?.id !== ours?.id || theirs?.hash !== ours?.hash;
    return { ok: false, reason: moved ? "copy-moved" : "league-unreadable" };
  }

  const started = Date.now();
  const ageGroups = loadAgeGroups();
  const teams = loadScoutTeams();
  const built = buildBoardsAndFacts({
    ageGroups,
    teams,
    gamesOfYear: loadScoutGamesForYear,
    readSeason,
    today,
  });
  const boards = boardViews(ageGroups, built);
  // Each club's card, from what the boards' build derived, published with them and vouched for by
  // the same record: they read the same inputs (`isBoardInput`).
  const clubs = clubViews({ ageGroups, built, namedAges: loadNamedAges() });
  const views = [...boards, ...clubs];
  const pages = livePagesOf(built, latestImportedAt(teams));
  const buildMs = Date.now() - started;

  const publish = await publishViews({
    store: liveStore,
    views,
    owns: [BOARD_FAMILY, CLUB_FAMILY],
    copy: { id: manifest.copy, version: manifest.version },
    today,
    now: now(),
    // What they were built from, so a rebuild finding the same copy, inputs, day and rules stops.
    built: { family: BOARD_FAMILY, from: await builtFrom(manifest, today) },
    // What a device lays the page out by before it reads a board, published with the boards.
    inline: { pages },
    collectDue: sweeping === "due",
    // Read again just before each commit, uploads and retries included: a copy started again
    // while the boards were built or went up is not theirs.
    stillCurrent: async () => (await copyStore.readManifest())?.copy === manifest.copy,
  });
  if (!publish.ok) {
    return {
      ok: false,
      reason: publish.reason === "not-current" ? "copy-replaced" : publish.reason,
    };
  }
  // The views are out once the meta is committed; a sweep that fails after says so on its own.
  let sweep: Extract<CopyPublish, { ok: true }>["sweep"];
  if (sweeping === "due") {
    return {
      ok: true,
      boards: boards.length,
      clubs: clubs.length,
      buildMs,
      publish,
      sweep:
        publish.undeleted > 0
          ? {
              ok: false,
              why: `${publish.undeleted} retired pieces past their grace could not be deleted`,
            }
          : { ok: true, deleted: publish.deleted, strays: 0 },
    };
  }
  try {
    const swept = await sweepViews({ store: liveStore, now: now() });
    sweep = swept.ok ? swept : { ok: false, why: swept.reason };
  } catch (error) {
    sweep = { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, boards: boards.length, clubs: clubs.length, buildMs, publish, sweep };
};
