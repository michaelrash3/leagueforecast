import type { SeasonSnapshot } from "../storage";

/**
 * League Standings from two devices, made one without losing either side's work.
 *
 * Every season travels in the cloud copy as one value (`cloudLocal.ts`), so a score entered on the
 * phone and another entered on the laptop are two changes to the same value. Deciding between the
 * two values would throw one device's score away; the first version asked the user which to keep,
 * and either answer lost something. So the two are merged record by record: seasons by id, and in
 * each season its teams and games by id, its scores by game, its bracket by slot, and its settings
 * field by field. Only a record both sides changed differently has to lose one version, and the
 * caller keeps the losing value whole in the cloud copy's kept versions (`cloudManifest.ts`).
 */

/** The seasons, as the cloud copy carries them (`{ seasons }`, the active one left out). */
export type LeagueValue = { seasons: SeasonSnapshot[] };

export type LeagueMerge = {
  value: LeagueValue;
  /** How many records both sides changed differently, and were settled toward `prefer`. */
  conflicts: number;
  /**
   * Seasons of this device's that had to take a new id, because the other side has a different
   * season under the same one (every browser's first season is `default`). The device's open
   * season follows its season to the new id.
   */
  renamed: Record<string, string>;
};

/** Which side a record both sides changed differently is settled toward. */
export type Prefer = "local" | "cloud";

type Keyed<T> = { order: string[]; byId: Map<string, T> };

/*
 * Equality by content. Records here are small (a team, a game, a score), and JSON of a value this
 * app built is canonical enough: the same code writes both sides, in the same key order.
 */
const same = (a: unknown, b: unknown): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));

const keyedList = <T extends { id: string }>(list: readonly T[] | undefined): Keyed<T> => {
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const item of list ?? []) {
    if (byId.has(item.id)) continue;
    byId.set(item.id, item);
    order.push(item.id);
  }
  return { order, byId };
};

const keyedRecord = <T>(record: Readonly<Record<string, T>> | undefined): Keyed<T> => {
  const byId = new Map(Object.entries(record ?? {}));
  return { order: [...byId.keys()], byId };
};

/** The ids both lists share, in the order `list` has them. */
const sharedOrder = (list: readonly string[], other: ReadonlySet<string>): string =>
  list.filter((id) => other.has(id)).join("\n");

/**
 * The order of a merged list. Taken from whichever side rearranged the records the two share,
 * the cloud's when neither or both did, with each side's additions after, in its own order.
 */
