import { useId, useState } from "react";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { UNKNOWN_STATE } from "../../lib/teamRankings";
import { RankingMethodButton, RankingMethodPanel } from "../RankingMethodPanel";
import { RankingList, formatRating } from "./RankingList";
import { TeamSearchSelect, type TeamSearchOption } from "../TeamSearchSelect";
import { card, pill } from "../../styles/tokens";

/** How many teams a page leads with, nationally and within one state. */
export const NATIONAL_TOP = 25;
export const STATE_TOP = 10;

type RankingsSectionProps = {
  groupName: string;
  /**
   * Every team in the pool, wherever it is filed, for the search box at the top.
   *
   * Not the page's own rows: the point of searching is to find a club without already knowing
   * which season and level it is on, which is the one thing the age tabs cannot help with.
   */
  searchOptions: TeamSearchOption[];
  /** Goes to the page that team is on and opens it. */
  onSearchTeam: (teamId: string) => void;
  hasAgeGroups: boolean;
  /** Why this page has no table at all, when the reason is the age level rather than the data. */
  unrankedLevelNote: string | null;
  /**
   * Which half of the season these boards are, for the headings, and what to say when it is empty.
   *
   * A half nobody has played yet is an empty board with a perfectly good reason, and "add a game to
   * start ranking teams" is the wrong reason: the games exist, they are in the other half.
   */
  segment: { name: string; played: number; otherName: string; otherPlayed: number } | null;
  rankings: ScoutRankingRow[];
  rankingsStale: boolean;
  nationalTop: ScoutRankingRow[];
  stateTopRows: ScoutRankingRow[];
  visibleRankings: ScoutRankingRow[];
  availableStates: string[];
  shownState: string;
  onShownStateChange: (state: string) => void;
  unknownStateCount: number;
  stateFilter: string;
  onStateFilterChange: (state: string) => void;
  showAll: boolean;
  onToggleShowAll: () => void;
  /** "Prosper, TX" for a pulled club; nothing for a stand-in. */
  placeOf: (teamId: string) => string | undefined;
  isLeagueTeam: (teamId: string) => boolean;
  hasGamesFiledHere: (teamId: string) => boolean;
  onOpenTeam: (teamId: string) => void;
  onMarkMine: (teamId: string) => void;
  onRemoveTeam: (teamId: string) => void;
};

/**
 * What the page is for: the two lists worth reading at a glance, and the full table underneath for
 * finding one team in a pool of thousands.
 */
/**
 * How many rows the full table shows before asking. The page's real count is in the toggle above
 * it - "Show all 15,629 teams" - and that number is the point; the rows are here to find a team
 * in, not to scroll. Rendering all of them was O(rows) DOM plus two O(rows) `placeOf` lookups and
 * an O(games) `hasGamesFiledHere` per row on every render, which on a nationwide page is minutes.
 */
export const ROWS_SHOWN_FIRST = 100;
export const ROWS_SHOWN_STEP = 200;

