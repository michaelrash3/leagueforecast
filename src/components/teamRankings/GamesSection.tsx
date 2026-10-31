import { useMemo, useState } from "react";
import type { ScoutGame, ScoutRankingRow, ScoutTeam } from "../../lib/teamRankings";
import { isScoutGamePlayed } from "../../lib/teamRankings";
import { formatIsoDayShort } from "../../lib/date";
import { windowGames, type GamesWindow } from "../../lib/teamRankings/gamesWindow";
import { isUpset, UPSET_CHANCE } from "../../lib/theWeekly";
import type { ToastTone } from "../../hooks/useToast";
import { ScheduleImportPanel, type NamedChecker } from "../ScheduleImportPanel";
import type { NamedGame } from "../../lib/teamRankings/namedGames";
import { TeamNameCombobox } from "../TeamNameCombobox";
import { TeamSearchSelect } from "../TeamSearchSelect";
import { WhatIf, WhatIfButton } from "./WhatIf";
import { button, card, pill } from "../../styles/tokens";
import type { AddGameDraft } from "./addGameDraft";

export { EMPTY_ADD_GAME_DRAFT, type AddGameDraft } from "./addGameDraft";

type GamesSectionProps = {
  groupName: string;
  ageGroupId: string;
  hasAgeGroups: boolean;
  draft: AddGameDraft;
  onDraftChange: (patch: Partial<AddGameDraft>) => void;
  teamNameOptions: string[];
  myTeamName: string;
  addGameValid: boolean;
  onAddGame: () => void;
  /** Takes the reader to the GameChanger pull, which is a section of its own. */
  onGoToImport: () => void;
  importOpen: boolean;
  onOpenImport: () => void;
  onCloseImport: () => void;
  suggestedTeams: ScoutTeam[];
  /** How a pasted schedule's rows are checked: here, or by the server (`ScheduleImportPanel`). */
  checker: NamedChecker;
  /** A pasted schedule's rows to add, by their clubs' names; a promise where the server adds them. */
  onImportGames: (games: NamedGame[]) => void | Promise<boolean>;
  /** The most rows a pasted schedule may have, where whoever adds them takes no more at once. */
  importRowsMax?: number;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
  /**
   * The page's stored games, pulled, pasted or typed in, newest first. League Standings fixtures
   * are not among them.
   */
  loggedGames: ScoutGame[];
  /** The days listed before the reader asks for every game (`gamesWindow.ts`). */
  gamesWindow: GamesWindow;
  /** Games listed whatever their date: the ones just added here. */
  keep: ReadonlySet<string>;
  teamNameById: Map<string, string>;
  editingGameId: string | null;
  editScoreA: string;
  editScoreB: string;
  onEditScoreA: (value: string) => void;
  onEditScoreB: (value: string) => void;
  onStartEditScore: (gameId: string) => void;
  onSaveScore: (gameId: string) => void;
  onToggleExcluded: (game: ScoutGame) => void;
  onRemoveGame: (game: ScoutGame) => void;
  /**
   * A club's row on the page's board, for a game's What if, worked out from the ratings shown
   * (`WhatIf`). Absent, or a club the board has no row for, and the game has none.
   */
  ratingRowOf?: (teamId: string) => ScoutRankingRow | undefined;
};

/** Everything that puts a result into the pool by hand: the form, the paste/CSV import, the log. */
/**
 * How many logged games the list shows before asking. A nationwide page can hold tens of thousands
 * of pulled games, and rendering every one as DOM cost more than the pool itself: each row is a
 * dozen elements, so a 60,000-game page was over half a million nodes for a list nobody scrolls
 * to the end of. The first hundred is what anyone actually looks at; the rest is a click away.
 */
export const GAMES_SHOWN_FIRST = 100;
export const GAMES_SHOWN_STEP = 200;

/** "1 game", "7 games". */
const gamesCount = (count: number) => `${count.toLocaleString()} ${count === 1 ? "game" : "games"}`;

