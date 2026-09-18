import { useState } from "react";
import type { ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { isScoutGamePlayed } from "../../lib/teamRankings";
import type { ToastTone } from "../../hooks/useToast";
import { ScheduleImportPanel } from "../ScheduleImportPanel";
import { TeamNameCombobox } from "../TeamNameCombobox";
import { button, card, pill } from "../../styles/tokens";

/**
 * The half-written game in the add form. One object rather than six pieces of state, because the
 * form is filled in and cleared as a unit and the view has to hand the whole of it down anyway.
 */
export type AddGameDraft = {
  teamAName: string;
  teamAScore: string;
  teamBName: string;
  teamBScore: string;
  date: string;
  event: string;
};

export const EMPTY_ADD_GAME_DRAFT: AddGameDraft = {
  teamAName: "",
  teamAScore: "",
  teamBName: "",
  teamBScore: "",
  date: "",
  event: "",
};

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
  allTeams: ScoutTeam[];
  suggestedTeams: ScoutTeam[];
  existingGames: ScoutGame[];
  onImportGames: (teams: ScoutTeam[], games: ScoutGame[]) => void;
  showToast: (message: string, options?: { tone?: ToastTone }) => void;
  /** The games typed in or pasted here, newest first. League fixtures are not among them. */
  loggedGames: ScoutGame[];
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
  allTeams,
  suggestedTeams,
  existingGames,
  onImportGames,
  showToast,
  loggedGames,
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
}: GamesSectionProps) {
  /*
   * Keyed on the page rather than reset in an effect: a different age group starts at the top
   * again by itself, and nothing has to fire after render to make it so.
   */
  const [listLimit, setListLimit] = useState({ key: ageGroupId, count: GAMES_SHOWN_FIRST });
  const shown = listLimit.key === ageGroupId ? listLimit.count : GAMES_SHOWN_FIRST;
  const shownGames = loggedGames.slice(0, shown);
  const hiddenGames = loggedGames.length - shownGames.length;

  return (
    <>
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Add a game</h2>
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
        <p className="mt-1 text-xs text-slate-500">
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
          ageGroupId={ageGroupId}
          ageGroupName={groupName}
          teams={allTeams}
          suggestedTeams={suggestedTeams}
          existingGames={existingGames}
          defaultSubjectTeam={myTeamName}
          onImport={onImportGames}
          onClose={onCloseImport}
          showToast={showToast}
        />
      )}

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Logged games{groupName ? ` (${groupName})` : ""}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Only games you&apos;ve entered here — this age group&apos;s League Standings schedule
          (played and upcoming) appears in the rankings and scouting report automatically but
          isn&apos;t listed here.
        </p>
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {shownGames.map((game) => {
            const played = isScoutGamePlayed(game);
            return (
              <li
                key={game.id}
                className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  {played ? (
                    <>
                      <span className="font-bold text-slate-950 dark:text-white">
                        {teamNameById.get(game.teamAId) ?? "?"} {game.teamAScore}
                      </span>
                      {" – "}
                      <span className="font-bold text-slate-950 dark:text-white">
                        {teamNameById.get(game.teamBId) ?? "?"} {game.teamBScore}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-slate-950 dark:text-white">
                        {teamNameById.get(game.teamAId) ?? "?"} vs{" "}
                        {teamNameById.get(game.teamBId) ?? "?"}
                      </span>
                      <span className={`ml-2 ${pill("neutral")}`}>Scheduled</span>
                    </>
                  )}
                  {game.excluded && (
                    <span className={`ml-2 ${pill("amber")}`} title="Kept, but not counted">
                      Not counted
                    </span>
                  )}
                  {game.event && <span className="ml-2 text-slate-500">{game.event}</span>}
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
                        className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400"
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
                  <button
                    type="button"
                    onClick={() => onRemoveGame(game)}
                    className={button.danger}
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {hiddenGames > 0 && (
          <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
            <span>
              Showing {shownGames.length} of {loggedGames.length}
            </span>
            <button
              type="button"
              onClick={() => setListLimit({ key: ageGroupId, count: shown + GAMES_SHOWN_STEP })}
              className={button.ghost}
            >
              Show {Math.min(GAMES_SHOWN_STEP, hiddenGames)} more
            </button>
          </div>
        )}
        {loggedGames.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No games logged yet.</p>
        )}
      </div>
    </>
  );
}
