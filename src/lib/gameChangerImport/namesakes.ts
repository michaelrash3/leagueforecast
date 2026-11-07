/**
 * When a name a schedule typed means a pulled club: the tidy's rules (`TidyRules`), the namesakes
 * near the namer (`inStateNamesakes`), the one pulled club of a name (`oneNamesake`), and the
 * answers a person gave. Split out of `gameChangerImport.ts`, which re-exports what it always
 * exported.
 */

import { borderingStates, farApart, onBorderMap } from "../stateBorders";
import {
  isPlaceholderName,
  looseNameKey,
  namesNobody,
  type ScoutGame,
  type ScoutTeam,
  startsWithinTheHour,
  teamNameKey,
} from "../teamRankings";
import { type NotThisTeam, refusesName } from "../notThisTeam";
import type { GcImportState } from "./types";
import { isoDayFrom, ownRowDays } from "./rows";
import { push } from "./poolIndex";

/**
 * How rare a word of a name has to be among the pulled clubs' names for the name to be one club's
 * wherever it is written: in no more of them than one in every 18,000. On the pool of 29 September
 * 2026 that was two of its 38,296 pulled names. The "bouley" of "513 Force - Bouley" was in one,
 * "eagles" in 212, and the names the rule must never read as one club's — "Samurai", "Arrows",
 * "Walkoff", "Firebirds" — in 8 to 15. A share rather than a count, because a word is rare only
 * against enough names to say so: in a fifth of that pool "Walkoff" was in two names and "Samurai"
 * in three, and a pool of fewer than 18,000 pulled names holds no word rare enough.
 */
const RARE_WORD_AMONG = 18_000;

/**
 * How many days before a club's first game of its own in a squad year a name can still mean it. A
 * row from before that is last season's squad of the name or somebody else's: an Illinois club's
 * 8 August loss to "Eagles" was not the Eagles of Independence, Kentucky, whose own schedule opened
 * on 3 September.
 */
const NAMED_BEFORE_OWN_DAYS = 7;

/** A row a name filed, as `soleNamesakes` asks of it. */
type NamedRow = {
  /** The squad year's pool key (`buildPoolKeyOf`). */
  pool: string;
  /** The name it was filed under, as `teamNameKey` reads it. */
  key: string;
  /** The level the name gave, or the page's. */
  level: number | undefined;
  /** The pulled club whose schedule wrote the name down. */
  namer: ScoutTeam | undefined;
  date: string | undefined;
};

/** What `soleNamesakes` and `inStateNamesakes` read of the pulled clubs' names, built once a row asks. */
type PulledNames = {
  /** Pulled clubs by pool, name and level, as the refile files them. */
  clubs: Map<string, ScoutTeam[]>;
  /** The same by the name read loosely (`looseNameKey`), for `oneNamesake`. */
  loose: Map<string, ScoutTeam[]>;
  /** The levels each pulled club is listed at. */
  listed: Map<string, Set<number>>;
  /** How many pulled names hold each word. */
  holding: Map<string, number>;
  names: number;
  /** Each pulled club's first day with a row of its own, by club and pool. */
  firstDay: Map<string, string>;
};

/** The pulled clubs' names, read once a row asks and shared by every rule that reads them. */
export const pulledNamesOf = (
  state: GcImportState,
  poolKeyOf: (ageGroupId: string) => string
): (() => PulledNames) => {
  let index: PulledNames | undefined;
  return () => {
    if (index) return index;
    const clubs = new Map<string, ScoutTeam[]>();
    const loose = new Map<string, ScoutTeam[]>();
    const listed = new Map<string, Set<number>>();
    const keys = new Set<string>();
    const clubOfSchedule = new Map<string, string>();
    state.teams.forEach((team) => {
      if (!team.gcTeams?.length) return;
      const key = teamNameKey(team.name);
      const looseKey = looseNameKey(team.name);
      keys.add(key);
      team.gcTeams.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
      new Set(
        team.gcTeams.map(
          (link) => `${poolKeyOf(link.ageGroupId)}\u0000${key}\u0000${link.ageLevel}`
        )
      ).forEach((slot) => push(clubs, slot, team));
      new Set(
        team.gcTeams.map(
          (link) => `${poolKeyOf(link.ageGroupId)}\u0000${looseKey}\u0000${link.ageLevel}`
        )
      ).forEach((slot) => push(loose, slot, team));
      listed.set(
        team.id,
        new Set(
          team.gcTeams
            .map((link) => link.ageLevel)
            .filter((level): level is number => level !== undefined)
        )
      );
    });
    const holding = new Map<string, number>();
    keys.forEach((key) =>
      new Set(key.split(" ")).forEach((word) => {
        if (word) holding.set(word, (holding.get(word) ?? 0) + 1);
      })
    );
    const firstDay = new Map<string, string>();
    state.games.forEach((game) => {
      const pool = poolKeyOf(game.ageGroupId);
      ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([club, day]) => {
        const at = `${club}\u0000${pool}`;
        const first = firstDay.get(at);
        if (first === undefined || day < first) firstDay.set(at, day);
      });
    });
    index = { clubs, loose, listed, holding, names: keys.size, firstDay };
    return index;
  };
};

