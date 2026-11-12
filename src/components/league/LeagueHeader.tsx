import type { Dispatch, JSX, SetStateAction } from "react";
import type { AppMode } from "../../lib/preferences";
import type { SeasonMeta } from "../../lib/storage";
import type { ActiveShareView, TeamBase, TeamWithProjection } from "../../lib/types";
import { tab } from "../../styles/tokens";
import { CloudButton } from "../CloudButton";
import { HeaderStatCard } from "../HeaderStatCard";
import type { CloudStatus } from "../../lib/cloud/cloudSession";
import type { Seasons } from "../../hooks/useSeasons";
import { useNarrowViewport } from "../../hooks/useWideViewport";

/** What `LeagueHeader` reads of App, each by the name App gives it. */
export type LeagueHeaderProps = {
  activeSeasonId: string;
  activeView: ActiveShareView;
  appMode: AppMode;
  cloud: CloudStatus;
  cloudPanel: { showing: boolean; show: () => void; hide: () => void };
  currentLeader: TeamWithProjection | undefined;
  finalCount: number;
  goldCutoff: number;
  hasCutLine: boolean;
  hasPostseason: boolean;
  seasonGroups: { inUse: SeasonMeta[]; archived: SeasonMeta[] };
  seasons: Seasons;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  shareSeason: () => Promise<void>;
  teams: TeamBase[];
  themeToggle: (placement: string) => JSX.Element;
  totalGamesCount: number;
  updateApp: (() => Promise<void>) | null;
};

/**
 * The page's header, above both halves of the app: the title row, with the cloud button and the
 * theme toggle beside the title on a phone; the switch between League Standings and Team Rankings;
 * on League Standings, the season picker and share link; on either half, the update button while
 * a new version waits; and on the Dashboard, the season's numbers (its leader, games final, the
 * Gold cut line). The League tab row below it is App's.
 *
 * App.tsx drew this inline. It moved here whole and is drawn where it was, with what it reads of
 * App handed in by the names App gives them.
 */
export function LeagueHeader({
  activeSeasonId,
  activeView,
  appMode,
  cloud,
  cloudPanel,
  currentLeader,
  finalCount,
  goldCutoff,
  hasCutLine,
  hasPostseason,
  seasonGroups,
  seasons,
  setAppMode,
  shareSeason,
  teams,
  themeToggle,
  totalGamesCount,
  updateApp,
}: LeagueHeaderProps) {
  const narrow = useNarrowViewport();
  return (
    <>
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 pt-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-sm font-black text-white dark:bg-white dark:text-slate-950">
                LF
              </div>
              {/*
               * A size smaller on a phone, where the title row also holds the cloud button and the
               * theme toggle: at its full size on a 360px screen the title took a second line once
               * the cloud button joined the row, 28px more of the first screen.
               */}
              <h1 className="text-xl font-black tracking-[-0.04em] text-slate-950 sm:text-2xl dark:text-white">
                League Forecast
              </h1>
              {/*
               * Below `lg` the theme toggle sits in the title row, the logo's size. At the end of
               * the controls it fell to a row of its own on a phone whenever the season's name was
               * long, and on Team Rankings always: 54px of the first screen for one button.
               */}
              <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
                <CloudButton
                  status={cloud}
                  onOpen={cloudPanel.show}
                  className="inline-flex h-10 w-10 shrink-0"
                />
                {themeToggle("inline-flex h-10 w-10 shrink-0")}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div
                role="tablist"
                aria-label="App mode"
                className="flex w-full items-center gap-1 rounded-lg bg-slate-100 p-1 sm:inline-flex sm:w-auto dark:bg-slate-900"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={appMode === "league"}
                  onClick={() => setAppMode("league")}
                  className={tab(appMode === "league", "fill")}
                >
                  League Standings
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={appMode === "rankings"}
                  onClick={() => setAppMode("rankings")}
                  className={tab(appMode === "rankings", "fill")}
                >
                  Team Rankings
                </button>
              </div>
              {appMode === "league" && (
                <>
                  <label className="sr-only" htmlFor="season-switcher">
                    Active season
                  </label>
                  <select
                    id="season-switcher"
                    value={activeSeasonId}
                    onChange={(event) => seasons.switchTo(event.target.value)}
                    className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                    aria-label="Active season"
                    title="Switch season"
                  >
                    {seasonGroups.inUse.map((season) => (
                      <option key={season.id} value={season.id}>
                        {season.name}
                      </option>
                    ))}
                    {seasonGroups.archived.length > 0 && (
                      <optgroup label="Archived">
                        {seasonGroups.archived.map((season) => (
                          <option key={season.id} value={season.id}>
                            {season.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {teams.length > 0 && (
                    <button
                      type="button"
                      onClick={shareSeason}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      aria-label="Copy share URL for this season"
                    >
                      Share
                    </button>
                  )}
                </>
              )}
              {updateApp && (
                <button
                  type="button"
                  onClick={() => {
                    void updateApp();
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-blue-300 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 shadow-xs hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200 dark:hover:bg-blue-900/60"
                >
                  Reload update
                </button>
              )}
              <CloudButton
                status={cloud}
                onOpen={cloudPanel.show}
                className="hidden h-11 w-11 lg:inline-flex"
              />
              {themeToggle("hidden p-3 lg:inline-flex")}
            </div>
          </div>

          {/*
           * The season at a glance belongs on the Dashboard. Above every other view it repeated
           * what that view already says (Standings opens on the leader and the cut line), and on
           * a phone it took most of the first screen before the view began.
           */}
          {appMode === "league" && activeView === "dashboard" && (
            <div
              // Three cards in a row, or on a phone one card of three lines (`HeaderStatCard`). The
              // phone's shape is drawn for a phone rather than styled out of the row's, which took
              // a dozen classes used nowhere else, 210 bytes of the stylesheet as it is sent.
              className={`${
                narrow
                  ? "mb-4 divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950"
                  : "grid grid-cols-2 gap-3 pb-4 sm:grid-cols-3"
              } ${teams.length === 0 ? "hidden" : ""}`}
              aria-label="League pulse summary"
            >
              <HeaderStatCard
                label="Games analyzed"
                value={`${finalCount}/${totalGamesCount}`}
                accent="from-emerald-400 via-cyan-400 to-blue-500"
                line={narrow}
              />
              <HeaderStatCard
                label="Current leader"
                value={currentLeader ? currentLeader.name : "—"}
                accent="from-blue-500 via-indigo-500 to-slate-900"
                line={narrow}
              />
              {hasPostseason && (
                <HeaderStatCard
                  label={hasCutLine ? "Gold cutoff" : "Postseason"}
                  value={hasCutLine ? `Top ${goldCutoff}` : "All teams"}
                  accent="from-amber-400 via-orange-500 to-red-500"
                  line={narrow}
                />
              )}
            </div>
          )}
        </div>
      </header>
    </>
  );
}
