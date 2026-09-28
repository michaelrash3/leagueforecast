import { useMemo, useState } from "react";
import { scenarioSeason, type ScenarioPick } from "../../lib/scenario";
import { formatGameDate, parseDateValue } from "../../lib/date";
import { displayName, recordText } from "../../lib/format";
import { useSimulationOdds } from "../../hooks/useSimulationWorker";
import type {
  GameLog,
  Matchup,
  Settings,
  Team,
  TeamBase,
  TeamWithProjection,
} from "../../lib/types";
import { button as buttonClasses, card } from "../../styles/tokens";

type PlayoffMachineProps = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
  /** The teams the forecast reads now, for each game's expected score. */
  liveTeams: Team[];
  ratings: { byTeam: Map<string, number>; games: Map<string, number> };
  remainingGames: Matchup[];
  cutoff: number;
  hasCutLine: boolean;
  /** The table as it stands, for what each pick changes. */
  currentRows: TeamWithProjection[];
  oddsSeed: string;
  iterations: number;
};

const SIDE_BUTTON =
  "rounded-md border px-2 py-1 text-xs font-semibold transition-colors aria-pressed:border-slate-950 aria-pressed:bg-slate-950 aria-pressed:text-white dark:aria-pressed:border-white dark:aria-pressed:bg-white dark:aria-pressed:text-slate-950 border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200";

const runsInput = (value: number | undefined) => (value === undefined ? "" : String(value));