/** Whether a name holds a word in no more than one in `among` of the pulled clubs' names. */
const holdsRareWord = (key: string, pulled: PulledNames, among: number): boolean => {
  const words = key.split(" ").filter(Boolean);
  if (words.length === 0) return false;
  const rarest = Math.min(...words.map((word) => pulled.holding.get(word) ?? 0));
  return rarest * among <= pulled.names;
};

/** Whether `date` is no earlier than a week before the club's first game of its own in the pool. */
const inItsSeason = (pulled: PulledNames, clubId: string, pool: string, date: string): boolean => {
  // No first day is no limit: a schedule that is empty says nothing of when the season began.
  const first = pulled.firstDay.get(`${clubId}\u0000${pool}`);
  const from = first === undefined ? undefined : isoDayFrom(first, -NAMED_BEFORE_OWN_DAYS);
  return from === undefined || date >= from;
};

/**
 * The pulled club a name can mean and no other, though its own schedules have no game that day:
 * the one pulled club carrying the name at that level in that squad year anywhere, in the namer's
 * state or one bordering it, under a name holding a word no other club's name has
 * (`RARE_WORD_AMONG`), on a day no earlier than a week before its own first game of the year,
 * where it has one.
 *
 * A name is where to look, not who played, and a club's own schedule says whether it played that
 * day (`refileStandIns`, `unlisted`). But a schedule is written ahead only as far as its coach has
 * got: "513 Force - Bouley" of Cincinnati had one game of its own on 29 September 2026, and a
 * Kentucky club's and an Ohio club's schedules each named it for a game in October. The rule left
 * both rows on stand-ins of the name, and the search showed the club three times. The user said on
 * 29 September that a name that specific can only be the one club — and that a vague "Eagles" can't
 * be combined, which the rare word is for. On the backup of that day the tidy filed 3,660 stand-in
 * rows onto 2,018 clubs, 1,047 of them scored, which emptied 1,985 stand-ins; four games two clubs
 * had each filed against a stand-in for the other were then one game, not two. A second tidy
 * moved nothing.
 *
 * A club whose own schedule is empty is held to no first day, since it has none to be held to and
 * never will: the name is all there is to go on. On the backup of 29 September 246 pulled clubs
 * had no game of their own anywhere in the pool, each one link already pulled, and other clubs'
 * schedules named them on 575 rows, 313 of them scored, from August to June. Holding them to a
 * first day would leave every one of those on a stand-in for good, the rule refusing outright the
 * one club a name that specific can mean.
 *
 * Both tidy steps that read a club's own days ask this of the same row, and must agree: the refile
 * files the row, and the step that takes a name's rows off a club with no game that day leaves it.
 * Read only once a row asks, since most tidies ask nothing.
 */
export const soleNamesakes = (
  state: GcImportState,
  poolKeyOf: (ageGroupId: string) => string,
  pulledNow: () => PulledNames = pulledNamesOf(state, poolKeyOf)
): ((row: NamedRow) => ScoutTeam | undefined) => {
  return ({ pool, key, level, namer, date }) => {
    if (date === undefined || !namer?.state) return undefined;
    const pulled = pulledNow();
    const found = (pulled.clubs.get(`${pool}\u0000${key}\u0000${level}`) ?? []).filter(
      (club) => club.id !== namer.id
    );
    if (found.length !== 1) return undefined;
    const club = found[0]!;
    if (!club.state || isPlaceholderName(club.name) || namesNobody(club.name)) return undefined;
    if (club.state !== namer.state && !borderingStates(namer.state).has(club.state)) {
      return undefined;
    }
    if (!holdsRareWord(key, pulled, RARE_WORD_AMONG)) return undefined;
    if (!inItsSeason(pulled, club.id, pool, date)) return undefined;
    return club;
  };
};

