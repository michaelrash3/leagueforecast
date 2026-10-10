import { coerceBackup } from "../backup";
import { fetchValues, type CloudStore } from "../cloud/cloudEngine";
import type { CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import { latestImportedAt } from "../gameChangerImport";
import {
  loadAgeGroups,
  loadAgeUnknown,
  loadDroppedClubs,
  loadNamedAges,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTooYoungClubs,
} from "../teamRankingsStorage";
import type { LeagueSeasonData, SeasonReader } from "./allKnown";
import { BOARD_FAMILY, builtFrom } from "./boardInputs";
import {
  leaguePrintOf,
  NO_LEAGUE_DOCS,
  readCloudLeague,
  type CloudLeague,
  type LeagueDocsList,
} from "./cloudLeague";
import { boardViews, buildBoardsAndFacts, livePagesOf } from "./views/board";
import { clubViews } from "./views/clubs";
import { CLUB_FAMILY } from "./views/clubShape";
import { gamesViews } from "./views/games";
import { GAMES_FAMILY } from "./views/gamesShape";
import { searchViews } from "./views/search";
import { SEARCH_FAMILY } from "./views/searchShape";
import { publishViews, sweepViews, type LiveStore, type PublishResult } from "./viewStore";

/**
 * What a server publishes after it has saved the copy: every board, built from the pool its own
 * store holds in memory and the League Standings seasons (`cloudLeague.ts`), published to `live/`
 * (`viewStore.ts`), and then a sweep of what readers can no longer be fetching. The nightly refresh
 * runs it; it is kept out of the script so it is tested.
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
      /**
       * The boards, the buckets of club cards, the years' Find a team lists and the pages' Games
       * lists built, and how long building them took.
       */
      boards: number;
      clubs: number;
      searches: number;
      games: number;
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
       * `league-moved`: a season's document changed by the time the boards were to be committed,
       * so they would put older scores over boards a rebuild since may have published with the
       * new ones; that change asks for its own rebuild. `newer-league`, `league-unreadable`: a
       * season's document this build cannot read (`readCloudLeague`), or the copy's part.
       */
      reason:
        | "locale"
        | "league-unreadable"
        | "newer-league"
        | "copy-moved"
        | "copy-replaced"
        | "league-moved"
        | Exclude<Extract<PublishResult, { ok: false }>["reason"], "not-current">;
    };

/**
 * Refusals that are not the publishing run's doing. A copy or a season saved during the run asks
 * for its own rebuild (`copy-moved`, `league-moved`). And views a newer build, newer rules or a
 * later day published first are what a rebuild stands aside for too (`isRebuildFailure`), and only
 * servers publish views: a deploy that lands while the nightly runs, on the build it checked out
 * before, has its own functions or the republish after it publish first, and the night saved all
 * the same. A season a newer build saved (`newer-league`) is not among them, since a device of any
 * build saves seasons, and a nightly that stood aside for one would never say it.
 */
const NOT_THE_RUNS: ReadonlySet<Extract<CopyPublish, { ok: false }>["reason"]> = new Set([
  "copy-moved",
  "league-moved",
  "newer-schema",
  "older-rules",
  "older-day",
] as const);

/**
 * Whether a run that published the copy's views (`scripts/nightly.ts`) failed at it: a refusal
 * that is not `NOT_THE_RUNS`, or, once the views are out, a sweep that stopped, the night's own
 * housekeeping.
 */
export const publishFailedRun = (views: CopyPublish): boolean =>
  views.ok ? !views.sweep.ok : !NOT_THE_RUNS.has(views.reason);

/**
 * Builds every board on every page, year and half from the pool in this process's store, which
 * must be the copy `manifest` names (the run that saved it, or found nothing to save, says so), and
 * publishes them under that copy and version for the members' day `today`.
 *
 * It refuses under any collation but English, the one the members' browsers sort ties by, rather
 * than publish boards whose tied rows sit in another order than the page would put them. The
 * League Standings seasons are their documents' (`leagueDocs`), read once, unless the caller read
 * them (`league`), and read again before each commit, which a change since turns away
 * (`league-moved`). With no document, they come from the copy itself, read from `copyStore`: a
 * pull never touches them, so a dry run's would-be copy still names the copy's own pieces, unless
 * a device saved them during the run, which deletes the pieces they replace at once. A part that
 * cannot be read is put down to that when the copy no longer names it, and to damage only when it
 * still does.
 */
