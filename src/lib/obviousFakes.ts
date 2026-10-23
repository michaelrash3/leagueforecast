import { isDatedAhead } from "./deletedGames";
import { madeUpHit } from "./teamNameRules";
import { isImplausibleScore, ratedMargin, scoreSeenBy } from "./teamRankings/games";
import { segmentOn, squadYearForGcSeason, SEASON_SEGMENT_ORDER } from "./teamRankings/seasons";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "./teamRankings/types";
import { clubsByGcId, filedBy } from "./unrealClubs";
import {
  ABSURD_MARGIN,
  AUTO_SIGNS,
  HUNDRED_MARGIN,
  ROUT_MARGIN,
  type AutoRemoval,
  type AutoRemovals,
  type AutoSign,
  type CountedWin,
} from "./autoRemoved";

/**
 * The clubs plainly made up, found each night so the user does not have to: the user asked on 11
 * October 2026 for the obviously fake teams to be spotted and removed without them, and for teams
 * named void, test or demo to be among them. What is found is marked (`autoRemoved.ts`), never
 * deleted, and the boards leave a marked club out.
 *
 * A pulled club is marked when it shows one of four signs and nothing keeps it.
 *
 * - A: two or more wins by `ROUT_MARGIN` runs or more that nobody has vouched for, filed by its
 *   own schedule, none of its wins by that much listed by the losing club's own schedule, at any
 *   age. The line is the user's of 11 October 2026, "repeated wins by 40 or more instead of 30".
 *   At thirty the sign waited for 11U unless one of the wins was by fifty, since a young travel
 *   team routs stand-ins: three clubs of 8U to 10U the user called real were one such win from it
 *   on 11 October. At forty that wait changes no mark on the five backups of 25 September to 11
 *   October 2026, sweeping each from no marks, and with the word "real" set aside the sweep takes
 *   none of the 131 clubs the user had called real by 11 October, 72 of them 10U and under, so it
 *   is gone.
 * - B: one such win by `ABSURD_MARGIN` or more that the loser's own schedule does not list. On 11
 *   October 2026 no game both clubs' schedules list, and none of the 77 scores the user vouched
 *   for, reaches fifty (the widest of each is 42.5). It was not always so: on 29 September one
 *   game both list read 54.5, and on 26 September, before the user's own sweep of 28 September,
 *   three reached fifty, the widest 119. A listed game is never a sign, whatever its margin.
 * - C: it has `AHEAD_FEWEST_PLAYED` scored games or more, half or more of them its own schedule's
 *   results dated `FAR_AHEAD_DAYS` or more ahead, no opponent's schedule lists any of its results
 *   dated ahead, and no real opponent's schedule lists any game of it at all. Nobody scores a game
 *   before it is played; the floor keeps out a game keyed a day or two off. The fewest games are
 *   the user's word of 11 October 2026: it "can't be a situation where they only have 2 games
 *   listed and one of them is in the future". On the five backups they leave C two clubs on each
 *   of 25 and 26 September, each with two of its three scores dated weeks ahead, and take from it
 *   next season's squads with fewer than three scores, the only clubs it marked on 29 September
 *   (two) and 11 October (one). The last clause is what lets the lift below hold: without it a club
 *   whose mark one real game lifted showed the sign again the same night, short of the guard's
 *   three or half, and was marked afresh on that day, which the next real game, dated before it,
 *   could never lift. Measured on the five backups, it changes no mark.
 * - N: its name, or the name of a GameChanger team filed under it, has void, test or demo as a word
 *   of its own, in any case ("Contest" and "Demons" are not), read by the import's own rules for
 *   those words (`madeUpHit`, `teamNameRules.ts`): so "voided", "testing", "do not use" and "DNU"
 *   too, and a word run into another, but not the Austin organisation called TEST,
 *   whose squads are "TEST Black" and "TEST Red", nor Skiles Test or a test-prep sponsor: on the
 *   backup of 11 October 2026 that reads 300 pulled clubs where the sign's own pattern read 249,
 *   the 10 it no longer reads all that organisation's (`madeUpHit`). Marked per
 *   GameChanger id: when only one of its teams has the word and the club's own name does not,
 *   only that one, so the club stands unless every one of its ids is marked.
 * - H: its own schedule reports a game won by `HUNDRED_MARGIN` or more that nobody has vouched
 *   for, whichever side it was on: the owner's rule of 21 October 2026, that a team reporting a
 *   game like that is to go, on its own. Like N it is no matter what real opponents list of it,
 *   since no witness makes such a score a game; the owner's own word on the club still keeps it.
 *   Measured from no marks: on the pool of 26 September 2026 as today's tidy leaves it, before the
 *   user's own sweep of the 28th, 24 games reached 100 (the widest 9,999) and H marks the 19 clubs whose schedules scored
 *   them, 5 of them showing no other sign; on 11 October the widest game is 54, so it takes none.
 *
 * Measured with this code against what the user did by hand, sweeping each backup from no marks.
 * On the pool of 26 September 2026 at 18:40, before the user's own sweep of 28 September, A, B and
 * C take off 21 clubs (9 by A, 16 by B, 2 by C, some by two), every one of which the user had
 * deleted by 11 October, and N 84 more. On 29 September and 11 October A, B and C take off none,
 * and N 86 and 249, eight of the 249 only through a GameChanger team's name. On none of the five
 * backups of 25 September to 11 October do A, B, C and N take a club the user said was real by 11
 * October (131 such clubs pulled then), even with that word set aside, nor does H on the two it
 * was measured on, 26 September and 11 October.
 *
 * What keeps a club with a sign:
 * - any of its GameChanger ids, or its club id, said to be real (`realClubs`);
 * - being any page's own team;
 * - the user's word on it: a pair kept apart, an age named, or a score vouched for in a game of it;
 * - for A, B and C, not N or H: real opponents' own schedules listing `PLAINLY_REAL_GAMES` of its
 *   scored games, or at least half of them (one at least). A real opponent is a pulled club that
 *   shows no sign of its own (C read without its clause about real opponents, which would make
 *   the question ask itself). A mark does not make a club no witness: a mark stays after its sign
 *   has gone, and two clubs marked for their stray scores, playing each other in the spring,
 *   would otherwise keep each other off the boards for good;
 * - a League Standings team linked to it, which only the derivation that reads League Standings
 *   can tell (`deriveAllKnown`), so it is applied there, whatever the marks say.
 *
 * A mark stays until something lifts it, so a club whose results dated ahead have since been
 * reached is not put back for that. Any guard lifts every mark it would have kept from being
 * made. A and B lift too on the sign's own escape: A once a losing club's own schedule lists one
 * of the wins counted, or any win of the club's by `ROUT_MARGIN` or more (the clause A itself
 * reads); B once a losing club's schedule lists the win counted, or once every win of the club's
 * by `ABSURD_MARGIN` or more is one its loser lists. Not by the counted game's id alone: a game the
 * loser's schedule comes to list can be filed or collapsed under another id, which happened to 9
 * of the 97 one-sided games between pulled clubs that both schedules came to list between 29
 * September and 11 October 2026. C lifts once a real opponent's schedule lists even one game of
 * the club's dated after the day it was marked: the shape C finds is a club whose scores are
 * mostly of games still to be played, and a season of real games is the answer to it; such a club
 * no longer shows C, so it stays lifted. N lifts once neither the club's name nor the GameChanger
 * team's has the word, and H once no game its own schedule scored is won by `HUNDRED_MARGIN` or
 * more unvouched: the game deleted or rescored. No witness lifts H, as none keeps it from being made.
 */

