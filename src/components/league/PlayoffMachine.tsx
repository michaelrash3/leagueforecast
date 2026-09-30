import { useMemo, useState } from "react";
import { scenarioSeason, type ScenarioPick } from "../../lib/scenario";
import { formatGameDate, parseDateValue, seasonStartMonth } from "../../lib/date";
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
import {
  createSavedScenario,
  duplicateSavedScenario,
  decodeSharedScenario,
  encodeSharedScenario,
  loadSavedScenarios,
  rebaseSavedScenario,
  renameSavedScenario,
  saveSavedScenarios,
  scenarioFingerprint,
  staleScenarioReasons,
  type SavedScenario,
} from "../../lib/savedScenario";

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
  seasonId: string;
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
  seasonId,
}: PlayoffMachineProps) {
  const [picks, setPicks] = useState<Record<string, ScenarioPick>>({});
  const [saved, setSaved] = useState<SavedScenario[]>(() => loadSavedScenarios(seasonId));
  const [scenarioName, setScenarioName] = useState("My scenario");
  const [presetTeamId, setPresetTeamId] = useState(teams[0]?.id ?? "");
  const [scenarioMessage, setScenarioMessage] = useState("");
  const [sharedPreview, setSharedPreview] = useState<SavedScenario | null>(() => {
    const encoded = new URL(window.location.href).searchParams.get("scenario");
    return encoded ? decodeSharedScenario(encoded) : null;
  });
  const nameOf = useMemo(() => {
    const names = new Map(teams.map((team) => [team.id, displayName(team.name)]));
    return (id: string) => names.get(id) ?? id;
  }, [teams]);
  // In the season's own order, which turns over New Year when its schedule does (`seasonStartMonth`).
  const games = useMemo(() => {
    const start = seasonStartMonth(matchups.map((game) => game.date));
    return [...remainingGames].sort(
      (a, b) => parseDateValue(a.date, start) - parseDateValue(b.date, start)
    );
  }, [remainingGames, matchups]);
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
  const keepSaved = (next: SavedScenario[]) => {
    if (saveSavedScenarios(seasonId, next)) {
      setSaved(next);
      setScenarioMessage("Saved on this device.");
    } else setScenarioMessage("The browser could not save this scenario.");
  };
  const saveCurrent = () => {
    if (picked === 0) return;
    const now = new Date().toISOString();
    const value = createSavedScenario(
      {
        id: globalThis.crypto?.randomUUID?.() ?? `scenario-${Date.now()}`,
        name: scenarioName.trim() || "My scenario",
        seasonId,
        picks: livePicks,
        sourceFingerprint: scenarioFingerprint(matchups, logs),
      },
      now
    );
    keepSaved([...saved, value]);
  };
  const preset = (kind: "win" | "lose" | "favorites" | "all") => {
    const byId = new Map(liveTeams.map((team) => [team.id, team]));
    const next: Record<string, ScenarioPick> = {};
    games.forEach((game) => {
      let winnerId: string;
      if (kind === "win" && (game.away === presetTeamId || game.home === presetTeamId)) {
        winnerId = presetTeamId;
      } else if (kind === "lose" && (game.away === presetTeamId || game.home === presetTeamId)) {
        winnerId = game.away === presetTeamId ? game.home : game.away;
      } else if (kind === "favorites") {
        winnerId =
          (byId.get(game.away)?.adjustedRating ?? 0) >= (byId.get(game.home)?.adjustedRating ?? 0)
            ? game.away
            : game.home;
      } else if (kind === "all") winnerId = game.home;
      else return;
      next[game.id] = { winnerId };
    });
    setPicks(next);
  };

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
        model&apos;s expected score unless you type one. Save useful paths on this device.
      </p>
      {sharedPreview && (
        <div className="mt-3 rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950/30">
          <p className="text-sm font-black">Shared scenario preview: {sharedPreview.name}</p>
          <p className="mt-1 text-xs">
            {Object.keys(sharedPreview.picks).length} assumed outcomes. Your season has not been
            changed.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonClasses.primary}
              onClick={() => {
                if (sharedPreview.seasonId !== seasonId) {
                  setScenarioMessage(
                    "This scenario belongs to a different season and cannot be applied here."
                  );
                  return;
                }
                const rebased = rebaseSavedScenario(
                  sharedPreview,
                  matchups,
                  logs,
                  new Date().toISOString()
                );
                setPicks(rebased.scenario.picks);
                setSharedPreview(null);
                setScenarioMessage(
                  `Applied preview${rebased.removed.length ? ` after removing ${rebased.removed.length} stale picks` : ""}.`
                );
              }}
            >
              Apply preview
            </button>
            <button
              type="button"
              className={buttonClasses.ghost}
              onClick={() => setSharedPreview(null)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-900">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold">
            Preset team
            <select
              value={presetTeamId}
              onChange={(event) => setPresetTeamId(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {displayName(team.name)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={buttonClasses.ghost} onClick={() => preset("win")}>
            Win out
          </button>
          <button type="button" className={buttonClasses.ghost} onClick={() => preset("lose")}>
            Lose out
          </button>
          <button type="button" className={buttonClasses.ghost} onClick={() => preset("favorites")}>
            Favorites win
          </button>
          <button type="button" className={buttonClasses.ghost} onClick={() => preset("all")}>
            Pick all remaining
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold">
            Scenario name
            <input
              value={scenarioName}
              onChange={(event) => setScenarioName(event.target.value)}
              className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
          <button
            type="button"
            className={buttonClasses.primary}
            disabled={picked === 0}
            onClick={saveCurrent}
          >
            Save scenario
          </button>
        </div>
        {scenarioMessage && (
          <p role="status" className="mt-2 text-xs font-semibold">
            {scenarioMessage}
          </p>
        )}
      </div>

      {saved.length > 0 && (
        <div className="mt-4" aria-label="Saved scenarios">
          <h4 className="text-sm font-black">Saved scenarios</h4>
          <ul className="mt-2 space-y-2">
            {saved.map((item) => {
              const stale = staleScenarioReasons(item, matchups, logs);
              return (
                <li
                  key={item.id}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold">
                      {item.name}
                      {stale.length > 0 ? ` · ${stale.length} stale` : ""}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        className={buttonClasses.ghost}
                        onClick={() => setPicks(item.picks)}
                      >
                        Apply
                      </button>
                      {stale.length > 0 && (
                        <button
                          type="button"
                          className={buttonClasses.ghost}
                          onClick={() => {
                            const rebased = rebaseSavedScenario(
                              item,
                              matchups,
                              logs,
                              new Date().toISOString()
                            );
                            keepSaved(
                              saved.map((entry) =>
                                entry.id === item.id ? rebased.scenario : entry
                              )
                            );
                            setScenarioMessage(
                              `Rebased ${item.name}; removed ${rebased.removed.length} invalid pick${rebased.removed.length === 1 ? "" : "s"}.`
                            );
                          }}
                        >
                          Rebase
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClasses.ghost}
                        onClick={() =>
                          keepSaved(
                            saved.map((entry) =>
                              entry.id === item.id
                                ? renameSavedScenario(
                                    entry,
                                    `${entry.name} renamed`,
                                    new Date().toISOString()
                                  )
                                : entry
                            )
                          )
                        }
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className={buttonClasses.ghost}
                        onClick={() =>
                          keepSaved([
                            ...saved,
                            duplicateSavedScenario(
                              item,
                              globalThis.crypto?.randomUUID?.() ?? `scenario-${Date.now()}`,
                              new Date().toISOString()
                            ),
                          ])
                        }
                      >
                        Duplicate
                      </button>
                      <button
                        type="button"
                        className={buttonClasses.ghost}
                        onClick={() => {
                          const url = new URL(window.location.href);
                          url.searchParams.set("scenario", encodeSharedScenario(item));
                          void navigator.clipboard?.writeText(url.toString());
                          setScenarioMessage("Scenario preview link copied.");
                        }}
                      >
                        Share
                      </button>
                      <button
                        type="button"
                        className={buttonClasses.danger}
                        onClick={() => keepSaved(saved.filter((entry) => entry.id !== item.id))}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

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
