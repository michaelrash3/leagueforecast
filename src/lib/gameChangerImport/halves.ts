/**
 * The tidy's joins of the two halves of one game: one club's row against a stand-in and the other
 * club's row naming it (`joinCrossedHalves`, `joinNamesakeHalves`). Split out of
 * `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  ageGroupLevel,
  claimInto,
  CLOSE_DISPUTE_RUNS,
  filedRowOf,
  filedTeamIds,
  gcRowId,
  isJoinedClaim,
  nameFitter,
  nameFitWords,
  ownPageFor,
  sameStart,
  type ScoutGame,
  type ScoutTeam,
  startMinuteOf,
  startsWithinTheHour,
  teamNameKey,
  unjoinedRow,
  withSchedulesOf,
} from "../teamRankings";
import { borderingStates, inOneRegion } from "../stateBorders";
import { NO_REFUSALS, type NotThisTeam, refusesName } from "../notThisTeam";
import { buildPoolKeyOf, PLAYS_UP_TO, push } from "./poolIndex";
import type { GcImportState } from "./types";
import { isScored } from "./rows";
import { SHIPPED_TIDY_RULES, type TidyRules } from "./namesakes";
import { townKey } from "./filing";

/**
 * Joins one game that each club filed against a stand-in for the other.
 *
 * The Cincy Stix 9U Navy beat a club called "Hurricanes" 13-2 on 20 September 2026, and both
 * clubs are on GameChanger and both were pulled. The Stix's coach typed "Hurricanes"; the
 * Hurricanes' coach typed "Stix". Neither is the other club's name as GameChanger lists it, and
 * the two clubs are in different states, so each end of the game was filed against a stand-in —
 * a "Hurricanes" named by an Ohio club, a "Stix" named by a Kentucky one — and the pool held two
 * games, two clubs with no GameChanger id, and no edge at all between two clubs that had met.
 * `resolveSlotGames` could not help, because it needs one of the two rows to name the other club
 * already, and here neither does.
 *
 * The two rows are still plainly one fixture, and the evidence is the same kind that settles a
 * slot: the same day, the same result from opposite seats, and a pair of names that fit — each
 * stand-in's name is the other club's name or a shorthand for it (`nameFitsWithin`). Each of those
 * alone is weak and all of them together are not: a false pair would need a second club, whose
 * name fits one of these stand-ins, to have played a second club, whose name fits the other, on
 * that same day, with that same score mirrored.
 *
 * Two more things guard it. The clubs have to be in one region — one state, or two that share a
 * border (`inOneRegion`) — because youth clubs play their neighbours, and a pair of fits across
 * the country is the coincidence this must not fall for. And the match has to be the only one
 * from both ends: where either row could be the partner of two, nothing is joined, because a wrong
 * join moves a result onto a club that never played it and leaves nothing behind to notice.
 *
 * A result on both rows has to mirror, and when it does the two start times are not compared at
 * all. Coaches type them independently, and on the stand-in fixtures export of 22 September 2026
 * — 89,876 rows filed against a stand-in — this rule joined 1,211 games, of which 487 had the
 * same start time on both schedules and 104 were more than an hour apart: an hour or two is a
 * clock set a time zone out, and 19 were exactly twelve hours apart, AM for PM. Held to within
 * the hour it joined 1,108. The same searches run a week either side, where the game is not,
 * joined 9.5 pairs at every window from none to a whole day, and each was the same two clubs
 * meeting in another week. A club's other squad in another slot is told apart by its squad
 * number and its typed age, not by the clock. A row with no result yet has only the clock to go
 * on: it joins a scored row that starts at the same instant, and two unplayed rows are left to
 * wait until they are scored, because joining them throws away one row's id and a game put back
 * a day came back as a second game.
 *
 * Two results that do not mirror are joined only at one start time, and only where no half with a
 * result that agrees fits either end: one instant is one game, and two scores for it are two
 * coaches' accounts of it. On that same export 265 games were scored apart like this — 190 of them
 * a single run, 7 with the winner changed — against 5.5 such joins a week off, each again the same
 * two clubs meeting in another week. The first row's result stands and carries what the other
 * side reported, which is how `collapseSameGames` keeps a game two pulled clubs scored apart.
 *
 * An age a coach typed into a stand-in's name has to be the other club's own: "Mustangs 11U" is a
 * statement about which squad was played, and the age label comes off every name before names are
 * compared. A team carrying GameChanger ids is never a stand-in, whatever flags a hand merge left
 * on it, and only the stand-ins this pass emptied leave the roster.
 *
 * The surviving row is the first of the two in the pool, with the stand-in replaced by the club
 * that filed the other; the other club's schedule is recorded in `alsoFrom`, and the level its own
 * schedule gave for its side replaces the one read off a coach's spelling of its name.
 */
