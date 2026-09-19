/**
 * Every game in the season: the dates, the score somebody types in, and what each finished result
 * did to the table.
 *
 * Lifted out of App.tsx with the three pieces only it used — the date field, the score row and the
 * finished-game row. Nothing else referred to them, so they came along rather than becoming a
 * shared module with one caller.
 */
import React, {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { buildBracketProjection, type BracketGameProjection } from "../../lib/bracket";
import { formatGameDate, formatGameDateLong, normalizeDateInput } from "../../lib/date";
import { displayName, teamAbbr } from "../../lib/format";
import {
  RUN_SCORE_CAP,
  type GameLog,
  type Matchup,
  type PitchMode,
  type TeamBase,
} from "../../lib/types";
import { blankLog, isFinal } from "../../lib/util";
import { LeagueScoreFillPanel } from "../LeagueScoreFillPanel";
import type { LeagueFillPlan } from "../../lib/leagueScoreFill";
import { card, fieldFocusRing, tab } from "../../styles/tokens";

/** A blank log, shared so a row with nothing entered is one object rather than thousands. */
const EMPTY_GAME_LOG = blankLog();

function GameDateInput({
  value,
  onCommit,
  ariaLabel,
}: {
  value: string;
  onCommit: (value: string) => void;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value || "");

  // Follow the value from outside without an effect: React applies a set during render before
  // painting, so the field never shows the previous date for a frame.
  const [lastValue, setLastValue] = useState(value);
  if (lastValue !== value) {
    setLastValue(value);
    setDraft(value || "");
  }

  const commit = () => {
    const normalized = normalizeDateInput(draft);
    onCommit(normalized);
    setDraft(normalized);
  };

  return (
    <input
      type="text"
      inputMode="text"
      placeholder="5/1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      className={`w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-950 ${fieldFocusRing} dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100`}
      aria-label={ariaLabel ?? "Game date in M/D format"}
    />
  );
}

type ScoreRowProps = {
  teamName: string;
  prefix: "away" | "home";
  log: GameLog;
  onChange: (field: keyof GameLog, value: string) => void;
  pitchMode: PitchMode;
  trackErrors: boolean;
  runsOnly: boolean;
};

const ScoreRow = React.memo(function ScoreRow({
  teamName,
  prefix,
  log,
  onChange,
  pitchMode,
  trackErrors,
  runsOnly,
}: ScoreRowProps) {
  const fields = useMemo(
    () =>
      // A runs-only league writes down the final score and nothing else, so one
      // box per team is the entire entry form.
      runsOnly
        ? [{ key: `${prefix}Runs` as keyof GameLog, label: "R", aria: "Runs" }]
        : [
            { key: `${prefix}Runs` as keyof GameLog, label: "R", aria: "Runs" },
            { key: `${prefix}Hits` as keyof GameLog, label: "H", aria: "Hits" },
            ...(pitchMode === "player"
              ? [
                  ...(trackErrors
                    ? [{ key: `${prefix}Errors` as keyof GameLog, label: "E", aria: "Errors" }]
                    : []),
                  {
                    key: `${prefix === "away" ? "home" : "away"}WalksAllowed` as keyof GameLog,
                    label: "BB",
                    aria: "Walks",
                  },
                ]
              : [{ key: `${prefix}K` as keyof GameLog, label: "K", aria: "Strikeouts" }]),
          ],
    [pitchMode, prefix, runsOnly, trackErrors]
  );
  const display = displayName(teamName);
  const abbr = teamAbbr(teamName);
  const inputRefs = useRef<Partial<Record<keyof GameLog, HTMLInputElement | null>>>({});
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    fields.forEach((field) => {
      const input = inputRefs.current[field.key];
      if (!input || document.activeElement === input) return;
      const nextValue = String(log[field.key] ?? "");
      if (input.value !== nextValue) input.value = nextValue;
    });
  }, [fields, log]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-xs font-semibold text-white sm:h-10 sm:w-10">
          {abbr}
        </div>
        <div className="truncate font-bold" title={teamName}>
          {display}
        </div>
      </div>
      <div className="flex gap-2 pl-11 sm:pl-0">
        {fields.map((field, index) => (
          <label
            key={field.key}
            className="text-center text-[10px] font-semibold uppercase text-slate-500"
          >
            {field.label}
            <input
              ref={(node) => {
                inputRefs.current[field.key] = node;
              }}
              defaultValue={String(log[field.key] ?? "")}
              onChange={(event) => {
                const digits = event.currentTarget.value.replace(/[^0-9]/g, "").slice(0, 2);
                const isRunsField = field.key === "awayRuns" || field.key === "homeRuns";
                const next =
                  isRunsField && Number(digits) > RUN_SCORE_CAP ? String(RUN_SCORE_CAP) : digits;
                if (event.currentTarget.value !== next) event.currentTarget.value = next;
                startTransition(() => {
                  onChangeRef.current(field.key, next);
                });
              }}
              onKeyDown={(event) => {
                // Most scores are one digit, so a length-based jump fires on
                // "10" but not on "7". Enter advances instead: it is the same
                // keystroke every time, and it never moves focus unasked.
                if (event.key !== "Enter") return;
                const nextField = fields[index + 1];
                if (!nextField) return;
                event.preventDefault();
                inputRefs.current[nextField.key]?.focus();
              }}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              aria-label={`${display} ${field.aria}`}
              className="mt-1 block h-10 w-11 rounded-lg border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            />
          </label>
        ))}
      </div>
    </div>
  );
}, areScoreRowPropsEqual);