/**
 * How far a name is read as the one pulled club of it in the namer's own state, though that club's
 * own schedules have no game that day (`inStateNamesakes`); null reads no name so.
 */
export type InStateRule = {
  /** A word of the name in no more than one in this many pulled clubs' names; 1 lets any name. */
  rareAmong: number;
  /** Failing one of the name at the row's level in the state, one a level either side. */
  nearLevel: boolean;
  /**
   * Only a club the namer is a neighbour of by their own schedules (`ownNeighbours`): a game both
   * clubs' own schedules hold, or a pulled club each has played on its own schedule.
   */
  vouched: boolean;
};

/**
 * How far a name is read as the one pulled club that carries it near the namer, though that club's
 * own schedules have no game that day (`oneNamesake`); null, or left out, reads no name so.
 */
export type NamesakeRule = {
  /** Failing one of the name at the row's level, the one whose name reads the same loosely. */
  loose: boolean;
  /** Failing either, the one of the name within this many levels of the row's. */
  levelsApart: number;
};

/**
 * How the namesake join reads a stand-in whose name is no pulled club's but fits one's
 * (`nameFitsWithin`), as that club, where the club's own row of the game is against a slot
 * (`joinNamesakeHalves`); null, or left out, reads only a club's very name.
 */
export type FittedRule = {
  /** Only between clubs of one state or of two that share a border (`inOneRegion`). */
  region: boolean;
};

/** The tidy's rules that a measurement reads one way and another, as `tidyPool` takes them. */
export type TidyRules = {
  inState: InStateRule | null;
  namesake?: NamesakeRule | null;
  fitted?: FittedRule | null;
};

/**
 * The tidy as it ships: the one pulled club of a name in the namer's state, any name, at the row's
 * level, where the two are neighbours by their own schedules (`inStateNamesakes`); and failing
 * that, the one pulled club of the name in the namer's region at the row's level, or spelled near
 * it, or within two levels (`oneNamesake`).
 */
export const SHIPPED_TIDY_RULES: TidyRules = {
  inState: { rareAmong: 1, nearLevel: false, vouched: true },
  namesake: { loose: true, levelsApart: 2 },
  fitted: { region: true },
};

/** The tidy before 27 October 2026, which read no name as the one club of it in a state. */
export const DAY_CHECK_TIDY_RULES: TidyRules = { inState: null, namesake: null };

/** The tidy of 27 October 2026, before a name was read as its one club in the namer's region. */
export const IN_STATE_TIDY_RULES: TidyRules = {
  inState: { rareAmong: 1, nearLevel: false, vouched: true },
  namesake: null,
};

/**
 * The tidy of 28 October 2026, before the namesake join read a name holding a club's name with more
 * around it as that club, against the club's own row of the game on a slot.
 */
export const ONE_NAMESAKE_TIDY_RULES: TidyRules = {
  inState: { rareAmong: 1, nearLevel: false, vouched: true },
  namesake: { loose: true, levelsApart: 2 },
};

/** A row a name filed, as `inStateNamesakes` asks of it: the start time too. */
type TimedNamedRow = NamedRow & { start: string | undefined };

/**
 * Why `inStateNamesakes` or `oneNamesake` read no club for a row, for a measurement that asks
 * (`refileStandIns`' `explain`): the rule is off; the row has no date or level, or its namer no
 * state; no pulled club of the name answers, or several do; the one that does is named like a slot,
 * its name's words are too common to read where a state says nothing, the row is dated before its
 * season, the two clubs are not neighbours by their own schedules, a level typed into the name is
 * far from every level it is listed at, or one of its own rows that day starts within the hour
 * against another club.
 */
export type NamesakeRefusal =
  | "off"
  | "noDate"
  | "noLevel"
  | "noState"
  | "none"
  | "several"
  | "slotName"
  | "commonWord"
  | "beforeSeason"
  | "notNeighbours"
  | "typedLevel"
  | "clash";