export function GamesSection({
  groupName,
  ageGroupId,
  hasAgeGroups,
  draft,
  onDraftChange,
  teamNameOptions,
  myTeamName,
  addGameValid,
  onAddGame,
  onGoToImport,
  importOpen,
  onOpenImport,
  onCloseImport,
  suggestedTeams,
  checker,
  importRowsMax,
  onImportGames,
  showToast,
  loggedGames,
  gamesWindow,
  keep,
  teamNameById,
  editingGameId,
  editScoreA,
  editScoreB,
  onEditScoreA,
  onEditScoreB,
  onStartEditScore,
  onSaveScore,
  onToggleExcluded,
  onRemoveGame,
  ratingRowOf,
}: GamesSectionProps) {
  /*
   * Whether every game is listed rather than the one day's. Keyed on the page
   * rather than reset in an effect, as the list limit is: another age group opens on its window
   * again by itself.
   */
  const [allFor, setAllFor] = useState<string | null>(null);
  const showingAll = allFor === ageGroupId;
  const windowed = useMemo(
    () => windowGames(loggedGames, gamesWindow, keep),
    [loggedGames, gamesWindow, keep]
  );
  /*
   * One club's games, every one of them on the page whatever their day, picked by name: a page of
   * thousands of games listed a day at a time, and a club's season was a scroll through all of them.
   * Kept per page, as every game listed is.
   */
  const [clubFor, setClubFor] = useState<{ page: string; id: string } | null>(null);
  const club = clubFor !== null && clubFor.page === ageGroupId ? clubFor.id : null;
  const clubOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const game of loggedGames) {
      ids.add(game.teamAId);
      ids.add(game.teamBId);
    }
    return [...ids].map((id) => ({ id, label: teamNameById.get(id) ?? "?" }));
  }, [loggedGames, teamNameById]);
  const clubGames = useMemo(
    () =>
      club === null
        ? null
        : loggedGames.filter((game) => game.teamAId === club || game.teamBId === club),
    [club, loggedGames]
  );
  /*
   * The page's upsets: results its ratings called the other way (`isUpset`), every one of them
   * whatever its day, the chosen club's alone when one is chosen. Kept per page, as a club is.
   */
  const [upsetsFor, setUpsetsFor] = useState<string | null>(null);
  const upsetsOnly = upsetsFor === ageGroupId && ratingRowOf !== undefined;
  const upsetGames = useMemo(
    () =>
      upsetsOnly && ratingRowOf
        ? (clubGames ?? loggedGames).filter((game) => isUpset(game, ratingRowOf))
        : null,
    [upsetsOnly, ratingRowOf, clubGames, loggedGames]
  );
  const listed = upsetGames ?? clubGames ?? (showingAll ? loggedGames : windowed.shown);
  // The game whose What if is open.
  const [whatIf, setWhatIf] = useState<string | null>(null);
  const day = formatIsoDayShort(gamesWindow.day);
  const windowLine =
    gamesWindow.basis === "today"
      ? `Today's games (${day})`
      : gamesWindow.basis === "season-end"
        ? `This season's last day of games (${day})`
        : `This season's first day of games (${day})`;
  const hiddenParts = [
    windowed.undated > 0 ? `${windowed.undated.toLocaleString()} undated` : "",
    windowed.needingScore > 0 ? `${windowed.needingScore.toLocaleString()} still need a score` : "",
  ].filter(Boolean);

  /*
   * Keyed on the page and the list rather than reset in an effect: a different age group, or the
   * switch between the day and every game, starts at the top again by itself, and nothing has to
   * fire after render to make it so.
   */
  const listKey = `${ageGroupId}|${club ?? (showingAll ? "all" : "window")}|${upsetsOnly ? "upsets" : ""}`;
  const [listLimit, setListLimit] = useState({ key: listKey, count: GAMES_SHOWN_FIRST });
  const shown = listLimit.key === listKey ? listLimit.count : GAMES_SHOWN_FIRST;
  const shownGames = listed.slice(0, shown);
  const hiddenGames = listed.length - shownGames.length;

  return (
    <>
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Add a game
          </h2>
          {ageGroupId && !importOpen && (
            <button
              type="button"
              onClick={onOpenImport}
              className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
            >
              Import games
            </button>
          )}
          <button
            type="button"
            onClick={onGoToImport}
            className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
          >
            Pull from GameChanger
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {!hasAgeGroups
            ? "Pulling from GameChanger creates the pages it needs. To log a game by hand instead, set up an age group in Setup first — every game needs one to know which ranking it belongs to."
            : "Leave both scores blank to log an upcoming/scheduled game (useful for building out your own team's future schedule) — come back and fill in the score once it's played."}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_90px_1fr_90px]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <TeamNameCombobox
                id="scout-team-a-name"
                value={draft.teamAName}
                onChange={(value) => onDraftChange({ teamAName: value })}
                options={teamNameOptions}
                placeholder="Team name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
              />
            </div>
            {myTeamName && (
              <button
                type="button"
                onClick={() => onDraftChange({ teamAName: myTeamName })}
                className="shrink-0 whitespace-nowrap text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
              >
                Use my team
              </button>
            )}
          </div>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={draft.teamAScore}
            onChange={(event) => onDraftChange({ teamAScore: event.target.value })}
            placeholder="Score"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <TeamNameCombobox
            id="scout-team-b-name"
            value={draft.teamBName}
            onChange={(value) => onDraftChange({ teamBName: value })}
            options={teamNameOptions}
            placeholder="Opponent name"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={draft.teamBScore}
            onChange={(event) => onDraftChange({ teamBScore: event.target.value })}
            placeholder="Score"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="date"
            value={draft.date}
            onChange={(event) => onDraftChange({ date: event.target.value })}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="text"
            value={draft.event}
            onChange={(event) => onDraftChange({ event: event.target.value })}
            placeholder="Tournament / event (optional)"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        <button
          type="button"
          onClick={onAddGame}
          disabled={!addGameValid}
          className={`${button.primary} mt-3`}
        >
          Add Game
        </button>
      </div>

      {importOpen && ageGroupId && (
        <ScheduleImportPanel
          ageGroupName={groupName}
          suggestedTeams={suggestedTeams}
          checker={checker}
          defaultSubjectTeam={myTeamName}
          onImport={onImportGames}
          {...(importRowsMax === undefined ? {} : { rowsMax: importRowsMax })}
          onClose={onCloseImport}
          showToast={showToast}
        />
      )}

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Logged games{groupName ? ` (${groupName})` : ""}
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          The games pulled, pasted or typed in on this page. This age group&apos;s League Standings
          schedule (played and upcoming) counts in the rankings and the scouting report but
          isn&apos;t listed here.
        </p>
        {clubOptions.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <label htmlFor="scout-games-club" className="font-semibold">
              One club&apos;s games
            </label>
            <div className="min-w-[14rem] flex-1">
              <TeamSearchSelect
                id="scout-games-club"
                value={club ?? ""}
                onChange={(id) => setClubFor({ page: ageGroupId, id })}
                options={clubOptions}
                placeholder="Find a club on this page"
              />
            </div>
            {club !== null && (
              <>
                <span>
                  {gamesCount(clubGames?.length ?? 0)} for {teamNameById.get(club) ?? "?"}.
                </span>
                <button type="button" onClick={() => setClubFor(null)} className={button.ghost}>
                  Every club
                </button>
              </>
            )}
          </div>
        )}
        {ratingRowOf && loggedGames.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            {upsetGames ? (
              <>
                <span>
                  {gamesCount(upsetGames.length)}
                  {club === null ? "" : ` for ${teamNameById.get(club) ?? "?"}`}{" "}
                  {upsetGames.length === 1 ? "was an upset" : "were upsets"}: the winner had less
                  than a {Math.round(UPSET_CHANCE * 100)}% chance by the ratings shown.
                </span>
                <button type="button" onClick={() => setUpsetsFor(null)} className={button.ghost}>
                  Every game
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setUpsetsFor(ageGroupId)}
                className={button.ghost}
              >
                Upsets
              </button>
            )}
          </div>
        )}
        {club === null &&
          !upsetsOnly &&
          loggedGames.length > 0 &&
          (showingAll || windowed.hidden > 0) && (
            <div
              className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400"
              data-testid="games-window"
            >
              <span>
                {showingAll
                  ? `All ${gamesCount(loggedGames.length)} on this page.`
                  : `${windowLine}. ${windowed.hidden.toLocaleString()} more ${
                      windowed.hidden === 1 ? "is" : "are"
                    } hidden${hiddenParts.length > 0 ? ` (${hiddenParts.join(", ")})` : ""}.`}
              </span>
              <button
                type="button"
                onClick={() => setAllFor(showingAll ? null : ageGroupId)}
                className={button.ghost}
              >
                {showingAll
                  ? gamesWindow.basis === "today"
                    ? "Show only today's games"
                    : `Show only ${day}`
                  : `Show all ${gamesCount(loggedGames.length)}`}
              </button>
            </div>
          )}
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {shownGames.map((game) => {
            const played = isScoutGamePlayed(game);
            const rowA = ratingRowOf?.(game.teamAId);
            const rowB = ratingRowOf?.(game.teamBId);
            const nameA = teamNameById.get(game.teamAId) ?? "?";
            const nameB = teamNameById.get(game.teamBId) ?? "?";
            return (
              <li key={game.id} className="py-2.5 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {played ? (
                      <>
                        <span className="font-bold text-slate-950 dark:text-white">
                          {nameA} {game.teamAScore}
                        </span>
                        {" – "}
                        <span className="font-bold text-slate-950 dark:text-white">
                          {nameB} {game.teamBScore}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="font-bold text-slate-950 dark:text-white">
                          {nameA} vs {nameB}
                        </span>
                        <span className={`ml-2 ${pill("neutral")}`}>Scheduled</span>
                      </>
                    )}
                    {game.excluded && (
                      <span className={`ml-2 ${pill("amber")}`} title="Kept, but not counted">
                        Not counted
                      </span>
                    )}
                    {game.event && (
                      <span className="ml-2 text-slate-500 dark:text-slate-400">{game.event}</span>
                    )}
                    {game.date && <span className="ml-2 text-slate-400">{game.date}</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    {!played && editingGameId === game.id ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          min={0}
                          value={editScoreA}
                          onChange={(event) => onEditScoreA(event.target.value)}
                          placeholder="Score"
                          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                        />
                        <input
                          type="number"
                          min={0}
                          value={editScoreB}
                          onChange={(event) => onEditScoreB(event.target.value)}
                          placeholder="Score"
                          className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => onSaveScore(game.id)}
                          className="text-xs font-bold text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          Save
                        </button>
                      </span>
                    ) : (
                      !played && (
                        <button
                          type="button"
                          onClick={() => onStartEditScore(game.id)}
                          className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                        >
                          Enter score
                        </button>
                      )
                    )}
                    {played && (
                      <button
                        type="button"
                        onClick={() => onToggleExcluded(game)}
                        className="text-xs font-bold text-amber-700 hover:underline dark:text-amber-500"
                        title={
                          game.excluded
                            ? "Count this game toward the rankings again"
                            : "Keep this game logged, but leave it out of the rankings"
                        }
                      >
                        {game.excluded ? "Count it" : "Don't count"}
                      </button>
                    )}
                    {rowA && rowB && (
                      <WhatIfButton
                        open={whatIf === game.id}
                        onToggle={() => setWhatIf((open) => (open === game.id ? null : game.id))}
                        label={`${nameA} and ${nameB}`}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => onRemoveGame(game)}
                      className={button.danger}
                    >
                      Remove
                    </button>
                  </span>
                </div>
                {whatIf === game.id && rowA && rowB && (
                  <div className="mt-1">
                    <WhatIf a={rowA} b={rowB} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {hiddenGames > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span>
              Showing {shownGames.length.toLocaleString()} of {listed.length.toLocaleString()}
            </span>
            <button
              type="button"
              onClick={() => setListLimit({ key: listKey, count: shown + GAMES_SHOWN_STEP })}
              className={button.ghost}
            >
              Show {Math.min(GAMES_SHOWN_STEP, hiddenGames)} more
            </button>
          </div>
        )}
        {loggedGames.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No games logged yet.
          </p>
        ) : (
          listed.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {gamesWindow.basis === "today" ? `No games today (${day}).` : `No games on ${day}.`}
            </p>
          )
        )}
      </div>
    </>
  );
}
