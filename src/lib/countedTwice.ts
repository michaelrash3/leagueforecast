/**
 * Pulled clubs credited twice with one game.
 *
 * A club plays one game at a time, and the games of a day are at least two hours apart: two of a
 * club's counted games on one day that start within the hour of each other are one game, entered
 * twice. Where the two give the club the same result, that is nearly all they can be. On the pool of
 * 26 September 2026 pulled clubs held 3,771 pairs of counted games within the hour of each other on
 * one day, 627 of them with the same result, where two different results match about 0.38% of the
 * time: about 12 of the 627 by chance.
 *
 * Most are one opponent entered twice, so each copy of the game found a different entry: a club
 * itself on GameChanger twice (a coach's own team and a parent's), two spellings a tidy cannot read
 * as one team, or a stand-in beside the club it stands for. Nothing is changed here; the list is for
 * the person who can tell which entry is the team (`PoolHealthCard`).
 */
import { csvEscape } from "./csv";
import {
  countsTowardRating,
  scoreSeenBy,
  startMinuteOf,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";

/** One game of the pair, as the club it is credited to sees it. */
export type CountedTwiceGame = {
  gameId: string;
  opponentId: string;
  opponentName: string;
  startTs: string;
};

/** Two or more of one club's counted games within the hour of each other, with one result. */
export type CountedTwice = {
  teamId: string;
  teamName: string;
  date: string;
  /** The club's score, then its opponent's, the same on every game of the group. */
  own: number;
  opponent: number;
  games: CountedTwiceGame[];
  /** From the first start of the group to the last. */
  minutesApart: number;
};

const HOUR_MINUTES = 60;

/**
 * Every such group in the pool, most recent day first. Only pulled clubs: a stand-in's record is
 * not shown anywhere, and the pulled club on the other side of its games is listed itself.
 */
export const countedTwice = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  today?: string
): CountedTwice[] => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  type Side = {
    game: ScoutGame;
    opponentId: string;
    own: number;
    opponent: number;
    minute: number;
  };
  const byClubDay = new Map<string, Side[]>();
  games.forEach((game) => {
    if (!game.date || !countsTowardRating(game, today)) return;
    const minute = startMinuteOf(game.startTs);
    if (minute === undefined) return;
    [game.teamAId, game.teamBId].forEach((clubId) => {
      if (!byId.get(clubId)?.gcTeams?.length) return;
      const seen = scoreSeenBy(game, clubId);
      if (!seen) return;
      const key = `${clubId}\u0000${game.date}`;
      const side: Side = {
        game,
        opponentId: clubId === game.teamAId ? game.teamBId : game.teamAId,
        own: seen.own,
        opponent: seen.opponent,
        minute,
      };
      const list = byClubDay.get(key);
      if (list) list.push(side);
      else byClubDay.set(key, [side]);
    });
  });

  const found: CountedTwice[] = [];
  byClubDay.forEach((sides, key) => {
    if (sides.length < 2) return;
    const [teamId, date] = key.split("\u0000") as [string, string];
    const sorted = sides.slice().sort((a, b) => a.minute - b.minute);
    const grouped = new Set<Side>();
    sorted.forEach((first, index) => {
      if (grouped.has(first)) return;
      const group = [
        first,
        ...sorted
          .slice(index + 1)
          .filter(
            (other) =>
              !grouped.has(other) &&
              other.minute - first.minute <= HOUR_MINUTES &&
              other.own === first.own &&
              other.opponent === first.opponent
          ),
      ];
      if (group.length < 2) return;
      group.forEach((side) => grouped.add(side));
      found.push({
        teamId,
        teamName: byId.get(teamId)?.name ?? teamId,
        date,
        own: first.own,
        opponent: first.opponent,
        games: group.map((side) => ({
          gameId: side.game.id,
          opponentId: side.opponentId,
          opponentName: byId.get(side.opponentId)?.name ?? side.opponentId,
          startTs: side.game.startTs ?? "",
        })),
        minutesApart: group[group.length - 1]!.minute - first.minute,
      });
    });
  });
  return found.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      a.teamName.localeCompare(b.teamName) ||
      a.teamId.localeCompare(b.teamId)
  );
};

export const COUNTED_TWICE_CSV_HEADERS = [
  "Club",
  "Date",
  "Result",
  "Opponents",
  "Starts (UTC)",
  "Minutes Apart",
] as const;

/** The whole list as a file, one group a line: a few hundred is spreadsheet work. */
export const countedTwiceCsv = (groups: readonly CountedTwice[]): string =>
  [
    COUNTED_TWICE_CSV_HEADERS.join(","),
    ...groups.map((group) =>
      [
        group.teamName,
        group.date,
        `${group.own}-${group.opponent}`,
        group.games.map((game) => game.opponentName).join(" | "),
        group.games.map((game) => game.startTs).join(" | "),
        String(group.minutesApart),
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

export const countedTwiceCsvFilename = (day: string): string => `counted-twice-${day}.csv`;
