import { useId, useMemo, useState } from "react";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { UNKNOWN_STATE } from "../../lib/teamRankings";
import type { WeekMovers } from "../../lib/thisWeek";
import type { TeamWeek, Weekly } from "../../lib/theWeekly";
import type { ExpectedRecord } from "../../lib/clubForm";
import { ThisWeekCard } from "./ThisWeekCard";
import { RankingMethodButton, RankingMethodPanel } from "../RankingMethodPanel";
import { RankingList, formatRating } from "./RankingList";
import { TeamSearchSelect, type GcIdOffer, type TeamSearchOption } from "../TeamSearchSelect";
import { useWideViewport } from "../../hooks/useWideViewport";
import type { MyTeamGlance } from "../../lib/myTeamGlance";
import type { Movement } from "../../lib/rankMovement";
import { MyTeamCard } from "./MyTeamCard";
import { WatchCard } from "./WatchCard";
import type { Watched } from "../../lib/watchList";
import type { RankHistoryPoint } from "../../hooks/useRankingsWorker";
import { card, focusRing, pill, textRole } from "../../styles/tokens";

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
  /** Where a pasted GameChanger id is when no club here carries it (`whereIsGcId`). */
  explainGcId?: (gcTeamId: string) => string | undefined;
  /** What can be done about such an id: a club thrown out brought back. */
  offerForGcId?: (gcTeamId: string) => GcIdOffer | undefined;
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
  /**
   * Whether the rows are the board to compare with the last visit (`MyTeamSince`), where that is
   * not simply that they are not being refitted: the live board's, once the network has vouched
   * for the board drawn, not the one this account kept and drew first. The Refitting labels still
   * read `rankingsStale`.
   */
  myTeamSettled?: boolean;
  nationalTop: ScoutRankingRow[];
  stateTopRows: ScoutRankingRow[];
  visibleRankings: ScoutRankingRow[];
  availableStates: string[];
  shownState: string;
  onShownStateChange: (state: string) => void;
  /** The state this device opens the card on where the page has a club there (`useStateTop`). */
  keptState: string | null;
  /** Keeps a state as that default, or forgets it for `null`. */
  onKeepState: (state: string | null) => void;
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
  /** The team marked as yours on this page, where it stands and what it plays next. */
  myTeam?: MyTeamGlance | null;
  /** The board's week (`weekMovers`), drawn under the page's own club. */
  thisWeek?: WeekMovers | null;
  /** The page's week from its games (`theWeekly`), drawn in the same card. */
  weekly?: Weekly | null;
  /** The page's own club's week just played (`teamWeek`). */
  myWeek?: TeamWeek | null;
  /** The page's own club's record beside the one its ratings expected (`recordVsExpected`). */
  myExpected?: ExpectedRecord;
  /** The marked club's place week by week, oldest first, ending a week ago (`useRankingsWorker`). */
  rankHistory?: RankHistoryPoint[];
  /** How far a row has moved on this page since last week (`movementOf`). */
  movementOf?: (row: ScoutRankingRow) => Movement | undefined;
  /**
   * What the rows are, in place of "Refitting…", while they stand in for this page's own fit: the
   * live board's label (`liveLabel`).
   */
  standInNote?: string;
  /** Rows to read, not change: the live board while its edits are off (`editLock`). */
  readOnly?: boolean;
  /**
   * Draws the Find a team card before the list it searches is in hand, at its real size, and is
   * called when somebody goes to search, so the page can bring the list in.
   */
  onSearchWanted?: () => void;
  /** The list a search asked for is on its way: the card says so until it is in. */
  searchLoading?: boolean;
  /** The list a search asked for could not be read: the card says so, and asking reads it again. */
  searchFailed?: boolean;
  /** Whether the marked club's next game is still to come in (`MyTeamCard`). */
  myTeamNextPending?: boolean;
  /** Whether the marked club's next game could not be read (`MyTeamCard`). */
  myTeamNextUnread?: boolean;
  /** Scouting's Compare with on our next game's opponent (`MyTeamCard`). */
  onScoutNext?: (opponentId: string) => void;
  /** The clubs watched on this page, for the card at the top of its board (`WatchCard`). */
  watch?: {
    watched: readonly Watched[];
    rowOf: (teamId: string) => ScoutRankingRow | undefined;
    onStop: (club: Watched) => void;
  };
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

/** What the Find a team card says of a list it could not read, which asking again reads again. */
export const SEARCH_UNREAD =
  "The cloud's list of teams could not be read just now. Search again to try once more.";
export const ROWS_SHOWN_STEP = 200;