/**
 * Why `refileStandIns` left one stand-in row where it was: the two rules' reasons, the in-state
 * rule's first (absent where the day check or a sole name had already picked the club), or that the
 * club they read is one the owner said the name is not.
 */
export type RefileRefusal = {
  inState?: NamesakeRefusal;
  namesake?: NamesakeRefusal;
  refused?: true;
};

/**
 * The pulled clubs each pulled club has played in a game its own schedules hold: a row of its own,
 * folded in or on record (`ownRowDays`). A row another club's schedule filed against it by name is
 * not its own word, so it never makes two clubs neighbours (`areOwnNeighbours`).
 */
export const ownOpponentsOf = (state: GcImportState): Map<string, Set<string>> => {
  const clubOfSchedule = new Map<string, string>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
  );
  const pulledIds = new Set(clubOfSchedule.values());
  const opponents = new Map<string, Set<string>>();
  state.games.forEach((game) =>
    ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([club]) => {
      const other = club === game.teamAId ? game.teamBId : game.teamAId;
      if (!pulledIds.has(other) || other === club) return;
      const met = opponents.get(club) ?? new Set<string>();
      met.add(other);
      opponents.set(club, met);
    })
  );
  return opponents;
};

/**
 * Whether a namer and a club are neighbours by their own schedules (`ownOpponentsOf`): the club's
 * own schedule has a game against the namer, or the two have each played a third pulled club on
 * their own. A row on the namer's schedule alone, the one a name filed, never vouches for itself.
 */
export const areOwnNeighbours = (
  opponents: ReadonlyMap<string, ReadonlySet<string>>,
  namerId: string,
  clubId: string
): boolean => {
  const theirs = opponents.get(clubId);
  if (!theirs) return false;
  if (theirs.has(namerId)) return true;
  const mine = opponents.get(namerId);
  if (!mine) return false;
  for (const other of theirs) if (other !== namerId && mine.has(other)) return true;
  return false;
};

/**
 * The pulled club a name means because it is the one pulled club of that name, at that level and
 * squad year, in the state of the club whose schedule wrote it down, though that club's own
 * schedules have no game that day: on a day no earlier than a week before its own first game of the
 * year, and never where one of its own rows that day starts within the hour against another club,
 * since a club plays one game at a time.
 *
 * The owner, 27 October 2026: "your tidy is not working properly or your rules are way too tight".
 * The second model sweep's read of the cloud copy that day found 7,540 clubs known only by name with
 * one pulled club of the name on their page in a state of the clubs naming them, holding 13,164
 * games. The rule of 28 September files a name onto a pulled club only where its own schedules have
 * a game that day (`unlisted`), or where no other club in the country carries the name and it holds
 * a word nearly nobody's does (`soleNamesakes`); a club that keeps only some of its games on
 * GameChanger fails it for every game it left off.
 *
 * Measured on the cloud copy the same day (GitHub run 40448331357), the whole pool tidied in
 * memory: the tidy as it shipped changed nothing, so it was doing what its rules said. Read as the
 * one club of the name in the namer's state, any name, at the row's level, names moved 12,104 rows
 * off stand-ins and the games leaning on one fell from 33.4% of the year to 30.3%; only names with a
 * word in no more than 1 in 2,000 pulled names, 6,736 rows and 31.7%; a level either side as well,
 * 16,110 rows and 29.3%. Of the rows moved, the namer and the club had met or shared a pulled
 * opponent 50.7% of the time, against 9.7% for another club of the namer's state on the page picked
 * in its place; the 4,006 rows a level either side added did so 16.4% of the time, close to the
 * decoys, so most of those were somebody else's and the rule reads no level but the row's. A sample
 * showed why the name alone is not enough: "Rangers named Angels", "Giants named Guardians", a rec
 * league's names, where the one Angels pulled in Texas is any of a dozen. So the rule asks the two
 * clubs to be neighbours by their own schedules (`vouched`, `areOwnNeighbours`). A wrong club passes
 * that about as often as the decoys did, so of the rows that pass, the wrong share is the decoys'
 * rate times the wrong share of all the rows, over the rate all the rows passed at: 0.097 w / 0.507,
 * and since no more than 54.6% of the rows can be wrong for 50.7% of them to be neighbours, no more
 * than 10.4% of the rows it files, whatever the rate is for a right one. (The run read neighbours off
 * every game between two pulled clubs; read off the clubs' own schedules both rates are lower.)
 *
 * Both tidy steps that read a club's own days ask this of the same row, and must agree, as with
 * `soleNamesakes`: the refile files the row, and the step that takes a name's rows off a club with
 * no game that day leaves it.
 */
