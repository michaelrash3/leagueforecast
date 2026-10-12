import type { Change } from "../cloud/cloudEngine";
import type { CloudManifest } from "../cloud/cloudManifest";
import { areaOf, LEAGUE_PART } from "../cloud/cloudPlan";
import type { PoolCommand } from "./commands";

/**
 * The owner's commands made on the cloud copy itself rather than on a pool (1.6): Team Rankings
 * started again, and an earlier version brought back. Each is a save of the copy's own manifest,
 * which the edit run commits as it does a pool command's (`runEdit`), on the version it read and
 * again on a newer one when a save lands between.
 *
 * Starting again takes every Team Rankings part out of the copy and keeps the lot as one earlier
 * version, whole (`keepWhole`), so bringing that version back is the start undone, for the thirty
 * days a kept version stays. League Standings is not touched: its seasons are their own, and a
 * start of Team Rankings is not a reason to lose a season's scores. Bringing a version back is the
 * device's own `bringBack`, made on the server: what it replaces is kept in its place.
 */

/** What a copy command saves: the changes, the keys whose values to keep, and a version to restore. */
export type CopyPlan =
  | {
      ok: true;
      changes: Change[];
      keepReplaced: string[];
      keepWhole: boolean;
      restore?: string;
    }
  | { ok: false; why: "missing" | "league-kept-live" };

/** The copy's Team Rankings parts: every one but League Standings. */
export const poolKeysOf = (manifest: CloudManifest): string[] =>
  manifest.parts.map((part) => part.key).filter((key) => areaOf(key) === "pool");

/**
 * The save `command` makes on `manifest`, at `at` (ms). `leagueKeptLive` says whether League
 * Standings lives in its own documents, asked only of a version carrying the copy's League part: it
 * is not brought back then, since the boards read the documents and every device the copy's part
 * no longer, and a version that put an old League back would put it nowhere anyone reads.
 *
 * - `missing`: nothing to start again (the copy holds no Team Rankings), or no such version kept.
 * - `league-kept-live`: the version carries League Standings, which is kept live now.
 */
export const planCopyCommand = async (
  command: Extract<PoolCommand, { kind: "copy.reset" | "copy.restore" }>,
  manifest: CloudManifest,
  at: number,
  leagueKeptLive: () => Promise<boolean>
): Promise<CopyPlan> => {
  if (command.kind === "copy.reset") {
    const keys = poolKeysOf(manifest);
    if (keys.length === 0) return { ok: false, why: "missing" };
    return {
      ok: true,
      changes: keys.map((key) => ({ key, value: null, at })),
      keepReplaced: keys,
      keepWhole: true,
    };
  }
  const bringing = manifest.kept.filter((part) => part.group === command.group);
  if (bringing.length === 0) return { ok: false, why: "missing" };
  if (bringing.some((part) => part.key === LEAGUE_PART) && (await leagueKeptLive())) {
    return { ok: false, why: "league-kept-live" };
  }
  return { ok: true, changes: [], keepReplaced: [], keepWhole: false, restore: command.group };
};

/**
 * The version a save kept: the group the commit wrote that the copy did not keep before. What a
 * start of Team Rankings is undone by, as a command to send in turn.
 */
export const keptBy = (before: CloudManifest, after: CloudManifest): string | null => {
  const had = new Set(before.kept.map((part) => part.group));
  return after.kept.find((part) => !had.has(part.group))?.group ?? null;
};
