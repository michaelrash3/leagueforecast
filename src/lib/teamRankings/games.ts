/**
 * When two rows are the same game.
 *
 * The pool collects the same fixture from several directions: both clubs' GameChanger schedules,
 * a pasted list, and the league's own results copied across. They arrive with different ids,
 * sometimes different dates, and one side often has the score while the other does not — so "the
 * same game" has to be decided on what the rows say rather than on anything either of them
 * carries as an identifier.
 *
 * Split out of `teamRankings.ts` because this is a closed question over a list of games and
 * nothing else in the pool: no ratings, no age arithmetic, no roster. `teamRankings.ts`
 * re-exports it, so no caller changed.
 *
 * What counts toward a rating, and which of a league's own games a pulled row is a copy of, are
 * read as League Standings starts; the rest, the scores a schedule asked about or a person typed,
 * the start times, the same game logged twice and the league's games filed with their copies, is a
 * module of its own (`gameRows.ts`), which `teamRankings.ts` re-exports too: in this one, the first
 * download carried all of it.
 */
import { normalizeDateInput, todayIsoDay } from "../date";
import { isDatedAhead } from "../deletedGames";
import { isScoutGamePlayed, type ScoutGame } from "./types";

/**
 * The id prefix a game derived from a League Standings fixture carries.
 *
 * Here because it is how a row says where it came from, which is the question this module exists
 * to answer: a league-derived row and a pulled row can describe the same fixture, and which one
 * survives a collapse depends on knowing which is which.
 */
export const LEAGUE_GAME_PREFIX = "league_";

/**
 * A game with the one club on both sides: a row a club's own schedule lists against its own name,
 * which is a scrimmage of its own squad or a namesake the import could not tell from it. Either way
 * it says nothing about the club against anyone else, and counted it was worse than nothing: read
 * from both seats, one 6-4 was two wins and two games. On the pool of 26 September 2026, 160 rows
 * were filed so, every one off the club's own schedule, and 55 scored in the squad year on 37
 * clubs. Of the 35 of those with one GameChanger link and its record, counting each twice matched
 * GameChanger's own record for none; counted once it matched 9, and left out 14, and left out was
 * the nearer for 21 clubs against 13. So it is left out — kept, and listed, but not counted.
 */
export const playsItself = (game: ScoutGame): boolean => game.teamAId === game.teamBId;

/**
 * A win by this many runs or more is not believed: the score is suspected of being made up
 * (`isImplausibleScore`). The pool of 26 September held 144 games won by more than thirty among
 * 149,809 scored, 19 of them by more than 100 runs and one by 9,999. Only the rating cap, then 8,
 * held them to an 8-run win each; uncapped, one of them put a club with no other result at the top
 * of the 9U board. Forty is the user's line, "a 40 or more run lead", of 21 October 2026, the same
 * line their sign A of an invented club was moved to on 11 October; it was thirty before, past
 * which the user had vouched for 76 of the 83 games won by 31 to 39 on the backup of 11 October.
 * It has to stay past `RATING_CAP` too, or a win by the cap would be a score nobody believes and
 * the what-if's top rung would not count.
 */
export const IMPLAUSIBLE_MARGIN = 40;

/**
 * A score suspected of being made up: won by `IMPLAUSIBLE_MARGIN` runs or more, read as the rating
 * reads a margin (`ratedMargin`), and not the very margin the user vouched for (`scoreConfirmed`).
 * A vouched-for 41-0 corrected or re-pulled as 9,999-0 is suspect again. It counts toward nothing
 * (`countsTowardRating`) and Pool Health lists it, to be deleted or vouched for.
 */
export const isImplausibleScore = (game: ScoutGame): boolean => {
  const margin = ratedMargin(game);
  if (margin === undefined || Math.abs(margin) < IMPLAUSIBLE_MARGIN) return false;
  return game.scoreConfirmed !== margin;
};

/**
 * Whether a game feeds the ratings and records: it has to have been played, not be one of the
 * cross-age tournament games kept only for the record, not be dated in a day that has not
 * happened yet, and not carry a score suspected of being made up (`isImplausibleScore`). Every ranking calculation goes through this, so there is one answer to the
 * question rather than four filters that can drift apart.
 *
 * The date is here because "played" used to mean nothing more than "both scores are numbers", and
 * a pull brings back rows that carry a score on a date still to come — a schedule somebody filled
 * in ahead, or a club that exists only on paper. You cannot score a game early; this is sports. A
 * single 20-0 dated eight months out was enough to take a club's rating from 0.29 to 2.61, and it
 * went on doing that until somebody noticed it in Pool Health and deleted it. Now it never counts,
 * and Pool Health still lists it so it can be cleared out for good.
 *
 * Nor does a game a club plays against itself (`playsItself`), nor a third copy of a game that
 * already counts (`ScoutGame.countedElsewhere`).
 *
 * `today` defaults to the clock, which is what makes the rule hold at every call site rather than
 * at the few that remember to ask. It is an ISO day, the shape a pool game's date is stored in, so
 * the two compare as strings; tests pass their own.
 */
