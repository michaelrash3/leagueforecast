import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
import { STATE_CODE_BY_NAME } from "../lib/stateNames";

export type TeamSearchOption = {
  /** What selecting this option yields. Names repeat across the country; ids do not. */
  id: string;
  label: string;
  /** A second line to tell two clubs of the same name apart — a state, a season, a record. */
  detail?: string;
  /**
   * Who coaches it (`coachesOf`), searched along with the name and listed under it. Where forty
   * clubs share a name, the coach is often the one thing about it the person looking already knows.
   */
  coaches?: readonly string[];
  /**
   * Put this one above the alphabet, lowest first.
   *
   * For the few options something actually knows about — the clubs a team's coaches point to,
   * where sharing two of them means the same club 98% of the time by state. Without it the
   * alphabet buries that answer among thousands of names, and the truncation below can drop it
   * entirely. Everything with no priority sorts alphabetically, as it always has.
   */
  priority?: number;
  /**
   * The GameChanger team ids the club is known by. A search holding one of them, bare or inside a
   * link to the team's page, finds the club that id is linked to and nothing else.
   */
  gcIds?: readonly string[];
};

/** Drawn at once. Past this the answer is to type more, not to scroll further. */
export const TEAM_SEARCH_LIMIT = 50;

/** State names longest first, so "west virginia" is taken whole before "virginia" can be. */
const STATES_LONGEST_FIRST = [...STATE_CODE_BY_NAME.entries()].sort(
  (a, b) => b[0].length - a[0].length
);

/** What a search asks of each result: every word somewhere in it, and every state it names. */
type SearchTerms = { words: string[]; states: Array<{ name: string; code: string }> };

/**
 * A search as the words it is made of, with any state named in full taken out as a state.
 *
 * Words rather than one string because a name is remembered in pieces and typed in whatever order
 * they come — "pandas trash" is the Trash Pandas — and a state's name because a club carries its
 * code: "ohio" found nothing in a list where every Ohio club reads "OH". A search that finds
 * nobody is still the answer when a word matches nothing about a club.
 */
export const searchTerms = (query: string): SearchTerms => {
  let rest = ` ${query.trim().toLowerCase().replace(/\s+/g, " ")} `;
  const states: SearchTerms["states"] = [];
  STATES_LONGEST_FIRST.forEach(([name, code]) => {
    const phrase = ` ${name} `;
    while (rest.includes(phrase)) {
      states.push({ name, code });
      rest = rest.replace(phrase, " ");
    }
  });
  return { words: rest.split(" ").filter(Boolean), states };
};

/**
 * A state's name is still a word too: "georgia smith" is as likely a coach called Georgia Smith as
 * a Smith in Georgia, so the name counts wherever it is written out, a coach's name included.
 */
/** What a search reads of an option, lower-cased once per option rather than once a keystroke. */
type SearchText = { text: string; lower: string; coaches: string[] };
const searchTexts = new WeakMap<TeamSearchOption, SearchText>();
const searchTextOf = (option: TeamSearchOption): SearchText => {
  const known = searchTexts.get(option);
  if (known) return known;
  const text = `${option.label} ${option.detail ?? ""}`;
  const read = {
    text,
    lower: text.toLowerCase(),
    coaches: option.coaches?.map((coach) => coach.toLowerCase()) ?? [],
  };
  searchTexts.set(option, read);
  return read;
};

const matchesTerms = (option: TeamSearchOption, terms: SearchTerms): boolean => {
  const { text, lower, coaches } = searchTextOf(option);
  const written = (word: string) => lower.includes(word) || coaches.some((c) => c.includes(word));
  return (
    terms.words.every(written) &&
    terms.states.every(({ name, code }) => new RegExp(`\\b${code}\\b`).test(text) || written(name))
  );
};

/**
 * The rows a query leaves, and how many there were in all.
 *
 * Alphabetical, because the caller's order — ranking, or whatever the pool happened to hold — is
 * no help at all when you are looking for a name you already know. The detail breaks a tie, so two
 * clubs of the same name keep a stable order rather than swapping about between renders.
 *
 * Except for the ones carrying a `priority`. Those are the options something actually knows
 * something about, and they go first: the alphabet is the right default precisely because nothing
 * usually knows better, and the wrong one when something does.
 */