export const publishCopyViews = async ({
  copyStore,
  liveStore,
  manifest,
  today,
  now,
  readSeason: seasonsHeld,
  leagueDocs = NO_LEAGUE_DOCS,
  league: leagueRead,
  sweep: sweeping = "full",
  locale = boardLocale(),
  atVersion = false,
}: {
  copyStore: CloudStore;
  liveStore: LiveStore;
  manifest: CloudManifest;
  today: string;
  /** The time, as an ISO string, asked for as each step starts. */
  now: () => string;
  /** The seasons of `manifest`'s own League Standings part, when the caller has read them. */
  readSeason?: SeasonReader;
  /** The seasons' documents (`league/`); none by default. */
  leagueDocs?: LeagueDocsList;
  /** What `leagueDocs` held, when the caller has read them for the same run. */
  league?: CloudLeague;
  /**
   * `full`, a sweep after the publish, strays and all (the nightly's); `due`, only the retired
   * uploads past their grace, taken out by the publish's own commit when it writes anyway.
   */
  sweep?: "full" | "due";
  locale?: string;
  /**
   * Whether the boards stand only while the copy is still at `manifest`'s version, not only the
   * same copy: refused as `copy-moved` once a save has moved it on. The republish after a deploy
   * asks it, since its publish over an older schema's meta is never late (`publishViews`), so the
   * marks would not keep it from putting back a version saved since; the nightly's is the save it
   * just made, which a later one's marks hold.
   */
  atVersion?: boolean;
}): Promise<CopyPublish> => {
  if (!/^en(-|$)/.test(locale)) return { ok: false, reason: "locale" };
  const league = leagueRead ?? (await readCloudLeague(leagueDocs));
  if (!league.ok) return { ok: false, reason: league.reason };
  const leaguePrint = leaguePrintOf(league);
  let readSeason: SeasonReader | null;
  if (league.from === "docs") readSeason = league.readSeason;
  else {
    const leagueOf = (copy: CloudManifest | null) =>
      copy?.parts.find((one) => one.key === LEAGUE_PART) ?? null;
    const ours = leagueOf(manifest);
    const fetched = seasonsHeld
      ? null
      : await fetchValues({ store: copyStore, parts: ours ? [ours] : [] });
    readSeason =
      seasonsHeld ?? (fetched?.ok ? seasonReaderOf(fetched.values.get(LEAGUE_PART)) : null);
    if (!readSeason) {
      // By part, not by version: a dry run's would-be copy has a version the store never had.
      const current = await copyStore.readManifest();
      const theirs = leagueOf(current);
      const moved =
        current?.copy !== manifest.copy || theirs?.id !== ours?.id || theirs?.hash !== ours?.hash;
      return { ok: false, reason: moved ? "copy-moved" : "league-unreadable" };
    }
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
  // Each year's Find a team list, likewise, with the ids the copy keeps off every page.
  const searches = searchViews({
    ageGroups,
    built,
    storedGames: loadScoutGames(),
    held: { dropped: loadDroppedClubs(), ageless: loadAgeUnknown(), tooYoung: loadTooYoungClubs() },
  });
  // And each page's Games list.
  const games = gamesViews({ ageGroups, built, gamesOfYear: loadScoutGamesForYear });
  const views = [...boards, ...clubs, ...searches, ...games];
  // With the copy's age groups, so a device that has never held the pool can lay the page out.
  const pages = livePagesOf(built, latestImportedAt(teams), ageGroups);
  const buildMs = Date.now() - started;

  /**
   * Whether the last look before a commit found the seasons changed since they were read, or the
   * copy saved on from the version built (only where held to it, `atVersion`).
   */
  let leagueMoved = false;
  let versionMoved = false;
  const publish = await publishViews({
    store: liveStore,
    views,
    owns: [BOARD_FAMILY, CLUB_FAMILY, SEARCH_FAMILY, GAMES_FAMILY],
    copy: { id: manifest.copy, version: manifest.version },
    today,
    now: now(),
    // What they were built from, so a rebuild finding the same copy, inputs, seasons, day and
    // rules stops.
    built: { family: BOARD_FAMILY, from: await builtFrom(manifest, today, leaguePrint) },
    // What a device lays the page out by before it reads a board, published with the boards.
    inline: { pages },
    collectDue: sweeping === "due",
    // Read again just before each commit, uploads and retries included: a copy started again
    // while the boards were built or went up is not theirs, and nor are seasons changed since.
    stillCurrent: async () => {
      const held = await copyStore.readManifest();
      if (held?.copy !== manifest.copy) return false;
      versionMoved = atVersion && held.version !== manifest.version;
      if (versionMoved) return false;
      const now = await readCloudLeague(leagueDocs);
      leagueMoved = !now.ok || leaguePrintOf(now) !== leaguePrint;
      return !leagueMoved;
    },
  });
  if (!publish.ok) {
    if (publish.reason !== "not-current") return { ok: false, reason: publish.reason };
    return {
      ok: false,
      reason: leagueMoved ? "league-moved" : versionMoved ? "copy-moved" : "copy-replaced",
    };
  }
  // The views are out once the meta is committed; a sweep that fails after says so on its own.
  let sweep: Extract<CopyPublish, { ok: true }>["sweep"];
  if (sweeping === "due") {
    return {
      ok: true,
      boards: boards.length,
      clubs: clubs.length,
      searches: searches.length,
      games: games.length,
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
  return {
    ok: true,
    boards: boards.length,
    clubs: clubs.length,
    searches: searches.length,
    games: games.length,
    buildMs,
    publish,
    sweep,
  };
};
