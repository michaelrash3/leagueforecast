import type { WeekMove, WeekMovers } from "../../lib/thisWeek";
import { TOP_PLACES } from "../../lib/thisWeek";
import type { TeamWeek, Weekly } from "../../lib/theWeekly";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { formatIsoDayShort } from "../../lib/date";
import { card } from "../../styles/tokens";

const pct = (chance: number) => `${Math.round(chance * 100)}%`;

/**
 * The Weekly (README, "The Weekly"): the page's week as one card under its own club. The upset of
 * the week and the others beside it, the board's movers (`weekMovers`), the game of the week ahead,
 * the winning streaks still running, and the page's own club's week. Every name opens the club's
 * panel. Drawn with the board, from what the board and its games already hold (`theWeekly`).
 */
export function ThisWeekCard({
  movers,
  weekly = null,
  myWeek = null,
  myTeamId,
  rowOf,
  onOpenTeam,
}: {
  movers: WeekMovers | null;
  weekly?: Weekly | null;
  /** The page's own club's week just played (`teamWeek`), where it played one. */
  myWeek?: TeamWeek | null;
  myTeamId?: string;
  rowOf: (teamId: string) => ScoutRankingRow | undefined;
  onOpenTeam: (teamId: string) => void;
}) {
  const into = movers?.into ?? [];
  const outOf = movers?.outOf ?? [];
  const climbs = movers?.climbs ?? [];
  const upsets = weekly?.upsets ?? [];
  const streaks = weekly?.streaks ?? [];
  const ahead = weekly?.ahead ?? null;
  const mine = myTeamId !== undefined && myWeek ? rowOf(myTeamId) : undefined;
  if (
    into.length + outOf.length + climbs.length + upsets.length + streaks.length === 0 &&
    !ahead &&
    !mine
  )
    return null;

  const name = (teamId: string) => rowOf(teamId)?.teamName ?? "?";
  const placeOf = (teamId: string) => {
    const row = rowOf(teamId);
    return row ? `#${(row.overallRank ?? row.rank).toLocaleString()}` : "";
  };
  const club = (teamId: string, label = name(teamId)) => (
    <button
      type="button"
      className="font-semibold text-blue-700 hover:underline dark:text-blue-300"
      onClick={() => onOpenTeam(teamId)}
    >
      {label}
    </button>
  );
  const faint = (text: string) => (
    <span className="text-slate-500 dark:text-slate-400">{text}</span>
  );
  const place = (at: number | null) => (at === null ? "new" : `#${at}`);
  const line = (title: string, moves: WeekMove[], climb = false) =>
    moves.length === 0 ? null : (
      <p className="text-sm text-slate-700 dark:text-slate-200">
        <span className="font-bold">{title}: </span>
        {moves.map((move, at) => (
          <span key={move.teamId}>
            {at > 0 ? ", " : ""}
            {club(move.teamId, move.name)}{" "}
            {faint(
              `${place(move.from)} → #${move.to}${climb && move.from !== null ? ` (up ${move.from - move.to})` : ""}`
            )}
          </span>
        ))}
      </p>
    );
  const [upset, ...moreUpsets] = upsets;
  return (
    <section aria-label="The Weekly" className={`${card} space-y-1.5 p-4`}>
      <h2 className="text-sm font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        The Weekly
        {weekly && (
          <span className="ml-2 font-semibold normal-case tracking-normal">
            week to {formatIsoDayShort(weekly.asOf)}
          </span>
        )}
      </h2>
      {upset && (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-bold">Upset of the week: </span>
          {club(upset.winnerId)} {upset.winnerRuns}–{upset.loserRuns} over {club(upset.loserId)}{" "}
          {faint(
            `(${placeOf(upset.loserId)}) · ${name(upset.winnerId)} had a ${pct(upset.chance)} chance`
          )}
          {moreUpsets.length > 0 && (
            <>
              {". Also: "}
              {moreUpsets.map((one, at) => (
                <span key={`${one.winnerId}|${one.loserId}|${one.date}`}>
                  {at > 0 ? ", " : ""}
                  {club(one.winnerId)} over {club(one.loserId)} {faint(`(${pct(one.chance)})`)}
                </span>
              ))}
            </>
          )}
        </p>
      )}
      {line(`Into the top ${TOP_PLACES}`, into)}
      {line(`Out of the top ${TOP_PLACES}`, outOf)}
      {line("Biggest climbs", climbs, true)}
      {ahead && (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-bold">Game of the week: </span>
          {faint(`${formatIsoDayShort(ahead.date)} · `)}
          {club(ahead.teamAId)} {faint(`(${placeOf(ahead.teamAId)})`)} vs {club(ahead.teamBId)}{" "}
          {faint(
            `(${placeOf(ahead.teamBId)}) · ${pct(ahead.chanceA)} to ${pct(1 - ahead.chanceA)}`
          )}
        </p>
      )}
      {streaks.length > 0 && (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-bold">Winning streaks: </span>
          {streaks.map((streak, at) => (
            <span key={streak.teamId}>
              {at > 0 ? ", " : ""}
              {club(streak.teamId)} {faint(`${streak.wins} straight`)}
            </span>
          ))}
        </p>
      )}
      {mine && myWeek && (
        <p className="text-sm text-slate-700 dark:text-slate-200">
          <span className="font-bold">Your week: </span>
          {club(mine.teamId)} went {myWeek.wins}–{myWeek.losses}
          {myWeek.ties > 0 ? `–${myWeek.ties}` : ""}
          {myWeek.bestWin && (
            <>
              {"; best win over "}
              {club(myWeek.bestWin.teamId)} {faint(`(#${myWeek.bestWin.place.toLocaleString()})`)}
            </>
          )}
        </p>
      )}
    </section>
  );
}