export function RankingsSection({
  groupName,
  searchOptions,
  onSearchTeam,
  explainGcId,
  offerForGcId,
  hasAgeGroups,
  unrankedLevelNote,
  segment,
  rankings,
  rankingsStale,
  myTeamSettled = !rankingsStale,
  nationalTop,
  stateTopRows,
  visibleRankings,
  availableStates,
  shownState,
  onShownStateChange,
  keptState,
  onKeepState,
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
  myTeam,
  thisWeek,
  weekly = null,
  myWeek = null,
  myExpected,
  rankHistory,
  movementOf,
  standInNote,
  readOnly = false,
  onSearchWanted,
  searchLoading = false,
  searchFailed = false,
  myTeamNextPending = false,
  myTeamNextUnread = false,
  watch,
  onScoutNext,
}: RankingsSectionProps) {
  // The page's rows by club, for the names and places The Weekly names.
  const rowOf = useMemo(() => {
    const byId = new Map(rankings.map((row) => [row.teamId, row]));
    return (teamId: string) => byId.get(teamId);
  }, [rankings]);
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
  const wide = useWideViewport();
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
            className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
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
              {...(explainGcId ? { explainGcId } : {})}
              {...(offerForGcId ? { offerForGcId } : {})}
              placeholder="Search every team or coach, any age or season"
            />
          </div>
        </div>
      )}
      {searchOptions.length === 0 && onSearchWanted && (
        <div className={`${card} p-4`}>
          <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Find a team
          </span>
          <button
            type="button"
            onClick={onSearchWanted}
            disabled={searchLoading}
            aria-busy={searchLoading}
            className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500"
          >
            {searchLoading
              ? "Bringing in every team…"
              : "Search every team or coach, any age or season"}
          </button>
          {searchFailed && (
            <p
              className="mt-2 text-xs text-slate-500 dark:text-slate-400"
              role="status"
              aria-live="polite"
            >
              {SEARCH_UNREAD}
            </p>
          )}
        </div>
      )}

      {rankings.length === 0 ? (
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {groupName ? `${groupName}${segment ? ` · ${segment.name}` : ""}` : "Rankings"}
          </h2>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {unrankedLevelNote
              ? unrankedLevelNote
              : !hasAgeGroups
                ? "Set up an age group in Setup, then add a game to start ranking teams."
                : // The first fit of a large pool takes seconds, and the board is empty until it
                  // comes back: it is not a page with no games.
                  rankingsStale
                  ? "Ranking the teams…"
                  : segment && segment.played === 0 && segment.otherPlayed > 0
                    ? `Nothing has been played in ${segment.name} yet. ${segment.otherName} has ${segment.otherPlayed.toLocaleString()} game${segment.otherPlayed === 1 ? "" : "s"} — the two halves are ranked separately, so this board fills up when the season reaches it.`
                    : "Add a game in Games to start ranking teams for this age group."}
          </p>
        </div>
      ) : (
        <>
          {watch && <WatchCard {...watch} onOpenTeam={onOpenTeam} />}
          {myTeam && (
            <MyTeamCard
              glance={myTeam}
              {...(rankHistory ? { history: rankHistory } : {})}
              {...(segment ? { segmentName: segment.name } : {})}
              onOpenTeam={onOpenTeam}
              nextPending={myTeamNextPending}
              nextUnread={myTeamNextUnread}
              {...(onScoutNext ? { onScout: onScoutNext } : {})}
              {...(myExpected ? { expected: myExpected } : {})}
              settled={myTeamSettled}
            />
          )}
          <ThisWeekCard
            movers={thisWeek ?? null}
            weekly={weekly}
            myWeek={myWeek}
            {...(myTeam ? { myTeamId: myTeam.teamId } : {})}
            rowOf={rowOf}
            onOpenTeam={onOpenTeam}
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className={`${card} p-5`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  National top {NATIONAL_TOP}
                  {segment ? ` · ${segment.name}` : ""}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {standInNote ?? (rankingsStale ? "Refitting…" : `of ${rankings.length} ranked`)}
                </span>
              </div>
              <RankingList
                rows={nationalTop}
                onOpen={onOpenTeam}
                placeOf={placeOf}
                {...(movementOf ? { movementOf } : {})}
              />
            </div>

            <div className={`${card} p-5`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  State top {STATE_TOP}
                </h2>
                {availableStates.length > 0 && (
                  <span className="flex flex-wrap items-center gap-2">
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
                    {/*
                      Offered only for a state with clubs on this page, the only kind the card can
                      open on. One button whether or not the state shown is the default, so the
                      keyboard's focus stays on it as its words change instead of going with it.
                    */}
                    {availableStates.includes(shownState) && (
                      <span className={`flex items-center gap-2 ${textRole.meta}`}>
                        {shownState === keptState && <span>Opens on {shownState}</span>}
                        <button
                          type="button"
                          onClick={() => onKeepState(shownState === keptState ? null : shownState)}
                          aria-label={
                            shownState === keptState
                              ? `Clear ${shownState} as the default state`
                              : `Make ${shownState} my default state`
                          }
                          className={`rounded-sm font-bold text-blue-600 hover:underline dark:text-blue-400 ${focusRing}`}
                        >
                          {shownState === keptState ? "Clear" : `Make ${shownState} my default`}
                        </button>
                      </span>
                    )}
                  </span>
                )}
              </div>
              {stateTopRows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
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
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
                className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400"
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
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {rankingsStale ? "Refitting the ratings… " : ""}Showing {visibleRankings.length} of{" "}
            {rankings.length} teams. Ratings still come from every game — filtering changes who is
            listed, not how anyone is rated, so the <strong>#</strong> here is the position within
            this list and the grey number is the place in the full table.
          </p>
        )}
        {showAll && (
          <div className="mt-3 overflow-x-auto">
            {/*
             * Eight columns is four too many for a phone, and this is the table a phone is most
             * likely to be holding: the nationwide pool, read at a field, on the half of the app
             * that carries fifty thousand teams. Sideways scrolling inside a card is the gesture
             * nobody finds, so below `sm` the same rows are stacked — rank, team and rating on one
             * line because that is the reading, the rest labelled underneath, and the actions last.
             *
             * One of the two, chosen by reading the breakpoint, rather than both with CSS hiding
             * one. This list is bounded to a first page precisely because rendering a nationwide
             * page was more memory than the pool behind it; rendering every visible row twice puts
             * half of that straight back, and it was enough to push `ListBounds` past its timeout
             * on a slower machine.
             *
             * One source, two shapes. A column added to the table has to be added here too, which
             * is the point: a column nobody can see on a phone is a column nobody has decided
             * about.
             */}
            {wide ? null : (
              <ul className="space-y-2">
                {visibleSlice.map((row) => {
                  const place = placeOf(row.teamId);
                  return (
                    <li
                      key={row.teamId}
                      className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        {/*
                         * Wrapped, never truncated. The name is a button, and to an ellipsis a
                         * button is one box that fits whole or goes whole: a long name with the
                         * League tag after it did not fit a phone's line, and the card read
                         * "#84 #3874 …" with nothing to say which club it was. A second line is
                         * the smaller cost.
                         */}
                        <span className="min-w-0 text-sm font-black wrap-break-word">
                          #{row.rank}
                          {row.overallRank !== undefined && row.overallRank !== row.rank && (
                            <span className="ml-1 text-xs font-bold text-slate-400">
                              #{row.overallRank}
                            </span>
                          )}{" "}
                          <button
                            type="button"
                            onClick={() => onOpenTeam(row.teamId)}
                            className="text-left font-black hover:underline"
                            title="Every game logged for this team"
                          >
                            {row.teamName}
                          </button>
                          {isLeagueTeam(row.teamId) && (
                            <span className={`ml-2 ${pill("blue")}`}>League</span>
                          )}
                        </span>
                        <span className="shrink-0 text-sm font-black">
                          {formatRating(row.rating)}
                        </span>
                      </div>
                      {place && (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{place}</p>
                      )}
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-slate-400">Record</dt>
                          <dd>{row.record}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-slate-400">Games</dt>
                          <dd>{row.games}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500 dark:text-slate-400">SOS</dt>
                          <dd>{row.sosRank ? `#${row.sosRank}` : "—"}</dd>
                        </div>
                      </dl>
                      <div className="mt-2 space-x-3 text-right">
                        {/* Rows to read while the live board's edits are off: nothing to mark. */}
                        {readOnly ? (
                          row.isMine && (
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                              ★ My team
                            </span>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => onMarkMine(row.teamId)}
                            className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                            aria-pressed={row.isMine}
                            title="Mark as my team"
                          >
                            {row.isMine ? "★ My team" : "☆ Mark mine"}
                          </button>
                        )}
                        {!isLeagueTeam(row.teamId) && hasGamesFiledHere(row.teamId) && (
                          <button
                            type="button"
                            onClick={() => onRemoveTeam(row.teamId)}
                            className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {wide && (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    <th className="py-2">Rank</th>
                    <th>Team</th>
                    <th>Record</th>
                    <th>Rating</th>
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
                            <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                              {place}
                            </span>
                          )}
                        </td>
                        <td>{row.record}</td>
                        <td>{formatRating(row.rating)}</td>
                        <td>{row.games}</td>
                        <td>{row.sosRank ? `#${row.sosRank}` : "—"}</td>
                        <td className="space-x-2 text-right">
                          {/* Rows to read while the live board's edits are off: nothing to mark. */}
                          {readOnly ? (
                            row.isMine && (
                              <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                                ★ My team
                              </span>
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => onMarkMine(row.teamId)}
                              className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                              aria-pressed={row.isMine}
                              title="Mark as my team"
                            >
                              {row.isMine ? "★ My team" : "☆ Mark mine"}
                            </button>
                          )}
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
            )}
            {hiddenRows > 0 && (
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
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
              <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {unrankedLevelNote ?? "No teams yet for this age group."}
              </p>
            )}
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Ratings only become meaningful once teams&apos; schedules connect, directly or through
          common opponents — a team with no shared opponents will show a plain, less certain rating.
          This model always uses a flat run-margin cap, independent of any one season&apos;s own
          settings.
        </p>
      </div>
    </>
  );
}
