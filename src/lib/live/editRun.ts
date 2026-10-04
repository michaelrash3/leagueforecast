import {
  CommitUnanswered,
  commitChanges,
  type Change,
  type CloudStore,
  type CommitResult,
} from "../cloud/cloudEngine";
import { readCloudPoolValue } from "../teamRankingsStorage";
import type { PoolCommand } from "./commands";
import type { EditPool, PoolEnsure } from "./poolCache";
import { runPoolCommand } from "./runPoolCommand";

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

/** The name the copy's manifest gives an edit's saves: a server publishing its own boards. */
export const EDIT_DEVICE = "live-edit";

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
 * - the copy's own refusals, as `PoolEnsure` names them.
 */
export type EditRefusal =
  | "missing"
  | "refused"
  | "unsaved"
  | "copy-replaced"
  | "unsure"
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
  command,
  copy,
  now,
  clock = () => performance.now(),
}: {
  pool: EditPool;
  store: CloudStore;
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
    const run = runPoolCommand(command);
    if (!run.ok) return { ok: false, why: run.why, tries };
    const changes = await changesOf(pool.written(), Date.parse(now()));
    const applyMs = Math.round(clock() - applying);
    const committing = clock();
    let commit: CommitResult;
    try {
      commit = await commitChanges({
        store,
        base: ensured.manifest,
        changes,
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
      // What the save moved, read off the two manifests: a value written as the copy already had
      // it is named from its own pieces, and a commit that moves nothing writes nothing.
      const was = new Map(ensured.manifest.parts.map((part) => [part.key, part.hash]));
      const after = new Map(commit.manifest.parts.map((part) => [part.key, part.hash]));
      return {
        ok: true,
        copy: commit.manifest.copy,
        version: commit.manifest.version,
        inverse: run.inverse,
        changed: changes.map(({ key }) => key).filter((key) => was.get(key) !== after.get(key)),
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