/** A result dated this many days or more ahead is no game keyed a day or two off. */
export const FAR_AHEAD_DAYS = 8;
/** The fewest scored games C reads its share of: two are too few, in the user's word. */
export const AHEAD_FEWEST_PLAYED = 3;
/** Games real opponents' schedules list that make a club plainly real, whatever its share. */
export const PLAINLY_REAL_GAMES = 3;

/**
 * The word a team plays under nowhere that a name has, as the name writes it but lower case, or
 * undefined: the user's list of void, test and demo, read by the import's rules for them.
 */
export const madeUpWord = (name: string | undefined): string | undefined =>
  madeUpHit(name)?.text.toLowerCase();

export type SweepPool = {
  teams: readonly ScoutTeam[];
  games: readonly ScoutGame[];
  ageGroups: readonly AgeGroup[];
};

/** The user's answers the sweep honours, as stored. */
export type SweepAnswers = {
  realClubs: ReadonlySet<string>;
  /** Pairs of GameChanger ids kept apart (`apartKey`). */
  keptApart: ReadonlySet<string>;
  /** Ages named, by GameChanger id. */
  namedAges: ReadonlyMap<string, unknown>;
};

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const daysAfter = (date: string, today: string) =>
  Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);

const isPlayed = (game: ScoutGame) =>
  game.teamAScore !== undefined && game.teamBScore !== undefined;

