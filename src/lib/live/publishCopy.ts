import { coerceBackup } from "../backup";
import { fetchValues, type CloudStore } from "../cloud/cloudEngine";
import type { CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import { loadAgeGroups, loadScoutGamesForYear, loadScoutTeams } from "../teamRankingsStorage";
import type { LeagueSeasonData, SeasonReader } from "./allKnown";
import { boardViews, buildAllBoards } from "./views/board";
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
      /** The boards built, and how long building them took. */
      boards: number;
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
       * nothing is published; the next run publishes.
       */
      reason:
        | "locale"
        | "league-unreadable"
        | "copy-moved"
        | Extract<PublishResult, { ok: false }>["reason"];
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
  locale = boardLocale(),
}: {
  copyStore: CloudStore;
  liveStore: LiveStore;
  manifest: CloudManifest;
  today: string;
  /** The time, as an ISO string, asked for as each step starts. */
  now: () => string;
  locale?: string;
}): Promise<CopyPublish> => {
  if (!/^en(-|$)/.test(locale)) return { ok: false, reason: "locale" };
  const leagueOf = (copy: CloudManifest | null) =>
    copy?.parts.find((one) => one.key === LEAGUE_PART) ?? null;
  const ours = leagueOf(manifest);
  const fetched = await fetchValues({ store: copyStore, parts: ours ? [ours] : [] });
  const readSeason = fetched.ok ? seasonReaderOf(fetched.values.get(LEAGUE_PART)) : null;
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
  const views = boardViews(
    ageGroups,
    buildAllBoards({
      ageGroups,
      teams: loadScoutTeams(),
      gamesOfYear: loadScoutGamesForYear,
      readSeason,
      today,
    })
  );
  const buildMs = Date.now() - started;

  const publish = await publishViews({
    store: liveStore,
    views,
    owns: ["board:"],
    copy: { id: manifest.copy, version: manifest.version },
    today,
    now: now(),
  });
  if (!publish.ok) return publish;
  // The views are out once the meta is committed; a sweep that fails after says so on its own.
  let sweep: Extract<CopyPublish, { ok: true }>["sweep"];
  try {
    const swept = await sweepViews({ store: liveStore, now: now() });
    sweep = swept.ok ? swept : { ok: false, why: swept.reason };
  } catch (error) {
    sweep = { ok: false, why: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, boards: views.length, buildMs, publish, sweep };
};
