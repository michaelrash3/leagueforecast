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
 *
 * Out to three hours, for what the hour leaves over: one squad on GameChanger twice often lists the
 * one game at two clocks. On the pool of 26 September 2026 a pulled club's counted games 61 to 180
 * minutes apart with the same result, not both holding a row of the club's own schedules, were 112
 * pairs against two opponents and 16 against one; the same search with the club's games moved a
 * week, two or three matched 0.41% of candidate pairs, about 8 of the 112 by chance. Two games that
 * both hold the club's own row are its schedule saying two games — a doubleheader — and stay
 * unlisted past the hour. Such a group is marked `wide`: it wants a look on GameChanger, and may be
 * one copy to leave out rather than two entries to fold.
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
  /** Joined beyond the hour, where a doubleheader or two copies of one game both fit. */
  wide?: boolean;
};

const HOUR_MINUTES = 60;
/** How far the leftovers of the hour may join, where the club's own schedule does not say two. */
const WIDE_MINUTES = 180;

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
    /** The game holds a row of the club's own schedules: the club listed it itself. */
    ownRow: boolean;
  };
  const byClubDay = new Map<string, Side[]>();
  games.forEach((game) => {
    if (!game.date || !countsTowardRating(game, today)) return;
    const minute = startMinuteOf(game.startTs);
    if (minute === undefined) return;
    [game.teamAId, game.teamBId].forEach((clubId) => {
      const links = byId.get(clubId)?.gcTeams;
      if (!links?.length) return;
      const seen = scoreSeenBy(game, clubId);
      if (!seen) return;
      const key = `${clubId}\u0000${game.date}`;
      const ours = (schedule: string | undefined) =>
        schedule !== undefined && links.some((link) => link.teamId === schedule);
      const side: Side = {
        game,
        opponentId: clubId === game.teamAId ? game.teamBId : game.teamAId,
        own: seen.own,
        opponent: seen.opponent,
        minute,
        ownRow: ours(game.source?.teamId) || (game.alsoRows ?? []).some((row) => ours(row.teamId)),
      };
      const list = byClubDay.get(key);
      if (list) list.push(side);
      else byClubDay.set(key, [side]);
    });
  });

  /** Two sides the second pass may join: one result, out to three hours. */
  const joins = (a: Side, b: Side): boolean =>
    a.own === b.own && a.opponent === b.opponent && Math.abs(a.minute - b.minute) <= WIDE_MINUTES;
  /**
   * Whether a side can go into a group: it joins one of the group's games, and it does not put two
   * of the club's own rows more than an hour apart in one group. Its schedule listing both is the
   * club saying two games — a doubleheader — whatever another club's copy between them fits.
   */
  const canAdd = (members: readonly Side[], side: Side): boolean =>
    members.some((member) => joins(member, side)) &&
    !(
      side.ownRow &&
      members.some(
        (member) => member.ownRow && Math.abs(member.minute - side.minute) > HOUR_MINUTES
      )
    );

  const found: CountedTwice[] = [];
  byClubDay.forEach((sides, key) => {
    if (sides.length < 2) return;
    const [teamId, date] = key.split("\u0000") as [string, string];
    const sorted = sides.slice().sort((a, b) => a.minute - b.minute);
    const grouped = new Set<Side>();
    const groups: { sides: Side[]; wide: boolean }[] = [];
    // Within the hour first, exactly as the list always read: nothing it listed is taken apart.
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
      groups.push({ sides: group, wide: false });
    });
    // Then what the hour left over: into a group one of its games fits, or paired with each other.
    const leftover = sorted.filter((side) => !grouped.has(side));
    leftover.forEach((side) => {
      const into = groups.find((group) => canAdd(group.sides, side));
      if (!into) return;
      into.sides.push(side);
      into.wide = true;
      grouped.add(side);
    });
    const rest = leftover.filter((side) => !grouped.has(side));
    rest.forEach((first, index) => {
      if (grouped.has(first)) return;
      const group = [first];
      rest.slice(index + 1).forEach((other) => {
        if (!grouped.has(other) && canAdd(group, other)) group.push(other);
      });
      if (group.length < 2) return;
      group.forEach((side) => grouped.add(side));
      groups.push({ sides: group, wide: true });
    });

    groups.forEach(({ sides: members, wide }) => {
      const group = members.slice().sort((a, b) => a.minute - b.minute);
      const first = group[0]!;
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
        ...(wide ? { wide: true } : {}),
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
  "Past the Hour",
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
        group.wide ? "yes" : "",
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

export const countedTwiceCsvFilename = (day: string): string => `counted-twice-${day}.csv`;
