import { useEffect, useState } from "react";
import { readView, type DecodedViews, type ViewRead } from "../lib/live/liveClient";
import type { LiveViewSource } from "./useLiveBoard";

/** Why a view was not read (`readView`). */
type ViewMiss = Extract<ViewRead<unknown>, { ok: false }>["why"];

/**
 * One published view the live board draws beside its board, read through the same checks and cache
 * as a board (`readView`) once `key` names it, and again for each newer meta, which costs nothing
 * when the meta names the same view. `failed` says the view under `key` could not be read: none
 * published, damaged, refused, or offline with none kept. Not while the meta is only the one this
 * device kept and the network has yet to answer: a view it lacks is read again through the
 * network's source, as a board is (`useLiveBoard`). A refusal is the source's to hear too, since it
 * means the account may see none of the views. `missing` says it failed because the meta names no
 * view under `key` at all: not a read that went wrong, and so not one that reading again mends.
 *
 * A new `attempt` (any value but the last one) reads the view again, for a person who asked again
 * after it failed: until that read says otherwise it has not failed.
 */
export function useLiveView<T>(
  source: LiveViewSource | null,
  key: string | null,
  coerce: (raw: unknown) => T | null,
  memory: DecodedViews<T>,
  attempt: unknown = null
): { view: T | null; failed: boolean; missing: boolean } {
  const [read, setRead] = useState<{ key: string; view: T } | null>(null);
  const [failedAt, setFailedAt] = useState<{
    key: string;
    attempt: unknown;
    why: ViewMiss;
  } | null>(null);

  useEffect(() => {
    if (!key || !source) return;
    let alive = true;
    void readView({
      reader: source.reader,
      meta: source.meta,
      key,
      cache: source.cache,
      coerce,
      memory,
    }).then((done) => {
      if (!alive) return;
      if (done.ok) {
        setRead({ key, view: done.view });
        // A view that failed and is read since, as a publish reads it again, has not failed: a
        // reader that stays on screen through both (the page's own club's card) says it is there.
        setFailedAt((was) => (was?.key === key ? null : was));
      } else if (done.why === "refused") {
        source.refused();
        setFailedAt({ key, attempt, why: done.why });
      } else if (source.settled) setFailedAt({ key, attempt, why: done.why });
    });
    return () => {
      alive = false;
    };
  }, [key, source, coerce, memory, attempt]);

  const failed =
    key !== null && failedAt !== null && failedAt.key === key && failedAt.attempt === attempt;
  return {
    view: read && read.key === key ? read.view : null,
    failed,
    missing: failed && failedAt?.why === "missing",
  };
}
