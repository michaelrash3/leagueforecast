/**
 * A game's rows as Team Rankings works them: the scores a club's schedule asked about or a person
 * typed, how far apart two start times are, the same game logged twice, and League Standings'
 * games filed with their pulled copies (`dedupeLeagueFixtures`).
 *
 * Split out of `games.ts`, which keeps what counts toward a rating and the league's copies League
 * Standings reads as it starts: only Team Rankings runs these, and the first download carried them.
 * `teamRankings.ts` re-exports this, as it does `games.ts`.
 */
import { isScoutGamePlayed, type ScoutGame } from "./types";
import { normalizeDateInput } from "../date";
import {
  LEAGUE_GAME_PREFIX,
  type LeagueRowReader,
  ratedMargin,
  samePage,
  slotCopiesOf,
} from "./games";

/**
 * A win by this many runs or more is put to the owner in Pool health, to delete, or to say it was
 * played that way: their word of 26 October 2026, "ask me about 30 and above". Below
 * `IMPLAUSIBLE_MARGIN` such a game still counts while it waits, as it did, since the owner vouched
 * for 76 of the 83 games won by 31 to 39 on the backup of 11 October; from that line it counts for
 * nothing until vouched for. From `LOPSIDED_MARGIN` (`autoRemoved.ts`) a club whose own schedule
 * reports one is taken off without asking (sign H).
 */
export const ASK_MARGIN = 30;

/**
 * A score put to the owner (`ASK_MARGIN`): won by that many runs or more as the rating reads a
 * margin, and not the very margin they vouched for, as `isImplausibleScore` reads it.
 */
export const isAskedScore = (game: ScoutGame): boolean => {
  const margin = ratedMargin(game);
  if (margin === undefined || Math.abs(margin) < ASK_MARGIN) return false;
  return game.scoreConfirmed !== margin;
};

export const scoreOf = (game: ScoutGame, teamId: string): number | undefined =>
  game.teamAId === teamId ? game.teamAScore : game.teamBScore;

/** A game with side B's own report taken off, for a score that now answers for both clubs. */
export const withoutReportedByB = (game: ScoutGame): ScoutGame => {
  if (game.reportedByB === undefined) return game;
  const { reportedByB: _dropped, ...rest } = game;
  return rest;
};

/**
 * A game with a score typed in by hand: the one answer for both clubs.
 *
 * Side B's report goes, and so does any mark that the score was another row's — the tidy takes such
 * a score off with its row (`bareRow`), which took the typed score with it. The record of each row
 * folded into the game is given the typed score from its club's seat, or the next tidy stands a
 * scored row up again with its old score — side B's beside this one, or side A's second listing as
 * a second game, since it no longer gave the same result — and a blank one would leave nothing of
 * the typed score once the game's own row goes (`withdrawn`) and the rows folded into it stand in
 * its place. The record keeps the row, so the regroup still finds it; the club's next pull brings
 * its schedule's score back in, as it does for any game.
 */
export const withScoreTyped = (
  game: ScoutGame,
  teamAScore: number,
  teamBScore: number
): ScoutGame => {
  const { scoreFromB: _borrowed, scoreFromTwin: _twin, ...rest } = withoutReportedByB(game);
  const alsoRows = game.alsoRows?.map((record) =>
    record.onSideB
      ? { ...record, ownScore: teamBScore, opponentScore: teamAScore }
      : { ...record, ownScore: teamAScore, opponentScore: teamBScore }
  );
  return { ...rest, teamAScore, teamBScore, ...(alsoRows ? { alsoRows } : {}) };
};

/**
 * The two scores somebody typed for a game, as whole runs, or null for anything else. An empty box
 * is no score: read as a number it was zero, and a Save pressed before typing recorded a 0–0 game.
 */
export const typedScores = (
  teamA: string,
  teamB: string
): { teamAScore: number; teamBScore: number } | null => {
  const run = (typed: string) => (/^\s*\d+\s*$/.test(typed) ? Number(typed) : null);
  const teamAScore = run(teamA);
  const teamBScore = run(teamB);
  return teamAScore === null || teamBScore === null ? null : { teamAScore, teamBScore };
};

const MINUTE_MS = 60_000;

/** A start as an instant, or undefined when there is none or it is not a time. */
const instantOf = (startTs: string | undefined): number | undefined => {
  if (startTs === undefined) return undefined;
  const at = Date.parse(startTs);
  return Number.isFinite(at) ? at : undefined;
};

