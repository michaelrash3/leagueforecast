import { useEffect, useState } from "react";
import { readView, type DecodedViews } from "../lib/live/liveClient";
import { coerceSearch, searchKey, type SearchView } from "../lib/live/views/searchShape";
import type { LiveViewSource } from "./useLiveBoard";

/** Lists decoded this page load, by fingerprint: a search asked for again is free. */
const decodedSearches: DecodedViews<SearchView> = new Map();

/** Only for tests: forgets the lists decoded so far. */
export const forgetDecodedSearches = (): void => decodedSearches.clear();

export type LiveSearch = {
  /** Whether somebody went to search on this year's pages. */
  asked: boolean;
  /** The year's list, once it is read and checked. */
  view: SearchView | null;
  /** The list could not be read: none published, damaged, refused, or offline with none kept. */
  failed: boolean;
  /** Reads the year's list, when somebody goes to search. */
  ask: () => void;
};

/**
 * Find a team on the cloud's board: the year's published list (`searchShape.ts`), read through
 * the same checks as a board (`readView`) only once somebody goes to search, since at a nationwide
 * pool it is megabytes. It is asked for a year: a pick that opens another year's page leaves the
 * box to be asked again there, rather than reading that year's list unasked. A newer meta reads it
 * again, which costs nothing when the meta names the same list.
 */
export function useLiveSearch(source: LiveViewSource | null, year: number | undefined): LiveSearch {
  const [askedFor, setAskedFor] = useState<{ year: number | undefined } | null>(null);
  const [read, setRead] = useState<{ key: string; view: SearchView } | null>(null);
  const [failed, setFailed] = useState(false);
  const key = askedFor && askedFor.year === year ? searchKey(year) : null;

  useEffect(() => {
    if (!key || !source) return;
    let alive = true;
    void readView({
      reader: source.reader,
      meta: source.meta,
      key,
      cache: source.cache,
      coerce: coerceSearch,
      memory: decodedSearches,
    }).then((done) => {
      if (!alive) return;
      if (done.ok) setRead({ key, view: done.view });
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [key, source]);

  return {
    asked: key !== null,
    view: read && read.key === key ? read.view : null,
    failed,
    ask: () => setAskedFor({ year }),
  };
}
