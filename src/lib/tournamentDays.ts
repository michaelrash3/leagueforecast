import type { ScoutGame } from "./teamRankings/types";

/*
 * How a meeting of a league's clubs is told from a tournament game (3.7), shared by a season
 * started from its clubs (`draftStart`) and Fill scores' games the schedule is missing
 * (`planLeagueScoreFill`). Its own module, and a small one, since Fill scores is part of the page's
 * first download and this is all it needs of a start.
 */

/** A day the pool can read: "2026-09-25", or the start of a longer stamp. */
export const dayOf = (date: string | undefined): string | undefined =>
  date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : undefined;

/**
 * Why a meeting of two of the league's clubs looks like a tournament game rather than a league
 * one, read off every game the pool holds (`games`, the year's, every club's): entered under an
 * event, or either club played a club outside the league (`league`) the same day. A day of the
 * league's own clubs alone is the league's, two of them or a doubleheader against one: a league can
 * play two of its teams on one day, and counting them as somebody else left both of the day's
 * games unticked as a tournament's. Undefined for a game that looks like the league's own. Shared
 * by a start (`draftStart`) and Fill scores' games not on the schedule (`planLeagueScoreFill`), so
 * the two say the same of one game.
 */
export const tournamentReason = (
  games: readonly ScoutGame[],
  league: ReadonlySet<string>
): ((game: ScoutGame) => string | undefined) => {
  // Who outside the league each of the league's clubs played on each day.
  const opponents = new Map<string, Set<string>>();
  const met = (club: string, day: string, opponent: string) => {
    if (!league.has(club) || league.has(opponent)) return;
    const key = `${club}@${day}`;
    const seen = opponents.get(key) ?? new Set<string>();
    seen.add(opponent);
    opponents.set(key, seen);
  };
  games.forEach((game) => {
    const day = dayOf(game.date);
    if (!day || game.withdrawn) return;
    met(game.teamAId, day, game.teamBId);
    met(game.teamBId, day, game.teamAId);
  });
  const playedOthers = (club: string, day: string, opponent: string) =>
    [...(opponents.get(`${club}@${day}`) ?? [])].some((one) => one !== opponent);
  return (game) => {
    const event = game.event?.trim();
    if (event) return `Entered under ${event}.`;
    const day = dayOf(game.date);
    if (!day) return undefined;
    return playedOthers(game.teamAId, day, game.teamBId) ||
      playedOthers(game.teamBId, day, game.teamAId)
      ? "One of the two played somebody else that day, so it was likely a tournament."
      : undefined;
  };
};