const change = (value: number): string =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(value !== 0 && Math.abs(value) < 1 ? 1 : 0)}`;

/**
 * "If we beat the Bears and the Cougars lose, where are we?"
 *
 * The question every family asks in the last weeks, and the page only ever answered it for the
 * model's own picks. Here the reader settles any game left by hand — who wins, and the score if
 * they like, since run differential breaks ties — and the table, the cut line and the Gold odds
 * are worked out again with those games played (`scenarioSeason`) and the rest simulated as the
 * forecast does. Nothing is saved: the picks live in this panel and go when the page does.
 */
export function PlayoffMachine({
  teams,
  matchups,
  logs,
  settings,
  liveTeams,
  ratings,
  remainingGames,
  cutoff,
  hasCutLine,
  currentRows,
  oddsSeed,
  iterations,
}: PlayoffMachineProps) {
  const [picks, setPicks] = useState<Record<string, ScenarioPick>>({});
  const nameOf = useMemo(() => {
    const names = new Map(teams.map((team) => [team.id, displayName(team.name)]));
    return (id: string) => names.get(id) ?? id;
  }, [teams]);
  const games = useMemo(
    () => [...remainingGames].sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date)),
    [remainingGames]
  );
  // A pick on a game that has since been played is the real result's to settle, not the pick's.
  const livePicks = useMemo(() => {
    const open = new Set(remainingGames.map((game) => game.id));
    return Object.fromEntries(Object.entries(picks).filter(([gameId]) => open.has(gameId)));
  }, [picks, remainingGames]);
  const picked = Object.keys(livePicks).length;

  const scenario = useMemo(
    () =>
      picked === 0
        ? null
        : scenarioSeason({ teams, matchups, logs, settings, liveTeams, ratings }, livePicks),
    [picked, teams, matchups, logs, settings, liveTeams, ratings, livePicks]
  );
  const { odds, pending } = useSimulationOdds({
    teams: hasCutLine && scenario ? scenario.teams : [],
    remaining: scenario?.remaining ?? [],
    iterations,
    seedText: `${oddsSeed}|picks|${JSON.stringify(livePicks)}`,
    cutoff,
    settings,
  });

  const nowById = useMemo(() => new Map(currentRows.map((row) => [row.id, row])), [currentRows]);

  const choose = (game: Matchup, winnerId: string | null) =>
    setPicks((before) => {
      const next = { ...before };
      if (winnerId === null) delete next[game.id];
      else next[game.id] = { winnerId };
      return next;
    });
  const typeRuns = (game: Matchup, side: "awayRuns" | "homeRuns", text: string) =>
    setPicks((before) => {
      const pick = before[game.id];
      if (!pick) return before;
      const runs = text.trim() === "" ? undefined : Math.max(0, Math.round(Number(text)));
      const next: ScenarioPick = { ...pick };
      if (runs === undefined || !Number.isFinite(runs)) delete next[side];
      else next[side] = runs;
      return { ...before, [game.id]: next };
    });

  return (
    <section aria-label="Playoff machine" className={`${card} p-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
          Playoff machine
        </h3>
        {picked > 0 && (
          <button type="button" className={buttonClasses.ghost} onClick={() => setPicks({})}>
            Clear picks
          </button>
        )}
      </div>
      <p className="mt-1 text-xs font-bold text-slate-500 dark:text-slate-400">
        Pick the winner of any game left and see where everyone lands. A pick plays out at the
        model&apos;s expected score unless you type one. Nothing here is saved.
      </p>

      {games.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">No games left to pick.</p>
      ) : (
        <ul className="mt-3 max-h-96 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {games.map((game) => {
            const pick = livePicks[game.id];
            const score = scenario?.scores[game.id];
            const away = nameOf(game.away);
            const home = nameOf(game.home);
            return (
              <li key={game.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="w-14 shrink-0 text-xs text-slate-500 dark:text-slate-400">
                  {formatGameDate(game.date)}
                </span>
                <span role="group" aria-label={`${away} at ${home}`} className="flex gap-1">
                  <button
                    type="button"
                    aria-pressed={pick?.winnerId === game.away}
                    className={SIDE_BUTTON}
                    onClick={() => choose(game, game.away)}
                  >
                    {away}
                  </button>
                  <button
                    type="button"
                    aria-pressed={!pick}
                    className={SIDE_BUTTON}
                    onClick={() => choose(game, null)}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    aria-pressed={pick?.winnerId === game.home}
                    className={SIDE_BUTTON}
                    onClick={() => choose(game, game.home)}
                  >
                    {home}
                  </button>
                </span>
                {pick && (
                  <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-label={`${away} runs`}
                      placeholder={score ? String(score.awayRuns) : ""}
                      value={runsInput(pick.awayRuns)}
                      onChange={(event) => typeRuns(game, "awayRuns", event.target.value)}
                      className="w-12 rounded border border-slate-300 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                    />
                    –
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      aria-label={`${home} runs`}
                      placeholder={score ? String(score.homeRuns) : ""}
                      value={runsInput(pick.homeRuns)}
                      onChange={(event) => typeRuns(game, "homeRuns", event.target.value)}
                      className="w-12 rounded border border-slate-300 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-900"
                    />
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {scenario && (
        <table className="mt-4 w-full text-sm" aria-label="Standings with your picks">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <th className="py-1">#</th>
              <th className="py-1">Team</th>
              <th className="py-1">Record</th>
              {hasCutLine && <th className="py-1 text-right">Gold %</th>}
            </tr>
          </thead>
          <tbody>
            {scenario.ranked.map((team) => {
              const now = nowById.get(team.id);
              const moved = now?.rank !== undefined ? now.rank - team.rank : 0;
              const gold = odds[team.id];
              const goldMove = gold !== undefined && now ? gold - now.goldPct : undefined;
              return (
                <tr
                  key={team.id}
                  className={
                    hasCutLine && team.rank === cutoff
                      ? "border-b-2 border-dashed border-amber-500"
                      : ""
                  }
                >
                  <td className="py-1 font-bold">
                    {team.rank}
                    {moved !== 0 && (
                      <span
                        className={`ml-1 text-xs ${moved > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"}`}
                      >
                        {moved > 0 ? "▲" : "▼"}
                        {Math.abs(moved)}
                      </span>
                    )}
                  </td>
                  <td className="py-1">{displayName(team.name)}</td>
                  <td className="py-1">{recordText(team)}</td>
                  {hasCutLine && (
                    <td className="py-1 text-right">
                      {pending || gold === undefined ? (
                        "…"
                      ) : (
                        <>
                          {Math.round(gold)}%
                          {goldMove !== undefined && Math.abs(goldMove) >= 0.5 && (
                            <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                              ({change(goldMove)})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
