import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { focusRing, tab } from "../styles/tokens";
import { NAV_ICONS } from "./navIcons";

/**
 * The tab row both halves of the app share (2.4). On a wide screen, every tab in a row, as before.
 * On a phone, a bar along the bottom of the screen, where a thumb is: the few views opened most,
 * each an icon over its label, and **More** for the rest, so nothing sits out of sight past the
 * edge of a row that scrolls sideways, which is where Settings and League Stats were. Five is what
 * fits: no row of five labels does, measured at 295px for the labels alone in 12px type against
 * the 288px a 320px screen leaves. The bar's labels are sized with the screen, 9px at 320px and
 * below and 11px from 390px, so "Dashboard" (about 55px at 9px) sits inside its cell even at 125%
 * browser zoom, where a 360px phone is 288px wide and a cell 57.6px.
 *
 * A tab can carry a badge, a count with the words a screen reader reads for it. On a phone, a view
 * under More whose badge is urgent is also a strip across the top of the bar ("Data Quality: 1
 * needs attention"), since a warning that has to be found behind a menu is not much of one, and a
 * sixth cell would not fit. More carries the badges of what is behind it, and is marked as the
 * open view when one of those is.
 *
 * The cells are a tablist either way: arrow keys move between its tabs and Home and End go to
 * either end, with the focus on one tab at a time (a roving `tabIndex`). More is a disclosure
 * button beside the tablist, not a tab, and its list is buttons; Escape closes it and gives the
 * focus back, and so does a tap anywhere else.
 *
 * A badge's words describe its tab (`aria-describedby`) rather than sit inside it: inside, they
 * would become part of the tab's name, and "Data Quality" would be called "Data Quality 1 needs
 * attention" for as long as something did.
 */
export type TabNavItem<K extends string> = {
  key: K;
  label: string;
  /** The tab's id, for the panel's `aria-labelledby`. */
  tabId: string;
  /** The panel it shows, for `aria-controls`. */
  controls: string;
  /** Drawn over the label in a phone's bar. */
  icon?: ReactNode;
  badge?: {
    count: number;
    /** What the count is, read after the tab's name, such as "2 need attention". */
    describe: string;
    /** An urgent badge under More is also shown across the top of a phone's bar. */
    urgent?: boolean;
  };
};

/** Something under More that is not a view, such as the tour. */
export type TabNavAction = { label: string; onSelect: () => void };

type Props<K extends string> = {
  label: string;
  items: readonly TabNavItem<K>[];
  current: K;
  onSelect: (key: K) => void;
  /** Phone-narrow: a bar along the bottom with `primary` and More. */
  narrow: boolean;
  /** The tabs in a phone's bar, in their order. */
  primary: readonly K[];
  actions?: readonly TabNavAction[];
  /** When a tab is pointed at or focused, before it is pressed (League's views load on demand). */
  onPreview?: (key: K) => void;
  /** The wide row's own spacing; the phone's bar is fixed to the screen and takes none. */
  className?: string;
};

/** The count drawn on a tab, hidden from a screen reader, which reads the description instead. */
const count = (value: number, onIcon = false) => (
  <span
    aria-hidden="true"
    className={`inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-xs font-black leading-5 text-white ${
      onIcon ? "absolute -right-3 -top-1.5" : "ml-1.5"
    }`}
  >
    {value}
  </span>
);

/** A phone's bar cell: an icon over its label, dark when it is the open view. */
const cell = (active: boolean) =>
  `relative flex min-w-0 flex-1 flex-col items-center gap-0.5 pb-1.5 pt-2 text-[clamp(9px,2.8vw,11px)] font-bold leading-tight ${focusRing} ${
    active
      ? "text-slate-950 dark:text-white"
      : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
  }`;

