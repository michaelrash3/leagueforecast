import { coerceBackup, type FullBackup } from "./backup";
import { idbGet, idbSet } from "./idb";

/**
 * What the last full restore replaced, kept on this device until the next restore.
 *
 * A restore reads everything it is about to replace before it writes anything, and offered that
 * only as the toast's download, for twelve seconds; any other toast in that time replaced it, and
 * on a phone it is easily missed. A browser that keeps no cloud copy had then lost its seasons for
 * good. So it is kept here too, one restore's worth, under a key of its own in the pool's
 * IndexedDB store, as the saved board is (`savedBoard.ts`): never read as the pool, never sent to
 * the cloud copy, gone with a reset, and replaced by the next restore's. Settings offers it as a
 * download for as long as it is here.
 */

const KEY = "league_forecast_replaced_backup_v1";

export type ReplacedBackup = { at: string; backup: FullBackup };

/** What the store is reached through; IndexedDB's, but for a test. */
export type ReplacedIo = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => Promise<boolean>;
};
const idbIo: ReplacedIo = { get: idbGet, set: idbSet };

const listeners = new Set<() => void>();

/** Calls `heard` each time a restore keeps what it replaced; returns the way to stop. */
export const onReplacedKept = (heard: () => void): (() => void) => {
  listeners.add(heard);
  return () => listeners.delete(heard);
};

/** Keeps `backup`, replaced at `at`, in place of any kept before. `false` where it did not land. */
export const keepReplaced = async (
  backup: FullBackup,
  at: string,
  io: ReplacedIo = idbIo
): Promise<boolean> => {
  const landed = await io.set(KEY, { at, backup }).catch(() => false);
  if (landed) listeners.forEach((heard) => heard());
  return landed;
};

/** What the last restore replaced, or null where nothing is kept or what is kept is not one. */
export const readReplaced = async (io: ReplacedIo = idbIo): Promise<ReplacedBackup | null> => {
  const kept = await io.get(KEY).catch(() => null);
  if (typeof kept !== "object" || kept === null) return null;
  const { at, backup } = kept as { at?: unknown; backup?: unknown };
  const parsed = coerceBackup(backup);
  return typeof at === "string" && parsed?.kind === "full" ? { at, backup: parsed.backup } : null;
};
