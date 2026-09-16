/**
 * The top of Team Rankings: which season year is open, which age level within it, and which area
 * of that page is showing. Every one of the three is a link somebody can send.
 */
import { ageGroupLevel, isRankedAgeLevel, type AgeGroup } from "../../lib/teamRankings";
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
  onOpenYear: (year: number | undefined) => void;
  onOpenPage: (groupId: string) => void;
  onOpenSection: (section: RankingsSection) => void;
};

export function RankingsHeader({
  ageGroups,
  section,
  selectedYear,
  selectedAgeGroupId,
  groupsInYear,
  yearChoices,
  onOpenYear,
  onOpenPage,
  onOpenSection,
}: RankingsHeaderProps) {
  return (
    <div className={`${card} p-5`}>
      <h1 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
        Team Rankings
      </h1>
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
