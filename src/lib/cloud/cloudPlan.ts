import type { CloudManifest, ManifestPart } from "./cloudManifest";

/**
 * What a device and the cloud copy each have to do to agree, key by key: the one place the rules
 * of syncing are written down, as a pure function the session carries out (`cloudSession.ts`).
 *
 * The data is in two areas, synced on their own terms:
 * - `league`: every League Standings season, one small value, taken at startup before the app
 *   draws, and merged record by record when both sides changed it (`leagueMerge.ts`).
 * - `pool`: the Team Rankings pool, key by key and tens of megabytes, taken only when Team Rankings
 *   is opened. A key both sides changed goes to whichever changed it later, and the other version
 *   is kept in the cloud copy, from where any device can bring it back.
 *
 * Every rule is about one key, and none of them removes a value because one side merely lacks it:
 * a value leaves the copy only because a device recorded removing it, and leaves a device only
 * because the copy dropped a value that device had synced.
 */

export const LEAGUE_PART = "league";

export type Area = "league" | "pool";

export const areaOf = (key: string): Area => (key === LEAGUE_PART ? "league" : "pool");

/**
 * - `take`: apply the copy's value here (or its absence: the copy dropped a key this device had).
 * - `send`: put this device's value in the copy (or take the key out: removed here).
 * - `merge`: League Standings changed on both sides; merge them (`leagueMerge.ts`).
 * - `local-wins`: a pool key both sides changed, this device's later: send it, keeping the copy's.
 * - `cloud-wins`: a pool key both sides changed, the copy's later: keep this device's in the copy,
 *   and take the copy's. Also every differing key of a pool meeting a copy that has one.
 * - `synced`: both sides hold the same value (changed to the same thing, or never apart).
 */
export type KeyAction = "take" | "send" | "merge" | "local-wins" | "cloud-wins" | "synced";

export type AreaPlan = {
  area: Area;
  /**
   * This device has not met this copy in this area before: its first sign-in, or a copy started
   * again. The area is settled as a whole, all at once or not at all.
   */
  meeting: boolean;
  actions: Map<string, KeyAction>;
};

/** What the plan needs of this device's own record (`DeviceCloudState`). */
export type PlanState = {
  /** The copy each area last met, or absent for none. */
  met: Partial<Record<Area, string>>;
  /** Each key's fingerprint as of the last time this device and the copy agreed on it. */
  hashes: Readonly<Record<string, string>>;
  /** The keys changed here since, each with when (ms). */
  dirty: Readonly<Record<string, number>>;
};

export type PlanInput = {
  manifest: CloudManifest;
  state: PlanState;
  area: Area;
  /** Keys of this area this device holds a value for. */
  held: readonly string[];
  /**
   * Whether this device's data in the area is nothing anybody made: a browser's untouched first
   * season, or a pool with no team. Such data is replaced when meeting a copy, never kept.
   */
  localEmpty: boolean;
  /** The fingerprint of this device's value of `key`, or null where it holds none. */
  localHash: (key: string) => Promise<string | null>;
};

const partsOf = (manifest: CloudManifest, area: Area): Map<string, ManifestPart> =>
  new Map(
    manifest.parts.filter((part) => areaOf(part.key) === area).map((part) => [part.key, part])
  );

const keysOf = (record: Readonly<Record<string, unknown>>, area: Area): string[] =>
  Object.keys(record).filter((key) => areaOf(key) === area);

/** Where an area that has met this copy stands, key by key. */
const planMet = async (input: PlanInput): Promise<Map<string, KeyAction>> => {
  const { manifest, state, area, held, localHash } = input;
  const cloud = partsOf(manifest, area);
  const holds = new Set(held);
  const keys = new Set([
    ...cloud.keys(),
    ...keysOf(state.hashes, area),
    ...keysOf(state.dirty, area),
    ...held,
  ]);
  const actions = new Map<string, KeyAction>();
  for (const key of keys) {
    const part = cloud.get(key);
    const base = state.hashes[key];
    const changedHere = key in state.dirty;
    const changedThere = part?.hash !== base;
    if (!changedHere) {
      if (changedThere) actions.set(key, "take");
      // A value this device had synced and holds no longer, with no record of removing it: its
      // storage lost it. The copy's is taken back rather than the loss trusted.
      else if (base !== undefined && !holds.has(key)) actions.set(key, "take");
      // A value neither side has a record of: held here, never sent. Sent, rather than left out.
      else if (base === undefined && part === undefined && holds.has(key)) actions.set(key, "send");
      continue;
    }
    if (!changedThere) {
      actions.set(key, "send");
      continue;
    }
    // Changed on both sides. The same change twice is no conflict.
    if ((await localHash(key)) === (part?.hash ?? null)) {
      actions.set(key, "synced");
    } else if (area === "league") {
      actions.set(key, "merge");
    } else {
      const here = state.dirty[key] ?? 0;
      actions.set(key, here > (part?.at ?? 0) ? "local-wins" : "cloud-wins");
    }
  }
  return actions;
};

/**
 * Where an area that has never met this copy stands. League Standings are merged, whatever either
 * side holds. The pool is taken whole: sign in first on the device that holds the data, and every
 * other device's pool is kept in the copy, where it can be brought back, rather than mixed key by
 * key into a pool it was never part of.
 */
const planMeeting = async (input: PlanInput): Promise<Map<string, KeyAction>> => {
  const { manifest, area, held, localEmpty, localHash } = input;
  const cloud = partsOf(manifest, area);
  const actions = new Map<string, KeyAction>();
  const mine = localEmpty ? [] : held;
  if (cloud.size === 0) {
    for (const key of mine) actions.set(key, "send");
    return actions;
  }
  if (mine.length === 0) {
    for (const key of new Set([...cloud.keys(), ...held])) actions.set(key, "take");
    return actions;
  }
  for (const key of new Set([...cloud.keys(), ...mine])) {
    const part = cloud.get(key);
    const hash = await localHash(key);
    if (hash !== null && hash === part?.hash) actions.set(key, "synced");
    else if (hash === null) actions.set(key, "take");
    else if (area === "league") actions.set(key, part ? "merge" : "send");
    else actions.set(key, "cloud-wins");
  }
  return actions;
};

export const planArea = async (input: PlanInput): Promise<AreaPlan> => {
  const meeting = input.state.met[input.area] !== input.manifest.copy;
  return {
    area: input.area,
    meeting,
    actions: meeting ? await planMeeting(input) : await planMet(input),
  };
};

/** Whether carrying out a plan means writing anything on this device. */
export const needsApply = (plan: AreaPlan): boolean =>
  [...plan.actions.values()].some(
    (action) => action === "take" || action === "merge" || action === "cloud-wins"
  );

/** Whether a plan leaves anything to do at all. */
export const isSettled = (plan: AreaPlan): boolean =>
  [...plan.actions.values()].every((action) => action === "synced") && !plan.meeting;