function areScoreRowPropsEqual(previous: ScoreRowProps, next: ScoreRowProps) {
  return (
    previous.teamName === next.teamName &&
    previous.prefix === next.prefix &&
    previous.log === next.log &&
    previous.pitchMode === next.pitchMode &&
    previous.runsOnly === next.runsOnly
  );
}

function FinalGameRow({
  id,
  date,
  awayName,
  homeName,
  awayRuns,
  homeRuns,
  onEdit,
}: {
  id: string;
  date: string;
  awayName: string;
  homeName: string;
  awayRuns: string;
  homeRuns: string;
  onEdit: () => void;
}) {
  const away = Number(awayRuns);
  const home = Number(homeRuns);
  const awayWon = away > home;
  const homeWon = home > away;
  const side = (name: string, runs: string, won: boolean) => (
    <div className="flex items-baseline justify-between gap-3">
      <span
        className={`truncate ${won ? "font-black text-slate-950 dark:text-white" : "font-semibold text-slate-500 dark:text-slate-400"}`}
      >
        {displayName(name)}
      </span>
      <span
        className={`tabular-nums ${won ? "font-black text-slate-950 dark:text-white" : "font-bold text-slate-500 dark:text-slate-400"}`}
      >
        {runs === "" ? "—" : runs}
      </span>
    </div>
  );
  return (
    <article
      id={id}
      className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-xs dark:border-slate-700 dark:bg-slate-900"
    >
      <span className="w-14 shrink-0 text-xs font-semibold text-slate-400 dark:text-slate-500">
        {formatGameDate(date)}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        {side(awayName, awayRuns, awayWon)}
        {side(homeName, homeRuns, homeWon)}
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        aria-label={`Edit final: ${displayName(awayName)} at ${displayName(homeName)}`}
      >
        Edit
      </button>
    </article>
  );
}

