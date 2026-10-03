import { hashJson } from "../cloud/cloudPack";
import type { CloudManifest } from "../cloud/cloudManifest";
import { LEAGUE_PART } from "../cloud/cloudPlan";
import { isBoardInputKey } from "../teamRankingsStorage";
import { BOARD_RULES } from "./views/boardShape";
import { LIVE_SCHEMA, type BuiltFrom, type LiveMeta } from "./viewStore";

/**
 * What the boards are built from, read off a copy's manifest: whether a save could have moved them,
 * and whether the boards published are already the ones the copy would give.
 */

/** The family of views the boards are: every key under this prefix. */
export const BOARD_FAMILY = "board:";

/** Whether a part of the copy is one the boards read: League Standings, or a pool key they read. */
export const isBoardInput = (key: string): boolean => key === LEAGUE_PART || isBoardInputKey(key);

/**
 * A fingerprint of the board inputs a copy holds: its parts' keys and the hashes of what they say,
 * in key order. When, by whom and under which upload a part was saved, the earlier versions kept,
 * and every other part are left out, so a save that changed nothing a board reads leaves it as it
 * was. A value saved again in another order of fields changes it, which costs a rebuild that was
 * not needed and never misses one.
 */
export const boardInputsPrint = (manifest: CloudManifest): Promise<string> =>
  boardInputsPrintOf(manifest.parts.map((part) => [part.key, part.hash] as const));

/**
 * `boardInputsPrint` of a copy's parts given as key and hash pairs, in any order: what a device
 * that kept only those (`copySeen`) holds a published board's `built.inputs` to.
 */
export const boardInputsPrintOf = async (
  parts: ReadonlyArray<readonly [key: string, hash: string]>
): Promise<string> => {
  const pairs = parts
    .filter(([key]) => isBoardInput(key))
    .map(([key, hash]) => [key, hash] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return (await hashJson(pairs)).hash;
};

/** What boards built from `manifest` for the members' day `today`, under these rules, came from. */
export const builtFrom = async (manifest: CloudManifest, today: string): Promise<BuiltFrom> => ({
  k: manifest.copy,
  v: manifest.version,
  inputs: await boardInputsPrint(manifest),
  today,
  rules: BOARD_RULES,
});

/**
 * Where the published boards stand against the copy `manifest` for the day `today`:
 * - `current`: built from this very version of the copy, for this day, under these rules, in this
 *   build's shape, so building them again would publish nothing new.
 * - `newer-schema`: published by a newer build, whose meta this one must leave alone.
 * - `older-rules`: built by newer rules than this build's, which must leave them alone.
 * - `older-day`: built for a later day than `today`, so this build's day has passed.
 * - `stale`: anything else, including no record at all.
 *
 * A later version whose board inputs are the same is still `stale`. Saying it was current would
 * leave the copy's mark at the older version, so a slower build of a version in between, with
 * other inputs, would not be late and could publish over them; building it again publishes the same
 * views, which costs no upload, and moves the mark.
 */
export const boardsState = async (
  meta: LiveMeta | null,
  manifest: CloudManifest,
  today: string
): Promise<"current" | "stale" | "newer-schema" | "older-rules" | "older-day"> => {
  if (meta && meta.schema > LIVE_SCHEMA) return "newer-schema";
  const built = meta?.built[BOARD_FAMILY];
  if (!meta || !built) return "stale";
  if (built.rules > BOARD_RULES) return "older-rules";
  if (today < built.today) return "older-day";
  const current =
    meta.schema === LIVE_SCHEMA &&
    built.k === manifest.copy &&
    built.v === manifest.version &&
    built.today === today &&
    built.rules === BOARD_RULES &&
    built.inputs === (await boardInputsPrint(manifest));
  return current ? "current" : "stale";
};
