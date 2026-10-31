import { byStart } from "./date";

/**
 * The order a team's games still to play come in: those dated today or later by date, then those
 * whose date has passed with no score, then those with no date. A game rained out keeps its old
 * date until it is given a new one, and read by date alone it was the team's next game for days
 * after it was not played; it is still owed, so it stays in the list, behind the games that will
 * be played first. `daysFromToday` reads the season's dates on one timeline
 * (`seasonDaysFromToday`), as Data Quality's past games are found.
 *
 * Within a day, by start (`byStart`), a game with none after the day's timed ones: a doubleheader
 * stored late game first had the late one as the team's next game.
 */
export const inPlayingOrder = <G extends { date: string; startTs?: string }>(
  games: readonly G[],
  daysFromToday: (date: string) => number | null
): G[] => {
  const placed = games.map((game) => {
    const days = daysFromToday(game.date);
    const group = days === null ? 2 : days < 0 ? 1 : 0;
    return { game, group, days: days ?? 0 };
  });
  placed.sort((a, b) => a.group - b.group || a.days - b.days || byStart(a.game, b.game));
  return placed.map(({ game }) => game);
};
