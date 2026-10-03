import type { ClubSearchOption } from "../../clubSearch";
import type { GcIdStores } from "../../gcIdWhereabouts";

/**
 * What a published Find a team list is, as both its publisher (`search.ts`) and a member's device
 * read it: its key, its shape and the check of that shape. Find a team crosses seasons and age
 * levels, so a year's list is every club the page's own search offers (`clubSearchOptions`), each
 * with the page a pick of it opens, and the lists of GameChanger ids the copy keeps off every page,
 * which the box reads to say where a pasted id went (`whereIsGcId`).
 *
 * One view per squad year with a page: the page searches over the year's roster, its League
 * Standings teams included, so a list differs from year to year by those.
 */

/** The family of views the search lists are: every key under this prefix. */
export const SEARCH_FAMILY = "search:";

/** A year's list's key in `live/meta`: `search:{year}`, "none" for the pages with no year. */
export const searchKey = (year: number | undefined): string => `search:${year ?? "none"}`;

/** The lists of ids kept off every page, as `whereIsGcId` reads them; no pull runs on a list. */
export type HeldGcIds = Omit<GcIdStores, "liveTeams">;

/** A year's Find a team list as read back. */
export type SearchView = {
  options: ClubSearchOption[];
  /** The page a pick of each club opens (`TeamPage.ageGroupId`), by club id. */
  pageOf: Map<string, string>;
  held: HeldGcIds;
};

/**
 * A club on the wire: its id, its name, its page's place in the list's `pages`, and the option's
 * line under the name, its coaches and its GameChanger ids, each empty when it has none, as the
 * option then leaves them out (`clubSearchOptions`).
 */
type ClubWire = [
  id: string,
  label: string,
  page: number,
  detail: string,
  coaches: string[],
  gcIds: string[],
];

/** A year's list as published: its pages once each, its clubs, and the held ids. */
export type SearchWire = {
  pages: string[];
  clubs: ClubWire[];
  dropped: string[];
  waiting: Array<[gcId: string, name: string] | [gcId: string]>;
  tooYoung: string[];
};

/**
 * A list as it is published. `pageOf` must name a page for every option, as `teamPages` does for
 * every club it offers.
 */
export const encodeSearch = (view: SearchView): SearchWire => {
  const pages: string[] = [];
  const places = new Map<string, number>();
  const placeOf = (pageId: string): number => {
    const held = places.get(pageId);
    if (held !== undefined) return held;
    pages.push(pageId);
    places.set(pageId, pages.length - 1);
    return pages.length - 1;
  };
  const clubs = view.options.map((option): ClubWire => {
    const pageId = view.pageOf.get(option.id);
    if (pageId === undefined) throw new Error(`Club ${option.id} is offered with no page.`);
    return [
      option.id,
      option.label,
      placeOf(pageId),
      option.detail ?? "",
      [...(option.coaches ?? [])],
      [...(option.gcIds ?? [])],
    ];
  });
  return {
    pages,
    clubs,
    dropped: [...view.held.dropped],
    waiting: view.held.ageless.map((row) =>
      row.name === undefined ? [row.teamId] : [row.teamId, row.name]
    ),
    tooYoung: [...view.held.tooYoung],
  };
};

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const isId = (raw: unknown): raw is string => typeof raw === "string" && raw !== "";

const isTexts = (raw: unknown): raw is string[] =>
  Array.isArray(raw) && raw.every((one) => typeof one === "string");

const isIds = (raw: unknown): raw is string[] => Array.isArray(raw) && raw.every(isId);

/**
 * A published list as read back, or null when any part of it is not what a list holds: a club
 * dropped on the way would be one the box cannot find, so one bad club refuses the list.
 */
export const coerceSearch = (raw: unknown): SearchView | null => {
  if (!isRecord(raw) || !isIds(raw.pages) || !Array.isArray(raw.clubs)) return null;
  if (new Set(raw.pages).size !== raw.pages.length) return null;
  if (!isIds(raw.dropped) || !isIds(raw.tooYoung) || !Array.isArray(raw.waiting)) return null;
  const pages = raw.pages;
  const options: ClubSearchOption[] = [];
  const pageOf = new Map<string, string>();
  for (const entry of raw.clubs as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 6) return null;
    const [id, label, page, detail, coaches, gcIds] = entry as unknown[];
    if (!isId(id) || pageOf.has(id) || typeof label !== "string") return null;
    // A place that is not a whole number in range names no page.
    const pageId = typeof page === "number" ? pages[page] : undefined;
    if (pageId === undefined || typeof detail !== "string") return null;
    if (!isTexts(coaches) || !isIds(gcIds)) return null;
    pageOf.set(id, pageId);
    options.push({
      id,
      label,
      ...(detail ? { detail } : {}),
      ...(coaches.length > 0 ? { coaches } : {}),
      ...(gcIds.length > 0 ? { gcIds } : {}),
    });
  }
  const ageless: Array<HeldGcIds["ageless"][number]> = [];
  for (const entry of raw.waiting as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 1 || entry.length > 2) return null;
    const [teamId, name] = entry as unknown[];
    if (!isId(teamId) || (entry.length === 2 && typeof name !== "string")) return null;
    ageless.push(typeof name === "string" ? { teamId, name } : { teamId });
  }
  return {
    options,
    pageOf,
    held: { dropped: new Set(raw.dropped), ageless, tooYoung: new Set(raw.tooYoung) },
  };
};