export const countsTowardRating = (game: ScoutGame, today: string = todayIsoDay()): boolean =>
  isScoutGamePlayed(game) &&
  game.excluded !== true &&
  game.countedElsewhere !== true &&
  !playsItself(game) &&
  !isDatedAhead(game, today) &&
  !isImplausibleScore(game);

/**
 * The score one side's own schedule gave it — its runs, then its opponent's — or undefined for a
 * game not played. Side B reads `reportedByB` where its schedule said something different, so
 * neither club's page shows the other's version of its own game.
 */
export const scoreSeenBy = (
  game: ScoutGame,
  teamId: string
): { own: number; opponent: number } | undefined => {
  if (game.teamAScore === undefined || game.teamBScore === undefined) return undefined;
  if (game.teamAId === teamId) return { own: game.teamAScore, opponent: game.teamBScore };
  const seen = game.reportedByB ?? game;
  return { own: seen.teamBScore!, opponent: seen.teamAScore! };
};

/**
 * Side A's margin as the rating reads it: the one score, or where the two clubs' schedules
 * disagree, the average of the two — the game counts once, and neither schedule is taken at its
 * word over the other. Undefined for a game not played.
 */
export const ratedMargin = (game: ScoutGame): number | undefined => {
  if (game.teamAScore === undefined || game.teamBScore === undefined) return undefined;
  const margin = game.teamAScore - game.teamBScore;
  const other = game.reportedByB;
  return other ? (margin + other.teamAScore - other.teamBScore) / 2 : margin;
};

/** Each page its own pool: how the league's rows were matched before the squad year was. */
export const samePage = (ageGroupId: string): string => ageGroupId;

/**
 * What `dedupeLeagueFixtures` asks of the roster to pair a club's own row, filed against nobody the
 * league names, with the league's copy of the game.
 */
export type LeagueRowReader = {
  /** Whether a side could be the league's opponent under no name of its own. */
  standsInFor: (sideId: string, opponentId: string) => boolean;
  /** Whether a stored row is the club's own, pulled from one of its GameChanger schedules. */
  pulledBy: (game: ScoutGame, clubId: string) => boolean;
  /**
   * The rating pool a page is in, its squad year, where a league game and a club's own copy of it
   * are looked for. The rating is fitted over the whole year, and a club GameChanger lists at
   * another age files its copy on that age's page: the Cincinnati Hornets' fall team is listed at
   * 8U, and its rows of the league's 9U games sat on the 8U page, never matched. The page itself
   * where it is not given.
   */
  poolOf?: (ageGroupId: string) => string;
  /**
   * Whether a club is one made for a league team a person said is not in Team Rankings
   * (`offClubIdFor`), and whether another club could be what a schedule called that team: any
   * club whose name fits the team's, pulled or not, since none of them is the team. Left out, no
   * row is read as such a team's.
   */
  isOffClub?: (clubId: string) => boolean;
  namesakeOf?: (sideId: string, offClubId: string) => boolean;
};

/**
 * A club's own copy of a league game, filed against nobody the league names.
 *
 * A GameChanger schedule that was never told the opponent files the game against a slot — "TBD-
 * 09/25/26, 7:15 PM" — or against a club known only by another spelling of the opponent's name. It
 * never shares the league row's pair of clubs, so the pass by fixture cannot see it, and when the
 * other club's own copy is not in the pool either, nothing else collapses it: 513 Force - Bouley's
 * 0-13 against the Cincinnati Hornets on 25 September came out as two losses, one to the Hornets
 * and one to "TBD".
 *
 * With no opponent to compare, the rest of the game decides it: the same club, the same page and
 * day, and the same score from that club's side. Only the club's own row takes part, pulled from
 * one of its GameChanger schedules: a game somebody typed in against "TBD" is a claim of its own,
 * not a schedule that was never told the opponent. Only a scored league row takes part, since an
 * unscored one counts for nothing and leaves nothing to count twice, and only a pairing that is the
 * only one either way — one league game of the club's that day that fits, and one row that fits it
 * — so a day with two games of one score is left as it is. The league row stays: it names the
 * opponent the slot does not.
 *
 * Returns the stored rows it pairs, by index, and reads none of the ones in `skip`. Exported for the
 * league's own forecast, which leaves the same rows out of the outside results it reads
 * (`leagueScoutBridge`), so the two halves of the app pair the same rows.
 */