export function TabNav<K extends string>({
  label,
  items,
  current,
  onSelect,
  narrow,
  primary,
  actions = [],
  onPreview,
  className = "",
}: Props<K>) {
  const id = useId();
  const tabs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const moreArea = useRef<HTMLDivElement | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  // Only a phone has a More list, so one left open is closed by the screen widening.
  const open = narrow && moreOpen;

  const inRow = narrow ? items.filter((item) => primary.includes(item.key)) : items;
  const underMore = narrow ? items.filter((item) => !inRow.includes(item)) : [];
  const currentUnderMore = underMore.find((item) => item.key === current);
  const urgent = underMore.filter(
    (item) => item.badge?.urgent && item.badge.count > 0 && item.key !== current
  );
  const moreCount = underMore.reduce((sum, item) => sum + (item.badge?.count ?? 0), 0);
  // The tab the focus lands on when tabbing into the row: the open one, or the first.
  const rovingKey = inRow.some((item) => item.key === current) ? current : inRow[0]?.key;
  const describedBy = (key: string) => `${id}-${key}-badge`;

  // A tap anywhere but the list or its button closes it.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Node && moreArea.current?.contains(event.target)) return;
      setMoreOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = inRow.findIndex((item) => item.key === rovingKey);
    const last = inRow.length - 1;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = index >= last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = index <= 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    const key = inRow[next]?.key;
    if (key === undefined) return;
    onSelect(key);
    tabs.current[key]?.focus();
  };

  /** Escape, anywhere in the More list or on its button, closes it and goes back to the button. */
  const closeOnEscape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setMoreOpen(false);
    moreButton.current?.focus();
  };

  const choose = (key: K) => {
    setMoreOpen(false);
    onSelect(key);
  };

  const tabButton = (item: TabNavItem<K>) => {
    const active = item.key === current;
    return (
      <button
        key={item.key}
        type="button"
        role="tab"
        id={item.tabId}
        aria-selected={active}
        aria-controls={item.controls}
        {...(item.badge?.count ? { "aria-describedby": describedBy(item.key) } : {})}
        tabIndex={item.key === rovingKey ? 0 : -1}
        ref={(node) => {
          tabs.current[item.key] = node;
        }}
        onClick={() => onSelect(item.key)}
        onKeyDown={onKeyDown}
        onMouseEnter={() => onPreview?.(item.key)}
        onFocus={() => onPreview?.(item.key)}
        className={narrow ? cell(active) : tab(active)}
      >
        {narrow ? (
          <>
            <span className="relative">
              {item.icon}
              {item.badge?.count ? count(item.badge.count, true) : null}
            </span>
            {item.label}
          </>
        ) : (
          <>
            {item.label}
            {item.badge?.count ? count(item.badge.count) : null}
          </>
        )}
      </button>
    );
  };

  // What each badge means, read as its tab's description, never as part of its name.
  const descriptions = (
    <div hidden>
      {items
        .filter((item) => item.badge?.count)
        .map((item) => (
          <span key={item.key} id={describedBy(item.key)}>
            {item.badge?.describe}
          </span>
        ))}
      {moreCount ? (
        <span id={`${id}-more-badge`}>
          {underMore
            .filter((item) => item.badge?.count)
            .map((item) => `${item.label}: ${item.badge?.describe ?? ""}`)
            .join("; ")}
        </span>
      ) : null}
    </div>
  );

  if (!narrow) {
    return (
      <div className={className}>
        <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto">
          {inRow.map(tabButton)}
        </div>
        {descriptions}
      </div>
    );
  }

  return (
    <div
      // Marks the bar for the design checks, which let its labels be smaller than 12px (2.5).
      data-tab-bar=""
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur-xl dark:border-slate-800 dark:bg-slate-950/95"
    >
      {urgent.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => choose(item.key)}
          onMouseEnter={() => onPreview?.(item.key)}
          className={`flex w-full items-center justify-center gap-2 border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs font-bold text-red-700 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200 ${focusRing}`}
        >
          {item.label}: {item.badge?.describe}
        </button>
      ))}
      <div ref={moreArea} className="relative mx-auto flex max-w-lg">
        <div role="tablist" aria-label={label} className="flex min-w-0 flex-[4]">
          {inRow.map(tabButton)}
        </div>
        {(underMore.length > 0 || actions.length > 0) && (
          <button
            ref={moreButton}
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-more`}
            // The visible "More", and which view is open under it.
            aria-label={currentUnderMore ? `More: ${currentUnderMore.label}` : "More"}
            {...(moreCount ? { "aria-describedby": `${id}-more-badge` } : {})}
            onClick={() => setMoreOpen((was) => !was)}
            onKeyDown={closeOnEscape}
            className={cell(Boolean(currentUnderMore))}
          >
            <span className="relative">
              {NAV_ICONS.more}
              {moreCount ? count(moreCount, true) : null}
            </span>
            More
          </button>
        )}
        {open && (
          <div
            id={`${id}-more`}
            role="group"
            aria-label={`More ${label.toLowerCase()}`}
            className="absolute bottom-full right-2 mb-2 w-60 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          >
            {underMore.map((item) => (
              <button
                key={item.key}
                type="button"
                aria-current={item.key === current ? "page" : undefined}
                {...(item.badge?.count ? { "aria-describedby": describedBy(item.key) } : {})}
                onClick={() => choose(item.key)}
                onKeyDown={closeOnEscape}
                onMouseEnter={() => onPreview?.(item.key)}
                onFocus={() => onPreview?.(item.key)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2.5 text-left text-sm font-bold ${
                  item.key === current
                    ? "bg-slate-950 text-white dark:bg-white dark:text-slate-950"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                } ${focusRing}`}
              >
                {item.label}
                {item.badge?.count ? count(item.badge.count) : null}
              </button>
            ))}
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  action.onSelect();
                }}
                onKeyDown={closeOnEscape}
                className={`flex w-full items-center rounded-md px-3 py-2.5 text-left text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 ${focusRing}`}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
      {descriptions}
    </div>
  );
}