export const joinCrossedHalves = (
  state: GcImportState
): { state: GcImportState; joined: number } => {
  const fits = nameFitter();
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const ownIds = new Map<string, Set<string>>();
  state.teams.forEach((team) => {
    if (team.gcTeams?.length) ownIds.set(team.id, new Set(team.gcTeams.map((l) => l.teamId)));
  });
  if (ownIds.size < 2) return { state, joined: 0 };

  /** A row one pulled club filed from its own schedule, against a name nobody has pulled. */
  type Half = {
    game: ScoutGame;
    club: ScoutTeam;
    standIn: ScoutTeam;
    pool: string;
    clubScore: number | undefined;
    standInScore: number | undefined;
    clubLevel: number | undefined;
    standInLevel: number | undefined;
    /**
     * The age a coach typed into the stand-in's name, and nothing else — no page level standing in.
     * "Mustangs 11U" is a statement about which squad was played, and a club's 12U squad is not it
     * however close the two levels are; `PLAYS_UP_TO` is the slack for a level nobody stated.
     */
    standInNamedLevel: number | undefined;
  };
  const halfOf = (game: ScoutGame): Half | undefined => {
    if (!game.date || !game.source) return undefined;
    const source = game.source.teamId;
    const clubIsA = ownIds.get(game.teamAId)?.has(source) ?? false;
    const clubIsB = ownIds.get(game.teamBId)?.has(source) ?? false;
    if (clubIsA === clubIsB) return undefined;
    const club = teamById.get(clubIsA ? game.teamAId : game.teamBId);
    const standIn = teamById.get(clubIsA ? game.teamBId : game.teamAId);
    // A team carrying GameChanger ids is a club, whatever flags a hand merge left on it: merging a
    // pulled club into a stand-in keeps the stand-in's `nameOnly`, and reading that as a stand-in
    // moved the merged club's rows and then deleted it, links and all.
    if (!club || !standIn?.nameOnly || standIn.gcTeams?.length) return undefined;
    const pageLevel = levelOf.get(game.ageGroupId);
    return {
      game,
      club,
      standIn,
      pool: poolKeyOf(game.ageGroupId),
      clubScore: clubIsA ? game.teamAScore : game.teamBScore,
      standInScore: clubIsA ? game.teamBScore : game.teamAScore,
      clubLevel: (clubIsA ? game.ageLevelA : game.ageLevelB) ?? pageLevel,
      standInLevel: (clubIsA ? game.ageLevelB : game.ageLevelA) ?? pageLevel,
      standInNamedLevel: clubIsA ? game.ageLevelB : game.ageLevelA,
    };
  };
  const scored = (half: Half) => half.clubScore !== undefined && half.standInScore !== undefined;
  /** Each end's result is the other's, read from the other seat. */
  const mirrored = (x: Half, y: Half) =>
    x.clubScore === y.standInScore && x.standInScore === y.clubScore;

  /*
   * Two lookups rather than a scan of the day. A Saturday in a nationwide pool is thousands of
   * rows, and comparing each with each is millions of pairs a day; a scored row's partner can only
   * be in the bucket with the mirrored result, and an unscored row's only in the bucket at its
   * start time. Within a bucket each half is filed under the words of its club's name, and looked
   * for under the words of the stand-in's: two names fit only where every word of the shorter is in
   * the longer (`nameFitWords`), so a club sharing no word with the stand-in cannot be its club.
   * On the tidied pool of 24 September 2026 a half looked up met 131 others in its buckets, 9.5
   * million pairs over the pass, and joined none; filed by word it met 2.5, 180,000 pairs.
   */
  const halves: Half[] = [];
  const byResult = new Map<string, Map<string, Half[]>>();
  const byTime = new Map<string, Map<string, Half[]>>();
  const wordsRead = new Map<string, ReadonlySet<string>>();
  const wordsOf = (name: string): ReadonlySet<string> => {
    const known = wordsRead.get(name);
    if (known) return known;
    const made = nameFitWords(name);
    wordsRead.set(name, made);
    return made;
  };
  const file = (lookup: Map<string, Map<string, Half[]>>, key: string, half: Half) => {
    let byWord = lookup.get(key);
    if (!byWord) {
      byWord = new Map();
      lookup.set(key, byWord);
    }
    const into = byWord;
    wordsOf(half.club.name).forEach((word) => push(into, word, half));
  };
  /** The halves filed at `key` whose club's name shares a word with `x`'s stand-in's, once each. */
  const under = (lookup: Map<string, Map<string, Half[]>>, key: string, x: Half): Half[] => {
    const byWord = lookup.get(key);
    if (!byWord) return [];
    const found = new Set<Half>();
    wordsOf(x.standIn.name).forEach((word) => byWord.get(word)?.forEach((y) => found.add(y)));
    return [...found];
  };
  const resultKey = (half: Half, mine: number | undefined, theirs: number | undefined) =>
    `${half.pool}\u0000${half.game.date}\u0000${mine}-${theirs}`;
  const timeKey = (half: Half) =>
    `${half.pool}\u0000${half.game.date}\u0000${startMinuteOf(half.game.startTs)}`;
  state.games.forEach((game) => {
    const half = halfOf(game);
    if (!half) return;
    halves.push(half);
    if (scored(half)) file(byResult, resultKey(half, half.clubScore, half.standInScore), half);
    if (startMinuteOf(half.game.startTs) !== undefined) file(byTime, timeKey(half), half);
  });
  if (halves.length < 2) return { state, joined: 0 };

  const sameTime = (x: Half, y: Half) => sameStart(x.game.startTs, y.game.startTs);
  const levelsAgree = (named: number | undefined, own: number | undefined) =>
    named === undefined || own === undefined || Math.abs(named - own) <= PLAYS_UP_TO;
  /**
   * The same result from opposite seats within the hour, each stand-in named for the other club:
   * the game, wherever the two clubs are from. On the pool of 26 September 2026 the join left 100
   * such pairs standing between states that share no border — Impact of Illinois and TC Toros of
   * Georgia, 6-14 at five and 14-6 at half past, a tournament's travel — and the same search a week
   * or a fortnight either side, where the game is not, found none. Let through, 93 more pairs were
   * joined on that pool and 89 on the pool of 24 September. A weaker link, a result still to
   * come or two that disagree, still has to be between neighbours. The age a coach typed holds
   * whatever the result: two clubs' sibling squads at one event can mirror a score at one instant.
   */
  const certain = (x: Half, y: Half) =>
    scored(x) && scored(y) && mirrored(x, y) && startsWithinTheHour(x.game.startTs, y.game.startTs);
  /** Whether `y` is, on everything but uniqueness, the other end of `x`'s game. */
  const couldBeOtherEnd = (x: Half, y: Half): boolean =>
    y.club.id !== x.club.id &&
    y.standIn.id !== x.standIn.id &&
    (certain(x, y) || inOneRegion(x.club.state, y.club.state)) &&
    levelsAgree(x.standInLevel, y.clubLevel) &&
    levelsAgree(y.standInLevel, x.clubLevel) &&
    (x.standInNamedLevel === undefined || x.standInNamedLevel === y.clubLevel) &&
    (y.standInNamedLevel === undefined || y.standInNamedLevel === x.clubLevel) &&
    fits(x.standIn.name, y.club.name) &&
    fits(y.standIn.name, x.club.name);

  const partnerOf = (x: Half): Half | undefined => {
    const found = new Set<Half>();
    if (scored(x)) {
      // The mirrored result, whatever the clocks say — and a row with no result yet at this time.
      under(byResult, resultKey(x, x.standInScore, x.clubScore), x).forEach((y) => found.add(y));
      if (x.game.startTs) {
        under(byTime, timeKey(x), x).forEach((y) => {
          if (!scored(y)) found.add(y);
        });
      }
    } else if (x.game.startTs) {
      under(byTime, timeKey(x), x).forEach((y) => found.add(y));
    }
    const fits = [...found].filter((y) => couldBeOtherEnd(x, y));
    // Where several fit, the clock picks between them or nothing is picked.
    const shortlist = fits.length > 1 ? fits.filter((y) => sameTime(x, y)) : fits;
    if (shortlist.length === 1) return shortlist[0];
    /*
     * Failing any half that agrees, one at the same instant that does not: one start time is one
     * game, and two scores for it are two coaches' accounts of it. Never where an agreeing half
     * fits and the clock could not choose, which is a guess between games rather than a dispute
     * about one.
     */
    if (fits.length > 0) return undefined;
    // Everything at this instant that agrees was asked about above, so what fits here does not.
    const disputed = under(byTime, timeKey(x), x).filter((y) => couldBeOtherEnd(x, y));
    return disputed.length === 1 ? disputed[0] : undefined;
  };

  /** The surviving row, by id, and the rows folded away into it. */
  const replaced = new Map<string, ScoutGame>();
  const dropped = new Set<string>();
  halves.forEach((x) => {
    if (replaced.has(x.game.id) || dropped.has(x.game.id)) return;
    const y = partnerOf(x);
    if (!y || replaced.has(y.game.id) || dropped.has(y.game.id)) return;
    // From both ends, or it is a guess between two.
    if (partnerOf(y) !== x) return;
    /*
     * Neither row has a result: wait. An unplayed game counts for nothing yet, and joining it on
     * the clock alone throws away the dropped row's id — so when the game was put back a day and
     * both clubs scored it, the dropped club's re-pull could no longer find its own row and filed
     * the game a second time. Once both results are in, the mirrored result joins them.
     */
    if (!scored(x) && !scored(y)) return;

    const clubIsA = x.game.teamAId === x.club.id;
    const takeScore = !scored(x) && scored(y);
    // The first row's result stands and carries the other side's, as `collapseSameGames` does.
    const disputed = scored(x) && scored(y) && !mirrored(x, y);
    const [theirA, theirB] = clubIsA
      ? [y.standInScore, y.clubScore]
      : [y.clubScore, y.standInScore];
    const otherLevel = y.game.teamAId === y.club.id ? y.game.ageLevelA : y.game.ageLevelB;
    /*
     * The other club goes in for its stand-in before the dropped row is put on record, so the
     * record reads which side that row's club is on (`recordOf`); against the stand-in it matched
     * neither, and the next tidy stood the row back up on the wrong side.
     *
     * No start is taken from the other schedule. That is the other coach's clock, and the next
     * regroup would read it as this schedule's, as `collapseSameGames` never does.
     */
    const named: ScoutGame = {
      ...x.game,
      ...(clubIsA ? { teamBId: y.club.id } : { teamAId: y.club.id }),
    };
    const joinedRow: ScoutGame = {
      ...withSchedulesOf(named, y.game),
      ...(otherLevel === undefined
        ? {}
        : clubIsA
          ? { ageLevelB: otherLevel }
          : { ageLevelA: otherLevel }),
      // A result taken from the other club's schedule is marked borrowed where that club is side
      // B, as `withSideBReport` marks it, so side A's own score replaces it once posted.
      ...(takeScore
        ? clubIsA
          ? { teamAScore: y.standInScore, teamBScore: y.clubScore, scoreFromB: true }
          : { teamAScore: y.clubScore, teamBScore: y.standInScore }
        : {}),
      /*
       * The other club's own score, beside this one's rather than in a note: it is that club's
       * schedule, and its page reads it (`reportedByB`). Only where the joined row's side B is that
       * club, which is every row a schedule of its own filed.
       */
      ...(clubIsA && scored(y)
        ? { reportedByB: { teamAScore: y.standInScore!, teamBScore: y.clubScore! } }
        : disputed
          ? {
              note: [x.game.note, `Other side reported ${theirA}-${theirB}.`]
                .filter(Boolean)
                .join(" "),
            }
          : {}),
    };
    replaced.set(x.game.id, joinedRow);
    dropped.add(y.game.id);
  });
  if (replaced.size === 0) return { state, joined: 0 };

  const games = state.games
    .filter((game) => !dropped.has(game.id))
    .map((game) => replaced.get(game.id) ?? game);
  /*
   * A stand-in the join emptied is not a club, and should not linger in the roster — but only the
   * ones this pass emptied. Every idle name-only team is not this pass's to remove, and one that
   * carries GameChanger ids is never a stand-in at all.
   */
  const touched = new Set(
    halves
      .filter((half) => replaced.has(half.game.id) || dropped.has(half.game.id))
      .map((half) => half.standIn.id)
  );
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter((team) => !touched.has(team.id) || stillUsed.has(team.id));
  return { state: { ...state, teams, games }, joined: replaced.size };
};