/**
 * The clubs whose own GameChanger schedules list a game: the one it was pulled off, every
 * schedule's row folded into it, every schedule on record as listing it, and side B where its own
 * report is kept.
 */
const listersOf = (game: ScoutGame, clubOfGcId: ReadonlyMap<string, string>): Set<string> => {
  const listers = new Set<string>();
  const add = (gcId: string | undefined) => {
    const clubId = gcId === undefined ? undefined : clubOfGcId.get(gcId);
    if (clubId !== undefined) listers.add(clubId);
  };
  add(game.source?.teamId);
  game.alsoRows?.forEach((record) => add(record.teamId));
  game.alsoFrom?.forEach(add);
  if (game.reportedByB) listers.add(game.teamBId);
  return listers;
};

/**
 * The sides whose own schedules reported a game's score, as `filedBy` reads them, but never both
 * sides for want of a schedule: a game nothing traces to a pulled club's schedule (typed in by
 * hand, or off a club since gone) is reported by nobody here, and H takes nobody off for it.
 */
const scoredBy = (game: ScoutGame, clubOfGcId: ReadonlyMap<string, string>): Set<string> => {
  const kept = new Set((game.alsoRows ?? []).map((record) => record.teamId));
  const schedules = [
    ...(game.source && !game.scoreFromB ? [game.source.teamId] : []),
    ...(game.alsoRows ?? [])
      .filter((record) => record.ownScore !== undefined)
      .map((record) => record.teamId),
    ...(game.alsoFrom ?? []).filter((schedule) => !kept.has(schedule)),
  ];
  const sides = new Set<string>();
  schedules.forEach((schedule) => {
    const club = clubOfGcId.get(schedule);
    if (club === game.teamAId || club === game.teamBId) sides.add(club);
  });
  if (game.reportedByB) sides.add(game.teamBId);
  return sides;
};

/** What a club's games say of it, walked once. */
type Tally = {
  played: number;
  /**
   * Its unvouched wins by `ROUT_MARGIN` or more filed by its own schedule that the loser's does not
   * list.
   */
  unlisted: CountedWin[];
  /** Its wins by `ROUT_MARGIN` or more, as its schedule reads them, that the loser's lists. */
  routsListed: number;
  /** Those of them by `ABSURD_MARGIN` or more. */
  absurdListed: number;
  /**
   * Its own results dated ahead, those an opponent lists, those `FAR_AHEAD_DAYS` or more ahead, and
   * the first day of those far ahead: the score the sign counts, not one keyed a day or two off.
   */
  ahead: number;
  aheadListed: number;
  farAhead: number;
  firstFar: string | undefined;
  vouched: boolean;
  /** The games won by `HUNDRED_MARGIN` or more, unvouched, that its own schedule reported (H). */
  reported: CountedWin[];
};

const emptyTally = (): Tally => ({
  played: 0,
  unlisted: [],
  routsListed: 0,
  absurdListed: 0,
  ahead: 0,
  aheadListed: 0,
  farAhead: 0,
  firstFar: undefined,
  vouched: false,
  reported: [],
});

/**
 * Whether every GameChanger team of a club is for a season that has not begun on `today`: next
 * season's squad, whose spring is still to come.
 */
const nextSeasonSquad = (links: readonly GcTeamLink[], today: string): boolean => {
  if (links.length === 0) return false;
  const now = segmentOn(today);
  const order = (year: number, half: string) =>
    year * 2 + SEASON_SEGMENT_ORDER.indexOf(half === "fall" ? "fall" : "spring");
  return links.every((link) => {
    if (link.seasonYear === undefined || !link.season) return false;
    const season = link.season.trim().toLowerCase();
    const half = season === "fall" || season === "winter" ? "fall" : "spring";
    return (
      order(squadYearForGcSeason(link.season, link.seasonYear), half) > order(now.year, now.segment)
    );
  });
};

/** Why N marks a GameChanger id: the word, and the team's name where the club's own has none. */
type Named = { word: string; teamName?: string };

