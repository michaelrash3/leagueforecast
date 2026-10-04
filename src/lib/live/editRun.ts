import {
  CommitUnanswered,
  commitChanges,
  fetchValues,
  type Change,
  type CloudStore,
  type CommitResult,
} from "../cloud/cloudEngine";
import type { CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import {
  loadAgeGroups,
  loadScoutGamesForYear,
  loadScoutTeams,
  readCloudPoolValue,
} from "../teamRankingsStorage";
import { ageGroupYear } from "../teamRankings/seasons";
import { isCopyCommand, isServerCommand, type PoolCommand } from "./commands";
import { keptBy, planCopyCommand, poolKeysOf } from "./copyOps";
import { runBackupRestore } from "./backupRestore";
import { NO_UPLOADS, type UploadReader, type UploadStore } from "../cloud/uploads";
import type { EditPool, PoolEnsure } from "./poolCache";
import { asksLeague, answerQuery, type PoolQuery, type QueryAnswer } from "./queries";
import { deriveAllKnown, type SeasonReader } from "./allKnown";
import { addOfNamed } from "./namedAdd";
import { readCloudLeague, type CloudLeague, type LeagueDocsList } from "./cloudLeague";
import { seasonReaderOf } from "./publishCopy";
import { EDIT_DEVICE } from "./rebuildPlan";
import { runPoolCommand } from "./runPoolCommand";
import { runYearArchive, runYearDelete } from "./yearOps";

/**
 * A Team Rankings edit run on the server, on the cloud copy (1.4): the command a device sends,
 * applied to the pool the server keeps warm (`createEditPool`), and the parts it
 * changed committed to the copy as one save. The same `applyCommand` a browser runs on its own store
 * (`runPoolCommand`), on this process's store, so the copy changes exactly as the device's pool
 * would have.
 *
 * A save that lands between the read and the commit moves the copy on: the written keys are let go
 * of (`forget`), the pool brought to the copy as it now is, and the command run again on that, up to
 * three times, as the nightly's own saves are. Commands carry their own ids and times, so a second
 * run makes the same change on the newer pool, or is refused where the pool no longer allows it.
 */

/** The name the copy's manifest gives an edit's saves, which the trigger rebuilds after soon. */
export { EDIT_DEVICE } from "./rebuildPlan";

/** Runs through before giving up on a copy that keeps moving. */
const MAX_TRIES = 3;

/**
 * Why an edit was not made.
 * - `missing`, `refused`: the command's own (`commands.ts`).
 * - `unsaved`: the server's store would not take a write.
 * - `copy-replaced`: the copy is not the one the device edited, or was started again under the run.
 * - `kept-moving`: other saves landed between each read and commit.
 * - `unsure`: the save went out and no answer came back, nor would the copy read to tell, so the
 *   edit may or may not be in it; the copy says which.
 * - `newer-league`: a year's archive, made with League Standings' games in it, met a season a newer
 *   build saved (`readCloudLeague`).
 * - `league-kept-live`: an earlier version to bring back carries League Standings, which lives in
 *   its own documents now (`copyOps.ts`).
 * - the copy's own refusals, as `PoolEnsure` names them.
 */
export type EditRefusal =
  | "missing"
  | "refused"
  | "unsaved"
  | "copy-replaced"
  | "unsure"
  | "newer-league"
  | "league-kept-live"
  | Extract<PoolEnsure, { ok: false }>["reason"];

export type EditRun =
  | {
      ok: true;
      /** The copy as the edit left it: the version its save made, or the one it found unchanged. */
      copy: string;
      version: number;
      /** What takes the edit back, as a command to send in turn. */
      inverse: PoolCommand;
      /** The copy's parts the save changed: none for an edit the copy already held. */
      changed: string[];
      /** Runs through: a second or third when a save moved the copy under the one before. */
      tries: number;
      /** How the last run through found the pool: started afresh, and the parts it fetched. */
      cold: boolean;
      fetched: number;
      /** How long the last run through took to bring the pool up, apply, and commit, in whole ms. */
      loadMs: number;
      applyMs: number;
      commitMs: number;
    }
  | { ok: false; why: EditRefusal; tries: number };

/** The pool's written keys as changes to the copy: each one's value now, or null for one gone. */
const changesOf = async (keys: ReadonlySet<string>, at: number): Promise<Change[]> => {
  const changes: Change[] = [];
  for (const key of [...keys].sort()) {
    changes.push({ key, value: (await readCloudPoolValue(key)) ?? null, at });
  }
  return changes;
};

/**
 * Runs `command` on the copy `store` holds: `pool` brought to it, the command applied, and the
 * changed parts committed onto the version read. `copy`, when given, is the copy the device edited,
 * and an edit is refused on any other. One at a time per process: `pool` is the process's store.
 */
export const runEdit = async ({
  pool,
  store,
  leagueDocs,
  uploads = NO_UPLOADS,
  command,
  copy,
  now,
  clock = () => performance.now(),
}: {
  pool: EditPool;
  store: CloudStore;
  /** The League Standings seasons' documents (`league/`), read only, for a year's archive. */
  leagueDocs: LeagueDocsList;
  /** What the copy's owner staged (`uploads.ts`): a backup to restore, deleted once restored. */
  uploads?: UploadStore;
  command: PoolCommand;
  copy?: string;
  now: () => string;
  /** A clock for the timings, which never steps back as the wall clock may. */
  clock?: () => number;
}): Promise<EditRun> => {
  let editing = copy ?? null;
  for (let tries = 1; tries <= MAX_TRIES; tries += 1) {
    const loading = clock();
    const ensured = await pool.ensure(store);
    const loadMs = Math.round(clock() - loading);
    if (!ensured.ok) return { ok: false, why: ensured.reason, tries };
    if (editing !== null && ensured.manifest.copy !== editing) {
      return { ok: false, why: "copy-replaced", tries };
    }
    editing = ensured.manifest.copy;

    /*
     * A run that is refused, throws, or whose commit throws leaves its writes unaccounted for, and a
     * pool written to that it was not told of starts afresh on its next read (`createPoolCache`):
     * slower, and never wrong. Only a commit the copy turned away is let go of key by key.
     */
    const applying = clock();
    const saving = await saveOf({
      command,
      manifest: ensured.manifest,
      leagueDocs,
      written: pool.written,
      now,
      runServer: () =>
        runServerCommand(command, {
          seasons: () => leagueOf(store, ensured.manifest, leagueDocs),
          uploads,
        }),
    });
    if (!saving.ok) return { ok: false, why: saving.why, tries };
    const applyMs = Math.round(clock() - applying);
    const committing = clock();
    let commit: CommitResult;
    try {
      commit = await commitChanges({
        store,
        base: ensured.manifest,
        changes: saving.changes,
        keepReplaced: saving.keepReplaced,
        keepWhole: saving.keepWhole,
        ...(saving.restore ? { restore: saving.restore } : {}),
        device: EDIT_DEVICE,
        now: now(),
      });
    } catch (error) {
      // The save went out, and neither an answer nor the copy says whether it landed: the writes
      // are let go of, so the next read fetches whatever the copy holds, and the device is told
      // the edit may or may not be in it. Anything else thrown is a save known not to have landed.
      if (!(error instanceof CommitUnanswered)) throw error;
      await pool.forget();
      return { ok: false, why: "unsure", tries };
    }
    const commitMs = Math.round(clock() - committing);
    if (commit.ok) {
      // The save is in the copy whatever the pool makes of it: one that cannot follow starts afresh.
      await pool.committed(commit.manifest).catch(() => pool.drop());
      // A restored backup's upload is used: deleted now, or by the nightly's sweep if this fails.
      if (command.kind === "backup.restore") {
        await uploads.remove(command.upload).catch(() => undefined);
      }
      // What the save moved, read off the two manifests: a value written as the copy already had
      // it is named from its own pieces, and a commit that moves nothing writes nothing.
      const was = new Map(ensured.manifest.parts.map((part) => [part.key, part.hash]));
      const after = new Map(commit.manifest.parts.map((part) => [part.key, part.hash]));
      return {
        ok: true,
        copy: commit.manifest.copy,
        version: commit.manifest.version,
        inverse: saving.inverse(ensured.manifest, commit.manifest),
        changed: [...new Set([...was.keys(), ...after.keys()])]
          .filter((key) => was.get(key) !== after.get(key))
          .sort(),
        tries,
        cold: ensured.cold,
        fetched: ensured.fetched.length,
        loadMs,
        applyMs,
        commitMs,
      };
    }
    await pool.forget();
  }
  return { ok: false, why: "kept-moving", tries: MAX_TRIES };
};

/** What takes back an owner's command that is never taken back. */
const NOT_TAKEN_BACK: PoolCommand = { kind: "none" };

/**
 * What an edit saves to the copy, and what takes it back once saved: a pool command's (or a year's)
 * writes to the process's store as changes, or a copy command's save of the manifest itself
 * (`copyOps.ts`), which writes nothing to the store, so the pool follows it on its next read.
 */
type Saving =
  | {
      ok: true;
      changes: Change[];
      keepReplaced: string[];
      keepWhole: boolean;
      restore?: string;
      inverse: (before: CloudManifest, after: CloudManifest) => PoolCommand;
    }
  | { ok: false; why: EditRefusal };

const saveOf = async ({
  command,
  manifest,
  leagueDocs,
  written,
  now,
  runServer,
}: {
  command: PoolCommand;
  manifest: CloudManifest;
  leagueDocs: LeagueDocsList;
  /** The keys the command wrote to the process's store (`EditPool.written`). */
  written: () => ReadonlySet<string>;
  now: () => string;
  runServer: () => ReturnType<typeof runServerCommand>;
}): Promise<Saving> => {
  if (isCopyCommand(command)) {
    let planned: Awaited<ReturnType<typeof planCopyCommand>>;
    try {
      planned = await planCopyCommand(
        command,
        manifest,
        Date.parse(now()),
        async () => (await leagueDocs()).length > 0
      );
    } catch {
      // The League documents would not list, so whether League Standings is kept live is unknown.
      return { ok: false, why: "store-refused" };
    }
    if (!planned.ok) return planned;
    return {
      ...planned,
      // A start is undone by bringing back what it kept; a version brought back is not taken back,
      // as on a device: what it replaced is kept, to be brought back in its turn.
      inverse: (before, after) => {
        const kept = command.kind === "copy.reset" ? keptBy(before, after) : null;
        return kept ? { kind: "copy.restore", group: kept } : NOT_TAKEN_BACK;
      },
    };
  }
  const run = isServerCommand(command) ? await runServer() : runPoolCommand(command);
  if (!run.ok) return run;
  const changes = await changesOf(written(), Date.parse(now()));
  // A restore keeps Team Rankings whole as it stood, as a start of it does, so bringing that
  // version back from the Cloud panel undoes the restore, a year or an archive it added included;
  // every other edit keeps nothing, as before.
  const keep = command.kind === "backup.restore";
  return {
    ok: true,
    changes,
    keepReplaced: keep ? poolKeysOf(manifest) : [],
    keepWhole: keep,
    inverse: () => run.inverse,
  };
};

/**
 * A command only the server runs, on the process's store: the owner's (`yearOps.ts`,
 * `backupRestore.ts`), a year's archive among them made with League Standings' seasons as the
 * boards are built with them (`seasons`, read only); and games added by their clubs' names
 * (`game.import`), resolved against the year's clubs as the page knows them, League Standings'
 * among them, and added as the device's Games tab adds them (`namedAdd.ts`). What it wrote is what
 * the edit commits, as a pool command's is.
 */
const runServerCommand = async (
  command: PoolCommand,
  {
    seasons,
    uploads,
  }: { seasons: () => Promise<SeasonReader | QueryRefusal>; uploads: UploadReader }
): Promise<{ ok: true; inverse: PoolCommand } | { ok: false; why: EditRefusal }> => {
  if (command.kind === "backup.restore") {
    const done = await runBackupRestore(uploads, command.upload);
    return done.ok ? { ok: true, inverse: NOT_TAKEN_BACK } : done;
  }
  if (command.kind === "year.delete") {
    const done = await runYearDelete(command.year);
    return done.ok ? { ok: true, inverse: NOT_TAKEN_BACK } : done;
  }
  if (command.kind !== "year.archive" && command.kind !== "game.import") {
    return { ok: false, why: "refused" };
  }
  const read = await seasons();
  if (typeof read === "string") {
    // Only the copy's own refusals, and a season a newer build saved, come of reading seasons.
    return { ok: false, why: read === "day-spent" || read === "month-spent" ? "refused" : read };
  }
  if (command.kind === "game.import") {
    const ageGroups = loadAgeGroups();
    const page = ageGroups.find((group) => group.id === command.page);
    if (!page) return { ok: false, why: "missing" };
    const roster = loadScoutTeams();
    const known = deriveAllKnown({
      ageGroups,
      teams: roster,
      yearGames: loadScoutGamesForYear(ageGroupYear(page)),
      readSeason: read,
    });
    const run = runPoolCommand(
      addOfNamed({
        year: command.year,
        page: page.id,
        named: command.games,
        known: known.teams,
        roster,
      })
    );
    return run.ok ? { ok: true, inverse: run.inverse } : run;
  }
  const done = await runYearArchive(command.year, read, command.at);
  return done.ok ? { ok: true, inverse: NOT_TAKEN_BACK } : done;
};

/**
 * Why a question was not answered: the copy is not the one asked about, or would not load; or,
 * for a question that refits a year, the day's or the month's compute is spent (`day-spent`,
 * `month-spent`, said by `handleQuery` before the question reaches the pool).
 */
export type QueryRefusal =
  | "copy-replaced"
  | "day-spent"
  | "month-spent"
  | "newer-league"
  | Extract<PoolEnsure, { ok: false }>["reason"];

export type QueryRun =
  | {
      ok: true;
      /** The copy and version the answer was worked out on. */
      copy: string;
      version: number;
      answer: QueryAnswer;
      /** How the pool was found: started afresh, the parts it fetched, and the time each step took. */
      cold: boolean;
      fetched: number;
      loadMs: number;
      answerMs: number;
    }
  | { ok: false; why: QueryRefusal };

/** The copy's League Standings seasons as last read, by the part they were read from. */
let leagueRead: { id: string; hash: string; seasons: SeasonReader } | null = null;

/**
 * The League Standings seasons the boards are built with (`readCloudLeague`): their documents', read
 * afresh for each question, or with none, those of `manifest`'s part (`seasonReaderOf`), read once
 * for each version of it, since an edit's pool leaves League out (no command reads it) and only a
 * question that refits a year needs it; or why they could not be read.
 */
const leagueOf = async (
  store: CloudStore,
  manifest: CloudManifest,
  leagueDocs: LeagueDocsList
): Promise<SeasonReader | QueryRefusal> => {
  let league: CloudLeague;
  try {
    league = await readCloudLeague(leagueDocs);
  } catch {
    return "store-refused";
  }
  if (!league.ok) return league.reason;
  if (league.from === "docs") return league.readSeason;
  const part = manifest.parts.find(({ key }) => key === LEAGUE_PART);
  if (!part) return seasonReaderOf(undefined) ?? "league-unreadable";
  const held = leagueRead;
  if (held?.id === part.id && held.hash === part.hash) return held.seasons;
  /*
   * The question is refused for what kept it from the part, and the worker kept: a store that
   * would not answer once threw out of the question and ended the worker, and the pool it kept
   * warm, for a question that writes nothing; and a piece not there read as a copy that kept
   * moving, which a damaged part would be said to be for ever.
   */
  let fetched: Awaited<ReturnType<typeof fetchValues>>;
  try {
    fetched = await fetchValues({ store, parts: [part] });
  } catch {
    return "store-refused";
  }
  if (!fetched.ok) {
    if (fetched.reason === "damaged") return "damaged";
    // A piece not there: the part replaced since the manifest was read, or the part damaged.
    const now = await store.readManifest().catch(() => undefined);
    if (now === undefined) return "store-refused";
    const still = now?.parts.find(({ key }) => key === LEAGUE_PART);
    return still?.id === part.id && still.hash === part.hash ? "damaged" : "kept-moving";
  }
  const seasons = seasonReaderOf(fetched.values.get(LEAGUE_PART));
  if (!seasons) return "league-unreadable";
  leagueRead = { id: part.id, hash: part.hash, seasons };
  return seasons;
};

/**
 * Answers `query` on the copy `store` holds (`answerQuery`): `pool` brought to it, as an edit's is,
 * and nothing written. A question that refits a year is answered with the copy's League Standings
 * seasons, as the boards on screen were built (`leagueOf`). `copy`, when given, is the copy the device asked about, and a question about
 * any other is refused, since its answer would be of another copy's clubs.
 */
export const runQuery = async ({
  pool,
  store,
  leagueDocs,
  query,
  copy,
  clock = () => performance.now(),
}: {
  pool: EditPool;
  store: CloudStore;
  /** The League Standings seasons' documents (`league/`), read only. */
  leagueDocs: LeagueDocsList;
  query: PoolQuery;
  copy?: string;
  clock?: () => number;
}): Promise<QueryRun> => {
  const loading = clock();
  const ensured = await pool.ensure(store);
  const loadMs = Math.round(clock() - loading);
  if (!ensured.ok) return { ok: false, why: ensured.reason };
  if (copy !== undefined && ensured.manifest.copy !== copy) {
    return { ok: false, why: "copy-replaced" };
  }
  const answering = clock();
  const seasons = asksLeague(query)
    ? await leagueOf(store, ensured.manifest, leagueDocs)
    : undefined;
  if (typeof seasons === "string") return { ok: false, why: seasons };
  const answer = answerQuery(query, seasons);
  return {
    ok: true,
    copy: ensured.manifest.copy,
    version: ensured.manifest.version,
    answer,
    cold: ensured.cold,
    fetched: ensured.fetched.length,
    loadMs,
    answerMs: Math.round(clock() - answering),
  };
};
