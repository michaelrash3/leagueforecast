import type { RankingsSection } from "../../lib/rankingsRoute";
import { useNarrowViewport } from "../../hooks/useWideViewport";
import type { ReactNode } from "react";
import { useContext } from "react";
import { ModeSwitchContext } from "../modeSwitch";
import { TabNav } from "../TabNav";
import { NAV_ICONS } from "../navIcons";

/**
 * Team Rankings used to render every area on one scroll — the tables, the forms, the importer and
 * the age-group editor, all below one another. This is the nav that replaced it: one area at a
 * time, each a link of its own through `?section=`.
 *
 * The order is the order of a season: read where everyone stands, log what happened, bring results
 * in, study one team, look back at the seasons that are over, and only then the settings nobody
 * visits twice.
 */
const SECTIONS: { section: RankingsSection; label: string }[] = [
  { section: "rankings", label: "Rankings" },
  { section: "games", label: "Games" },
  { section: "import", label: "Import" },
  { section: "scouting", label: "Scouting" },
  { section: "archive", label: "Archive" },
  { section: "setup", label: "Setup" },
];

/** The one panel the tabs all describe; every tab points at it with `aria-controls`. */
export const SECTION_PANEL_ID = "team-rankings-panel";

/** The tab that opens a section, so the panel can name the tab it belongs to. */
export const sectionTabId = (section: RankingsSection) => `team-rankings-tab-${section}`;

/** The sections a phone keeps in its row (2.4); Archive and Setup are under More. */
const PHONE_SECTIONS: readonly RankingsSection[] = ["rankings", "games", "import", "scouting"];
const SECTION_ICONS: Partial<Record<RankingsSection, ReactNode>> = {
  rankings: NAV_ICONS.rankings,
  games: NAV_ICONS.games,
  import: NAV_ICONS.import,
  scouting: NAV_ICONS.scouting,
};

export function SectionNav({
  current,
  onSelect,
  onPreview,
  inBar = false,
}: {
  current: RankingsSection;
  onSelect: (section: RankingsSection) => void;
  /** When a tab is pointed at or focused, before it is pressed (the sections load on demand). */
  onPreview?: (section: RankingsSection) => void;
  /** Drawn in a row of its own (`RankingsHeader`), which spaces it, rather than under the card's. */
  inBar?: boolean;
}) {
  const narrow = useNarrowViewport();
  const modeSwitch = useContext(ModeSwitchContext);
  /*
   * The tabs and their keyboard (arrow keys between them, Home and End to either end, the focus on
   * one at a time) are `TabNav`'s, shared with League Standings, so the two halves move alike.
   */
  return (
    <TabNav
      label="Team Rankings section"
      items={SECTIONS.map(({ section, label }) => ({
        key: section,
        label,
        tabId: sectionTabId(section),
        controls: SECTION_PANEL_ID,
        ...(SECTION_ICONS[section] ? { icon: SECTION_ICONS[section] } : {}),
      }))}
      current={current}
      onSelect={onSelect}
      {...(onPreview ? { onPreview } : {})}
      narrow={narrow}
      primary={PHONE_SECTIONS}
      actions={modeSwitch ? [modeSwitch] : []}
      className={
        inBar
          ? "-mx-1 px-1"
          : "mt-3 -mx-1 border-t border-slate-100 px-1 pt-3 dark:border-slate-800"
      }
    />
  );
}