/**
 * The GameChanger team ids a search names: the id in a link to a team's page, or a word that has
 * the shape of one (twelve letters and digits).
 *
 * An id is what somebody holding a GameChanger page has, and until this a pasted one found nothing,
 * since names were all a search read: the user asked on 28 September 2026 why the team attached to
 * an id could not be found. A twelve-letter word is only taken as an id where a club carries it
 * exactly, so "Thunderbolts" still searches as a name.
 */
export const gcIdsInSearch = (query: string): string[] => {
  const ids = new Set<string>();
  for (const match of query.matchAll(/gc\.com\/teams\/([A-Za-z0-9]{12})/g)) ids.add(match[1]!);
  query.split(/\s+/).forEach((word) => {
    if (/^[A-Za-z0-9]{12}$/.test(word)) ids.add(word);
  });
  return [...ids];
};

/**
 * The options in the order a search lists them, sorted once per list rather than once a keystroke.
 *
 * Find a team offers every club in the pool, and once the clubs known only from other schedules
 * joined it that was about 93,000; sorting them on every keystroke took 130 to 190 ms of it,
 * measured in Node, which a phone multiplies. The list is a memo's, so the same array comes back
 * until the pool changes, and the order is kept against it.
 */
const sortedLists = new WeakMap<readonly TeamSearchOption[], TeamSearchOption[]>();
/** One collator for every comparison: the same order as `localeCompare`, without making one each. */
const collator = new Intl.Collator();
const sortedOptions = (options: readonly TeamSearchOption[]): TeamSearchOption[] => {
  const known = sortedLists.get(options);
  if (known) return known;
  const sorted = options
    .slice()
    .sort(
      (a, b) =>
        (a.priority ?? Infinity) - (b.priority ?? Infinity) ||
        collator.compare(a.label, b.label) ||
        collator.compare(a.detail ?? "", b.detail ?? "")
    );
  sortedLists.set(options, sorted);
  return sorted;
};

/**
 * Sorts a list and reads every option's text ahead of the first search of it, which is otherwise
 * what that first keystroke waits on: about 0.4 s on 93,000 options, measured in Node.
 */
export const warmTeamSearch = (options: readonly TeamSearchOption[]): void => {
  sortedOptions(options).forEach(searchTextOf);
};

export const matchTeamOptions = (
  options: readonly TeamSearchOption[],
  query: string,
  limit: number = TEAM_SEARCH_LIMIT
): { shown: TeamSearchOption[]; total: number } => {
  const ids = gcIdsInSearch(query);
  if (ids.length > 0) {
    const linked = options.filter((option) => option.gcIds?.some((id) => ids.includes(id)));
    if (linked.length > 0) return { shown: linked.slice(0, limit), total: linked.length };
  }
  const terms = searchTerms(query);
  const searching = terms.words.length > 0 || terms.states.length > 0;
  const sorted = sortedOptions(options);
  const matches = searching ? sorted.filter((option) => matchesTerms(option, terms)) : sorted;
  return { shown: matches.slice(0, limit), total: matches.length };
};

/** Coaches listed under a result before the rest are counted rather than named. */
export const COACHES_SHOWN = 3;

/**
 * The coaches a result lists, and how many more it has: the ones the query found first, marked, so
 * a club found by its coach says which coach, then the others in the order the club gave them.
 * Null for an option with none.
 */
export const coachesToList = (
  coaches: readonly string[] | undefined,
  query: string
): { names: Array<{ name: string; found: boolean }>; more: number } | null => {
  if (!coaches?.length) return null;
  const { words, states } = searchTerms(query);
  const needles = [...words, ...states.map((state) => state.name)];
  const marked = coaches.map((name) => ({
    name,
    found: needles.some((word) => name.toLowerCase().includes(word)),
  }));
  const ordered = [...marked.filter((coach) => coach.found), ...marked.filter((c) => !c.found)];
  return {
    names: ordered.slice(0, COACHES_SHOWN),
    more: Math.max(0, ordered.length - COACHES_SHOWN),
  };
};