/**
 * A result this wide or wider is no sign of one game on a stand-in sharing no word with the namer's
 * name (`joinNamesakeHalves`): a game won by ten is often one the run rule called, and the same
 * score turns up week after week.
 */
const UNWORDED_MARGIN = 10;

/**
 * Joins one game held twice because both pulled clubs filed it against a stand-in, where one of the
 * two stand-ins carries the other club's very name.
 *
 * One club's coach types the other club's name as GameChanger lists it, but a name goes onto a
 * pulled club only where the import can say which one, and the named club can be a level up, on
 * another page; the other club's coach types a shorthand of the first club's name nobody pulled,
 * and files the same game at the same minute, the result mirrored, against it. Each row stands
 * against a stand-in and both clubs count the game. The crossed-halves join wants each stand-in's
 * name to fit the other club and the clubs to be neighbours, and the slot settle and the claim
 * step want one of the rows to name the other club already, so none of them joins it: on the
 * backup of 11 October 2026 an audit found 714 scored rows this way, on 633 stand-ins, the
 * namesake out of reach a level off (294), out of the namer's region (241), among several of the
 * name in its state (78) or named from no state (65).
 *
 * The game says it is one game. Club A's own row is against a stand-in whose name is pulled club
 * B's (`teamNameKey`, in the squad year, at any level, from any state), and B's own row of the game
 * is against a stand-in or a slot, starts within the hour, and gives the result mirrored. A false
 * pair needs another club of B's name, or another club naming B, to have played that hour with that
 * score, so the match has to be the only one each way, counted over every row that could be either
 * end. Measured against the same search with B's row a week or a fortnight either side, where the
 * game is not, two more things are asked:
 *
 * - B's opponent is a slot, or a stand-in sharing a word of three letters or more with A's name,
 *   filler words off (`nameFitWords`). Over the backups of 25, 26 and 29 September and 11 October
 *   2026, a stand-in sharing no word made a false pair 5.0% of the time (374 pairs), against 0.80%
 *   for one that shared a word and 0.28% for a slot. One sharing no word is read as A all the same
 *   where everything else about the game agrees (`nearAndPlain`): B in A's state or next door, the
 *   clubs not of one town, their levels at most one apart, the game not won by ten or more, and the
 *   stand-in's name no other pulled club's. With A's row one to four weeks either side, on those
 *   four backups after a tidy, that joins 15, 15, 19 and 28 more pairs, 77 in all, against 0.25 a
 *   shift off (0.32%); with B in A's state or next door alone it found 134 on 25 and 29 September
 *   and 11 October against 5.25 a shift off (3.9%), the false ones on a stand-in of another pulled
 *   club's name, between clubs of one town, two levels apart or in games won by ten.
 * - The two clubs' own levels for the game are no more than two apart (`PLAYS_UP_TO`), as far as a
 *   squad plays up or down: three or more apart was false 11.9% of the time (88 pairs).
 *
 * Held to those, the measurement found 225, 215, 304 and 500 pairs on those backups, 1,244 in all,
 * against 7.75 a shift off: 0.62%, and 5.75 of the 7.75 were the same two clubs meeting in another
 * week. With B's score the same from its own seat rather than mirrored it found none. The
 * crossed-halves join was accepted at 0.8%. With the guards in `holds` as well, the tidy joins 220,
 * 211, 301 and 486, 1,218 in all, against 7 pairs a shift off, under 0.6%. A row with no result
 * waits for one: blank rows at the same minute paired as often a week off as on the day (1,796
 * such pairs, against 1,809 a shift off).
 *
 * The game stays on A's row, the one that named B, on A's page: the stand-in gives way to B, at the
 * level B's own row gives it, and B's row goes into the game as a claim filed against the team it
 * named (`claimInto`), as the claim step holds the rows it claims, so it counts once in the squad
 * year's one fit and for both clubs. A level written from the row matters: read at A's page level
 * where no typed age said otherwise, 122 of the 253 joined games across two pages on the 11
 * October backup would have rated B at A's level. Nothing joined is final, as a claim is not. The
 * game's own row keeps the stand-in it named and the level the name gave (`ScoutGame.joinedFrom`),
 * every tidy reads the two rows again as their schedules filed them, and a join the schedules no
 * longer bear out — a score or a start since posted that no longer fits, a second club of the name
 * with a row that does, a copy of the game naming either club itself, the owner's refusal of either
 * name, the other club's row gone — puts each row back as it was (`unjoinedRow`).
 *
 * And a stand-in of no pulled club's name is read as each club its name fits (`nameFitsWithin`),
 * where that club's own row of the hour, the result mirrored, is against a slot (`FittedRule`, tidy
 * rules 35): the owner's "Both teams have the game" of 28 October 2026, a 4-11 loss to a TBD slot
 * on one club's schedule and an 11-4 win at the same minute on the other's over the first club's
 * name with its region and an event's tag around it. Between neighbours, on the cloud copy of that
 * day, it joined 296 games, and with every row against a slot a week or a fortnight either side
 * 0.75 a shift (0.3%); read anywhere, 30 more against 3.0 a shift, so the region is asked.
 */