/** Minutes between two starts; undefined when either is missing or is not a time. */
export const minutesApart = (a: string | undefined, b: string | undefined): number | undefined => {
  const x = instantOf(a);
  const y = instantOf(b);
  return x === undefined || y === undefined ? undefined : Math.abs(x - y) / MINUTE_MS;
};

/** A start rounded to its minute, so an index can be keyed on what `sameStart` compares. */
export const startMinuteOf = (startTs: string | undefined): number | undefined => {
  const at = instantOf(startTs);
  return at === undefined ? undefined : Math.round(at / MINUTE_MS);
};

/**
 * Whether two rows give the same start: the same minute, to the nearest.
 *
 * Read as instants rather than as equal strings. The pool of 24 September 2026 stores every start
 * in one spelling, but 1,013 of its rows start at an odd second or millisecond, and 54 pairs of rows
 * between the same two clubs on the same day were under a minute apart — 12 of them off one
 * schedule, which is one game listed twice however the strings compare. The nearest minute rather
 * than "under a minute apart" so that an index keyed on `startMinuteOf` finds exactly the pairs this
 * matches. A start that is not a time matches only its own spelling.
 */
export const sameStart = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  const x = startMinuteOf(a);
  const y = startMinuteOf(b);
  return x === undefined || y === undefined ? a === b : x === y;
};

/**
 * How far apart two clubs' schedules can put one game and still mean it.
 *
 * A start on a schedule is when the game was planned, not when it began: a tournament runs behind
 * and nobody moves the placeholder, so the two coaches' copies of one game drift apart. On the pool
 * of 24 September 2026, 1,213 pairs of rows off two schedules gave the same pair of clubs the same
 * result on the same day at different starts, and 1,115 of them were an hour apart or less; the
 * same search a week off, where no game is, found 7. A game runs longer than an hour, so two
 * starts within one of each other on two schedules are one game — inclusive, because the pair that
 * brought this to light, Legacy Baseball Club and River City Raptors, was exactly sixty minutes out.
 *
 * One club's own schedule is held to more. The same pool had 109 pairs of rows off one schedule,
 * against one opponent, exactly an hour apart with two different results — 23-6 and 12-2 — which
 * is a doubleheader written down at its slot times, so there the hour only counts where the two
 * rows give the same result. Of 212 such scored pairs within the hour, 34 did (16%); of 6,044 two
 * hours or more apart, which are doubleheaders, 81 did (1.3%). A repeated result that much more
 * often than doubleheaders produce one is the same game listed twice.
 */
export const ONE_GAME_WINDOW_MINUTES = 60;

export const startsWithinTheHour = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined) return false;
  const gap = minutesApart(a, b);
  return gap === undefined ? a === b : gap <= ONE_GAME_WINDOW_MINUTES;
};

/**
 * Finds an existing game that looks like the same game as `candidate` — same two teams (in either
 * order), same date, same score. That is the shape a double-entry takes, whether it came from
 * typing a game twice, importing a screenshot twice, or re-entering one the league schedule
 * already supplied. Two scoreless scheduled games on the same date count as a match too, since
 * "no score yet" is the same on both sides.
 */
/** The two sides of a game as one order-free key, so A-vs-B and B-vs-A compare equal. */
export const pairKeyOf = (game: ScoutGame): string =>
  [game.teamAId, game.teamBId].slice().sort().join("|");

export const findDuplicateGame = (candidate: ScoutGame, games: ScoutGame[]): ScoutGame | null => {
  const pairKey = pairKeyOf(candidate);
  const found = games.find((game) => {
    if (game.id === candidate.id) return false;
    if (game.ageGroupId !== candidate.ageGroupId) return false;
    if (pairKeyOf(game) !== pairKey) return false;
    if ((game.date ?? "") !== (candidate.date ?? "")) return false;
    return (
      scoreOf(game, candidate.teamAId) === candidate.teamAScore &&
      scoreOf(game, candidate.teamBId) === candidate.teamBScore
    );
  });
  return found ?? null;
};

/**
 * One fixture's identity: the rating pool (`poolOf` the game's page, the page itself unless the
 * caller says), the two sides in either order, and the calendar day.
 *
 * The day is what decides it. Two clubs that meet again in October are not playing the same game
 * over — that is a tournament meeting outside league play, and it has to stay a game of its own.
 * Dates run through `normalizeDateInput` because the two sources spell a day differently: the
 * league keeps month-and-day ("4/12") while a pulled game keeps an ISO date ("2027-04-12"), so a
 * raw string compare would never match the pair it is meant to catch.
 *
 * Returns "" for a game with no readable date, which callers read as "this one cannot be matched"
 * — better to leave a dateless game alone than to fold it into a fixture it may not belong to.
 */