const mergedOrder = (
  base: readonly string[] | null,
  local: readonly string[],
  cloud: readonly string[],
  kept: ReadonlySet<string>
): string[] => {
  const localSet = new Set(local);
  const cloudSet = new Set(cloud);
  let primary = cloud;
  if (base) {
    const inAll = new Set(base.filter((id) => localSet.has(id) && cloudSet.has(id)));
    const localMoved = sharedOrder(local, inAll) !== sharedOrder(base, inAll);
    const cloudMoved = sharedOrder(cloud, inAll) !== sharedOrder(base, inAll);
    if (localMoved && !cloudMoved) primary = local;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of [...primary, ...(primary === cloud ? local : cloud)]) {
    if (seen.has(id) || !kept.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

type Counter = { conflicts: number };

/**
 * One record from three versions of it (absent is `undefined`). A change on one side wins over no
 * change on the other; a deletion loses to an edit, so no work is lost to it; two different
 * changes are settled toward `prefer`, and counted.
 */
const pick = <T>(
  base: T | undefined,
  local: T | undefined,
  cloud: T | undefined,
  prefer: Prefer,
  counter: Counter,
  both: ((local: T, cloud: T, base: T | undefined) => T) | null
): T | undefined => {
  if (same(local, cloud)) return local;
  if (same(local, base)) return cloud;
  if (same(cloud, base)) return local;
  if (local === undefined) return cloud;
  if (cloud === undefined) return local;
  if (both) return both(local, cloud, base);
  counter.conflicts += 1;
  return prefer === "local" ? local : cloud;
};

/** Every record of a keyed collection, merged, in the merged order. */
const mergeKeyed = <T>(
  base: Keyed<T> | null,
  local: Keyed<T>,
  cloud: Keyed<T>,
  prefer: Prefer,
  counter: Counter,
  both: ((local: T, cloud: T, base: T | undefined) => T) | null = null
): { order: string[]; byId: Map<string, T> } => {
  const ids = new Set([...(base?.order ?? []), ...local.order, ...cloud.order]);
  const byId = new Map<string, T>();
  for (const id of ids) {
    const merged = pick(
      base ? base.byId.get(id) : undefined,
      local.byId.get(id),
      cloud.byId.get(id),
      prefer,
      counter,
      both
    );
    if (merged !== undefined) byId.set(id, merged);
  }
  const order = mergedOrder(base?.order ?? null, local.order, cloud.order, new Set(byId.keys()));
  return { order, byId };
};

const listOf = <T>(merged: { order: string[]; byId: Map<string, T> }): T[] =>
  merged.order.flatMap((id) => {
    const item = merged.byId.get(id);
    return item === undefined ? [] : [item];
  });

const recordOf = <T>(merged: { order: string[]; byId: Map<string, T> }): Record<string, T> =>
  Object.fromEntries(
    merged.order.flatMap((id) => {
      const item = merged.byId.get(id);
      return item === undefined ? [] : [[id, item] as const];
    })
  );

/** Settings field by field: two devices changing two different settings keep both. */
const mergeFields = <T extends object>(
  base: T | undefined,
  local: T,
  cloud: T,
  prefer: Prefer,
  counter: Counter
): T => {
  const fields = new Set([
    ...Object.keys(base ?? {}),
    ...Object.keys(local),
    ...Object.keys(cloud),
  ]);
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = pick(
      base ? (base as Record<string, unknown>)[field] : undefined,
      (local as Record<string, unknown>)[field],
      (cloud as Record<string, unknown>)[field],
      prefer,
      counter,
      null
    );
    if (value !== undefined) out[field] = value;
  }
  return out as T;
};

const laterOf = (a: string | undefined, b: string | undefined): string | undefined =>
  a === undefined ? b : b === undefined ? a : a > b ? a : b;

/** One season both sides hold, merged inside: its records, then its name and settings. */
const mergeSeason = (
  base: SeasonSnapshot | undefined,
  local: SeasonSnapshot,
  cloud: SeasonSnapshot,
  prefer: Prefer,
  counter: Counter
): SeasonSnapshot => {
  const teams = mergeKeyed(
    base ? keyedList(base.teams) : null,
    keyedList(local.teams),
    keyedList(cloud.teams),
    prefer,
    counter
  );
  const matchups = mergeKeyed(
    base ? keyedList(base.matchups) : null,
    keyedList(local.matchups),
    keyedList(cloud.matchups),
    prefer,
    counter
  );
  const logs = mergeKeyed(
    base ? keyedRecord(base.logs) : null,
    keyedRecord(local.logs),
    keyedRecord(cloud.logs),
    prefer,
    counter
  );
  const bracketLogs = mergeKeyed(
    base ? keyedRecord(base.bracketLogs) : null,
    keyedRecord(local.bracketLogs),
    keyedRecord(cloud.bracketLogs),
    prefer,
    counter
  );
  const name = pick(base?.name, local.name, cloud.name, prefer, counter, null) ?? cloud.name;
  const updatedAt = laterOf(local.updatedAt, cloud.updatedAt);
  return {
    id: cloud.id,
    name,
    createdAt: cloud.createdAt || local.createdAt,
    ...(updatedAt ? { updatedAt } : {}),
    teams: listOf(teams),
    matchups: listOf(matchups),
    logs: recordOf(logs),
    bracketLogs: recordOf(bracketLogs),
    settings: mergeFields(base?.settings, local.settings, cloud.settings, prefer, counter),
  };
};

const seasonsOf = (value: LeagueValue | null): SeasonSnapshot[] => value?.seasons ?? [];

/** An id neither side uses, in the app's own `season-N` style. */
const freshSeasonId = (taken: ReadonlySet<string>): string => {
  let n = taken.size + 1;
  while (taken.has(`season-${n}`)) n += 1;
  return `season-${n}`;
};

/**
 * This device's seasons, ready to merge with the other side's. A season both hold under one id is
 * the same season only if it was made at the same moment. Otherwise it is two seasons that were
 * given the same id: every browser's first is `default`, and each makes its next `season-N` from
 * its own count, so a season deleted and another made on one device can reuse an id the other
 * device still has. Then this device's season is kept apart under a new id, rather than having its
 * teams and games mixed into another season's. The one exception is a season this device never
 * touched since the two last met, which the other side has replaced: that one is simply gone.
 */
const separateSeasons = (
  local: readonly SeasonSnapshot[],
  cloud: Keyed<SeasonSnapshot>,
  base: Keyed<SeasonSnapshot> | null
): { seasons: SeasonSnapshot[]; renamed: Record<string, string> } => {
  const taken = new Set([
    ...cloud.order,
    ...(base?.order ?? []),
    ...local.map((season) => season.id),
  ]);
  const renamed: Record<string, string> = {};
  const seasons = local.flatMap((season) => {
    const theirs = cloud.byId.get(season.id);
    if (!theirs || theirs.createdAt === season.createdAt) return [season];
    const was = base?.byId.get(season.id);
    if (was && was.createdAt === season.createdAt && same(was, season)) return [];
    const id = freshSeasonId(taken);
    taken.add(id);
    renamed[season.id] = id;
    return [{ ...season, id }];
  });
  return { seasons, renamed };
};

/**
 * Two devices' League Standings from the version both last had (`base`): every change either made
 * since is in the result, and a record both changed differently is settled toward `prefer`.
 */
export const mergeLeague = (
  base: LeagueValue,
  local: LeagueValue,
  cloud: LeagueValue,
  prefer: Prefer
): LeagueMerge => {
  const counter: Counter = { conflicts: 0 };
  const theirs = keyedList(seasonsOf(cloud));
  const was = keyedList(seasonsOf(base));
  const mine = separateSeasons(seasonsOf(local), theirs, was);
  const seasons = mergeKeyed(
    was,
    keyedList(mine.seasons),
    theirs,
    prefer,
    counter,
    (ours, cloudSeason, baseSeason) => mergeSeason(baseSeason, ours, cloudSeason, prefer, counter)
  );
  return {
    value: { seasons: listOf(seasons) },
    conflicts: counter.conflicts,
    renamed: mine.renamed,
  };
};

/** A season with nothing in it: every browser's first, before anything is typed into it. */
export const isEmptySeason = (season: SeasonSnapshot): boolean =>
  season.teams.length === 0 &&
  season.matchups.length === 0 &&
  Object.keys(season.logs).length === 0 &&
  Object.keys(season.bracketLogs).length === 0;

/** League Standings that hold nothing a merge could keep: no season with anything in it. */
export const isEmptyLeague = (value: LeagueValue | null): boolean =>
  seasonsOf(value).every(isEmptySeason);

/**
 * Two devices' League Standings with no version in common: the first time a browser holding
 * seasons of its own meets the cloud copy. Everything on either side is kept, since nothing says
 * what either side deleted. Seasons that merely share an id are kept apart (`separateSeasons`), and
 * this device's untouched first season is dropped where the other side has a season of that id.
 * Inside a season both hold, a record the two hold differently is settled toward `prefer`.
 */
export const joinLeagues = (
  local: LeagueValue,
  cloud: LeagueValue,
  prefer: Prefer
): LeagueMerge => {
  const counter: Counter = { conflicts: 0 };
  const theirs = keyedList(seasonsOf(cloud));
  const kept = seasonsOf(local).filter(
    (season) => !isEmptySeason(season) || !theirs.byId.has(season.id)
  );
  const mine = separateSeasons(kept, theirs, null);
  const seasons = mergeKeyed(
    null,
    keyedList(mine.seasons),
    theirs,
    prefer,
    counter,
    (ours, cloudSeason) => mergeSeason(undefined, ours, cloudSeason, prefer, counter)
  );
  return {
    value: { seasons: listOf(seasons) },
    conflicts: counter.conflicts,
    renamed: mine.renamed,
  };
};