export const inStateNamesakes = (
  state: GcImportState,
  poolKeyOf: (ageGroupId: string) => string,
  rule: InStateRule | null,
  pulledNow: () => PulledNames = pulledNamesOf(state, poolKeyOf)
): ((row: TimedNamedRow, why?: (reason: NamesakeRefusal) => void) => ScoutTeam | undefined) => {
  if (!rule)
    return (_row, why) => {
      why?.("off");
      return undefined;
    };
  const clashes = ownClashes(state);
  let opponents: Map<string, Set<string>> | undefined;
  return ({ pool, key, level, namer, date, start }, why) => {
    const no = (reason: NamesakeRefusal) => {
      why?.(reason);
      return undefined;
    };
    if (date === undefined) return no("noDate");
    if (level === undefined) return no("noLevel");
    if (!namer?.state) return no("noState");
    const pulled = pulledNow();
    const inState = (at: number) =>
      (pulled.clubs.get(`${pool}\u0000${key}\u0000${at}`) ?? []).filter(
        (club) => club.id !== namer.id && club.state === namer.state
      );
    let found = inState(level);
    if (found.length === 0 && rule.nearLevel) {
      found = [...new Set([...inState(level - 1), ...inState(level + 1)])];
    }
    if (found.length === 0) return no("none");
    if (found.length > 1) return no("several");
    const club = found[0]!;
    if (isPlaceholderName(club.name) || namesNobody(club.name)) return no("slotName");
    if (!holdsRareWord(key, pulled, rule.rareAmong)) return no("commonWord");
    if (!inItsSeason(pulled, club.id, pool, date)) return no("beforeSeason");
    if (
      rule.vouched &&
      !areOwnNeighbours((opponents ??= ownOpponentsOf(state)), namer.id, club.id)
    ) {
      return no("notNeighbours");
    }
    return clashes(club.id, date, start, namer.id) ? no("clash") : club;
  };
};

/** A row a name filed, as the owner's answers are asked of it (`answeredNamesakes`). */
type AnsweredRow = {
  /** The schedule that wrote the name, the namer's own. */
  schedule: string | undefined;
  /** The name it wrote, as `teamNameKey` reads it. */
  typed: string | undefined;
  /** The squad year's pool key (`buildPoolKeyOf`). */
  pool: string;
  /** The level the name gave, or the page's. */
  level: number | undefined;
  date: string | undefined;
  start: string | undefined;
  /** The pulled club whose schedule wrote the name. */
  namerId: string;
};

/** The owner's answers asked of a row, under whatever refusals the asker holds. */
export type AnsweredLookup = (row: AnsweredRow, refused: NotThisTeam) => ScoutTeam | undefined;

/**
 * The pulled club the owner said a name on a schedule is ("Same team as", `ScoutTeam.namedAs`): the
 * one club holding that schedule's name as an answer at the row's level in its squad year, where it
 * could have played the row as the in-state rule reads a club that could (`inStateNamesakes`): on a
 * day no earlier than a week before its own first game of the year, and never where one of its own
 * rows that day starts within the hour against another club. Not on a name alone: the owner's word
 * on who the coach means by it stands where the two clubs are not neighbours, or not of one state,
 * since the owner has seen the games. Read for every listing of the namer's, as its refusals are
 * kept (`refusalsFor`): a club on GameChanger twice is one club writing the name.
 *
 * Never where the owner has said the name is not the club, on any of those listings
 * (`notThisTeam.ts`), and that is read under the answer's own name: the name a press of Not this
 * team on a row the answer filed refuses (`refusalsFor`), which no rename of the club, nor a fold
 * of it into a club of another name, changes, so Not this team always wins. Read by the club's
 * name, the refusal stopped counting once the club was renamed, and the tidy filed the refused rows
 * back. Nor is a refusal of another name read: one of the club's own, given for a row the coach
 * typed that way, says nothing of what the coach means by the answer's name, and read, it took
 * back every answer the owner gave after it for that coach.
 *
 * The owner's case, from the sweep of 30 October 2026: a coach's "Bolts" of 12 September folded
 * into the club it was, the same coach's "Bolts" of 19 September went to a new stand-in, and the
 * owner had to answer again. Every road a name takes onto a club asks this of the same row and must
 * agree, as with the in-state rule: the import's match (`planOpponent`), the refile, which files a
 * stand-in's row onto the club, and the resettle, which leaves such a row on it.
 *
 * `ownGamesOf` gives each club's games holding a row of its own schedules, which the guards read.
 * Built the first time a row asks, since most pools hold no answer.
 */