const fixtureKeyOf = (
  game: ScoutGame,
  poolOf: (ageGroupId: string) => string = samePage
): string => {
  const day = normalizeDateInput(game.date ?? "");
  return day ? `${poolOf(game.ageGroupId)}|${pairKeyOf(game)}|${day}` : "";
};

/** The league game a stored row is a copy of, and which of the row's clubs stood for which team. */
type OffFixture = { key: string; as: ReadonlyMap<string, string> };

/**
 * For a stored row, the league game it is a copy of when that game is against a team a person said
 * is not in Team Rankings, and which club in the row stood for that team; null otherwise.
 *
 * The league's row names the club made for that team (`offClubIdFor`), which no schedule and no
 * name lookup ever reaches, so every other copy of the game names some other club of the team's
 * name: a stand-in the import made for it, a pulled club the import filed it against, or a club
 * typed in by hand. Such a row is the league's game when one of its clubs played the team in the
 * league that day, in the same rating pool, and its other club could be what that schedule called
 * the team; or, for a league game between two such teams, when each of its clubs could be what it
 * was called by one of the two. With only one league game it could be, it is then filed under that
 * game's fixture, where the rules for any copy of a league game decide which survives, whatever
 * the two say the score was and whether or not either is scored yet. Carried by the name before,
 * the league's row named the clubs those copies named, and was matched by its pair of clubs.
 */
