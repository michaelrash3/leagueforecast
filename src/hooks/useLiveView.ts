import { useEffect, useState } from "react";
import { readView, type DecodedViews } from "../lib/live/liveClient";
import type { LiveViewSource } from "./useLiveBoard";

/**
 * One published view the live board draws beside its board, read through the same checks and cache
 * as a board (`readView`) once `key` names it, and again for each newer meta, which costs nothing
 * when the meta names the same view. `failed` says the view under `key` could not be read: none
 * published, damaged, refused, or offline with none kept. Not while the meta is only the one this
 * device kept and the network has yet to answer: a view it lacks is read again through the
 * network's source, as a board is (`useLiveBoard`). A refusal is the source's to hear too, since it
 * means the account may see none of the views.
 */
export function useLiveView<T>(
  source: LiveViewSource | null,
  key: string | null,
  coerce: (raw: unknown) => T | null,
  memory: DecodedViews<T>
): { view: T | null; failed: boolean } {
  const [read, setRead] = useState<{ key: string; view: T } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);

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
      if (done.ok) setRead({ key, view: done.view });
      else if (done.why === "refused") {
        source.refused();
        setFailedKey(key);
      } else if (source.settled) setFailedKey(key);
    });
    return () => {
      alive = false;
    };
  }, [key, source, coerce, memory]);

  return {
    view: read && read.key === key ? read.view : null,
    failed: key !== null && failedKey === key,
  };
}