export const answeredNamesakes = (
  teams: Iterable<ScoutTeam>,
  teamOf: (teamId: string) => ScoutTeam | undefined,
  ownGamesOf: (club: ScoutTeam) => Iterable<ScoutGame>,
  poolKeyOf: (ageGroupId: string) => string
): AnsweredLookup => {
  let answers: Map<string, string[]> | undefined;
  return (row, refused) => {
    const { schedule, typed, pool, level, date } = row;
    if (schedule === undefined || !typed || date === undefined || level === undefined) {
      return undefined;
    }
    if (!answers) {
      const held = new Map<string, string[]>();
      for (const team of teams) {
        if (!team.gcTeams?.length) continue;
        team.namedAs?.forEach((answer) =>
          push(held, `${answer.schedule}\u0000${answer.name}`, team.id)
        );
      }
      answers = held;
    }
    const byName = answers;
    if (byName.size === 0) return undefined;
    const schedules = new Set([
      schedule,
      ...(teamOf(row.namerId)?.gcTeams ?? []).map((link) => link.teamId),
    ]);
    const holders = new Set(
      [...schedules].flatMap((each) => byName.get(`${each}\u0000${typed}`) ?? [])
    );
    const found = [...holders].flatMap((id) => {
      const club = teamOf(id);
      const listed = club?.gcTeams?.some(
        (link) => poolKeyOf(link.ageGroupId) === pool && link.ageLevel === level
      );
      return club && listed && club.id !== row.namerId ? [club] : [];
    });
    if (found.length !== 1) return undefined;
    const club = found[0]!;
    if (isPlaceholderName(club.name) || namesNobody(club.name)) return undefined;
    if ([...schedules].some((each) => refusesName(refused, each, typed, club))) return undefined;
    const own = new Set((club.gcTeams ?? []).map((link) => link.teamId));
    const ownClub = (id: string) => (own.has(id) ? club.id : undefined);
    let first: string | undefined;
    for (const game of ownGamesOf(club)) {
      const inPool = poolKeyOf(game.ageGroupId) === pool;
      const other = game.teamAId === club.id ? game.teamBId : game.teamAId;
      for (const [, day] of ownRowDays(game, ownClub)) {
        if (inPool && (first === undefined || day < first)) first = day;
        // A club plays one game at a time (`ownClashes`).
        if (day === date && other !== row.namerId && startsWithinTheHour(game.startTs, row.start)) {
          return undefined;
        }
      }
    }
    // No first day is no limit, as the in-state rule reads it (`inItsSeason`).
    const from = first === undefined ? undefined : isoDayFrom(first, -NAMED_BEFORE_OWN_DAYS);
    return from === undefined || date >= from ? club : undefined;
  };
};

/** The owner's answers as the tidy reads them off a pool (`answeredNamesakes`). */
export const answeredIn = (
  state: GcImportState,
  teamOf: (teamId: string) => ScoutTeam | undefined,
  poolKeyOf: (ageGroupId: string) => string
): AnsweredLookup => {
  /** The games holding a row of each answered club's own schedules, by club: read once asked. */
  let ownGames: Map<string, ScoutGame[]> | undefined;
  const ownGamesOf = (club: ScoutTeam): ScoutGame[] => {
    if (!ownGames) {
      const byClub = new Map<string, ScoutGame[]>();
      const clubOfSchedule = new Map<string, string>();
      state.teams.forEach((team) => {
        if (team.namedAs?.length) {
          team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
        }
      });
      state.games.forEach((game) => {
        const days = ownRowDays(game, (schedule) => clubOfSchedule.get(schedule));
        new Set(days.map(([clubId]) => clubId)).forEach((clubId) => push(byClub, clubId, game));
      });
      ownGames = byClub;
    }
    return ownGames.get(club.id) ?? [];
  };
  return answeredNamesakes(state.teams, teamOf, ownGamesOf, poolKeyOf);
};

