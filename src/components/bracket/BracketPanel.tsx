/**
 * The bracket: its games, the scores somebody enters into them, and what the model makes of the
 * ones still to play.
 *
 * Lifted out of App.tsx whole. Nothing here reads anything but its own props, which is what made
 * it liftable — and what made it worth lifting, since none of it has any business being on screen
 * while somebody is trying to follow how the season's state is put together.
 */
import { buildBracketProjection, type BracketGameProjection } from "../../lib/bracket";
import { displayName } from "../../lib/format";
import { RUN_SCORE_CAP, type GameLog } from "../../lib/types";
import { card } from "../../styles/tokens";

function BracketScoreInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {label}
      <input
        value={value}
        onChange={(event) => {
          const digits = event.target.value.replace(/[^0-9]/g, "").slice(0, 2);
          onChange(Number(digits) > RUN_SCORE_CAP ? String(RUN_SCORE_CAP) : digits);
        }}
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        className="mt-1 block h-10 w-12 rounded-lg border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-hidden focus:border-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-white"
      />
    </label>
  );
}

function BracketTeamLine({
  slot,
  score,
  isWinner,
  sourceLabel,
  onScoreChange,
}: {
  slot: BracketGameProjection["top"];
  score: string;
  isWinner: boolean;
  sourceLabel: "Projected" | "Actual" | "Bye" | "";
  onScoreChange: (value: string) => void;
}) {
  const team = slot.team;
  return (
    <div
      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
        isWinner
          ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-slate-950 px-2 py-1 text-[10px] font-semibold text-white">
            {slot.seed ? `#${slot.seed}` : "—"}
          </span>
          <span className="truncate text-sm font-bold text-slate-950 dark:text-slate-100">
            {team ? displayName(team.name) : slot.sourceGameId ? "Awaiting previous game" : "Bye"}
          </span>
        </div>
        <div className="mt-1 text-[11px] font-bold text-slate-500 dark:text-slate-400">
          {team
            ? `${`Seed #${slot.seed}`}${sourceLabel ? ` · ${sourceLabel}` : ""}`
            : slot.sourceGameId
              ? `Winner of ${slot.sourceGameId.toUpperCase()}`
              : "Automatic advance"}
        </div>
      </div>
      {team && <BracketScoreInput label="R" value={score} onChange={onScoreChange} />}
    </div>
  );
}

const winnerLabelForTeam = (
  source: BracketGameProjection["winnerSource"]
): "Projected" | "Actual" | "Bye" | "" => {
  if (source === "actual") return "Actual";
  if (source === "projected") return "Projected";
  if (source === "bye") return "Bye";
  return "";
};

function BracketGameCard({
  game,
  onScoreChange,
  onToggleFinal,
}: {
  game: BracketGameProjection;
  onScoreChange: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  onToggleFinal: (gameId: string) => void;
}) {
  const topWinner = !!game.top.team && game.winnerId === game.top.team.id;
  const bottomWinner = !!game.bottom.team && game.winnerId === game.bottom.team.id;
  const winnerLabel =
    game.winnerSource === "actual"
      ? "Actual winner"
      : game.winnerSource === "bye"
        ? "Bye advance"
        : game.winnerSource === "projected"
          ? "Model pick"
          : "Pending";
  const pickPct =
    game.prediction && game.predictedWinnerId
      ? game.predictedWinnerId === game.matchup?.away
        ? game.prediction.awayWinPct
        : 1 - game.prediction.awayWinPct
      : null;
  const hasPlayableTeams = !!game.top.team && !!game.bottom.team;

  return (
    <article className="min-w-[260px] rounded-lg border border-slate-200 bg-slate-50 p-3 shadow-xs dark:border-slate-700 dark:bg-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Game {game.gameIndex + 1}
          </div>
          <div className="text-sm font-bold text-slate-950 dark:text-slate-100">{winnerLabel}</div>
        </div>
        {hasPlayableTeams && (
          <button
            type="button"
            onClick={() => onToggleFinal(game.id)}
            className={`rounded-lg px-3 py-1 text-xs font-black ${
              game.log.isFinal ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"
            }`}
          >
            {game.log.isFinal ? "Final" : "Set Final"}
          </button>
        )}
      </div>

      <div className="space-y-2">
        <BracketTeamLine
          slot={game.top}
          score={game.log.homeRuns}
          isWinner={topWinner}
          sourceLabel={topWinner ? winnerLabelForTeam(game.winnerSource) : ""}
          onScoreChange={(value) => onScoreChange(game.id, "homeRuns", value)}
        />
        <BracketTeamLine
          slot={game.bottom}
          score={game.log.awayRuns}
          isWinner={bottomWinner}
          sourceLabel={bottomWinner ? winnerLabelForTeam(game.winnerSource) : ""}
          onScoreChange={(value) => onScoreChange(game.id, "awayRuns", value)}
        />
      </div>

      {game.prediction && pickPct !== null && (
        <div className="mt-3 rounded-lg bg-white p-3 text-xs font-bold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700">
          Model score: {game.prediction.awayScore}-{game.prediction.homeScore} ·{" "}
          {Math.round(pickPct * 100)}% win chance for the bracket pick
        </div>
      )}
    </article>
  );
}

export function BracketPredictionPanel({
  title,
  emptyMessage,
  championLabel,
  projection,
  onScoreChange,
  onToggleFinal,
  onClearScores,
}: {
  title: string;
  emptyMessage: string;
  championLabel: string;
  projection: ReturnType<typeof buildBracketProjection>;
  onScoreChange: (gameId: string, field: keyof GameLog, value: string | boolean) => void;
  onToggleFinal: (gameId: string) => void;
  onClearScores: (gameIds: string[], label: string) => void;
}) {
  const bracketGames = projection.rounds.flat();
  const savedGames = bracketGames.filter(
    (game) =>
      game.log.isFinal ||
      game.log.awayRuns !== "" ||
      game.log.homeRuns !== "" ||
      game.log.awayHits !== "" ||
      game.log.homeHits !== ""
  ).length;
  const champion = projection.champion;
  return (
    <section className={`${card} p-5`} aria-label="Bracket prediction model">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
            {title}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {projection.entrantCount} teams · {projection.size}-slot bracket
          </span>
          <button
            type="button"
            onClick={() =>
              onClearScores(
                bracketGames.map((game) => game.id),
                title
              )
            }
            disabled={savedGames === 0}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-800 shadow-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            Clear bracket scores
          </button>
        </div>
      </div>

      {projection.rounds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
          {emptyMessage}
        </div>
      ) : (
        <>
          <div className="mb-4 rounded-lg bg-slate-950 p-4 text-white">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">
              {championLabel}
            </div>
            <div className="mt-1 text-2xl font-black">
              {champion ? displayName(champion.name) : "Pending"}
            </div>
          </div>
          <div className="overflow-x-auto pb-2">
            <div
              className="grid min-w-max gap-4"
              style={{
                gridTemplateColumns: `repeat(${projection.rounds.length}, minmax(280px, 1fr))`,
              }}
            >
              {projection.rounds.map((round) => (
                <div key={round[0]?.roundName ?? "round"} className="space-y-4">
                  <div className="sticky left-0 rounded-lg bg-slate-100 px-3 py-2 text-center text-xs font-semibold uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {round[0]?.roundName}
                  </div>
                  <div className="space-y-4">
                    {round.map((game) => (
                      <BracketGameCard
                        key={game.id}
                        game={game}
                        onScoreChange={(gameId, field, value) =>
                          onScoreChange(gameId, field, value)
                        }
                        onToggleFinal={onToggleFinal}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
