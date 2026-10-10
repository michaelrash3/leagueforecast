import type { CloudStore } from "../cloud/cloudEngine";
import { copyTooNew, loadPoolFrom, type LoadedCopy } from "../cloud/cloudRunner";
import { NO_LEAGUE_DOCS, type LeagueDocsList } from "./cloudLeague";
import { publishCopyViews, type CopyPublish } from "./publishCopy";
import { needsRepublish, type LiveStore } from "./viewStore";

/**
 * The members' views published again from the cloud copy as it stands, once a deploy has left them
 * of an older schema than the build deployed, or there are none (README, "Views a server
 * publishes"). Then no device of the new build draws a board, and without this every member was
 * left on the older schema's notice until the next nightly, which GitHub starts hours late.
 * `scripts/republish.ts` runs it after a push to main that deployed; it is kept here so its rules
 * are tested.
 *
 * What it answers for is the views at its end, not its own publish. It goes on only while what is
 * published wants publishing again (`needsRepublish`): read before it starts, and again after a
 * publish it did not make, since another publisher (a rebuild after a save, on the functions
 * deployed just before, or an edit's) may have put out this build's views meanwhile. A publish
 * turned away by something saved or committed while it built (`MOVING`) is tried again on the copy
 * as it now stands, up to `tries` times in all: the rebuild such a save asks for is not certain to
 * publish (the rebuilds may be off, paused, capped or failing), and a run that left the members on
 * the notice and said it was done would be the outage it is here to end. Anything else that stops a
 * publish while the views still want one fails the run, a later day's or newer rules' views over
 * an older schema's meta included, since the members are still on the notice.
 */

/** How many times the copy is loaded and published, at most, while what is built keeps moving. */
export const REPUBLISH_TRIES = 3;

/**
 * Refusals a try on the copy as it now stands may get past: the copy saved on or started again,
 * or a season saved, while the boards were built or went up, and a meta that changed under every
 * commit.
 */
const MOVING: ReadonlySet<Extract<CopyPublish, { ok: false }>["reason"]> = new Set([
  "copy-moved",
  "league-moved",
  "copy-replaced",
  "kept-changing",
] as const);

export type Republish = {
  /**
   * `not-needed`: what was published did not want publishing when the run began: of this build's
   * schema, a newer build's, or another layout's. `no-copy`: there is no cloud copy to publish
   * from. `newer-copy`: a newer build saved or tidied the copy (`copyTooNew`), so its views are that
   * build's. `published`: this run published them, whatever the sweep after them did, which only
   * collects pieces nothing names and the next night's full sweep collects as well.
   * `published-since`: a try was turned away, and what is published no longer wants publishing:
   * another publisher put out this build's views, or a newer build's. `refused`: the last try was
   * turned away and the views still want publishing.
   */
  end: "not-needed" | "no-copy" | "newer-copy" | "published" | "published-since" | "refused";
  /** Whether the run did what it is for: every end but `refused`. */
  ok: boolean;
  /** The copy loaded and published this many times. */
  tries: number;
  /** The meta as it was published when the run began, or null where none was. */
  found: unknown;
  /**
   * What is published as the run last read it: `found`, or the meta read again after its last try
   * that did not publish; not read after a publish of its own, which is what stands then.
   */
  now?: unknown;
};

export const republishViews = async ({
  copyStore,
  liveStore,
  leagueDocs = NO_LEAGUE_DOCS,
  today,
  now,
  locale,
  tries = REPUBLISH_TRIES,
  onLoaded,
  onViews,
}: {
  /** The copy's store, which nothing here writes. */
  copyStore: CloudStore;
  liveStore: LiveStore;
  leagueDocs?: LeagueDocsList;
  /** The members' day, asked for as each try publishes. */
  today: () => string;
  now: () => string;
  /** The collation the boards are built under (`boardLocale`, unless a test says). */
  locale?: string;
  tries?: number;
  /** Told as each try has loaded the copy, before it builds, with what is published as it found it. */
  onLoaded?: (loaded: LoadedCopy, published: unknown, attempt: number) => void;
  /** Told how each try's publish ended. */
  onViews?: (views: CopyPublish) => void;
}): Promise<Republish> => {
  const read = async () => (await liveStore.readMeta())?.meta ?? null;
  const found = await read();
  let published = found;
  if (!needsRepublish(found)) {
    return { end: "not-needed", ok: true, tries: 0, found, now: found };
  }
  for (let attempt = 1; ; attempt += 1) {
    const loaded = await loadPoolFrom(copyStore);
    if (!loaded) return { end: "no-copy", ok: true, tries: attempt - 1, found, now: published };
    if (copyTooNew(loaded.manifest)) {
      return { end: "newer-copy", ok: true, tries: attempt - 1, found, now: published };
    }
    onLoaded?.(loaded, published, attempt);
    const views = await publishCopyViews({
      copyStore,
      liveStore,
      manifest: loaded.manifest,
      today: today(),
      now,
      leagueDocs,
      ...(locale !== undefined ? { locale } : {}),
      // Over an older schema's meta nothing holds a version saved since from being put back.
      atVersion: true,
    });
    onViews?.(views);
    if (views.ok) return { end: "published", ok: true, tries: attempt, found };
    published = await read();
    if (!needsRepublish(published)) {
      return { end: "published-since", ok: true, tries: attempt, found, now: published };
    }
    if (!MOVING.has(views.reason) || attempt >= tries) {
      return { end: "refused", ok: false, tries: attempt, found, now: published };
    }
  }
};