export function RankingsSection({
  groupName,
  searchOptions,
  onSearchTeam,
  hasAgeGroups,
  unrankedLevelNote,
  segment,
  rankings,
  rankingsStale,
  nationalTop,
  stateTopRows,
  visibleRankings,
  availableStates,
  shownState,
  onShownStateChange,
  unknownStateCount,
  stateFilter,
  onStateFilterChange,
  showAll,
  onToggleShowAll,
  placeOf,
  isLeagueTeam,
  hasGamesFiledHere,
  onOpenTeam,
  onMarkMine,
  onRemoveTeam,
}: RankingsSectionProps) {
  // Keyed on the filter, so choosing another state starts at the top again without an effect.
  const [rowLimit, setRowLimit] = useState({ key: stateFilter, count: ROWS_SHOWN_FIRST });
  const shownRows = rowLimit.key === stateFilter ? rowLimit.count : ROWS_SHOWN_FIRST;
  const visibleSlice = visibleRankings.slice(0, shownRows);
  const hiddenRows = visibleRankings.length - visibleSlice.length;

  /**
   * The method explainer and its button are one disclosure with nothing outside this section to
   * say about it, so it keeps its own state rather than borrowing the view's.
   */
  const [methodOpen, setMethodOpen] = useState(false);
  const methodPanelId = useId();

  return (
    <>
      {/*
        Above the boards rather than inside them, because it is not a filter on this page — it
        crosses seasons and age levels. "Canes Triad Black" is on exactly one page, and finding it
        used to mean knowing which season and which level before you could start looking.
      */}
      {searchOptions.length > 0 && (
        <div className={`${card} p-4`}>
          <label
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="scout-team-search"
          >
            Find a team
          </label>
          <div className="mt-2 flex">
            <TeamSearchSelect
              id="scout-team-search"
              value=""
              onChange={onSearchTeam}
              options={searchOptions}
              placeholder="Search every team, any age or season"
            />
          </div>
        </div>
      )}

      {rankings.length === 0 ? (
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
            {groupName ? `${groupName}${segment ? ` · ${segment.name}` : ""}` : "Rankings"}
          </h2>
          <p className="mt-3 text-sm text-slate-500">
            {unrankedLevelNote
              ? unrankedLevelNote
              : !hasAgeGroups
                ? "Set up an age group in Setup, then add a game to start ranking teams."
                : segment && segment.played === 0 && segment.otherPlayed > 0
                  ? `Nothing has been played in ${segment.name} yet. ${segment.otherName} has ${segment.otherPlayed.toLocaleString()} game${segment.otherPlayed === 1 ? "" : "s"} — the two halves are ranked separately, so this board fills up when the season reaches it.`
                  : "Add a game in Games to start ranking teams for this age group."}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={`${card} p-5`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
                  National top {NATIONAL_TOP}
                  {segment ? ` · ${segment.name}` : ""}
                </h2>
                <span className="text-xs text-slate-500">
                  {rankingsStale ? "Refitting…" : `of ${rankings.length} ranked`}
                </span>
              </div>
              <RankingList rows={nationalTop} onOpen={onOpenTeam} placeOf={placeOf} />
            </div>

            <div className={`${card} p-5`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
                  State top {STATE_TOP}
                </h2>
                {availableStates.length > 0 && (
                  <select
                    aria-label="State"
                    value={shownState}
                    onChange={(event) => onShownStateChange(event.target.value)}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
                  >
                    {availableStates.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {stateTopRows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">
                  {availableStates.length === 0
                    ? "No team here has a state yet. Add one from a team's panel, or pull from GameChanger, which brings the state with it."
                    : `No ranked teams in ${shownState} yet.`}
                </p>
              ) : (
                <RankingList rows={stateTopRows} onOpen={onOpenTeam} placeOf={placeOf} />
              )}
            </div>
          </div>
        </>
      )}

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
            Full rankings
            <RankingMethodButton
              open={methodOpen}
              onToggle={() => setMethodOpen((value) => !value)}
              panelId={methodPanelId}
            />
          </h2>
          {/*
            Collapsed by default now that the page leads with the two lists worth reading. A
            nationwide pool is thousands of rows; they are here to find a team in, not to scroll.
          */}
          <button
            type="button"
            onClick={onToggleShowAll}
            aria-expanded={showAll}
            className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
          >
            {showAll ? "Hide the full table" : `Show all ${rankings.length} teams`}
          </button>
          {showAll && (availableStates.length > 0 || unknownStateCount > 0) && (
            <span className="flex items-center gap-2">
              <label
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                htmlFor="scout-state-filter"
              >
                State
              </label>
              <select
                id="scout-state-filter"
                value={stateFilter}
                onChange={(event) => onStateFilterChange(event.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">All states</option>
                {availableStates.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
                {unknownStateCount > 0 && (
                  <option value={UNKNOWN_STATE}>No state set ({unknownStateCount})</option>
                )}
              </select>
            </span>
          )}
        </div>
        {methodOpen && (
          <RankingMethodPanel id={methodPanelId} onClose={() => setMethodOpen(false)} />
        )}
        {showAll && stateFilter && (
          <p className="mt-2 text-xs text-slate-500">
            {rankingsStale ? "Refitting the ratings… " : ""}Showing {visibleRankings.length} of{" "}
            {rankings.length} teams. Ratings still come from every game — filtering changes who is
            listed, not how anyone is rated, so the <strong>#</strong> here is the position within
            this list and the grey number is the place in the full table.
          </p>
        )}
        {showAll && (
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2">Rank</th>
                  <th>Team</th>
                  <th>Record</th>
                  <th>Rating</th>
                  {/* The fit's own estimate, so the discount in the column before it is visible
                      rather than asserted: "+7.3 off four games, ranked at +6.5". */}
                  <th className="whitespace-nowrap">Best guess</th>
                  <th>Games</th>
                  <th>SOS</th>
                  <th className="sr-only">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleSlice.map((row) => {
                  const place = placeOf(row.teamId);
                  return (
                    <tr
                      key={row.teamId}
                      className="border-t border-slate-100 dark:border-slate-800"
                    >
                      <td className="py-3 font-black">
                        #{row.rank}
                        {row.overallRank !== undefined && row.overallRank !== row.rank && (
                          <span className="ml-1 text-xs font-bold text-slate-400">
                            #{row.overallRank}
                          </span>
                        )}
                      </td>
                      <td className="font-bold text-slate-950 dark:text-white">
                        <button
                          type="button"
                          onClick={() => onOpenTeam(row.teamId)}
                          className="text-left font-bold hover:underline"
                          title="Every game logged for this team"
                        >
                          {row.teamName}
                        </button>
                        {isLeagueTeam(row.teamId) && (
                          <span className={`ml-2 ${pill("blue")}`}>League</span>
                        )}
                        {place && (
                          <span className="block text-xs font-normal text-slate-500">{place}</span>
                        )}
                      </td>
                      <td>{row.record}</td>
                      <td>{formatRating(row.rating)}</td>
                      <td className="text-slate-500">{formatRating(row.pointRating)}</td>
                      <td>{row.games}</td>
                      <td>{row.sosRank ? `#${row.sosRank}` : "—"}</td>
                      <td className="space-x-2 text-right">
                        <button
                          type="button"
                          onClick={() => onMarkMine(row.teamId)}
                          className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                          aria-pressed={row.isMine}
                          title="Mark as my team"
                        >
                          {row.isMine ? "★ My team" : "☆ Mark mine"}
                        </button>
                        {!isLeagueTeam(row.teamId) && hasGamesFiledHere(row.teamId) && (
                          <button
                            type="button"
                            onClick={() => onRemoveTeam(row.teamId)}
                            className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hiddenRows > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>
                  Showing {visibleSlice.length} of {visibleRankings.length}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setRowLimit({ key: stateFilter, count: shownRows + ROWS_SHOWN_STEP })
                  }
                  className="font-bold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Show {Math.min(ROWS_SHOWN_STEP, hiddenRows)} more
                </button>
              </div>
            )}
            {rankings.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-500">
                {unrankedLevelNote ?? "No teams yet for this age group."}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Ratings only become meaningful once teams&apos; schedules connect, directly or through
          common opponents — a team with no shared opponents will show a plain, less certain rating.
          This model always uses a flat run-margin cap, independent of any one season&apos;s own
          settings.
        </p>
      </div>
    </>
  );
}
