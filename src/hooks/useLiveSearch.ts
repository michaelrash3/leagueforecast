import { useState } from "react";
import type { DecodedViews } from "../lib/live/liveClient";
import { coerceSearch, searchKey, type SearchView } from "../lib/live/views/searchShape";
import type { LiveViewSource } from "./useLiveBoard";
import { useLiveView } from "./useLiveView";

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
  const key = askedFor && askedFor.year === year ? searchKey(year) : null;
  const { view, failed } = useLiveView(source, key, coerceSearch, decodedSearches);
  return { asked: key !== null, view, failed, ask: () => setAskedFor({ year }) };
}
