import { mergeSeason } from "../cloud/leagueMerge";
import type { SeasonSnapshot } from "../storage";
import type { GameLog, Matchup, Settings, TeamBase } from "../types";
import { docChanges, encodeKey, seasonToDoc, type LeagueDocChange } from "./leagueDocs";

/**
 * The rules a League Standings season is kept live by, between this device and the season's
 * document in the cloud (`leagueDocs.ts`), with nothing of React or Firestore in them, so each is
 * tried on its own (`useLiveLeague` runs them).
 *
 * Three versions of the season meet in each: `base`, the document as this device last took it in;
 * `local`, the season on screen, with whatever has been changed here since; and `remote`, the
 * document as it is now. What changed here since `base` is laid over what changed elsewhere, record
 * by record, by the merge the cloud copy has always used (`leagueMerge.ts`), so two devices
 * scoring two games each keep both, and a game deleted on one device is not brought back by
 * another that never touched it.
 */

/** The parts of a season the page edits. */
export type SeasonParts = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  bracketLogs: Record<string, GameLog>;
  settings: Settings;
};

/** The season's entry in the season list: what the document carries besides the parts. */
export type SeasonEntry = { id: string; name: string; createdAt: string };

/**
 * A season as the live store compares it: without when it was last saved, which moves with every
 * write and is no edit of anybody's.
 */
export const liveSeason = (entry: SeasonEntry, parts: SeasonParts): SeasonSnapshot => ({
  id: entry.id,
  name: entry.name,
  createdAt: entry.createdAt,
  teams: parts.teams,
  matchups: parts.matchups,
  logs: parts.logs,
  bracketLogs: parts.bracketLogs,
  settings: parts.settings,
});

/** `season` without when it was last saved. */
export const unsaved = (season: SeasonSnapshot): SeasonSnapshot => {
  const { updatedAt: _saved, ...rest } = season;
  return rest;
};

/** The parts of `season`. */
export const partsOf = (season: SeasonSnapshot): SeasonParts => ({
  teams: season.teams,
  matchups: season.matchups,
  logs: season.logs,
  bracketLogs: season.bracketLogs,
  settings: season.settings,
});

/** What changes `from` into `to`, as fields of the document; when each was saved left out. */
const changesBetween = (from: SeasonSnapshot, to: SeasonSnapshot): LeagueDocChange[] =>
  docChanges(seasonToDoc(unsaved(from)), seasonToDoc(unsaved(to)));

/** Whether two versions of a season hold the same, whatever order their records' fields are in. */
export const sameSeason = (a: SeasonSnapshot, b: SeasonSnapshot): boolean =>
  changesBetween(a, b).length === 0;

/**
 * The season with what changed here since `base` laid over `remote`: every change made elsewhere
 * taken, every change made here kept, and a record both changed toward this device's, which is
 * the change about to be written. With no `base`, the first time this device meets the document,
 * nothing says what either side deleted, so everything either holds is kept, and a record the
 * two hold differently is the cloud's, the version every other device already has.
 */
export const layOver = (
  base: SeasonSnapshot | null,
  local: SeasonSnapshot,
  remote: SeasonSnapshot
): SeasonSnapshot =>
  unsaved(
    mergeSeason(
      base ? unsaved(base) : undefined,
      unsaved(local),
      unsaved(remote),
      base ? "local" : "cloud",
      { conflicts: 0 }
    )
  );

/**
 * What to write to turn the document as it is, `remote`, into `merged`: each record, setting and
 * order that differs, and when it was saved, `now`, only alongside a change.
 */
export const writesFor = (
  remote: SeasonSnapshot,
  merged: SeasonSnapshot,
  now: string
): LeagueDocChange[] => {
  const changes = changesBetween(remote, merged);
  return changes.length === 0 ? [] : [...changes, { path: ["updatedAt"], value: now }];
};

/** The document fields another device changed between two versions: what the undo guard reads. */
export const fieldsChanged = (from: SeasonSnapshot, to: SeasonSnapshot): string[] =>
  changesBetween(from, to).map((change) => change.path.join("/"));

/** A season to put back, as an undo holds one: the settings only when the step replaced them. */
export type UndoTarget = Omit<SeasonParts, "settings"> & { settings?: Settings };

const keyedList = <T extends { id: string }>(
  field: string,
  current: readonly T[],
  snapshot: readonly T[],
  touched: (path: string) => boolean
): T[] => {
  const byId = new Map(snapshot.map((item) => [item.id, item]));
  const ids = [...new Set([...current.map((item) => item.id), ...byId.keys()])];
  const now = new Map(current.map((item) => [item.id, item]));
  return ids.flatMap((id) => {
    const item = touched(`${field}/${encodeKey(id)}`) ? byId.get(id) : now.get(id);
    return item === undefined ? [] : [item];
  });
};

const keyedRecord = <T>(
  field: string,
  current: Readonly<Record<string, T>>,
  snapshot: Readonly<Record<string, T>>,
  touched: (path: string) => boolean
): Record<string, T> => {
  const out: Record<string, T> = {};
  for (const id of new Set([...Object.keys(current), ...Object.keys(snapshot)])) {
    const item = touched(`${field}/${encodeKey(id)}`) ? snapshot[id] : current[id];
    if (item !== undefined) out[id] = item;
  }
  return out;
};

/** `list` with the records `order` holds first, in its order, and the rest after, as they were. */
const inOrderOf = <T extends { id: string }>(list: readonly T[], order: readonly T[]): T[] => {
  const byId = new Map(list.map((item) => [item.id, item]));
  const first = order.flatMap((item) => {
    const kept = byId.get(item.id);
    return kept === undefined ? [] : [kept];
  });
  const placed = new Set(first.map((item) => item.id));
  return [...first, ...list.filter((item) => !placed.has(item.id))];
};

/**
 * What an undo puts back when the season is shared: the season as the step left it, `snapshot`,
 * except for every record another device has changed since the step (`touched`, by document
 * field), which keeps that device's change. Undoing a deleted game on one device must not also
 * take back a score another device has entered since; that score was never this device's to undo.
 * The merge does it: the records another device changed count as unchanged here, and the rest as
 * changed back to the snapshot, so a score put back brings its game back with it, as any merge does.
 */
export const guardedUndo = (
  snapshot: UndoTarget,
  current: SeasonSnapshot,
  touched: (path: string) => boolean
): SeasonSnapshot => {
  const settings = snapshot.settings ?? current.settings;
  const local: SeasonSnapshot = { ...current, ...snapshot, settings };
  const fields = new Set([...Object.keys(current.settings), ...Object.keys(settings)]);
  const base: SeasonSnapshot = {
    ...current,
    teams: keyedList("teams", current.teams, snapshot.teams, touched),
    matchups: keyedList("matchups", current.matchups, snapshot.matchups, touched),
    logs: keyedRecord("logs", current.logs, snapshot.logs, touched),
    bracketLogs: keyedRecord("bracketLogs", current.bracketLogs, snapshot.bracketLogs, touched),
    settings: Object.fromEntries(
      [...fields].flatMap((field) => {
        const value = (touched(`settings/${field}`)
          ? settings
          : current.settings) as unknown as Record<string, unknown>;
        return value[field] === undefined ? [] : [[field, value[field]]];
      })
    ) as unknown as Settings,
  };
  const merged = mergeSeason(base, local, current, "cloud", { conflicts: 0 });
  // In the order the step left them, as the snapshot has it; what came in since, after.
  return unsaved({
    ...merged,
    teams: inOrderOf(merged.teams, snapshot.teams),
    matchups: inOrderOf(merged.matchups, snapshot.matchups),
  });
};