export const joinNamesakeHalves = (
  state: GcImportState,
  /** The names the owner has said are not a club (`notThisTeam.ts`): never joined onto it. */
  refused: NotThisTeam = NO_REFUSALS,
  /** The rules still being measured (`TidyRules`): how far a name that only fits is read. */
  rules: TidyRules = SHIPPED_TIDY_RULES
): { state: GcImportState; joined: number } => {
  const fitted = rules.fitted ?? null;
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const clubOfSchedule = new Map<string, string>();
  /** The pulled clubs a stand-in's name could be, by squad year and name key. */
  const clubsByName = new Map<string, string[]>();
  let clubs = 0;
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    clubs += 1;
    team.gcTeams.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
    new Set(team.gcTeams.map((link) => poolKeyOf(link.ageGroupId))).forEach((pool) =>
      push(clubsByName, `${pool}\u0000${teamNameKey(team.name)}`, team.id)
    );
  });
  if (clubs < 2) return { state, joined: 0 };
  const ownPage = ownPageFor(state.ageGroups);
  const pulled = (team: ScoutTeam | undefined) => Boolean(team?.gcTeams?.length);
  // As the measurement read them: a slot is a placeholder, and a stand-in any other name only.
  const isSlot = (team: ScoutTeam | undefined) => team?.placeholder === true && !pulled(team);
  const isStandIn = (team: ScoutTeam | undefined) =>
    team?.nameOnly === true && team.placeholder !== true && !pulled(team);

  /*
   * Each game the join made, taken apart into the rows its two schedules filed, to be read again
   * beside every other row: its own row back against the stand-in it named, at the level the name
   * gave, and each row of the other club's it holds stood up as that schedule filed it, the claim
   * against the team it named, on its club's page. `key` is the pair as the reading below names it.
   * A game whose stand-in has since gone from the roster keeps the join, as a claim the claim step
   * reads from then on: there is nothing to put its row back against.
   */
  type Apart = { row: ScoutGame; back: ScoutGame[]; key: string | undefined };
  const apart = new Map<string, Apart>();
  state.games.forEach((game) => {
    // A game the user has thrown out keeps what it holds, as it keeps a claim (`claimFiledRows`).
    if (game.joinedFrom === undefined || game.excluded) return;
    if (!teamById.has(game.joinedFrom)) {
      const { joinedFrom: _from, joinedFromLevel: _level, ...unmarked } = game;
      apart.set(game.id, { row: unmarked, back: [], key: undefined });
      return;
    }
    const theirs = (game.alsoRows ?? []).filter((record) => record.onSideB === true);
    const row = unjoinedRow(game);
    const claim = theirs.find((record) => isJoinedClaim(game, record));
    apart.set(game.id, {
      row,
      back: theirs.map((record) => ownPage(filedRowOf(game, record))),
      key: claim ? `${row.id}\u0000${gcRowId(claim.teamId, claim.gameId)}` : undefined,
    });
  });

  /** A club's own scored row against a side nobody pulled, as one end of a game. */
  type Half = {
    game: ScoutGame;
    club: string;
    other: string;
    pool: string;
    own: number;
    theirs: number;
    /** The level the club played it at, as its own row gives it. */
    level: number | undefined;
  };
  /** Every club's rows, by squad year and club: where the other end of a namer's row is found. */
  const rowsOf = new Map<string, Half[]>();
  const nameKeys = new Map<string, string>();
  const nameKeyOf = (team: ScoutTeam) => {
    const known = nameKeys.get(team.id);
    if (known !== undefined) return known;
    const made = teamNameKey(team.name);
    nameKeys.set(team.id, made);
    return made;
  };
  /*
   * The pulled clubs by every name they are listed under: their own, and each of their GameChanger
   * teams' as GameChanger has it, which a merged or renamed club keeps beside a name of its own.
   * Built the first time it is asked, since most passes ask nothing of it.
   */
  let listedAs: Map<string, string[]> | undefined;
  const clubsListedAs = (pool: string, key: string): string[] => {
    if (!listedAs) {
      listedAs = new Map();
      state.teams.forEach((team) =>
        team.gcTeams?.forEach((link) =>
          [team.name, link.name].forEach((name) =>
            push(listedAs!, `${poolKeyOf(link.ageGroupId)}\u0000${teamNameKey(name)}`, team.id)
          )
        )
      );
    }
    return listedAs.get(`${pool}\u0000${key}`) ?? [];
  };
  /** The rows against a stand-in of a pulled club's name, and the clubs of that name. */
  const namers: { half: Half; namesakes: string[] }[] = [];
  /** The rows against a stand-in of no pulled club's name, read where a name fits (`fitted`). */
  const fitNamers: Half[] = [];
  /** Every club's rows against a slot, by squad year, result and hour (`slotKey`). */
  const onSlots = new Map<string, Half[]>();
  const slotKey = (pool: string, own: number, theirs: number, hour: number) =>
    `${pool}\u0000${own}-${theirs}\u0000${hour}`;
  const hourOf = (half: Half) => Math.floor(startMinuteOf(half.game.startTs)! / 60);
  const read = (game: ScoutGame) => {
    // Rows with no result wait for one, and a row with no start has no hour to be in.
    if (!game.source || !game.startTs || game.withdrawn || !isScored(game) || game.scoreFromB) {
      return;
    }
    const club = clubOfSchedule.get(game.source.teamId);
    if (club === undefined || club !== game.teamAId) return;
    const other = teamById.get(game.teamBId);
    if (!other || pulled(other)) return;
    const pool = poolKeyOf(game.ageGroupId);
    const half: Half = {
      game,
      club,
      other: other.id,
      pool,
      own: game.teamAScore!,
      theirs: game.teamBScore!,
      level: game.ageLevelA ?? levelOf.get(game.ageGroupId),
    };
    push(rowsOf, `${pool}\u0000${club}`, half);
    if (fitted && isSlot(other) && startMinuteOf(game.startTs) !== undefined) {
      push(onSlots, slotKey(pool, half.own, half.theirs, hourOf(half)), half);
    }
    if (!isStandIn(other)) return;
    const namesakes = (clubsByName.get(`${pool}\u0000${nameKeyOf(other)}`) ?? []).filter(
      (id) => id !== club
    );
    if (namesakes.length > 0) namers.push({ half, namesakes });
    else if (fitted) fitNamers.push(half);
  };
  state.games.forEach((game) => {
    const taken = apart.get(game.id);
    if (!taken) read(game);
    else [taken.row, ...taken.back].forEach(read);
  });
  if (namers.length === 0 && fitNamers.length === 0 && apart.size === 0) {
    return { state, joined: 0 };
  }

  /*
   * Every pair that could be one game, each way it can be read: the namer's row, and a row of a
   * club of the name within the hour with the result mirrored. A pair is one game only where
   * neither row is in any other pair, counted before anything else is asked of it, so a second
   * candidate either way, however poor, leaves both rows where they are.
   */
  type Reading = { a: Half; b: Half; fit?: true };
  const readingsOf = new Map<string, Reading[]>();
  const pairsOf = new Map<string, Set<string>>();
  const note = (gameId: string, pair: string) => {
    const bucket = pairsOf.get(gameId);
    if (bucket) bucket.add(pair);
    else pairsOf.set(gameId, new Set([pair]));
  };
  namers.forEach(({ half: a, namesakes }) =>
    namesakes.forEach((clubId) =>
      (rowsOf.get(`${a.pool}\u0000${clubId}`) ?? []).forEach((b) => {
        if (b.game.id === a.game.id || a.own !== b.theirs || a.theirs !== b.own) return;
        if (!startsWithinTheHour(a.game.startTs, b.game.startTs)) return;
        const pair = [a.game.id, b.game.id].sort().join("\u0000");
        push(readingsOf, pair, { a, b });
        note(a.game.id, pair);
        note(b.game.id, pair);
      })
    )
  );
  /*
   * And a stand-in of nobody's name, read as each club whose name it fits (`nameFitsWithin`) and
   * whose own row of the hour, the result mirrored, is against a slot: the one club's schedule
   * could not say whom it played, and the other's coach typed the first club's name with its region
   * before it and an event's tag after it. Every club the name fits is a reading, wherever it is,
   * so a second within the hour leaves both rows where they are; the region is asked after
   * (`holds`).
   */
  if (fitNamers.length > 0 && onSlots.size > 0) {
    const fits = nameFitter();
    const listedNames = (clubId: string) => {
      const team = teamById.get(clubId);
      return team ? [team.name, ...(team.gcTeams ?? []).map((link) => link.name)] : [];
    };
    fitNamers.forEach((a) => {
      const standIn = teamById.get(a.other)!;
      /*
       * A name a pulled club is listed under names that club, though its own rows say nothing of the
       * game, and the namer's own name names nobody else: read for no other club it fits.
       */
      const listed = clubsListedAs(a.pool, nameKeyOf(standIn));
      const hour = hourOf(a);
      [hour - 1, hour, hour + 1].forEach((at) =>
        (onSlots.get(slotKey(a.pool, a.theirs, a.own, at)) ?? []).forEach((b) => {
          if (b.club === a.club || !startsWithinTheHour(a.game.startTs, b.game.startTs)) return;
          if (listed.some((id) => id !== b.club)) return;
          if (!listedNames(b.club).some((name) => fits(standIn.name, name))) return;
          const pair = [a.game.id, b.game.id].sort().join("\u0000");
          push(readingsOf, pair, { a, b, fit: true });
          note(a.game.id, pair);
          note(b.game.id, pair);
        })
      );
    });
  }

  /** A's row as one that can take B in: nothing another club's held in it, nothing of B's lent. */
  const takesIn = ({ game, club }: Half) =>
    !game.excluded &&
    game.namedByAvatar === undefined &&
    game.reportedByB === undefined &&
    (game.alsoRows ?? []).every((record) => clubOfSchedule.get(record.teamId) === club) &&
    (game.alsoFrom ?? []).every((schedule) => clubOfSchedule.get(schedule) === club);
  /** B's row as one that can go into A's whole: a bare row, found by its own id. */
  const goesIn = ({ game }: Half) =>
    !game.excluded &&
    game.namedByAvatar === undefined &&
    game.reportedByB === undefined &&
    !game.scoreFromTwin &&
    !game.alsoRows?.length &&
    !game.alsoFrom?.length &&
    game.id === gcRowId(game.source!.teamId, game.source!.gameId);
  const words = (name: string) =>
    new Set([...nameFitWords(name)].filter((word) => word.length >= 3));
  const sharesWord = (a: string, b: string) => {
    const theirs = words(b);
    return [...words(a)].some((word) => theirs.has(word));
  };
  /*
   * B's stand-in for A sharing no word with A's name, read as A all the same where nothing else
   * about the game says otherwise: B in A's state or next door, the two clubs not of one town (a
   * coach there knows the other club's name), their levels a level apart at most, the game not won
   * by ten or more (`UNWORDED_MARGIN`), and the stand-in's name no other pulled club's, which would
   * say B played that club. Measured in the step's own description above.
   */
  const nearAndPlain = (a: Half, b: Half, opponent: ScoutTeam): boolean => {
    const namer = teamById.get(a.club);
    const named = teamById.get(b.club);
    if (!namer?.state || !named?.state) return false;
    if (named.state !== namer.state && !borderingStates(namer.state).has(named.state)) return false;
    const town = townKey(namer.city);
    if (town !== undefined && town === townKey(named.city)) return false;
    if (a.level !== undefined && b.level !== undefined && Math.abs(a.level - b.level) > 1) {
      return false;
    }
    if (Math.abs(a.own - a.theirs) >= UNWORDED_MARGIN) return false;
    return !clubsListedAs(a.pool, nameKeyOf(opponent)).some((id) => id !== a.club && id !== b.club);
  };
  /*
   * Whether a club's own schedules have played a stand-in as a team of its own, read off the rows
   * as their schedules filed them: a stand-in a club has played is not a name for that club. Asked
   * only of the stand-ins the pairs below name for A, and answered for all of them in one reading
   * of the rows: filling in every club's opponents instead took a third of the step's 1.6 seconds
   * a pass on the backup of 11 October 2026, and the step now takes 1.3.
   */
  const asked = new Map<string, Set<string>>();
  readingsOf.forEach((readings) =>
    readings.forEach(({ a, b }) => {
      if (!isStandIn(teamById.get(b.other))) return;
      const bucket = asked.get(a.club);
      if (bucket) bucket.add(b.other);
      else asked.set(a.club, new Set([b.other]));
    })
  );
  const played = new Set<string>();
  /*
   * And a copy of the game already standing between either club and another pulled club, within
   * the hour with a result no further from the club's own row's than two scorekeepers' are
   * (`CLOSE_DISPUTE_RUNS`), as the claim step reads a row against a stand-in beside a copy, is one
   * more reading of the game: a pair read beside it is not the only one, so it is noted as a second
   * pair for that club's row. read() leaves such copies out, as no end of a pair, and so the join
   * once never saw them: a second club of B's name pulled after the join, its own row naming A,
   * went onto A by that name beside the joined game, since A's row no longer stood against the
   * stand-in the import would have folded it into, and A counted the game twice, through every
   * tidy after, where the tidy before the join counted it once; so did B, where a club pulled after
   * the join named B. Read beside the copy, the join comes apart, and the steps after it settle the
   * row into the copy, as they do where every schedule is in at the first tidy. Asked only of the
   * clubs the pairs name, in the same reading of the rows. No pair joined on the backups of 25, 26
   * and 29 September and 11 October 2026 has such a copy beside it, and the tidy of each is the
   * same to the byte with the question and without: it is there for the order schedules come in.
   */
  const halvesOf = new Map<string, Half[]>();
  const seen = new Set<string>();
  readingsOf.forEach((readings) =>
    readings.forEach(({ a, b }) =>
      [a, b].forEach((half) => {
        if (seen.has(half.game.id)) return;
        seen.add(half.game.id);
        push(halvesOf, half.club, half);
      })
    )
  );
  if (asked.size > 0 || halvesOf.size > 0) {
    const plays = (club: string | undefined, team: string) => {
      if (club !== undefined && asked.get(club)?.has(team)) played.add(`${club}\u0000${team}`);
    };
    /** `game` from `club`'s seat, set against the halves of that club at its hour. */
    const rivals = (game: ScoutGame, club: string, own: number, theirs: number) =>
      halvesOf.get(club)?.forEach((half) => {
        if (Math.abs(half.own - own) + Math.abs(half.theirs - theirs) > CLOSE_DISPUTE_RUNS) return;
        if (half.pool !== poolKeyOf(game.ageGroupId)) return;
        if (!startsWithinTheHour(half.game.startTs, game.startTs)) return;
        note(half.game.id, `\u0001${game.id}`);
      });
    const of = (game: ScoutGame) => {
      const club = game.source ? clubOfSchedule.get(game.source.teamId) : undefined;
      if (club === game.teamAId) plays(club, game.teamBId);
      else if (club === game.teamBId) plays(club, game.teamAId);
      game.alsoRows?.forEach((record) =>
        plays(
          clubOfSchedule.get(record.teamId),
          record.filedAgainst ?? (record.onSideB ? game.teamAId : game.teamBId)
        )
      );
      if (game.excluded || game.withdrawn || !game.startTs || !isScored(game)) return;
      if (!halvesOf.has(game.teamAId) && !halvesOf.has(game.teamBId)) return;
      if (!pulled(teamById.get(game.teamAId)) || !pulled(teamById.get(game.teamBId))) return;
      rivals(game, game.teamAId, game.teamAScore!, game.teamBScore!);
      rivals(game, game.teamBId, game.teamBScore!, game.teamAScore!);
    };
    state.games.forEach((game) => {
      const taken = apart.get(game.id);
      if (!taken) of(game);
      else [taken.row, ...taken.back].forEach(of);
    });
  }
  const hasPlayed = (clubId: string, teamId: string) => played.has(`${clubId}\u0000${teamId}`);
  const holds = ({ a, b, fit }: Reading): boolean => {
    if (!takesIn(a) || !goesIn(b)) return false;
    const opponent = teamById.get(b.other);
    const namer = teamById.get(a.club);
    const named = teamById.get(b.club);
    if (fit) {
      // A name that only fits is read between neighbours, where the rule asks it.
      if (
        fitted?.region &&
        !(namer?.state && named?.state && inOneRegion(namer.state, named.state))
      ) {
        return false;
      }
      /*
       * The owner's word on a game taken off a club is kept under the club's own name
       * (`refusalsFor`), which is not the name the row wrote here: either says the name is not
       * that club.
       */
      if (refusesName(refused, a.game.source!.teamId, named?.name, named)) return false;
    }
    if (
      !isSlot(opponent) &&
      !(
        isStandIn(opponent) &&
        (sharesWord(opponent!.name, namer?.name ?? "") || nearAndPlain(a, b, opponent!))
      )
    ) {
      return false;
    }
    if (
      a.level !== undefined &&
      b.level !== undefined &&
      Math.abs(a.level - b.level) > PLAYS_UP_TO
    ) {
      return false;
    }
    /*
     * Two clubs' sibling squads at one event can mirror a score at one instant
     * (`joinCrossedHalves`): one club's 11U beats the other's 11U 5-3 at six while the second
     * club's 12U loses 3-5 to the first's 12U, each coach typing its own squad's age for the other.
     * So where both coaches typed an age, one of the two has to be the other club's own level. One
     * age a level off on its own is let through: on the backup of 11 October 2026, refusing every
     * typed age that was not the other club's own turned away 173 of the 500 pairs, and the same
     * search with B's row a week or a fortnight either side found 7 pairs with it and 7 without;
     * refusing only where both disagree turns away 13. Nor is a stand-in A's own schedule has
     * played as a team of its own a name for A, as the claim step holds it.
     */
    const typedA = a.game.ageLevelB;
    const typedB = b.game.ageLevelB;
    if (typedA !== undefined && typedB !== undefined && typedA !== b.level && typedB !== a.level) {
      return false;
    }
    if (isStandIn(opponent) && hasPlayed(a.club, b.other)) return false;
    /*
     * A name the owner refused files nothing onto the club it was refused for, whichever row wrote
     * it: A's name for B, and B's name for A. Asked of A's alone, a pair where each stand-in carried
     * the other club's very name was joined the other way round, on B's row with A's row as the
     * claim, though the owner had said A's name for B is not B. A refusal is kept under the
     * club's exact name key, so the second question finds one only where B's stand-in carries a
     * name the owner turned away for A, A's very name for one.
     */
    return (
      !refusesName(
        refused,
        a.game.source!.teamId,
        teamById.get(a.other)?.name,
        teamById.get(b.club)
      ) &&
      !refusesName(
        refused,
        b.game.source!.teamId,
        teamById.get(b.other)?.name,
        teamById.get(a.club)
      )
    );
  };
  /** The pairs read as one game, by A's row: each the reading that holds, the earlier A by id. */
  const chosen = new Map<string, Reading>();
  readingsOf.forEach((readings, pair) => {
    const [x, y] = pair.split("\u0000") as [string, string];
    if (pairsOf.get(x)?.size !== 1 || pairsOf.get(y)?.size !== 1) return;
    const reading = readings
      .filter(holds)
      .sort((p, q) => (p.a.game.id < q.a.game.id ? -1 : p.a.game.id > q.a.game.id ? 1 : 0))[0];
    if (reading) chosen.set(reading.a.game.id, reading);
  });

  let joined = 0;
  /** The games the join made that the reading makes again, left exactly as they are. */
  const kept = new Set<string>();
  apart.forEach((taken, id) => {
    const reading = chosen.get(taken.row.id);
    if (taken.key !== undefined && reading && taken.key === `${id}\u0000${reading.b.game.id}`) {
      kept.add(id);
    } else {
      joined += 1;
    }
  });
  const made = new Map<string, ScoutGame>();
  const folded = new Set<string>();
  chosen.forEach(({ a, b }, id) => {
    if (kept.has(id)) return;
    const { ageLevelB: typed, ...row } = a.game;
    const named: ScoutGame = {
      ...row,
      teamBId: b.club,
      ...(b.level === undefined ? {} : { ageLevelB: b.level }),
      joinedFrom: a.other,
      ...(typed === undefined ? {} : { joinedFromLevel: typed }),
    };
    made.set(id, claimInto(named, b.game, b.other, b.game.ageLevelB));
    folded.add(b.game.id);
    joined += 1;
  });
  if (joined === 0) return { state, joined: 0 };

  const games = state.games.flatMap((game) => {
    const taken = apart.get(game.id);
    const rows = !taken || kept.has(game.id) ? [game] : [taken.row, ...taken.back];
    return rows.flatMap((row) => (folded.has(row.id) ? [] : [made.get(row.id) ?? row]));
  });
  return { state: { ...state, games }, joined };
};