const offFixturesOf = (
  games: readonly ScoutGame[],
  poolOf: (ageGroupId: string) => string,
  roster: LeagueRowReader | undefined
): ((game: ScoutGame) => OffFixture | null) => {
  const isOff = roster?.isOffClub;
  const namesake = roster?.namesakeOf;
  if (!isOff || !namesake) return () => null;
  /** The teams each club played in the league, by pool and day. */
  const offsOn = new Map<string, string[]>();
  const clubs = new Set<string>();
  /** The league's games between two such teams, by pool and day, and the days they fall on. */
  const pairsOn = new Map<string, Array<readonly [string, string]>>();
  const pairDays = new Set<string>();
  games.forEach((game) => {
    if (!game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    const offA = isOff(game.teamAId);
    const offB = isOff(game.teamBId);
    if (!offA && !offB) return;
    const day = normalizeDateInput(game.date ?? "");
    if (!day) return;
    const pool = poolOf(game.ageGroupId);
    if (offA && offB) {
      const key = `${pool}\u0000${day}`;
      const pairs = pairsOn.get(key);
      if (!pairs) pairsOn.set(key, [[game.teamAId, game.teamBId]]);
      else pairs.push([game.teamAId, game.teamBId]);
      pairDays.add(day);
      return;
    }
    const [off, club] = offA ? [game.teamAId, game.teamBId] : [game.teamBId, game.teamAId];
    clubs.add(club);
    const key = `${pool}\u0000${club}\u0000${day}`;
    const offs = offsOn.get(key);
    if (!offs) offsOn.set(key, [off]);
    else if (!offs.includes(off)) offs.push(off);
  });
  if (clubs.size === 0 && pairsOn.size === 0) return () => null;
  /**
   * Days as the rows write them, each read once: a pool's rows name a few hundred days between a
   * quarter of a million of them, so a row of no such game costs a lookup, not a reading.
   */
  const days = new Map<string, string>();
  const dayOf = (written: string): string => {
    let day = days.get(written);
    if (day === undefined) {
      day = normalizeDateInput(written);
      days.set(written, day);
    }
    return day;
  };
  return (game) => {
    // The clubs first, then the day: nearly every row is between clubs that played no such team,
    // on a day with no league game between two of them, and only a row on such a day has its
    // clubs' names compared with the teams'.
    const byClub = clubs.has(game.teamAId) || clubs.has(game.teamBId);
    if (!byClub && pairsOn.size === 0) return null;
    const day = dayOf(game.date ?? "");
    if (!day || (!byClub && !pairDays.has(day))) return null;
    const pool = poolOf(game.ageGroupId);
    const pairs = pairsOn.get(`${pool}\u0000${day}`);
    const keyOf = (a: string, b: string) => `${pool}|${[a, b].sort().join("|")}|${day}`;
    /** Each league game the row could be, with which of its clubs stood for which such team. */
    const fits = new Map<string, Map<string, string>>();
    if (byClub) {
      (
        [
          [game.teamAId, game.teamBId],
          [game.teamBId, game.teamAId],
        ] as const
      ).forEach(([club, side]) => {
        (offsOn.get(`${pool}\u0000${club}\u0000${day}`) ?? []).forEach((off) => {
          if (namesake(side, off)) fits.set(keyOf(club, off), new Map([[side, off]]));
        });
      });
    }
    if (pairs) {
      pairs.forEach(([a, b]) => {
        const { teamAId: x, teamBId: y } = game;
        if (namesake(x, a) && namesake(y, b)) {
          fits.set(
            keyOf(a, b),
            new Map([
              [x, a],
              [y, b],
            ])
          );
        } else if (namesake(x, b) && namesake(y, a)) {
          fits.set(
            keyOf(a, b),
            new Map([
              [x, b],
              [y, a],
            ])
          );
        }
      });
    }
    if (fits.size !== 1) return null;
    const [key, as] = [...fits][0]!;
    return { key, as };
  };
};

/**
 * A game's two scores in the order of its clubs' ids, each club a copy stood in for read as the one
 * it stood for (`as`), or "" for a game not scored. A fixture's rows all name the same two clubs,
 * either way round, so a copy filed from the other seat reads as the league's row does, and who won
 * stays in it: read lower score first, a doubleheader won 5-1 and lost 1-5 was one score twice, and
 * the one game's copy gave both games its start.
 */
const scoreByClubs = (game: ScoutGame, as?: ReadonlyMap<string, string>): string => {
  const { teamAScore: a, teamBScore: b } = game;
  if (a === undefined || b === undefined) return "";
  const sideA = as?.get(game.teamAId) ?? game.teamAId;
  const sideB = as?.get(game.teamBId) ?? game.teamBId;
  return sideA <= sideB ? `${a}-${b}` : `${b}-${a}`;
};

/**
 * Collapses a league-derived game and the stored game that is the same real fixture down to one
 * row.
 *
 * Team Rankings pools two sources: `deriveLeagueScoutGames` rebuilds a row for every League
 * Standings matchup on every render, and a GameChanger pull stores rows of its own. A club that
 * pulls the schedule of a team playing in a league it also tracks here ends up holding the same
 * real fixture twice, and once it goes final both copies carry a score — so the rating fits it
 * twice and the record counts the win twice. Filling in a league game from a pull is wanted;
 * adding a second league game is not.
 *
 * Which copy survives follows from which one is actually evidence:
 *  - Every league row for the fixture already scored: the league's own book is authoritative for
 *    its own games, so the league rows stay and the stored duplicates go.
 *  - Otherwise the stored row carries the only result anyone has, so it stays and the league row
 *    it stands in for — an unscored one first, since that is the row with nothing in it — goes.
 *    League rows beyond the number of stored rows stay put, so a fixture nobody has a result for
 *    still shows up as scheduled.
 *
 * Only a league row triggers any of this. Two stored games between the same pair on the same day
 * with no league row are a doubleheader somebody logged twice on purpose, and both are kept; a
 * doubleheader that the league *does* carry is resolved by count rather than by guessing which
 * stored row pairs with which league row, because nothing in either source says.
 */
export const dedupeLeagueFixtures = (
  games: ScoutGame[],
  /**
   * What the roster says about a stored row, for pairing a club's own row filed against nobody with
   * the league's copy (`LeagueRowReader`). Given by the caller, which holds the roster this module
   * does not. Without it only rows naming the same two clubs are compared, as before.
   */
  roster?: LeagueRowReader
): ScoutGame[] => {
  /*
   * Only a stored row between two clubs a league row names can share a fixture with one, so only
   * those are keyed. Keying reads the date, and every row of the pool used to be keyed, twice on
   * every open: a quarter of a million rows on the 18:40 pool, for a league of a few dozen games.
   * Measured there, the pass went from about 800 ms to 140 ms and dropped the same rows.
   */
  const leagueClubs = new Set<string>();
  games.forEach((game) => {
    if (!game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    leagueClubs.add(game.teamAId);
    leagueClubs.add(game.teamBId);
  });
  // No league row, nothing to collapse into: the pass below pairs only with a league row too.
  if (leagueClubs.size === 0) return games;

  // Indexed in a single pass rather than scanned per game: this runs on every render over a pool
  // that can hold tens of thousands of rows, and comparing each game against all the others would
  // not survive that.
  const poolOf = roster?.poolOf ?? samePage;
  const byFixture = new Map<string, { league: number[]; stored: number[] }>();
  const file = (key: string, game: ScoutGame, index: number) => {
    let bucket = byFixture.get(key);
    if (!bucket) {
      bucket = { league: [], stored: [] };
      byFixture.set(key, bucket);
    }
    (game.id.startsWith(LEAGUE_GAME_PREFIX) ? bucket.league : bucket.stored).push(index);
  };
  // The league's rows first, so a stored row between two of its clubs is filed with their own
  // fixture where there is one, before anything else is asked of it.
  games.forEach((game, index) => {
    if (!game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    const key = fixtureKeyOf(game, poolOf);
    if (key) file(key, game, index);
  });
  const offFixture = offFixturesOf(games, poolOf, roster);
  /** Rows filed with a league game against such a team, and the clubs in them that stood for it. */
  const standsFor = new Map<number, ReadonlyMap<string, string>>();
  games.forEach((game, index) => {
    if (game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    const own =
      leagueClubs.has(game.teamAId) && leagueClubs.has(game.teamBId)
        ? fixtureKeyOf(game, poolOf)
        : "";
    if (own && byFixture.get(own)?.league.length) {
      file(own, game, index);
      return;
    }
    // A copy of a game against a team said not to be in Team Rankings names some club of the
    // team's name, never the club made for it, so it is filed under the league's own fixture.
    const off = offFixture(game);
    if (off) {
      file(off.key, game, index);
      standsFor.set(index, off.as);
    } else if (own) file(own, game, index);
  });

  const dropped = new Set<number>();
  /*
   * The starts each league row kept in place of dropped copies is offered by them, by the row's
   * index and each start's minute. A row takes one where it has none of its own and every offer
   * gives the same minute. Dropped with the copy, the start left the league's game untimed, and a
   * club's list read the day's games in stored order.
   */
  const offered = new Map<number, Map<number, string>>();
  const offer = (index: number, copy: ScoutGame) => {
    const minute = startMinuteOf(copy.startTs);
    if (minute === undefined || games[index]!.startTs !== undefined) return;
    const minutes = offered.get(index) ?? new Map<number, string>();
    if (!minutes.has(minute)) minutes.set(minute, copy.startTs!);
    offered.set(index, minutes);
  };
  byFixture.forEach(({ league, stored }) => {
    // A fixture only one source knows about is not a duplicate of anything.
    if (league.length === 0 || stored.length === 0) return;

    if (league.every((index) => isScoutGamePlayed(games[index]!))) {
      stored.forEach((index) => dropped.add(index));
      /*
       * Each league row is offered the starts of the copies giving its score, where no other league
       * game of the fixture has that score. A doubleheader the league typed with no starts keeps
       * each game's from its own copy; two games of one score are not told apart by it, with one
       * game's copy in the pool or both, which is which being no guess to make.
       */
      const scores = league.map((index) => scoreByClubs(games[index]!));
      league.forEach((index, at) => {
        const score = scores[at];
        if (!score || scores.indexOf(score) !== scores.lastIndexOf(score)) return;
        stored.forEach((copy) => {
          if (scoreByClubs(games[copy]!, standsFor.get(copy)) === score) offer(index, games[copy]!);
        });
      });
      return;
    }

    // Unscored league rows are the ones the stored rows are standing in for, so they go first.
    const emptiestFirst = league
      .slice()
      .sort((a, b) => Number(isScoutGamePlayed(games[a]!)) - Number(isScoutGamePlayed(games[b]!)));
    emptiestFirst.slice(0, stored.length).forEach((index) => dropped.add(index));
  });

  if (roster) {
    // A copy filed against a slot has the schedule's time, which the slot's name spells out, and
    // offers it to the league's game it is a copy of as a copy by fixture does.
    slotCopiesOf(games, roster, dropped).forEach((rows, index) => {
      dropped.add(index);
      rows.forEach((row) => offer(row, games[index]!));
    });
  }
  /** Starts given to league rows kept, by index, from the copies dropped in their place. */
  const startsGiven = new Map<number, string>();
  offered.forEach((minutes, index) => {
    if (minutes.size === 1) startsGiven.set(index, [...minutes.values()][0]!);
  });

  // The common case is a pool with nothing to collapse; hand back the same array so callers that
  // memoize on identity are not re-run for a list that did not change.
  // A row that stands for the league's game against such a team, where the league has not the
  // score and the row is kept in its place, is that team's game: it names the club made for the
  // team, not the club of its name the person said it is not, whatever score it carries.
  if (dropped.size === 0) return games;
  return games.flatMap((game, index) => {
    if (dropped.has(index)) return [];
    const startTs = startsGiven.get(index);
    if (startTs) return [{ ...game, startTs }];
    const as = standsFor.get(index);
    if (!as) return [game];
    return [
      {
        ...game,
        teamAId: as.get(game.teamAId) ?? game.teamAId,
        teamBId: as.get(game.teamBId) ?? game.teamBId,
      },
    ];
  });
};