type Verdict = {
  /** The signs it shows, A, B and C, and which of its GameChanger ids N marks. */
  signs: AutoSign[];
  named: Map<string, Named>;
  wins: CountedWin[];
  /** The games won by `HUNDRED_MARGIN` or more its own schedule reported, either side (H). */
  reported: CountedWin[];
  /** Its wins by `ROUT_MARGIN` or more, and by `ABSURD_MARGIN` or more, that the loser's lists. */
  routsListed: number;
  absurdListed: number;
  /** Whether a win by `ABSURD_MARGIN` or more is among those no loser's schedule lists. */
  absurdUnlisted: boolean;
  ahead?: AutoRemoval["ahead"];
  /** Kept by the user's word: real, its own team, kept apart, an age named, a score vouched for. */
  kept: boolean;
  /** Kept by real opponents' schedules listing its games. */
  corroborated: boolean;
  /** The day of the latest game of it a real opponent's schedule lists. */
  lastCorroborated: string;
};

/**
 * What every pulled club shows, and what keeps it: the signs before any guard, the guards, and the
 * day of the latest of its games a real opponent's own schedule lists.
 */
const judge = (pool: SweepPool, answers: SweepAnswers, today: string): Map<string, Verdict> => {
  const clubOfGcId = clubsByGcId(pool.teams);
  const pulled = new Map(
    pool.teams.filter((team) => (team.gcTeams ?? []).length > 0).map((team) => [team.id, team])
  );
  const tallies = new Map([...pulled.keys()].map((id) => [id, emptyTally()]));
  const listed = new Map<ScoutGame, Set<string>>();

  pool.games.forEach((game) => {
    if (game.scoreConfirmed !== undefined) {
      const a = tallies.get(game.teamAId);
      if (a) a.vouched = true;
      const b = tallies.get(game.teamBId);
      if (b) b.vouched = true;
    }
    if (!isPlayed(game)) return;
    if (!tallies.has(game.teamAId) && !tallies.has(game.teamBId)) return;
    const listers = listersOf(game, clubOfGcId);
    listed.set(game, listers);
    const filers = filedBy(game, clubOfGcId);
    const early = isDatedAhead(game, today);
    const margin = ratedMargin(game) ?? 0;
    // A win nobody vouched for (`isImplausibleScore`), by A's line or more, as the rating reads it.
    const rout = Math.abs(margin) >= ROUT_MARGIN && isImplausibleScore(game);
    // H's: by the owner's line or more, unvouched, whichever side's own schedule reports it.
    const hundred =
      Math.abs(margin) >= HUNDRED_MARGIN && isImplausibleScore(game)
        ? scoredBy(game, clubOfGcId)
        : null;
    const winner = margin > 0 ? game.teamAId : margin < 0 ? game.teamBId : undefined;
    [
      [game.teamAId, game.teamBId],
      [game.teamBId, game.teamAId],
    ].forEach(([self, other]) => {
      const tally = tallies.get(self!);
      if (!tally) return;
      tally.played += 1;
      const ownFiled = filers.includes(self!);
      const otherListed = listers.has(other!);
      const seen = scoreSeenBy(game, self!);
      if (seen && seen.own - seen.opponent >= ROUT_MARGIN && otherListed) {
        tally.routsListed += 1;
        if (seen.own - seen.opponent >= ABSURD_MARGIN) tally.absurdListed += 1;
      }
      if (hundred?.has(self!)) {
        tally.reported.push({
          gameId: game.id,
          margin: Math.abs(margin),
          ...(game.date ? { date: game.date } : {}),
        });
      }
      // Filed by its own schedule and not listed by the loser's. The two never part in a pool, since
      // a win the club's schedule did not file is one the loser's did, but it is what the sign says.
      if (rout && winner === self && ownFiled && !otherListed) {
        tally.unlisted.push({
          gameId: game.id,
          margin: Math.abs(margin),
          ...(game.date ? { date: game.date } : {}),
        });
      }
      if (early && ownFiled) {
        tally.ahead += 1;
        if (otherListed) tally.aheadListed += 1;
        if (
          game.date !== undefined &&
          ISO_DAY.test(game.date) &&
          daysAfter(game.date, today) >= FAR_AHEAD_DAYS
        ) {
          tally.farAhead += 1;
          if (tally.firstFar === undefined || game.date < tally.firstFar)
            tally.firstFar = game.date;
        }
      }
    });
  });

  const real = answers.realClubs;
  const mine = new Set(pool.ageGroups.flatMap((group) => (group.myTeamId ? [group.myTeamId] : [])));
  const apart = new Set([...answers.keptApart].flatMap((key) => key.split("\u0000")));
  const verdicts = new Map<string, Verdict>();
  pulled.forEach((team, id) => {
    const tally = tallies.get(id)!;
    const links = team.gcTeams ?? [];
    const widest = Math.max(0, ...tally.unlisted.map((win) => win.margin));
    const signs: AutoSign[] = [];
    if (tally.unlisted.length >= 2 && tally.routsListed === 0) signs.push("wins");
    if (widest >= ABSURD_MARGIN) signs.push("rout");
    if (tally.reported.length > 0) signs.push("hundred");
    // C's shape; whether a real opponent lists a game of it is asked below, once witnesses are known.
    if (
      tally.played >= AHEAD_FEWEST_PLAYED &&
      tally.farAhead * 2 >= tally.played &&
      tally.aheadListed === 0 &&
      tally.firstFar !== undefined
    ) {
      signs.push("ahead");
    }
    const clubWord = madeUpWord(team.name);
    const named = new Map<string, Named>();
    links.forEach((link) => {
      if (clubWord !== undefined) {
        named.set(link.teamId, { word: clubWord });
        return;
      }
      const word = madeUpWord(link.name);
      if (word !== undefined) named.set(link.teamId, { word, teamName: link.name });
    });
    const ids = links.map((link) => link.teamId);
    verdicts.set(id, {
      signs,
      named,
      wins: signs.includes("wins") || signs.includes("rout") ? tally.unlisted : [],
      reported: tally.reported,
      routsListed: tally.routsListed,
      absurdListed: tally.absurdListed,
      absurdUnlisted: widest >= ABSURD_MARGIN,
      ...(signs.includes("ahead")
        ? {
            ahead: {
              first: tally.firstFar!,
              results: tally.farAhead,
              played: tally.played,
              ...(nextSeasonSquad(links, today) ? { nextSeason: true as const } : {}),
            },
          }
        : {}),
      kept:
        real.has(id) ||
        ids.some((gcId) => real.has(gcId)) ||
        mine.has(id) ||
        ids.some((gcId) => apart.has(gcId) || answers.namedAges.has(gcId)) ||
        tally.vouched,
      corroborated: false,
      lastCorroborated: "",
    });
  });

  // A real opponent is a pulled club showing no sign, C's shape counted as one. Whatever marks it
  // carries are no matter: a mark outlives its sign, and a witness is about what a club shows now.
  const witness = (clubId: string): boolean => {
    const verdict = verdicts.get(clubId);
    return verdict !== undefined && verdict.signs.length === 0 && verdict.named.size === 0;
  };
  const corroborated = new Map<string, number>();
  listed.forEach((listers, game) => {
    [
      [game.teamAId, game.teamBId],
      [game.teamBId, game.teamAId],
    ].forEach(([self, other]) => {
      const verdict = verdicts.get(self!);
      if (!verdict || !listers.has(self!) || !listers.has(other!) || !witness(other!)) return;
      corroborated.set(self!, (corroborated.get(self!) ?? 0) + 1);
      if (game.date !== undefined && game.date > verdict.lastCorroborated) {
        verdict.lastCorroborated = game.date;
      }
    });
  });
  verdicts.forEach((verdict, id) => {
    const count = corroborated.get(id) ?? 0;
    verdict.corroborated =
      count >= PLAINLY_REAL_GAMES || (count >= 1 && count * 2 >= tallies.get(id)!.played);
    // C is no sign of a club a real opponent's schedule lists a game of, however few.
    if (count > 0 && verdict.signs.includes("ahead")) {
      verdict.signs = verdict.signs.filter((sign) => sign !== "ahead");
      delete verdict.ahead;
    }
  });
  return verdicts;
};

