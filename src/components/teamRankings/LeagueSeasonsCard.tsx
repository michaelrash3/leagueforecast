import { useState } from "react";
import {
  AGE_LEVELS,
  ageGroupSeason,
  formatAgeGroupName,
  isRankedAgeLevel,
  MIN_RANKED_AGE_LEVEL,
  MIN_SEASON_YEAR,
  parseAgeGroupName,
  type AgeGroup,
  type AgeGroupSeason,
} from "../../lib/teamRankings";
import type { SeasonMeta } from "../../lib/storage";
import { button, card } from "../../styles/tokens";

type LeagueSeasonsCardProps = {
  seasons: SeasonMeta[];
  ageGroups: AgeGroup[];
  yearOptions: number[];
  /** Puts this League Standings season at that age, or takes it off Team Rankings with `null`. */
  onAssign: (seasonId: string, season: AgeGroupSeason | null) => void;
};

/**
 * Asks the one question about age groups that has an answer: what age does your league season play?
 *
 * Everything else here now arrives with the GameChanger pull — a 9U schedule makes the 9U page —
 * so typing a page in before you can use it is repeating what the import is about to say. What no
 * import can tell is which of those pages *your own league* belongs on, because nothing in a
 * GameChanger schedule mentions your league at all. That is what this asks, and answering it makes
 * the page if it is not there yet.
 */
export function LeagueSeasonsCard({
  seasons,
  ageGroups,
  yearOptions,
  onAssign,
}: LeagueSeasonsCardProps) {
  // Only the rows being changed right now; every other row reads from the age groups themselves,
  // so an answer given here and an age group edited elsewhere can never drift apart.
  const [drafts, setDrafts] = useState<Record<string, AgeGroupSeason>>({});

  if (seasons.length === 0) return null;

  return (
    <div className={`${card} p-5`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
        Your league seasons
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        What age does each of your League Standings seasons play? That season&apos;s whole schedule
        then counts on that age&apos;s table — upcoming games show their opponent right away, and
        scored ones count as results. The age pages themselves are made for you by the GameChanger
        import, so this is the only part it cannot work out: nothing in a GameChanger schedule
        mentions your league.
      </p>
      <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
        {seasons.map((season) => {
          const holder = ageGroups.find((group) => group.seasonIds.includes(season.id));
          const held = holder ? ageGroupSeason(holder) : {};
          // A season named "Spring 2027 9U" has already answered this; start there rather than at
          // a default the user has to correct.
          const guess = parseAgeGroupName(season.name);
          const draft: AgeGroupSeason = drafts[season.id] ?? {
            ageLevel: held.ageLevel ?? guess.ageLevel ?? MIN_RANKED_AGE_LEVEL,
            year: held.year ?? guess.year ?? yearOptions[0] ?? MIN_SEASON_YEAR,
          };
          const draftName = formatAgeGroupName(draft.ageLevel, draft.year);
          const settled =
            holder !== undefined && held.ageLevel === draft.ageLevel && held.year === draft.year;
          const patch = (next: Partial<AgeGroupSeason>) =>
            setDrafts((prev) => ({ ...prev, [season.id]: { ...draft, ...next } }));

          return (
            <li key={season.id} className="flex flex-wrap items-end gap-3 py-3 text-sm">
              <span className="flex min-w-[8rem] flex-col">
                <span className="font-bold text-slate-950 dark:text-white">{season.name}</span>
                <span className="text-xs text-slate-500">
                  {holder ? `On ${holder.name}` : "Not on Team Rankings yet"}
                </span>
              </span>
              <span className="flex flex-col gap-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor={`season-age-${season.id}`}
                >
                  Age
                </label>
                <select
                  id={`season-age-${season.id}`}
                  value={draft.ageLevel}
                  onChange={(event) => patch({ ageLevel: Number(event.target.value) })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  {AGE_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {level}U{isRankedAgeLevel(level) ? "" : " (not ranked)"}
                    </option>
                  ))}
                </select>
              </span>
              <span className="flex flex-col gap-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor={`season-year-${season.id}`}
                >
                  Year
                </label>
                <select
                  id={`season-year-${season.id}`}
                  value={draft.year}
                  onChange={(event) => patch({ year: Number(event.target.value) })}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </span>
              {!settled && (
                <button
                  type="button"
                  onClick={() => onAssign(season.id, draft)}
                  className={button.primary}
                >
                  {holder ? `Move to ${draftName}` : `Put on ${draftName}`}
                </button>
              )}
              {holder && (
                <button
                  type="button"
                  onClick={() => onAssign(season.id, null)}
                  className="pb-2 text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                >
                  Take off
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