/**
 * Whether a pulled club's own schedules have a row that day starting within the hour of `start`
 * against a club other than `namerId`: a club plays one game at a time, so a name read as that club
 * there is somebody else. Read only once a row asks.
 */
const ownClashes = (
  state: GcImportState
): ((clubId: string, date: string, start: string | undefined, namerId: string) => boolean) => {
  /** Each pulled club's own rows by day, at their start and against whom. */
  let ownStarts: Map<string, { start: string | undefined; other: string }[]> | undefined;
  const ownStartsNow = () => {
    if (ownStarts) return ownStarts;
    const clubOfSchedule = new Map<string, string>();
    state.teams.forEach((team) =>
      team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
    );
    const starts = new Map<string, { start: string | undefined; other: string }[]>();
    state.games.forEach((game) =>
      ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([club, day]) => {
        const other = club === game.teamAId ? game.teamBId : game.teamAId;
        push(starts, `${club}\u0000${day}`, { start: game.startTs, other });
      })
    );
    ownStarts = starts;
    return starts;
  };
  return (clubId, date, start, namerId) =>
    (ownStartsNow().get(`${clubId}\u0000${date}`) ?? []).some(
      (row) => row.other !== namerId && startsWithinTheHour(row.start, start)
    );
};

/**
 * The pulled clubs each pulled club has met in a game both clubs' own schedules have a row in: what
 * the resettle reads two far-apart clubs' acquaintance by (`unvouched`).
 */
const bothListedOpponents = (state: GcImportState): Map<string, Set<string>> => {
  const clubOfSchedule = new Map<string, string>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
  );
  const opponents = new Map<string, Set<string>>();
  const add = (club: string, other: string) => {
    const bucket = opponents.get(club);
    if (bucket) bucket.add(other);
    else opponents.set(club, new Set([other]));
  };
  state.games.forEach((game) => {
    const clubs = new Set<string>();
    const of = (schedule: string) => {
      const club = clubOfSchedule.get(schedule);
      if (club !== undefined) clubs.add(club);
    };
    if (game.source) of(game.source.teamId);
    game.alsoRows?.forEach((record) => of(record.teamId));
    game.alsoFrom?.forEach(of);
    if (clubs.has(game.teamAId) && clubs.has(game.teamBId)) {
      add(game.teamAId, game.teamBId);
      add(game.teamBId, game.teamAId);
    }
  });
  return opponents;
};

/**
 * How rare a word of a name must be for `oneNamesake` to read it where the clubs' states say
 * nothing: no more than one in this many pulled names, as the in-state rule's rare reading was
 * measured (27 October 2026).
 */
const NAMESAKE_RARE_AMONG = 2_000;

/** A row a name filed, as `oneNamesake` asks of it: the name read loosely, and a level typed with it. */
type NamesakeRow = TimedNamedRow & { looseKey: string; typed: number | undefined };

/**
 * The pulled club a name means because it is the one pulled club that carries the name near the
 * club whose schedule wrote it down, though that club's own schedules have no game that day: in the
 * namer's state or one bordering it, or either of no known state, or further where the two clubs
 * have met or shared an opponent by both sides' own schedules (as the resettle reads it,
 * `unvouched`), at the row's level in its squad year; failing any there, the one whose name reads the same loosely
 * (`looseNameKey`: "Saint Louis Stars Baseball" and "St. Louis Stars"); failing that, the one of the
 * name within two levels, since a club plays up. Two is a guess, and none is read. And as with the
 * in-state rule: never a club named like a slot or nobody, on a day no earlier than a week before
 * its own first game of the year, never where one of its own rows that day starts within the hour
 * against another club, and never two levels from a level typed into the name where it is listed
 * nowhere within one of it (the resettle takes such a row off, `twoOff`, and the two must agree).
 *
 * The owner, 27 and 28 October 2026: "I need stand in games at or below 15%", then "If you can get
 * to 25%, great". On the cloud copy of 28 October (GitHub runs 40606022999 and 40607594214), 32.1% of
 * the year's games had a stand-in or a slot on a side. Boards trained with each name filed onto the
 * one pulled club of it on its page, any state, forecast the later games better than the boards as
 * they were (log loss +0.0005 ± 0.0002, z 2.0; Brier z 2.0, on 126,563 decided games), and the share
 * fell about four points; spelled near it, about 0.4 more, and the one within two levels about 1.7
 * more, neither forecasting measurably better or worse (z 1.4 and 0.2). Leaving the names' games out
 * instead forecast clearly worse (z -6.2 for the names holding one game), so this files them.
 *
 * Both tidy steps that read a club's own days ask this of the same row, and must agree: the refile
 * files the row, and the step that takes a name's rows off a club with no game that day leaves it.
 */
