/**
 * Every season this device holds, at a glance: how each ended or how far it has got, and the team
 * followed in it, one league's seasons side by side (`seasonGlance.ts`). Opened from the Seasons
 * card (`SeasonManager.tsx`), which fetches this the first time it is opened: until then nothing
 * of it is downloaded, and nothing is read from storage.
 */
import { useMemo } from "react";
import { agoLabel } from "../../lib/date";
import { storedBases } from "../../lib/live/leagueBase";
import { createdApart, seasonDocId } from "../../lib/live/leagueDocs";
import { readOurTeam } from "../../lib/preferences";
import { glanceCache, glanceGroups, glanceLines, type SeasonGlance } from "../../lib/seasonGlance";
import { listSeasons, readSeasonSnapshot, type SeasonMeta } from "../../lib/storage";

/** Each season's glance, kept for the visit and worked out again only once the season is saved. */
const glanceOf = glanceCache();

/**
 * Whether League kept live has a copy of this season's document on this device, which is what
 * makes it a season the cloud may have moved on from. A copy kept for a season made at another
 * moment belongs to a deleted season whose id this one reuses (`leagueSeasons.ts`), and says
 * nothing of it.
 */
const linkedToCloud = (meta: SeasonMeta): boolean => {
  const known = storedBases.read(seasonDocId(meta.id));
  return known !== null && !createdApart(known.season.createdAt, meta.createdAt);
};

const statusOf = (glance: SeasonGlance): string =>
  glance.final
    ? "Final"
    : glance.bracketOpen
      ? "Bracket to finish"
      : glance.scheduled === 0
        ? "No games"
        : "In progress";

export function SeasonsAtAGlance({
  seasons,
  activeSeasonId,
}: {
  seasons: readonly SeasonMeta[];
  activeSeasonId: string;
}) {
  /*
   * Read when opened, and again only when the list of seasons or the open one changes: a glance,
   * not a live view. Each season is read from storage as it was last saved, fresh from the index
   * (the list passed in may predate a save), and only where it was saved since it was last read.
   * The open season too: its scores are saved half a second after the last one typed (`App.tsx`),
   * so one marked final in that half second is not in it until the glance is opened again.
   */
  const groups = useMemo(() => {
    const stored = new Map(listSeasons().map((meta) => [meta.id, meta]));
    const rows = seasons.flatMap((listed) => {
      const meta = stored.get(listed.id);
      const glance = meta ? glanceOf(meta, readOurTeam(meta.id), readSeasonSnapshot) : null;
      if (!meta || !glance) return [];
      /*
       * The open season is the one League kept live follows; any other is as this device last
       * saved it, which may be behind what another device has done since. Nothing is fetched to
       * catch it up.
       */
      const behind = meta.id !== activeSeasonId && linkedToCloud(meta);
      return [{ meta, glance, behind }];
    });
    return glanceGroups(rows);
  }, [seasons, activeSeasonId]);

  return (
    <div className="space-y-4" role="region" aria-label="Seasons at a glance">
      <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        From the seasons stored on this device. Nothing is fetched to bring them up to date.
      </p>
      {groups.map((group) => (
        <div key={group.seasons[0]?.meta.id ?? group.stem}>
          <h3 className="text-sm font-black uppercase tracking-wide text-slate-600 dark:text-slate-300">
            {group.stem || "Named by year"}
          </h3>
          <ul className="mt-2 space-y-2">
            {group.seasons.map(({ meta, glance, behind }) => (
              <li
                key={meta.id}
                aria-label={meta.name}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-slate-100">
                    {meta.name}
                    {meta.id === activeSeasonId && (
                      <span className="ml-2 text-xs font-semibold text-blue-700 dark:text-blue-300">
                        Open
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {statusOf(glance)}
                  </span>
                </div>
                <ul className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
                  {glanceLines(glance).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {behind && (
                  <p className="mt-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {meta.updatedAt
                      ? `May be behind: this device's copy as of ${agoLabel(meta.updatedAt)}.`
                      : "May be behind: this is this device's copy."}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