export const leagueCopiesFiledAgainstNobody = (
  games: readonly ScoutGame[],
  roster: LeagueRowReader,
  skip: ReadonlySet<number> = new Set()
): Set<number> => new Set(slotCopiesOf(games, roster, skip).keys());

/**
 * `leagueCopiesFiledAgainstNobody`'s pairing, each stored row it pairs by index to the league rows
 * it is a copy of: the one league game, as read off each page of its pool that claims its season.
 * The collapse gives those rows the copy's start (`dedupeLeagueFixtures`).
 */
export const slotCopiesOf = (
  games: readonly ScoutGame[],
  roster: LeagueRowReader,
  skip: ReadonlySet<number>
): Map<number, number[]> => {
  const paired = new Map<number, number[]>();
  const poolOf = roster.poolOf ?? samePage;
  const clubDay = (ageGroupId: string, clubId: string, day: string) =>
    `${poolOf(ageGroupId)}|${clubId}|${day}`;
  const leagueByClubDay = new Map<string, number[]>();
  const leagueClubs = new Set<string>();
  games.forEach((game, index) => {
    if (!game.id.startsWith(LEAGUE_GAME_PREFIX) || !isScoutGamePlayed(game)) return;
    const day = normalizeDateInput(game.date ?? "");
    if (!day) return;
    [game.teamAId, game.teamBId].forEach((clubId) => {
      leagueClubs.add(clubId);
      const key = clubDay(game.ageGroupId, clubId, day);
      const bucket = leagueByClubDay.get(key);
      if (bucket) bucket.push(index);
      else leagueByClubDay.set(key, [index]);
    });
  });
  if (leagueByClubDay.size === 0) return paired;

  /**
   * A league row and one of its two clubs, to the stored rows of that club's that fit it and nothing
   * else. Per club, because each club's own schedule holds its own copy of the game: the Hornets'
   * row against "513 Force" and 513 Force's against "TBD" are both copies of one league game, where
   * two rows of 513 Force's that fit it are two games of one score and neither is taken.
   */
  const rowsFor = new Map<string, number[]>();
  /** The league rows each fit is, by index: one, or the one game on each page of its pool. */
  const leagueOf = new Map<string, Set<number>>();
  games.forEach((game, index) => {
    if (skip.has(index) || game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    // Read before the date, which is the costly part: nearly every row in a nationwide pool is
    // between clubs no league here has, and a nationwide pool is a quarter of a million rows.
    if (!leagueClubs.has(game.teamAId) && !leagueClubs.has(game.teamBId)) return;
    if (!isScoutGamePlayed(game)) return;
    const day = normalizeDateInput(game.date ?? "");
    if (!day) return;
    // By the league row's id, which a fixture keeps on every page that claims its season: one
    // game read off two pages of a year is still the one fit. And by the year: a season pages of two
    // years claim is dated into each, and one year's copy and the other's in one bucket paired
    // neither.
    const fits = new Set<string>();
    (
      [
        [game.teamAId, game.teamBId],
        [game.teamBId, game.teamAId],
      ] as const
    ).forEach(([clubId, sideId]) => {
      if (!roster.pulledBy(game, clubId)) return;
      const seen = scoreSeenBy(game, clubId);
      if (!seen) return;
      (leagueByClubDay.get(clubDay(game.ageGroupId, clubId, day)) ?? []).forEach((leagueIndex) => {
        const league = games[leagueIndex]!;
        const opponentId = league.teamAId === clubId ? league.teamBId : league.teamAId;
        // The same two clubs are the pass by fixture's to settle, not this one's.
        if (opponentId === sideId) return;
        const result = scoreSeenBy(league, clubId);
        if (!result || result.own !== seen.own || result.opponent !== seen.opponent) return;
        if (roster.standsInFor(sideId, opponentId)) {
          const fit = `${poolOf(league.ageGroupId)}|${league.id}|${clubId}`;
          fits.add(fit);
          const rows = leagueOf.get(fit);
          if (rows) rows.add(leagueIndex);
          else leagueOf.set(fit, new Set([leagueIndex]));
        }
      });
    });
    if (fits.size !== 1) return;
    const [fit] = fits;
    const bucket = rowsFor.get(fit!);
    if (bucket) bucket.push(index);
    else rowsFor.set(fit!, [index]);
  });
  rowsFor.forEach((rows, fit) => {
    if (rows.length === 1) paired.set(rows[0]!, [...(leagueOf.get(fit) ?? [])]);
  });
  return paired;
};