export const oneNamesake = (
  state: GcImportState,
  poolKeyOf: (ageGroupId: string) => string,
  rule: NamesakeRule | null | undefined,
  pulledNow: () => PulledNames = pulledNamesOf(state, poolKeyOf)
): ((row: NamesakeRow, why?: (reason: NamesakeRefusal) => void) => ScoutTeam | undefined) => {
  if (!rule)
    return (_row, why) => {
      why?.("off");
      return undefined;
    };
  const clashes = ownClashes(state);
  let met: Map<string, Set<string>> | undefined;
  /** As the resettle reads a name filed far from its namer (`unvouched`), so the two agree. */
  const backed = (namerId: string, clubId: string): boolean => {
    met ??= bothListedOpponents(state);
    const theirs = met.get(clubId);
    if (!theirs) return false;
    if (theirs.has(namerId)) return true;
    const ours = met.get(namerId);
    return [...theirs].some((other) => other !== clubId && ours?.has(other));
  };
  return ({ pool, key, looseKey, level, namer, date, start, typed }, why) => {
    const no = (reason: NamesakeRefusal) => {
      why?.(reason);
      return undefined;
    };
    if (date === undefined) return no("noDate");
    if (level === undefined) return no("noLevel");
    const pulled = pulledNow();
    // Near the namer, or far from it where the two clubs' own schedules meet: a Kentucky club
    // plays Michigan's all the time (the owner, 27 October 2026), and no border joins them.
    const near = (club: ScoutTeam) =>
      club.id !== namer?.id &&
      (!farApart(namer?.state, club.state) || (namer !== undefined && backed(namer.id, club.id)));
    const at = (from: Map<string, ScoutTeam[]>, name: string, levels: readonly number[]) => [
      ...new Set(
        levels.flatMap((at) => from.get(`${pool}\u0000${name}\u0000${at}`) ?? []).filter(near)
      ),
    ];
    let found = at(pulled.clubs, key, [level]);
    if (found.length === 0 && rule.loose) found = at(pulled.loose, looseKey, [level]);
    if (found.length === 0 && rule.levelsApart > 0) {
      const levels: number[] = [];
      for (let gap = 1; gap <= rule.levelsApart; gap += 1) levels.push(level - gap, level + gap);
      found = at(pulled.clubs, key, levels);
    }
    if (found.length === 0) return no("none");
    if (found.length > 1) return no("several");
    const club = found[0]!;
    if (isPlaceholderName(club.name) || namesNobody(club.name)) return no("slotName");
    // Where either club's state is unknown, or off the map of borders, nothing says the two are
    // near, and the one club of the name in the pool is the only one: a common name a club of no
    // known state wrote went onto the one club of it pulled at that level, in another country. So the name
    // must hold a word few pulled names do.
    if (
      !(onBorderMap(namer?.state) && onBorderMap(club.state)) &&
      !holdsRareWord(key, pulled, NAMESAKE_RARE_AMONG)
    ) {
      return no("commonWord");
    }
    if (!inItsSeason(pulled, club.id, pool, date)) return no("beforeSeason");
    const listed = pulled.listed.get(club.id);
    if (
      typed !== undefined &&
      listed?.size &&
      ![...listed].some((at) => Math.abs(at - typed) <= 1)
    ) {
      return no("typedLevel");
    }
    return clashes(club.id, date, start, namer?.id ?? "") ? no("clash") : club;
  };
};
