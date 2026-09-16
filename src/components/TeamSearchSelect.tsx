import { useEffect, useId, useMemo, useRef, useState } from "react";

export type TeamSearchOption = {
  /** What selecting this option yields. Names repeat across the country; ids do not. */
  id: string;
  label: string;
  /** A second line to tell two clubs of the same name apart — a state, a season, a record. */
  detail?: string;
  /**
   * Put this one above the alphabet, lowest first.
   *
   * For the few options something actually knows about — the clubs a team's coaches point to,
   * where sharing two of them means the same club 98% of the time by state. Without it the
   * alphabet buries that answer among thousands of names, and the truncation below can drop it
   * entirely. Everything with no priority sorts alphabetically, as it always has.
   */
  priority?: number;
};

/** Drawn at once. Past this the answer is to type more, not to scroll further. */
export const TEAM_SEARCH_LIMIT = 50;

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
export const matchTeamOptions = (
  options: readonly TeamSearchOption[],
  query: string,
  limit: number = TEAM_SEARCH_LIMIT
): { shown: TeamSearchOption[]; total: number } => {
  const needle = query.trim().toLowerCase();
  const sorted = options
    .slice()
    .sort(
      (a, b) =>
        (a.priority ?? Infinity) - (b.priority ?? Infinity) ||
        a.label.localeCompare(b.label) ||
        (a.detail ?? "").localeCompare(b.detail ?? "")
    );
  const matches = needle
    ? sorted.filter((option) =>
        `${option.label} ${option.detail ?? ""}`.toLowerCase().includes(needle)
      )
    : sorted;
  return { shown: matches.slice(0, limit), total: matches.length };
};

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
        className={className}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg dark:border-slate-800 dark:bg-slate-900"
        >
          {shown.length === 0 && (
            <li className="px-3 py-1.5 text-slate-500">No team matches that.</li>
          )}
          {shown.map((option, index) => (
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
                <span className="font-semibold text-slate-950 dark:text-white">{option.label}</span>
                {option.detail && (
                  <span className="ml-2 text-xs text-slate-500">{option.detail}</span>
                )}
              </button>
            </li>
          ))}
          {total > shown.length && (
            <li className="px-3 py-1.5 text-xs text-slate-500">
              {total - shown.length} more — keep typing to narrow it.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
