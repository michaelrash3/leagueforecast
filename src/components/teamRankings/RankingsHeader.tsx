/**
 * The top of Team Rankings: which season year is open, which age level within it, and which area
 * of that page is showing. Every one of the three is a link somebody can send.
 */
import { agoLabel } from "../../lib/date";
import {
  ageGroupLevel,
  isRankedAgeLevel,
  segmentLabel,
  type AgeGroup,
  type SeasonSegment,
} from "../../lib/teamRankings";
import { SEASON_SEGMENTS } from "../../lib/rankingsRoute";
import type { RankingsSection } from "../../lib/rankingsRoute";
import { SectionNav } from "./SectionNav";
import { button, card, tab } from "../../styles/tokens";

type RankingsHeaderProps = {
  ageGroups: AgeGroup[];
  section: RankingsSection;
  /** The season year on screen; `undefined` is the bucket for groups with no year of their own. */
  selectedYear: number | undefined;
  selectedAgeGroupId: string;
  groupsInYear: AgeGroup[];
  yearChoices: (number | undefined)[];
  /** Which half of the baseball year the boards are for; absent on a page with no year. */
  selectedSegment: SeasonSegment | undefined;
  /** How many games each half of this year holds, so a half with none can say so on its tab. */
  segmentGames: Record<SeasonSegment, number>;
  onOpenSegment: (segment: SeasonSegment) => void;
  onOpenYear: (year: number | undefined) => void;
  onOpenPage: (groupId: string) => void;
  onOpenSection: (section: RankingsSection) => void;
  /** When the newest GameChanger schedule in the pool was fetched; null for a pool never pulled into. */
  pulledAt: string | null;
};

export function RankingsHeader({
  ageGroups,
  section,
  selectedYear,
  selectedAgeGroupId,
  groupsInYear,
  yearChoices,
  selectedSegment,
  segmentGames,
  onOpenSegment,
  onOpenYear,
  onOpenPage,
  onOpenSection,
  pulledAt,
}: RankingsHeaderProps) {
  return (
    <div className={`${card} p-5`}>
      <h1 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
        Team Rankings
      </h1>
      {/* The one fact about freshness the pool has always stored and never shown. */}
      <p className="mt-1 text-xs text-slate-500" data-testid="rankings-freshness">
        {pulledAt === null
          ? "No GameChanger schedules pulled yet."
          : `Schedules last pulled ${agoLabel(pulledAt)}.`}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-500"
          htmlFor="scout-season-year"
        >
          Season
        </label>
        {yearChoices.length > 1 ? (
          <select
            id="scout-season-year"
            value={selectedYear === undefined ? "" : String(selectedYear)}
            onChange={(event) =>
              onOpenYear(event.target.value === "" ? undefined : Number(event.target.value))
            }
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {yearChoices.map((year) => (
              <option key={year === undefined ? "" : year} value={year === undefined ? "" : year}>
                {year === undefined ? "No season set" : year}
              </option>
            ))}
          </select>
        ) : (
          ageGroups.length > 0 && (
            <span
              id="scout-season-year"
              className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
            >
              {selectedYear ?? "No season set"}
            </span>
          )
        )}
      </div>

      {/*
        The way in, for a browser with nothing in it yet. Not shown on the two sections it points
        at: on Setup the form it offers is already on screen, and on Import so is the pull.
      */}
      {ageGroups.length === 0 && section !== "setup" && section !== "import" && (
        <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
          <p className="text-sm font-bold text-slate-950 dark:text-white">Nothing ranked yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Pull a team list from GameChanger and the pages make themselves: every team says which
            age level and season it belongs to, and each one is filed under the page for that squad
            year — created if it is not there yet. Setting a page up by hand is for a league you are
            tracking without GameChanger.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onOpenSection("import")}
              className={button.primary}
            >
              Pull from GameChanger
            </button>
            <button type="button" onClick={() => onOpenSection("setup")} className={button.ghost}>
              Set one up by hand
            </button>
          </div>
        </div>
      )}

      {/*
        The two halves of the baseball year, which are two tables rather than one filtered.
        Alongside the season and the age level because it scopes the boards the same way, and only
        where there is a year to be half of — a legacy page with no season keeps its single table.
      */}
      {selectedSegment !== undefined && selectedYear !== undefined && groupsInYear.length > 0 && (
        <nav
          aria-label="Half of the season"
          className="mt-3 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {SEASON_SEGMENTS.map((segment) => {
            const active = segment === selectedSegment;
            const played = segmentGames[segment];
            return (
              <button
                key={segment}
                type="button"
                onClick={() => onOpenSegment(segment)}
                aria-current={active ? "page" : undefined}
                className={tab(active)}
              >
                {segmentLabel(selectedYear, segment)}
                {/* A half nobody has played yet is still offered, and says so rather than
                    disappearing: the season is going to reach it. */}
                {played === 0 && (
                  <span className="ml-2 text-xs font-semibold opacity-60">not played</span>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {groupsInYear.length > 0 && (
        <nav aria-label="Age level" className="mt-3 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {groupsInYear.map((group) => {
            const level = ageGroupLevel(group);
            const active = group.id === selectedAgeGroupId;
            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onOpenPage(group.id)}
                aria-current={active ? "page" : undefined}
                className={tab(active)}
              >
                {level === undefined ? group.name : `${level}U`}
                {isRankedAgeLevel(level) ? "" : " ·"}
              </button>
            );
          })}
        </nav>
      )}

      <SectionNav current={section} onSelect={onOpenSection} />
    </div>
  );
}