export function GamesView({
  teams,
  matchups: _matchups,
  logs,
  scoreboardGames,
  scoreboardPredictions,
  scoreboardTeamFilter,
  pitchMode,
  trackErrors,
  runsOnly,
  setScoreboardTeamFilter,
  newDate,
  setNewDate,
  newAway,
  setNewAway,
  newHome,
  setNewHome,
  addGameValid,
  addGame,
  toggleFinal,
  swapGame,
  removeGame,
  updateLog,
  setMatchups,
  gameStatusClasses,
  seasonGamesFinalized,
  bracketProjection,
  silverBracketProjection,
  updateBracketLog,
  toggleBracketFinal,
  scoreFillPlan,
  openScoreFill,
  closeScoreFill,
  applyScoreFill,
  seasonLabel,
}: {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  scoreboardGames: Matchup[];
  scoreboardPredictions: Map<
    string,
    {
      spread: string;
      pickName: string;
      pickPct: number;
      scenarioBadges: string[];
      impactScore: number;
    }
  >;
  scoreboardTeamFilter: string;
  pitchMode: PitchMode;
  trackErrors: boolean;
  runsOnly: boolean;
  setScoreboardTeamFilter: (v: string) => void;
  newDate: string;
  setNewDate: (v: string) => void;
  newAway: string;
  setNewAway: (v: string) => void;
  newHome: string;
  setNewHome: (v: string) => void;
  addGameValid: boolean;
  addGame: () => void;
  toggleFinal: (id: string) => void;
  swapGame: (id: string) => void;
  removeGame: (id: string) => void;
  updateLog: (id: string, field: keyof GameLog, value: string | boolean) => void;
  setMatchups: React.Dispatch<React.SetStateAction<Matchup[]>>;
  gameStatusClasses: (s: string) => string;
  seasonGamesFinalized: boolean;
  bracketProjection: ReturnType<typeof buildBracketProjection>;
  silverBracketProjection: ReturnType<typeof buildBracketProjection>;
  updateBracketLog: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  toggleBracketFinal: (gameId: string) => void;
  /** Set while the fill review is open; null when it is not. */
  scoreFillPlan: LeagueFillPlan | null;
  openScoreFill: () => void;
  closeScoreFill: () => void;
  applyScoreFill: (matchupIds: string[]) => void;
  seasonLabel: string;
}) {
  const dateId = useId();
  const awayId = useId();
  const homeId = useId();
  const filterId = useId();
  const [quickFilter, setQuickFilter] = useState<"all" | "open" | "today">("all");

  const todayKey = useMemo(() => {
    const now = new Date();
    return `${now.getUTCMonth() + 1}/${now.getUTCDate()}`;
  }, []);

  const handleToggleFinal = useCallback(
    (gameId: string) => {
      const priorScrollY = window.scrollY;
      toggleFinal(gameId);
      requestAnimationFrame(() => {
        window.scrollTo({ top: priorScrollY });
      });
    },
    [toggleFinal]
  );
  const visibleGames = useMemo(() => {
    if (quickFilter === "open") return scoreboardGames.filter((g) => !isFinal(logs[g.id]));
    if (quickFilter === "today") {
      return scoreboardGames.filter(
        (g) => normalizeDateInput(g.date) === normalizeDateInput(todayKey)
      );
    }
    return scoreboardGames;
  }, [quickFilter, scoreboardGames, logs, todayKey]);
  const tournamentGames = useMemo(() => {
    if (!seasonGamesFinalized || quickFilter === "today") return [];

    const inSelectedTeamFilter = (game: BracketGameProjection) => {
      if (scoreboardTeamFilter === "ALL") return true;
      return (
        game.matchup?.away === scoreboardTeamFilter || game.matchup?.home === scoreboardTeamFilter
      );
    };

    return [
      ...bracketProjection.rounds.flatMap((round) =>
        round.map((game) => ({ game, bracketLabel: "Gold Bracket" }))
      ),
      ...silverBracketProjection.rounds.flatMap((round) =>
        round.map((game) => ({ game, bracketLabel: "Silver Bracket" }))
      ),
    ]
      .filter(({ game }) => game.matchup && inSelectedTeamFilter(game))
      .filter(({ game }) => quickFilter !== "open" || !isFinal(game.log))
      .sort(
        (a, b) =>
          a.game.roundIndex - b.game.roundIndex ||
          a.bracketLabel.localeCompare(b.bracketLabel) ||
          a.game.gameIndex - b.game.gameIndex
      );
  }, [
    seasonGamesFinalized,
    quickFilter,
    scoreboardTeamFilter,
    bracketProjection,
    silverBracketProjection,
  ]);

  const nextOpenGameId = useMemo(
    () => scoreboardGames.find((game) => !isFinal(logs[game.id]))?.id ?? null,
    [scoreboardGames, logs]
  );
  const jumpToNextOpen = useCallback(() => {
    if (!nextOpenGameId) return;
    document.getElementById(`game-card-${nextOpenGameId}`)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [nextOpenGameId]);

  // A finished game is a result to read, not a form to fill, so it collapses to
  // one line. Re-opening one puts the full card back for a correction.
  const [expandedFinals, setExpandedFinals] = useState<Record<string, boolean>>({});
  const toggleExpandedFinal = useCallback((gameId: string) => {
    setExpandedFinals((prev) => ({ ...prev, [gameId]: !prev[gameId] }));
  }, []);

  return (
    <section className="space-y-6">
      <div className={`${card} p-5`}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_1fr_1fr_auto]">
          <div>
            <label htmlFor={dateId} className="sr-only">
              Game date
            </label>
            <GameDateInput
              value={newDate}
              onCommit={(v) => setNewDate(v)}
              ariaLabel="New game date (M/D)"
            />
            <input id={dateId} type="hidden" value={newDate} readOnly aria-hidden="true" />
          </div>
          <label htmlFor={awayId} className="block">
            <span className="sr-only">Away team</span>
            <select
              id={awayId}
              value={newAway}
              onChange={(event) => setNewAway(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="">Away team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <label htmlFor={homeId} className="block">
            <span className="sr-only">Home team</span>
            <select
              id={homeId}
              value={newHome}
              onChange={(event) => setNewHome(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-bold text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
            >
              <option value="">Home team…</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addGame}
            disabled={!addGameValid}
            className="rounded-lg bg-slate-950 px-5 py-2 font-black text-white shadow-xs hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          >
            Add Game
          </button>
        </div>
        {!addGameValid && (newAway || newHome) && (
          <p className="mt-2 text-xs font-bold text-amber-600">
            Pick two different teams to add a game.
          </p>
        )}
        {_matchups.length > 0 && !scoreFillPlan && (
          <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
            <button
              type="button"
              onClick={openScoreFill}
              className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
            >
              Fill scores from Team Rankings
            </button>
            <span className="ml-2 text-xs text-slate-500">
              Reads results already in the pool — a GameChanger pull, usually — and offers them for
              this schedule. Nothing is written until you have looked.
            </span>
          </div>
        )}
      </div>

      {scoreFillPlan && (
        <LeagueScoreFillPanel
          plan={scoreFillPlan}
          seasonLabel={seasonLabel}
          onApply={applyScoreFill}
          onClose={closeScoreFill}
        />
      )}

      <div className={`${card} p-4`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label
            htmlFor={filterId}
            className="text-sm font-bold text-slate-700 dark:text-slate-200"
          >
            Scoreboard Filter
          </label>
          <select
            id={filterId}
            value={scoreboardTeamFilter}
            onChange={(event) => setScoreboardTeamFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-950 outline-hidden focus:border-slate-950 md:w-72 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
          >
            <option value="ALL">All Teams</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                {displayName(team.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setQuickFilter("all")}
            className={tab(quickFilter === "all")}
          >
            All Games
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("open")}
            className={tab(quickFilter === "open")}
          >
            Open Games
          </button>
          <button
            type="button"
            onClick={() => setQuickFilter("today")}
            className={tab(quickFilter === "today")}
          >
            Today
          </button>
          <button
            type="button"
            onClick={jumpToNextOpen}
            disabled={!nextOpenGameId}
            className="ml-auto rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Next Unfinalized
          </button>
        </div>
      </div>

      {visibleGames.length === 0 && tournamentGames.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
          {seasonGamesFinalized ? "No games match this filter." : "No games yet."}
        </div>
      ) : null}

      {visibleGames.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {visibleGames.map((game) => {
            const log = logs[game.id] || EMPTY_GAME_LOG;
            const away = teams.find((team) => team.id === game.away);
            const home = teams.find((team) => team.id === game.home);
            const final = isFinal(log);
            const hasEnteredScore = log.awayRuns.trim() !== "" && log.homeRuns.trim() !== "";
            const prediction = scoreboardPredictions.get(game.id);
            if (final && !expandedFinals[game.id]) {
              return (
                <FinalGameRow
                  key={game.id}
                  id={`game-card-${game.id}`}
                  date={game.date}
                  awayName={away?.name || game.away}
                  homeName={home?.name || game.home}
                  awayRuns={log.awayRuns}
                  homeRuns={log.homeRuns}
                  onEdit={() => toggleExpandedFinal(game.id)}
                />
              );
            }
            return (
              <article
                key={game.id}
                id={`game-card-${game.id}`}
                className={`overflow-hidden rounded-lg border bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900 ${
                  final
                    ? "border-slate-200 opacity-80 dark:border-slate-700"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                  <GameDateInput
                    value={game.date}
                    ariaLabel={`Date for ${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`}
                    onCommit={(nextDate) =>
                      setMatchups((prev) =>
                        prev.map((item) =>
                          item.id === game.id ? { ...item, date: nextDate } : item
                        )
                      )
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.blur();
                        handleToggleFinal(game.id);
                      }}
                      className={`rounded-lg px-3 py-1 text-xs font-black ${
                        final ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
                      }`}
                      aria-label={final ? "Mark game as scheduled" : "Mark game as final"}
                    >
                      {final ? "Final" : "Scheduled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => swapGame(game.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                      aria-label="Swap home and away teams"
                    >
                      Swap
                    </button>
                    <button
                      type="button"
                      onClick={() => removeGame(game.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-red-600 dark:border-slate-600 dark:bg-slate-800"
                      aria-label="Delete game"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="space-y-4 p-4">
                  {!final && prediction ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700 shadow-xs ring-1 ring-slate-200">
                          Spread: {prediction.spread}
                        </span>
                        {prediction.scenarioBadges.map((badge) => (
                          <span
                            key={badge}
                            className={`rounded-full px-3 py-1 ${gameStatusClasses(badge)}`}
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                      <span className="text-slate-500">
                        Pick: {prediction.pickName} · {Math.round(prediction.pickPct * 100)}%
                      </span>
                    </div>
                  ) : !final ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
                      Prediction queued in the background — score entry and final verification are
                      ready now.
                    </div>
                  ) : null}
                  <ScoreRow
                    teamName={away?.name || game.away}
                    prefix="away"
                    log={log}
                    onChange={(field, value) => updateLog(game.id, field, value)}
                    pitchMode={pitchMode}
                    trackErrors={trackErrors}
                    runsOnly={runsOnly}
                  />
                  <ScoreRow
                    teamName={home?.name || game.home}
                    prefix="home"
                    log={log}
                    onChange={(field, value) => updateLog(game.id, field, value)}
                    pitchMode={pitchMode}
                    trackErrors={trackErrors}
                    runsOnly={runsOnly}
                  />
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <span>
                      {final
                        ? `Final · ${formatGameDate(game.date)}`
                        : hasEnteredScore
                          ? "Scores entered — verify final"
                          : (game.date ?? "").trim()
                            ? formatGameDateLong(game.date)
                            : "Needs Date"}
                    </span>
                    {!final && (
                      <button
                        type="button"
                        onClick={() => handleToggleFinal(game.id)}
                        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                      >
                        {hasEnteredScore ? "Verify Final" : "Save + Final"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {tournamentGames.length > 0 && (
        <div className="space-y-4">
          <div className={`${card} p-4`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Tournament Schedule
            </div>
            <h3 className="mt-1 text-lg font-black text-slate-950 dark:text-slate-100">
              Bracket games are ready for score entry
            </h3>
            <p className="mt-1 text-sm font-bold text-slate-500 dark:text-slate-400">
              All regular-season games are finalized, so Gold and Silver tournament matchups now
              appear here alongside the bracket predictor.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {tournamentGames.map(({ game, bracketLabel }) => {
              const matchup = game.matchup;
              if (!matchup) return null;
              const away = teams.find((team) => team.id === matchup.away);
              const home = teams.find((team) => team.id === matchup.home);
              const final = isFinal(game.log);
              const hasEnteredScore =
                game.log.awayRuns.trim() !== "" && game.log.homeRuns.trim() !== "";
              const pickPct =
                game.prediction && game.predictedWinnerId
                  ? game.predictedWinnerId === matchup.away
                    ? game.prediction.awayWinPct
                    : 1 - game.prediction.awayWinPct
                  : null;
              const winnerLabel =
                game.winnerSource === "actual"
                  ? "Actual winner"
                  : game.winnerSource === "bye"
                    ? "Bye advance"
                    : game.winnerSource === "projected"
                      ? "Model pick"
                      : "Pending";

              return (
                <article
                  key={game.id}
                  className={`overflow-hidden rounded-lg border bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900 ${
                    final
                      ? "border-slate-200 opacity-80 dark:border-slate-700"
                      : "border-slate-200 dark:border-slate-700"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/50">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        {bracketLabel} · {game.roundName} · Game {game.gameIndex + 1}
                      </div>
                      <div className="mt-1 text-sm font-bold text-slate-950 dark:text-slate-100">
                        {winnerLabel}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleBracketFinal(game.id)}
                      className={`rounded-lg px-3 py-1 text-xs font-black ${
                        final ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
                      }`}
                      aria-label={
                        final
                          ? "Mark tournament game as scheduled"
                          : "Mark tournament game as final"
                      }
                    >
                      {final ? "Final" : "Scheduled"}
                    </button>
                  </div>
                  <div className="space-y-4 p-4">
                    {!final && game.prediction && pickPct !== null && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800/50">
                        <span className="rounded-full bg-white px-3 py-1 text-slate-700 shadow-xs ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
                          Model score: {game.prediction.awayScore}-{game.prediction.homeScore}
                        </span>
                        <span className="text-slate-500 dark:text-slate-400">
                          Bracket pick · {Math.round(pickPct * 100)}%
                        </span>
                      </div>
                    )}
                    <ScoreRow
                      teamName={away?.name || matchup.away}
                      prefix="away"
                      log={game.log}
                      onChange={(field, value) => updateBracketLog(game.id, field, value)}
                      pitchMode={pitchMode}
                      trackErrors={trackErrors}
                      runsOnly={runsOnly}
                    />
                    <ScoreRow
                      teamName={home?.name || matchup.home}
                      prefix="home"
                      log={game.log}
                      onChange={(field, value) => updateBracketLog(game.id, field, value)}
                      pitchMode={pitchMode}
                      trackErrors={trackErrors}
                      runsOnly={runsOnly}
                    />
                    <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span>
                        {final
                          ? `Final · ${bracketLabel}`
                          : hasEnteredScore
                            ? "Scores entered — verify final"
                            : `${game.roundName} score entry`}
                      </span>
                      {!final && (
                        <button
                          type="button"
                          onClick={() => toggleBracketFinal(game.id)}
                          className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                        >
                          {hasEnteredScore ? "Verify Final" : "Save + Final"}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