/**
 * How the box looks wherever it is used: a field with an edge. Three of the five places it is used
 * gave it no style at all, so on Scouting and on Find a team it was a bare line of text, and on a
 * phone the "fare?" beside Scouting's was printed over the name picked in it. A caller adds a
 * width. The text is left at the browser's 16px, below which iOS zooms the page on focus.
 */
const FIELD =
  "rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900";

type TeamSearchSelectProps = {
  id: string;
  /** The selected option's id, or "" for none chosen. */
  value: string;
  onChange: (teamId: string) => void;
  options: TeamSearchOption[];
  placeholder?: string;
  className?: string;
};

/**
 * Picks one team out of a list too long to scroll.
 *
 * A dropdown was fine when a pool held the dozen clubs somebody had typed in. A pool fed from
 * GameChanger holds thousands, and a native `select` over that is a wall: no way to type at it, and
 * ordered by whatever the caller happened to hand over. This filters as you type and lists what is
 * left alphabetically, which are the two things that make a long list usable.
 *
 * It selects by id rather than by name on purpose. The country is full of clubs called the same
 * thing, and this control exists to fold one team into another — the one place where picking the
 * wrong team of the same name does real damage. The name is what you search; the id is what you
 * choose. Where two rows read alike, `detail` is what tells them apart.
 */
export function TeamSearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder,
  className,
}: TeamSearchSelectProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((option) => option.id === value) ?? null;

  const { shown, total } = useMemo(() => matchTeamOptions(options, query), [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  /**
   * A filtered list is a different list, so the highlight goes back to the top whenever the query
   * changes — done where the query changes rather than in an effect, which would be a second
   * render to undo the first. Clamped as well, since the list can shrink under a stale index.
   */
  const activeIndex = shown.length === 0 ? 0 : Math.min(active, shown.length - 1);

  const choose = (option: TeamSearchOption) => {
    onChange(option.id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && shown[activeIndex] ? `${listboxId}-${activeIndex}` : undefined
        }
        autoComplete="off"
        // While it is open you are searching, so the box holds the query; closed, it holds the
        // team you chose, which is what a picker is expected to show.
        value={open ? query : (selected?.label ?? "")}
        placeholder={placeholder}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery("");
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            if (shown.length === 0) return;
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((activeIndex + step + shown.length) % shown.length);
            return;
          }
          if (event.key === "Enter" && open) {
            const option = shown[activeIndex];
            if (option) {
              event.preventDefault();
              choose(option);
            }
          }
        }}
        className={`${FIELD} ${className ?? "w-full"}`}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          {shown.length === 0 && (
            <li className="px-3 py-1.5 text-slate-500 dark:text-slate-400">
              {/^\s*\S*gc\.com\/teams\/[A-Za-z0-9]{12}/.test(query)
                ? "No team here is linked to that GameChanger page. It has not been pulled, or it was pulled onto another team and unlinked."
                : "No team matches that."}
            </li>
          )}
          {shown.map((option, index) => {
            const coaches = coachesToList(option.coaches, query);
            return (
              <li
                key={option.id}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={option.id === value}
              >
                <button
                  type="button"
                  // Fires before the input's blur, so the click registers before the list closes.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setActive(index)}
                  className={`block w-full px-3 py-1.5 text-left ${
                    index === activeIndex ? "bg-slate-100 dark:bg-slate-800" : ""
                  }`}
                >
                  <span className="font-semibold text-slate-950 dark:text-white">
                    {option.label}
                  </span>
                  {option.detail && (
                    <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                      {option.detail}
                    </span>
                  )}
                  {coaches && (
                    <span className="block text-xs text-slate-500 dark:text-slate-400">
                      Coaches:{" "}
                      {coaches.names.map((coach, at) => (
                        <Fragment key={coach.name}>
                          {at > 0 && ", "}
                          {coach.found ? (
                            <strong className="font-semibold text-slate-800 dark:text-slate-100">
                              {coach.name}
                            </strong>
                          ) : (
                            coach.name
                          )}
                        </Fragment>
                      ))}
                      {coaches.more > 0 && ` and ${coaches.more} more`}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {total > shown.length && (
            <li className="px-3 py-1.5 text-xs text-slate-500 dark:text-slate-400">
              {total - shown.length} more — keep typing to narrow it.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
