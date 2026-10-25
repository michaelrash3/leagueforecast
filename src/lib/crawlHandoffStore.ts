import { handedFile, type HandedFile, type HandoffKind } from "./crawlHandoff";

/**
 * The crawl's handed-over files, held until the Import page that applies them is on screen and
 * takes them (`crawlHandoff.ts`).
 *
 * Module state, like the Scout request: the files arrive at the app as a whole, wherever the
 * reader happens to be, and are applied by whichever Import is drawn, this device's own panel or
 * the cloud's. Each is taken exactly once. An id seen before is never held again, for the life of
 * the page, because applying the Organizations twice on a cloud device would send a second merge
 * the reader never asked for.
 */

export type HeldFile = { id: string; file: File };
export type HeldHandoff = { teams: HeldFile | null; orgs: HeldFile | null };

const NOTHING: HeldHandoff = { teams: null, orgs: null };

let held: HeldHandoff = NOTHING;
const seen = new Set<string>();
const loaded = new Map<string, Set<HandoffKind>>();
const listeners = new Set<() => void>();
const takers = new Set<(id: string, kind: HandoffKind) => void>();

const changed = (next: HeldHandoff) => {
  held = next;
  listeners.forEach((listener) => listener());
};

/**
 * Holds a hand-off's files, a newer file of a kind taking the place of an older one not yet
 * taken. Answers `duplicate` for an id already held, with the kinds of it already applied, so the
 * miner can be told again that they were.
 */
export const holdHandoff = (handoff: {
  id: string;
  teams: HandedFile | null;
  orgs: HandedFile | null;
}): { status: "held" | "duplicate"; loaded: HandoffKind[] } => {
  if (seen.has(handoff.id))
    return { status: "duplicate", loaded: [...(loaded.get(handoff.id) ?? [])] };
  seen.add(handoff.id);
  changed({
    teams: handoff.teams ? { id: handoff.id, file: handedFile(handoff.teams) } : held.teams,
    orgs: handoff.orgs ? { id: handoff.id, file: handedFile(handoff.orgs) } : held.orgs,
  });
  return { status: "held", loaded: [] };
};

/** What is held now; the same object until something is held or taken. */
export const heldHandoff = (): HeldHandoff => held;

export const subscribeHandoff = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * The held file of a kind, taken and cleared in one step, so two effects asking at once (React
 * runs them twice in development) cannot both apply it. The taker says when it has been applied
 * (`handoffLoaded`); one that fails says nothing, and the miner keeps it for the page's next load.
 */
export const takeHandoff = (kind: HandoffKind): HeldFile | null => {
  const one = held[kind];
  if (!one) return null;
  changed({ ...held, [kind]: null });
  return one;
};

/**
 * A taken file is where the same file chosen by hand would be: the team list in the pull card,
 * the organizations kept. Only then is the miner told, since that is when it marks the rows sent.
 */
export const handoffLoaded = (id: string, kind: HandoffKind): void => {
  const kinds = loaded.get(id) ?? new Set<HandoffKind>();
  if (kinds.has(kind)) return;
  kinds.add(kind);
  loaded.set(id, kinds);
  takers.forEach((taker) => taker(id, kind));
};

/** Told of every file applied: how the page tells the miner. */
export const onHandoffLoaded = (taker: (id: string, kind: HandoffKind) => void): (() => void) => {
  takers.add(taker);
  return () => takers.delete(taker);
};

export const resetHandoffForTests = (): void => {
  held = NOTHING;
  seen.clear();
  loaded.clear();
  listeners.clear();
  takers.clear();
};
