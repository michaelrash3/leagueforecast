import { useMemo, useRef, useState } from "react";
import {
  buildScoutingReport,
  buildTeamRankings,
  deriveLeagueScoutGames,
  isScoutGamePlayed,
  resolveOrCreateTeam,
  type MatchupTier,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { buildTeamRankExplanationRequest } from "../lib/teamRankingsSummaryClient";
import {
  loadLogsForSeason,
  loadMatchupsForSeason,
  loadTeamsForSeason,
  type SeasonMeta,
} from "../lib/storage";
import {
  loadScoutGames,
  loadScoutTeams,
  saveScoutGames,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";
import { AiStoryPanel } from "./AiStoryPanel";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill } from "../styles/tokens";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type TeamRankingsViewProps = {
  seasons: SeasonMeta[];
  activeSeasonId: string;
  showToast: (
    message: string,
    options?: {
      tone?: ToastTone;
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    }
  ) => void;
  requestConfirmation: (options: ConfirmOptions) => Promise<boolean>;
};

const tierTone = (tier: MatchupTier) =>
  tier === "Favored" ? "emerald" : tier === "Underdog" ? "red" : "neutral";

const formatRating = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
const formatPct = (value: number) => `${Math.round(value * 100)}%`;

export function TeamRankingsView({
  seasons,
  activeSeasonId,
  showToast,
  requestConfirmation,
}: TeamRankingsViewProps) {
  const [selectedSeasonId, setSelectedSeasonId] = useState(activeSeasonId);
  const [scoutTeams, setScoutTeams] = useState<ScoutTeam[]>(() => loadScoutTeams());
  const [scoutGames, setScoutGames] = useState<ScoutGame[]>(() => loadScoutGames());
  const [reportTeamId, setReportTeamId] = useState<string>("");

  const [teamAName, setTeamAName] = useState("");
  const [teamAScore, setTeamAScore] = useState("");
  const [teamBName, setTeamBName] = useState("");
  const [teamBScore, setTeamBScore] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [gameEvent, setGameEvent] = useState("");

  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editScoreA, setEditScoreA] = useState("");
  const [editScoreB, setEditScoreB] = useState("");

  const lastDeletedGameRef = useRef<ScoutGame | null>(null);
  const lastDeletedTeamRef = useRef<{ team: ScoutTeam; games: ScoutGame[] } | null>(null);

  const persistTeams = (teams: ScoutTeam[]) => {
    setScoutTeams(teams);
    if (!saveScoutTeams(teams))
      showToast("Could not save teams (storage full).", { tone: "error" });
  };
  const persistGames = (games: ScoutGame[]) => {
    setScoutGames(games);
    if (!saveScoutGames(games))
      showToast("Could not save games (storage full).", { tone: "error" });
  };

  // League Standings' completed games for the selected season, read fresh every render — this
  // view never writes back to League Standings data, only reads it.
  const leagueSeason = useMemo(
    () => ({
      teams: loadTeamsForSeason(selectedSeasonId),
      matchups: loadMatchupsForSeason(selectedSeasonId),
      logs: loadLogsForSeason(selectedSeasonId),
    }),
    [selectedSeasonId]
  );

  // The full team pool for this season: the persisted scout pool, extended (in-memory, not yet
  // necessarily saved) with any league team names not already in it. Every read in this view uses
  // this — never the raw `scoutTeams` state directly — so a league team is usable immediately,
  // before any save has happened.
  const merged = useMemo(
    () =>
      deriveLeagueScoutGames(
        selectedSeasonId,
        leagueSeason.teams,
        leagueSeason.matchups,
        leagueSeason.logs,
        scoutTeams
      ),
    [selectedSeasonId, leagueSeason, scoutTeams]
  );

  const leagueGameTeamIds = useMemo(
    () => new Set(merged.games.flatMap((game) => [game.teamAId, game.teamBId])),
    [merged.games]
  );

  const seasonGames = useMemo(
    () => [...merged.games, ...scoutGames.filter((game) => game.seasonId === selectedSeasonId)],
    [merged.games, scoutGames, selectedSeasonId]
  );

  const rankings = useMemo(
    () => buildTeamRankings(selectedSeasonId, merged.teams, seasonGames),
    [selectedSeasonId, merged.teams, seasonGames]
  );

  const teamNameById = useMemo(
    () => new Map(merged.teams.map((team) => [team.id, team.name])),
    [merged.teams]
  );

  const reportRows = useMemo(() => {
    const forId = reportTeamId || rankings.find((row) => row.isMine)?.teamId || rankings[0]?.teamId;
    if (!forId) return [];
    return buildScoutingReport(forId, rankings);
  }, [reportTeamId, rankings]);
  const reportForId =
    reportTeamId || rankings.find((row) => row.isMine)?.teamId || rankings[0]?.teamId || "";
  const reportRow = rankings.find((row) => row.teamId === reportForId) ?? null;

  const explanationRequest = useMemo(() => {
    if (!reportRow || reportRow.games === 0) return null;
    const seasonLabel = seasons.find((s) => s.id === selectedSeasonId)?.name ?? selectedSeasonId;
    return buildTeamRankExplanationRequest(reportRow, rankings.length, reportRows, seasonLabel);
  }, [reportRow, rankings.length, reportRows, seasons, selectedSeasonId]);
  const explanation = useLeagueSummary(explanationRequest);

  const seasonManualGames = useMemo(
    () =>
      scoutGames
        .filter((game) => game.seasonId === selectedSeasonId)
        .slice()
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [scoutGames, selectedSeasonId]
  );

  const setMyTeam = (teamId: string) => {
    const exists = scoutTeams.some((team) => team.id === teamId);
    const base = exists
      ? scoutTeams
      : [...scoutTeams, ...merged.teams.filter((t) => t.id === teamId)];
    persistTeams(base.map((team) => ({ ...team, isMine: team.id === teamId })));
  };

  const removeGame = async (game: ScoutGame) => {
    const played = isScoutGamePlayed(game);
    const confirmed = await requestConfirmation({
      title: "Remove this game?",
      message: played
        ? `${teamNameById.get(game.teamAId) ?? "?"} ${game.teamAScore} – ${
            teamNameById.get(game.teamBId) ?? "?"
          } ${game.teamBScore}`
        : `${teamNameById.get(game.teamAId) ?? "?"} vs ${teamNameById.get(game.teamBId) ?? "?"} (scheduled, no score yet)`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    lastDeletedGameRef.current = game;
    persistGames(scoutGames.filter((g) => g.id !== game.id));
    showToast("Game removed.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => {
        const restored = lastDeletedGameRef.current;
        if (restored) persistGames([...scoutGames.filter((g) => g.id !== restored.id), restored]);
      },
    });
  };

  const removeTeam = async (team: ScoutTeam) => {
    const confirmed = await requestConfirmation({
      title: `Remove ${team.name}?`,
      message: "This also removes every scouted game logged against this team, across all seasons.",
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    const relatedGames = scoutGames.filter(
      (game) => game.teamAId === team.id || game.teamBId === team.id
    );
    lastDeletedTeamRef.current = { team, games: relatedGames };
    persistTeams(scoutTeams.filter((t) => t.id !== team.id));
    persistGames(scoutGames.filter((g) => g.teamAId !== team.id && g.teamBId !== team.id));
    showToast(`${team.name} removed.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => {
        const restored = lastDeletedTeamRef.current;
        if (!restored) return;
        persistTeams([...scoutTeams, restored.team]);
        persistGames([...scoutGames, ...restored.games]);
      },
    });
  };

  const myTeamName = rankings.find((row) => row.isMine)?.teamName ?? "";

  const scoresBothBlank = teamAScore.trim() === "" && teamBScore.trim() === "";
  const scoresBothValid =
    teamAScore.trim() !== "" &&
    teamBScore.trim() !== "" &&
    Number.isFinite(Number(teamAScore)) &&
    Number(teamAScore) >= 0 &&
    Number.isFinite(Number(teamBScore)) &&
    Number(teamBScore) >= 0;
  const addGameValid =
    teamAName.trim().length > 0 &&
    teamBName.trim().length > 0 &&
    teamAName.trim().toLowerCase() !== teamBName.trim().toLowerCase() &&
    (scoresBothBlank || scoresBothValid);

  const addGame = () => {
    if (!addGameValid) {
      showToast("Enter both team names, and either both scores or neither.", { tone: "error" });
      return;
    }
    let teams = merged.teams;
    const a = resolveOrCreateTeam(teamAName, teams);
    teams = a.teams;
    const b = resolveOrCreateTeam(teamBName, teams);
    teams = b.teams;
    const newGame: ScoutGame = {
      id: `scout_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      teamAId: a.teamId,
      teamBId: b.teamId,
      seasonId: selectedSeasonId,
      ...(scoresBothValid
        ? { teamAScore: Number(teamAScore), teamBScore: Number(teamBScore) }
        : {}),
      ...(gameDate ? { date: gameDate } : {}),
      ...(gameEvent.trim() ? { event: gameEvent.trim() } : {}),
    };
    persistTeams(teams);
    persistGames([...scoutGames, newGame]);
    setTeamAName("");
    setTeamAScore("");
    setTeamBName("");
    setTeamBScore("");
    setGameDate("");
    setGameEvent("");
    showToast(scoresBothValid ? "Game added." : "Added to schedule.", { tone: "success" });
  };

  const saveGameScore = (gameId: string) => {
    const a = Number(editScoreA);
    const b = Number(editScoreB);
    if (!Number.isFinite(a) || a < 0 || !Number.isFinite(b) || b < 0) {
      showToast("Enter two non-negative scores.", { tone: "error" });
      return;
    }
    persistGames(
      scoutGames.map((game) =>
        game.id === gameId ? { ...game, teamAScore: a, teamBScore: b } : game
      )
    );
    setEditingGameId(null);
    setEditScoreA("");
    setEditScoreB("");
    showToast("Score saved.", { tone: "success" });
  };

  const nameDatalistId = "team-rankings-name-options";

  return (
    <div className="flex flex-col gap-6">
      <div className={`${card} p-5`}>
        <h1 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
          Team Rankings
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          A separate pool from League Standings: log any team&apos;s scores as they come up in a
          tournament or another league, and see how everyone stacks up. This season&apos;s League
          Standings results are folded in automatically — no need to re-enter those. Marking a team
          &ldquo;mine&rdquo; is just a shortcut for the scouting report and for adding your own
          schedule ahead of time — it never changes how any team, including yours, is rated.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="scout-season"
          >
            Ranking teams for
          </label>
          <select
            id="scout-season"
            value={selectedSeasonId}
            onChange={(event) => setSelectedSeasonId(event.target.value)}
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Top 10</h2>
        {rankings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            Add a game below to start ranking teams for this season.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {rankings.slice(0, 10).map((row) => (
              <li
                key={row.teamId}
                className={`flex items-center justify-between gap-3 px-2 py-2.5 text-sm ${
                  row.isMine ? "rounded-lg bg-blue-50 dark:bg-blue-950/40" : ""
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className={pill(row.rank === 1 ? "amber" : "neutral")}>#{row.rank}</span>
                  <span className="font-bold text-slate-950 dark:text-white">
                    {row.teamName}
                    {row.isMine ? " ★" : ""}
                  </span>
                </span>
                <span className="text-slate-500">
                  {row.record} · {formatRating(row.rating)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Add a game</h2>
        <p className="mt-1 text-xs text-slate-500">
          Leave both scores blank to log an upcoming/scheduled game (useful for building out your
          own team&apos;s future schedule) — come back and fill in the score once it&apos;s played.
        </p>
        <datalist id={nameDatalistId}>
          {merged.teams.map((team) => (
            <option key={team.id} value={team.name} />
          ))}
        </datalist>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_90px_1fr_90px]">
          <div className="flex items-center gap-2">
            <input
              type="text"
              list={nameDatalistId}
              value={teamAName}
              onChange={(event) => setTeamAName(event.target.value)}
              placeholder="Team name"
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
            />
            {myTeamName && (
              <button
                type="button"
                onClick={() => setTeamAName(myTeamName)}
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
            value={teamAScore}
            onChange={(event) => setTeamAScore(event.target.value)}
            placeholder="Score"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="text"
            list={nameDatalistId}
            value={teamBName}
            onChange={(event) => setTeamBName(event.target.value)}
            placeholder="Opponent name"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={teamBScore}
            onChange={(event) => setTeamBScore(event.target.value)}
            placeholder="Score"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="date"
            value={gameDate}
            onChange={(event) => setGameDate(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="text"
            value={gameEvent}
            onChange={(event) => setGameEvent(event.target.value)}
            placeholder="Tournament / event (optional)"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        <button
          type="button"
          onClick={addGame}
          disabled={!addGameValid}
          className={`${button.primary} mt-3`}
        >
          Add Game
        </button>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Full rankings</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
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
              {rankings.map((row) => (
                <tr key={row.teamId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-3 font-black">#{row.rank}</td>
                  <td className="font-bold text-slate-950 dark:text-white">
                    {row.teamName}
                    {leagueGameTeamIds.has(row.teamId) && (
                      <span className={`ml-2 ${pill("blue")}`}>League</span>
                    )}
                  </td>
                  <td>{row.record}</td>
                  <td>{formatRating(row.rating)}</td>
                  <td>{row.games}</td>
                  <td>{row.sosRank ? `#${row.sosRank}` : "—"}</td>
                  <td className="space-x-2 text-right">
                    <button
                      type="button"
                      onClick={() => setMyTeam(row.teamId)}
                      className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                      aria-pressed={row.isMine}
                      title="Mark as my team"
                    >
                      {row.isMine ? "★ My team" : "☆ Mark mine"}
                    </button>
                    {!leagueGameTeamIds.has(row.teamId) && (
                      <button
                        type="button"
                        onClick={() => {
                          const team = merged.teams.find((t) => t.id === row.teamId);
                          if (team) void removeTeam(team);
                        }}
                        className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rankings.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">No teams yet for this season.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Ratings only become meaningful once teams&apos; schedules connect, directly or through
          common opponents — a team with no shared opponents will show a plain, less certain rating.
          This model always uses a flat run-margin cap, independent of any one season&apos;s own
          settings.
        </p>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Scouting report
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="scout-report-team"
          >
            How would
          </label>
          <select
            id="scout-report-team"
            value={reportForId}
            onChange={(event) => setReportTeamId(event.target.value)}
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {rankings.map((row) => (
              <option key={row.teamId} value={row.teamId}>
                {row.teamName}
              </option>
            ))}
          </select>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            fare against everyone?
          </span>
        </div>
        {reportRow && (
          <div className="mt-3">
            <AiStoryPanel
              title="Why this ranking"
              text={explanation.status === "ready" ? explanation.summary : ""}
              source={explanation.status === "ready" ? "gemini" : "local"}
              model={explanation.model}
              loading={explanation.status === "loading"}
              loadingLabel="Writing rank explanation…"
              unavailableReason={explanation.reason}
              errorMessage={explanation.message}
              onRetry={explanation.retry}
            />
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2">Opponent</th>
                <th>Opponent rank</th>
                <th>Projected margin</th>
                <th>Win probability</th>
                <th>Outlook</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((preview) => (
                <tr
                  key={preview.opponentId}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="py-3 font-bold text-slate-950 dark:text-white">
                    {preview.opponentName}
                  </td>
                  <td>#{preview.opponentRank}</td>
                  <td>
                    {preview.projectedMargin >= 0 ? "+" : ""}
                    {preview.projectedMargin.toFixed(1)}
                  </td>
                  <td>{formatPct(preview.winProb)}</td>
                  <td>
                    <span className={pill(tierTone(preview.tier))}>{preview.tier}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reportRows.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              Add at least two teams to this season to see scouting projections.
            </p>
          )}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Logged games ({seasons.find((s) => s.id === selectedSeasonId)?.name ?? selectedSeasonId})
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Only games you&apos;ve entered here — this season&apos;s League Standings results appear
          in the rankings above automatically but aren&apos;t listed here.
        </p>
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {seasonManualGames.map((game) => {
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
                        onChange={(event) => setEditScoreA(event.target.value)}
                        placeholder="Score"
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                      />
                      <input
                        type="number"
                        min={0}
                        value={editScoreB}
                        onChange={(event) => setEditScoreB(event.target.value)}
                        placeholder="Score"
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => saveGameScore(game.id)}
                        className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400"
                      >
                        Save
                      </button>
                    </span>
                  ) : (
                    !played && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGameId(game.id);
                          setEditScoreA("");
                          setEditScoreB("");
                        }}
                        className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Enter score
                      </button>
                    )
                  )}
                  <button
                    type="button"
                    onClick={() => void removeGame(game)}
                    className={button.danger}
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {seasonManualGames.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No games logged yet.</p>
        )}
      </div>
    </div>
  );
}