/** A mark with `signs` alone, or none where nothing is left of it. */
const keeping = (mark: AutoRemoval, signs: readonly AutoSign[]): AutoRemoval | undefined => {
  if (signs.length === mark.signs.length) return mark;
  if (signs.length === 0) return undefined;
  const { wins, reported, ahead, word, teamName, ...rest } = mark;
  return {
    ...rest,
    signs: [...signs],
    ...(wins && (signs.includes("wins") || signs.includes("rout")) ? { wins } : {}),
    ...(reported && signs.includes("hundred") ? { reported } : {}),
    ...(ahead && signs.includes("ahead") ? { ahead } : {}),
    ...(word && signs.includes("named") ? { word } : {}),
    ...(teamName && signs.includes("named") ? { teamName } : {}),
  };
};

/**
 * The marks after tonight's sweep of `pool`: those a guard or a sign's own escape now lifts taken
 * off, and a mark made for each GameChanger id of a club newly showing a sign that nothing keeps.
 * `marks` itself when nothing changes, so a caller can tell by identity whether to save.
 *
 * `today` is the user's day, as an ISO day.
 */
export const sweepMarks = (
  pool: SweepPool,
  answers: SweepAnswers,
  marks: AutoRemovals,
  today: string
): AutoRemovals => {
  const verdicts = judge(pool, answers, today);
  const clubOfGcId = clubsByGcId(pool.teams);
  const games = new Map(pool.games.map((game) => [game.id, game]));
  const teams = new Map(pool.teams.map((team) => [team.id, team]));
  const next = new Map(marks);
  let changed = false;

  // Lifted: by a guard, or by a sign's own escape.
  marks.forEach((mark, gcId) => {
    const clubId = clubOfGcId.get(gcId);
    const verdict = clubId === undefined ? undefined : verdicts.get(clubId);
    // An id no club carries now says nothing either way, so its mark stands.
    if (clubId === undefined || !verdict) return;
    if (verdict.kept) {
      next.delete(gcId);
      changed = true;
      return;
    }
    const loserLists = (win: CountedWin) => {
      const game = games.get(win.gameId);
      if (!game) return false;
      const loser = game.teamAId === clubId ? game.teamBId : game.teamAId;
      return listersOf(game, clubOfGcId).has(loser);
    };
    const link = teams.get(clubId)?.gcTeams?.find((entry) => entry.teamId === gcId);
    const word = madeUpWord(teams.get(clubId)?.name) ?? madeUpWord(link?.name);
    const signs = mark.signs.filter((sign) => {
      if (sign === "named") return word !== undefined;
      // H's own escape, and no witness's: the game gone, vouched for, or its schedule no more.
      if (sign === "hundred") return verdict.signs.includes("hundred");
      if (verdict.corroborated) return false;
      // A's escape as A reads it: any win by `ROUT_MARGIN` or more a loser's schedule lists.
      if (sign === "wins") return verdict.routsListed === 0 && !(mark.wins ?? []).some(loserLists);
      if (sign === "rout") {
        // B's: the win counted is listed, or every win by the line is one its loser lists.
        const listed = (mark.wins ?? []).some(
          (win) => win.margin >= ABSURD_MARGIN && loserLists(win)
        );
        return !listed && !(verdict.absurdListed > 0 && !verdict.absurdUnlisted);
      }
      return !(verdict.lastCorroborated > mark.on);
    });
    const kept = keeping(mark, signs);
    if (kept === mark) return;
    changed = true;
    if (kept) next.set(gcId, kept);
    else next.delete(gcId);
  });

  // Made: a club with a sign and nothing keeping it, each of its ids not marked already.
  verdicts.forEach((verdict, clubId) => {
    if (verdict.kept) return;
    // A witness keeps a club from every sign but H, which no witness makes a game.
    const shown = verdict.corroborated
      ? verdict.signs.filter((sign) => sign === "hundred")
      : verdict.signs;
    if (shown.length === 0 && verdict.named.size === 0) return;
    const team = teams.get(clubId)!;
    (team.gcTeams ?? []).forEach((link) => {
      if (next.has(link.teamId)) return;
      const named = verdict.named.get(link.teamId);
      const signs = AUTO_SIGNS.filter((sign) =>
        sign === "named" ? named !== undefined : shown.includes(sign)
      );
      if (signs.length === 0) return;
      next.set(link.teamId, {
        gcTeamId: link.teamId,
        name: team.name,
        on: today,
        signs,
        ...(verdict.wins.length > 0 && (signs.includes("wins") || signs.includes("rout"))
          ? { wins: verdict.wins }
          : {}),
        ...(verdict.reported.length > 0 && signs.includes("hundred")
          ? { reported: verdict.reported }
          : {}),
        ...(verdict.ahead && signs.includes("ahead") ? { ahead: verdict.ahead } : {}),
        ...(named ? { word: named.word } : {}),
        ...(named?.teamName === undefined ? {} : { teamName: named.teamName }),
      });
      changed = true;
    });
  });
  return changed ? next : marks;
};
