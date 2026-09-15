import { useRef, type KeyboardEvent } from "react";
import type { RankingsSection } from "../../lib/rankingsRoute";
import { tab } from "../../styles/tokens";

/**
 * Team Rankings used to render every area on one scroll — the tables, the forms, the importer and
 * the age-group editor, all below one another. This is the nav that replaced it: one area at a
 * time, each a link of its own through `?section=`.
 *
 * The order is the order of a season: read where everyone stands, log what happened, bring results
 * in, study one team, and only then the settings nobody visits twice.
 */
const SECTIONS: { section: RankingsSection; label: string }[] = [
  { section: "rankings", label: "Rankings" },
  { section: "games", label: "Games" },
  { section: "import", label: "Import" },
  { section: "scouting", label: "Scouting" },
  { section: "setup", label: "Setup" },
];

/** The one panel the tabs all describe; every tab points at it with `aria-controls`. */
export const SECTION_PANEL_ID = "team-rankings-panel";

/** The tab that opens a section, so the panel can name the tab it belongs to. */
export const sectionTabId = (section: RankingsSection) => `team-rankings-tab-${section}`;

export function SectionNav({
  current,
  onSelect,
}: {
  current: RankingsSection;
  onSelect: (section: RankingsSection) => void;
}) {
  const tabs = useRef<Partial<Record<RankingsSection, HTMLButtonElement | null>>>({});

  /**
   * Arrow keys move between tabs, as a tablist is expected to. Tab itself skips over the ones that
   * are not current (the roving `tabIndex` below), so reaching the panel's contents does not mean
   * pressing Tab five times first.
   *
   * The handler sits on each tab rather than on the tablist, because the tablist is not focusable
   * — the roving `tabIndex` puts the focus on a tab, which is where the keystroke arrives.
   */
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = SECTIONS.findIndex((entry) => entry.section === current);
    const last = SECTIONS.length - 1;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = index === last ? 0 : index + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = index <= 0 ? last : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else return;
    event.preventDefault();
    const section = SECTIONS[next]!.section;
    onSelect(section);
    tabs.current[section]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="Team Rankings section"
      className="mt-3 -mx-1 flex gap-1 overflow-x-auto border-t border-slate-100 px-1 pt-3 dark:border-slate-800"
    >
      {SECTIONS.map(({ section, label }) => {
        const active = section === current;
        return (
          <button
            key={section}
            type="button"
            role="tab"
            id={sectionTabId(section)}
            aria-selected={active}
            aria-controls={SECTION_PANEL_ID}
            tabIndex={active ? 0 : -1}
            ref={(node) => {
              tabs.current[section] = node;
            }}
            onClick={() => onSelect(section)}
            onKeyDown={onKeyDown}
            className={tab(active)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
