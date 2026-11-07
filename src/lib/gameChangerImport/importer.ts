/**
 * Filing pulled GameChanger schedules into the Team Rankings pool, one team at a time
 * (`importGcSchedule`, `createGcImporter`) or many in turn (`importGcSchedules`), and the summary
 * of what each did. Split out of `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  ageFitsBand,
  ageFromGradYearInName,
  ageLevelFromLooseName,
  ageLevelFromName,
  ageLevelOf,
  ageSpanFromName,
  formatGcSeason,
  type GcGame,
  gcSeasonIsCurrent,
  type GcTeamProfile,
  type GcTeamSchedule,
  isNotBaseball,
  isSchoolName,
  squadYearOfGcTeam,
} from "../gameChangerApi";
import {
  type AgeGroup,
  ageGroupYear,
  type GcAgeSource,
  gcRowId,
  inSquadYear,
  isRankedAgeLevel,
  matchExistingGame,
  mayTakeRow,
  MIN_AGE_LEVEL,
  sameGameEvidence,
  sameStart,
  scoreSeenBy,
  type ScoutGame,
  type ScoutTeam,
  squadYearForGcSeason,
  teamNameKey,
  withFiledMark,
  withNote,
  withSchedulesOf,
  withSideBReport,
} from "../teamRankings";
import { agelessEvidence } from "../agelessEvidence";
import {
  type DeletedClubs,
  type DeletedGames,
  isDeletedClub,
  isDeletedGame,
  isInventedSchedule,
} from "../deletedGames";
import { isTooYoungClub, type TooYoungClubs } from "../tooYoungClubs";
import { MIN_OPPONENT_AGE_EVIDENCE } from "../opponentAgeBar";
import { namedAgeFor, type NamedAges } from "../namedAges";
import { notATeamWord, type NotATeamWord } from "../teamNameRules";
import type { NotThisTeam } from "../notThisTeam";
import type { RetiredIds } from "../teamRankings/retiredIds";
import { todayIsoDay } from "../date";
import {
  addGame,
  buildIndex,
  type ImportIndex,
  indexFolded,
  indexHalf,
  isStandIn,
  matchKeyOf,
  movedPlace,
  noteAgeGroup,
  noteInPool,
  noteOpponent,
  notePlaces,
  push,
  restatePlaces,
} from "./poolIndex";
import {
  ageFromFixtures,
  gcGameId,
  oldestOpponentAge,
  profileAgeLevel,
  resolveAgeGroup,
  withOpponentAge,
} from "./ages";
import { ageLevelOfOutcome } from "./folds";
import {
  differs,
  filedMarkFor,
  heldOnRecord,
  isFilable,
  planOpponent,
  resolveOwnTeam,
  restsOnItsName,
  scoresAsExisting,
  skipReason,
  teamOfPlan,
  withOpponent,
  withTypedAs,
} from "./filing";
import type { GcImportOutcome, GcImportState } from "./types";
import { isScored } from "./rows";

/**
 * One pulled schedule, folded in.
 *
 * Returns the pool it would produce and a report of what it did. When the schedule cannot be filed
 * — no age level, or no season, so there is no page it belongs on — the pool comes back untouched
 * with the reason in `issue`, because filing a nationwide pull's worth of games under a guess is
 * worse than saying so.
 */
/**
 * The answers a pull carries with it: what the user has already decided, and what the app has
 * already learned.
 *
 * An object rather than a run of positional arguments because there are now three of them and
 * there will be more. Measured across the repo, 142 of the 147 calls to the three entry points
 * below pass only the schedule and the pool, so this costs five call sites and stops the next
 * answer being a fifth positional parameter nobody can read at a glance.
 */
export type GcImportOptions = {
  /** Rows the user has thrown out, so a re-pull does not file them again. */
  deleted?: DeletedGames;
  /** Clubs the user has thrown out, whose schedules are refused outright. */
  droppedClubs?: DeletedClubs;
  /** Ids already known to be below the youngest level ranked here. */
  tooYoung?: TooYoungClubs;
  /** The levels somebody named by hand, which beat GameChanger's own field. */
  namedAges?: NamedAges;
  /**
   * The names the owner has said are not a club, by the schedule that wrote them ("Not this
   * team", `notThisTeam.ts`): a row of the name off that schedule is filed onto anything but that
   * club, as though the club did not carry the name, unless the club's own schedule lists the game
   * against this one.
   */
  notThisTeam?: NotThisTeam;
  /**
   * The clubs the owner has vouched for, by club id or any GameChanger id of theirs, beside the
   * user's own club and a page's own team, which the pool itself says: those said to be real, and
   * the clubs a League Standings team links (`leagueLinkedClubs`). The tidy deletes none of them for
   * its name (`dropNotATeam`), so neither does the import refuse one's schedule on a word in it,
   * nor drop another club's row of a name that is one of them: the club kept would stop updating,
   * and the rows that confirm its games would come off them.
   */
  realClubs?: ReadonlySet<string>;
  /**
   * Whether `realClubs` is known to be short of clubs the owner vouched for: a cloud run that could
   * not read League Standings has the real list alone. The gate still turns away a drop word's row
   * then, as such a run files no page the rules refuse, but a game filed on the row before is left
   * standing rather than withdrawn (`refused`). The row may name a club League links, and the tidy
   * would take that club's game away for the night, where this run's tidy deletes no club for its
   * name at all. The next run that reads League settles the row.
   */
  realClubsShort?: boolean;
  /**
   * The day "you cannot score a game early" is judged against, as an ISO day.
   *
   * Only read to describe a team nobody could age, which is why it is here rather than threaded
   * through the fold: passing it means a test can say which day it is instead of depending on the
   * afternoon it runs on.
   */
  today?: string;
  /**
   * The baseball years this pull files, by `squadYearForGcSeason`: 2027 is Fall 2026 through
   * Summer 2027. A team whose GameChanger season falls in any other year is refused before its age
   * is read.
   *
   * A crawl that searches every season of a calendar year hands over last spring's and summer's
   * squads beside this fall's, and GameChanger mints a new id per team per season, so nothing
   * else in a list tells a finished year's team from one playing now. The panel passes the season
   * being played unless somebody ticks another. Absent means every year: the rota refreshes what
   * the pool already holds, and every caller before this one passed nothing.
   */
  seasonYears?: ReadonlySet<number>;
  /**
   * The teams `seasonYears` holds to, where it holds to only some: the nightly's rota files what
   * the pool already holds in whatever year it is, but asks beside it about the teams waiting on
   * an age, which have no page to say which season they are and are filed in the season being
   * played only, as **Ask again** files them. Absent means every team the pull asks about.
   */
  seasonYearsFor?: ReadonlySet<string>;
  /**
   * The ids the stored pool has let go of (`loadRetiredIds`), which no club made here is minted
   * as: a club folded or deleted would otherwise give its id to the next club of its letters, and
   * whatever named it, a League Standings pick above all, would name that club instead.
   */
  retired?: RetiredIds;
};

const NOTHING_DELETED: DeletedGames = new Set<string>();

const NO_CLUBS: DeletedClubs = new Set<string>();

const NOTHING_NAMED: NamedAges = new Map();

export const importGcSchedule = (
  schedule: GcTeamSchedule,
  state: GcImportState,
  options: GcImportOptions = {}
): { state: GcImportState; outcome: GcImportOutcome } => {
  // The fold works in place, so it is handed copies: a caller's pool is never altered under it.
  const working: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const result = importOne(schedule, working, buildIndex(working, options.retired), options);
  // Nothing could be filed, so hand back exactly what came in rather than a copy of it.
  return result.outcome.issue ? { state, outcome: result.outcome } : result;
};

/**
 * A pulled schedule with GameChanger's own reading of its age done again in the squad year the team
 * plays in, where that is not the year its season's label reads as (`squadYearOfGcTeam`).
 *
 * Only a class year reads differently from one year to the next — "2034" in the age field is 11U
 * in 2027 and 12U in 2028 — and only a level the profile's own ladder gave (`ageLevelOf`, read in
 * the label's year) is read again, so a level that came from anywhere else stands as it is.
 */
const withAgeReadIn = (schedule: GcTeamSchedule, squadYear: number): GcTeamSchedule => {
  const { profile } = schedule;
  if (!profile.season) return schedule;
  const labelYear = squadYearForGcSeason(profile.season.season, profile.season.year);
  if (squadYear === labelYear) return schedule;
  if (ageLevelOf(profile.ageLabel, profile.name, labelYear) !== profile.ageLevel) return schedule;
  const ageLevel = ageLevelOf(profile.ageLabel, profile.name, squadYear);
  if (ageLevel === profile.ageLevel) return schedule;
  const next: GcTeamProfile = { ...profile };
  if (ageLevel === undefined) delete next.ageLevel;
  else next.ageLevel = ageLevel;
  return { ...schedule, profile: next };
};

/**
 * Whether a club's own names carry the word a row's name hit: its stored name, or the GameChanger
 * name on one of its links. A row is matched to a club by the name key, and the key drops what a
 * bracket says, so "Tamberlane Tigers 12U (Scrimmage)" keys as plain "Tamberlane Tigers". The key
 * alone cannot tell a club whose own name reads as a tryout ("Workout Warriors"), which every row
 * of its name hits, from a row that adds a practice's word to a plain club's name; the club's own
 * names can.
 */
const carriesWord = (team: ScoutTeam, word: NotATeamWord): boolean =>
  [team.name, ...(team.gcTeams ?? []).map((link) => link.name)].some(
    (name) => notATeamWord(name)?.word === word
  );

/**
 * Whether the owner vouched for a club the pool holds (`GcImportOptions.realClubs`): the user's own
 * club, a page's own team, or one `real` names by its club id or any GameChanger id of it. No word
 * in such a club's name refuses its schedule, nor drops another club's row of its name.
 */
const vouchedClub = (
  team: ScoutTeam,
  real: ReadonlySet<string>,
  ageGroups: readonly AgeGroup[]
): boolean =>
  team.isMine === true ||
  real.has(team.id) ||
  (team.gcTeams ?? []).some((link) => real.has(link.teamId)) ||
  ageGroups.some((group) => group.myTeamId === team.id);

/**
 * Whether the import would file a GameChanger id's schedule whatever its name says, as its gate
 * asks it (`vouched` in `importOne`): the id is in `real`, or the club in `state` that carries it is
 * one the owner vouched for (`vouchedClub`). `real` is what the import is handed as `realClubs`,
 * the clubs League Standings links among them.
 *
 * For a pasted list, which reads a row's name before any request: a row whose name says it is no
 * team is left out there, and one of a club vouched for has to be kept, or the import could never
 * refresh that club from a paste although it would file the schedule.
 */
export const vouchedByImport = (
  state: GcImportState,
  real: ReadonlySet<string>
): ((gcTeamId: string) => boolean) => {
  // Each id's club as the import's index holds it (`indexTeam`): the last club carrying it.
  const carrier = new Map<string, ScoutTeam>();
  state.teams.forEach((team) =>
    (team.gcTeams ?? []).forEach((link) => carrier.set(link.teamId, team))
  );
  return (gcTeamId) => {
    if (real.has(gcTeamId)) return true;
    const team = carrier.get(gcTeamId);
    return team !== undefined && vouchedClub(team, real, state.ageGroups);
  };
};

const importOne = (
  pulled: GcTeamSchedule,
  state: GcImportState,
  index: ImportIndex,
  options: GcImportOptions
): { state: GcImportState; outcome: GcImportOutcome } => {
  const deleted = options.deleted ?? NOTHING_DELETED;
  const droppedClubs = options.droppedClubs ?? NO_CLUBS;
  const tooYoung = options.tooYoung ?? NO_CLUBS;
  const real = options.realClubs ?? NO_CLUBS;
  /** A club the owner vouched for (`GcImportOptions.realClubs`), whose name refuses nothing. */
  const vouchedFor = (team: ScoutTeam | undefined): boolean =>
    team !== undefined && vouchedClub(team, real, state.ageGroups);
  /*
   * The squad year the team plays in, which is its season label's except for a winter's: that
   * names either year it straddles, and the team's own games say which (`squadYearOfGcTeam`). Read
   * first, because the age is read in it too — the profile read a class year against the label's
   * later year, and a Winter 2027 squad playing from November 2026 is a level younger than that.
   */
  const seasonYear = pulled.profile.season
    ? squadYearOfGcTeam(pulled.profile.season, pulled.games, options.today ?? todayIsoDay())
    : undefined;
  const original = seasonYear === undefined ? pulled : withAgeReadIn(pulled, seasonYear);
  /*
   * Filled in before anything else looks at the profile, so the page, the link and the games all
   * agree on one level. A team GameChanger did not file under an age is filed under the one its
   * opponents keep naming, or under none at all.
   */
  /*
   * What GameChanger says right now, read before anything rewrites it. A level somebody named by
   * hand stands in only while this is what it was when they named it: the moment the club's own
   * page says something different, the club wins and the hand-named level is ignored.
   */
  const gcSaysNow = profileAgeLevel(original.profile);
  const named = namedAgeFor(options.namedAges ?? NOTHING_NAMED, original.profile.id, gcSaysNow);
  /*
   * A level somebody named by hand, applied before anything else looks at the profile — ahead of
   * GameChanger's own field rather than only in its absence. Everything downstream then agrees on
   * one level with no other change: the page it is filed under, the link written against the
   * team, and the age carried on each of its games.
   */
  const withNamed: GcTeamSchedule =
    named === undefined
      ? original
      : { ...original, profile: { ...original.profile, ageLevel: named } };
  /*
   * Then the league the user's list says this team plays in, when GameChanger itself said nothing.
   *
   * Below the club's own word and above its opponents': a league naming an age — "NKB 11u" — is a
   * statement about every team in it, which is stronger than reading the company a team keeps and
   * weaker than the club filling in its own page. It reaches here from `listed` rather than from
   * `profile` because GameChanger never said it: its public API has no route from a team to its
   * leagues, and only a crawl that found the team through one knows.
   *
   * Leagues only. A tournament is where a team plays up, so an age in one is a ceiling it reached
   * rather than the age it is — see `ageFromLeagueNames`.
   */
  /*
   * Never against GameChanger's own band. "Under 13" and "Between 13 - 18" bound an age without
   * giving one, and a list's age outside the bound is the list being wrong about the team: of the
   * 141 waiting teams a partial Organizations export of 22 September 2026 would age, the two whose
   * band it contradicted were "Ritter", filed "Under 13" and under a 16U organization, and
   * "Monster Blue", filed "Between 13 - 18" and under a 7U one.
   */
  const listedAge = withNamed.listed?.ageLevel;
  const fromLeague =
    profileAgeLevel(withNamed.profile) === undefined &&
    listedAge !== undefined &&
    ageFitsBand(listedAge, withNamed.profile.ageLabel)
      ? listedAge
      : undefined;
  const withLeague: GcTeamSchedule =
    fromLeague === undefined
      ? withNamed
      : { ...withNamed, profile: { ...withNamed.profile, ageLevel: fromLeague } };
  const fromNames = withOpponentAge(withLeague);
  const withOpponents = fromNames.schedule;
  /*
   * And after that, the clubs the games themselves identify: the other halves of this team's games
   * are already in the pool, filed by the clubs that played it.
   */
  const fromFixtures =
    profileAgeLevel(withOpponents.profile) === undefined
      ? ageFromFixtures(withOpponents, index, MIN_OPPONENT_AGE_EVIDENCE)
      : undefined;
  const withFixtures: GcTeamSchedule =
    fromFixtures === undefined
      ? withOpponents
      : { ...withOpponents, profile: { ...withOpponents.profile, ageLevel: fromFixtures } };
  /*
   * And very last, an age the name writes against its other words or without its U — "Spiders12U",
   * "10U_Hartman", "Giants 11-12". Last of everything rather than beside the name reader, so a team
   * anything else can age is aged by that, and no team the pool already files moves; see
   * `ageLevelFromLooseName`. Never against GameChanger's own band.
   */
  const loose =
    profileAgeLevel(withFixtures.profile) === undefined
      ? ageLevelFromLooseName(withFixtures.profile.name)
      : undefined;
  const fromLooseName =
    loose !== undefined && ageFitsBand(loose, withFixtures.profile.ageLabel) ? loose : undefined;
  const withLoose: GcTeamSchedule =
    fromLooseName === undefined
      ? withFixtures
      : { ...withFixtures, profile: { ...withFixtures.profile, ageLevel: fromLooseName } };
  /*
   * And only when none of that answered, the oldest age the team has played, until its opponents
   * settle one (`oldestOpponentAge`). A team the waiting list sets aside is not filed by it.
   */
  const fromOldest =
    profileAgeLevel(withLoose.profile) === undefined
      ? oldestOpponentAge(withLoose, index, options.today ?? todayIsoDay())
      : undefined;
  const schedule: GcTeamSchedule =
    fromOldest === undefined
      ? withLoose
      : { ...withLoose, profile: { ...withLoose.profile, ageLevel: fromOldest } };
  const inferred = fromNames.inferred ?? fromFixtures;
  const { profile } = schedule;
  const base: GcImportOutcome = {
    gcTeamId: profile.id,
    teamName: profile.name,
    teamId: "",
    ageGroupId: "",
    ageGroupName: "",
    createdAgeGroup: false,
    createdTeam: false,
    gamesAdded: 0,
    gamesUpdated: 0,
    gamesUnchanged: 0,
    gamesIgnored: 0,
    gamesOutOfSeason: 0,
    opponentsCreated: 0,
    opponentsMatchedByGame: 0,
    opponentsMatchedByName: 0,
    ...(inferred === undefined ? {} : { ageFromOpponents: inferred }),
    ...(named === undefined ? {} : { ageNamedByUser: named }),
    ...(fromLeague === undefined ? {} : { ageFromLeague: fromLeague }),
    ...(fromFixtures === undefined ? {} : { ageFromFixtures: fromFixtures }),
    ...(fromLooseName === undefined ? {} : { ageFromLooseName: fromLooseName }),
    ...(fromOldest === undefined ? {} : { ageFromOldest: fromOldest }),
  };

  /*
   * A club the user threw out, refused before a single game is read off it. Nothing later can do
   * this: the games would be filed, the team rebuilt from the profile, and the deletion undone by
   * the very pull that was meant to keep the pool clean.
   */
  if (isDeletedClub(droppedClubs, profile.id)) {
    return {
      state,
      outcome: {
        ...base,
        skip: "deleted",
        issue: "You deleted this club, so its schedule was not read.",
      },
    };
  }

  /*
   * A club GameChanger has already told us is too young, refused without reading its schedule.
   * The age is a fact about the squad and a GameChanger id is minted per team per season, so it
   * cannot come good as the club ages up — next year is a different id.
   */
  if (isTooYoungClub(tooYoung, profile.id)) {
    return {
      state,
      outcome: {
        ...base,
        skip: "below-min-age",
        issue: `This club is below ${MIN_AGE_LEVEL}U, so its schedule was not read again.`,
      },
    };
  }

  /*
   * A team from a season this pull was not asked for. Refused ahead of its age for the reason the
   * invented schedule below is: a team with no age would otherwise join the waiting list and be
   * asked about every week for a season nobody wanted. GameChanger's own season decides it, since
   * the list's column is a claim about the id and this is the answer. A team GameChanger gives no
   * season at all is left to the refusal that already says so, a few lines on.
   */
  if (
    options.seasonYears &&
    (options.seasonYearsFor?.has(profile.id) ?? true) &&
    profile.season &&
    seasonYear !== undefined &&
    !options.seasonYears.has(seasonYear)
  ) {
    return {
      state,
      outcome: {
        ...base,
        skip: "other-season",
        otherSeasonYear: seasonYear,
        issue: `${formatGcSeason(profile.season)} falls in the ${seasonYear} season, which this pull was not asked for, so its schedule was not read.`,
      },
    };
  }

  /*
   * A schedule nothing on which has happened yet and all of which already has a result. Refused
   * here, ahead of its age, because the age is the wrong question for it: an invented team with
   * no age would otherwise join the waiting list and be asked about every week, and one with an
   * age would file results nobody played. `inventedFromOutcomes` hands the id on to be remembered,
   * so the refusal outlasts the dates that give it away.
   */
  if (isInventedSchedule(schedule.games, options.today ?? todayIsoDay())) {
    return {
      state,
      outcome: {
        ...base,
        skip: "invented",
        issue:
          "Every game on its schedule has a result on a day that has not happened, so it was thrown out as invented.",
      },
    };
  }

  /*
   * The owner's word on a club beats a word in its name, at the door as in the tidy: a club on the
   * real list, the user's own, a page's own team, or one League Standings links, whose GameChanger
   * name happens to read as a practice or a tryout ("Workout Warriors"), is filed as any other.
   */
  const vouched = real.has(profile.id) || vouchedFor(index.teamByGcId.get(profile.id));
  const resolved = resolveAgeGroup(profile, state, seasonYear, vouched);
  if (!resolved) {
    const why = skipReason(profile, vouched);
    /*
     * A team nobody could age is filed nowhere and leaves no trace in the pool, so this outcome is
     * the only thing that ever escapes with what GameChanger said about it. Somebody has to look
     * at these by hand eventually, and the schedule that is in hand right here — the opponent
     * names, the dates, the scores, the roster count — is what they will need to tell a rec-league
     * team from an invention. Computed only for "no age", because it is the only refusal anyone
     * is ever asked to reconsider.
     */
    const today = options.today ?? todayIsoDay();
    /*
     * A team with nothing on its schedule is only worth asking about again in its own season, when
     * the schedule is a thing somebody has yet to write. From a season that is over or not begun,
     * nothing changes week to week, so it leaves the list rather than being asked every week —
     * and is not remembered, so the pull that meets it in its season files it as normal. A team
     * whose season GameChanger does not say is asked about as before.
     */
    if (
      why.code === "no-age" &&
      schedule.games.length === 0 &&
      profile.season &&
      !gcSeasonIsCurrent(profile.season, today)
    ) {
      return {
        state,
        outcome: {
          ...base,
          skip: "out-of-season",
          issue: `No age and no games, and its season (${formatGcSeason(profile.season)}) is not the one being played, so it was left for a later pull.`,
        },
      };
    }
    const evidence =
      why.code === "no-age" ? agelessEvidence(profile, schedule.games, today) : undefined;
    return {
      state,
      outcome: {
        ...base,
        skip: why.code,
        issue: why.message,
        ...(evidence ? { noAgeEvidence: evidence } : {}),
      },
    };
  }

  const { group, created: createdAgeGroup } = resolved;
  if (createdAgeGroup) noteAgeGroup(index, group);
  // The working arrays are mutated from here on; the public entry hands in copies.
  const teams = state.teams;
  const games = state.games;
  /*
   * Which rule of the ladder above answered, written on the link so the club's panel can say why
   * it is filed where it is. GameChanger's own reading is a ladder of its own (`ageLevelOf`): a
   * bracket in the name outranks the age field, and a name is read when the field says nothing,
   * so the field is read alone to tell which of the two it was.
   */
  const ageFrom: GcAgeSource | undefined =
    named !== undefined
      ? "you"
      : gcSaysNow !== undefined
        ? ageSpanFromName(original.profile.name) === undefined &&
          ageLevelOf(original.profile.ageLabel, "", seasonYear) === gcSaysNow
          ? "gamechanger"
          : "name"
        : fromLeague !== undefined
          ? "list"
          : fromNames.inferred !== undefined
            ? "opponents"
            : fromFixtures !== undefined
              ? "fixtures"
              : fromLooseName !== undefined
                ? "name"
                : fromOldest !== undefined
                  ? "tentative"
                  : undefined;
  // Read before this pull's link replaces it: whether the club was filed at a guess (`onClubPage`).
  const wasTentative =
    index.teamByGcId.get(profile.id)?.gcTeams?.find((link) => link.teamId === profile.id)
      ?.ageFrom === "tentative";
  const own = resolveOwnTeam(schedule, group.id, teams, index, ageFrom);
  const ourLevel = profileAgeLevel(profile);
  const outcome: GcImportOutcome = {
    ...base,
    teamId: own.teamId,
    ageGroupId: group.id,
    ageGroupName: group.name,
    createdAgeGroup,
    createdTeam: own.created,
  };

  const ageGroups = resolved.ageGroups;

  const squadYear = ageGroupYear(group);
  /*
   * The games this schedule's rows have matched from another schedule's copy, by the row that
   * matched each. One schedule lists one game once, so a second row off it is a second game unless
   * it is that same game listed twice — however close a doubleheader's other slot sits to it — and
   * the row that matched first is what says whether it is.
   */
  const claimed = new Map<string, ScoutGame>();
  /*
   * The club's own row on the page this pull files the club on, where the page it was filed at
   * before was the oldest of its opponents' (`oldestOpponentAge`), a guess this pull has replaced:
   * its opponents settled an age, GameChanger gave one, or an older opponent turned up. It takes its
   * own rows with it, as `setClubAge` moves them when somebody sets one; a row another club's
   * schedule filed stays on that club's page. Within the year's pool, which every index here is
   * keyed by, so the row is written in place. A club GameChanger moved from one age it gave to
   * another leaves its rows where they were filed, as it always has (`namesakeHalves.test`).
   *
   * The club's side takes the club's level with it where the row wrote one down, as `setClubAge`
   * writes it: a level left behind is read before the page's (`gameSideLevels`), so a club moved
   * from the 10U it was first filed at to the 9U its opponents settled kept its earlier games rated
   * as a 10U side's (Codex on #438).
   */
  const clubLevel = ourLevel ?? index.levelOf(group.id);
  /** The sides of every row moved off a guess, whose places are read again once the pull ends. */
  const leftGuess = new Set<string>();
  const onClubPage = (game: ScoutGame): ScoutGame => {
    if (
      !wasTentative ||
      game.source?.teamId !== profile.id ||
      game.ageGroupId === group.id ||
      index.poolKeyOf(game.ageGroupId) !== index.poolKeyOf(group.id)
    ) {
      return game;
    }
    leftGuess.add(game.teamAId);
    leftGuess.add(game.teamBId);
    const { ageLevelA, ageLevelB, ...rest } = game;
    const levelOn = (teamId: string, level: number | undefined) =>
      teamId === own.teamId && level !== undefined ? clubLevel : level;
    const a = levelOn(game.teamAId, ageLevelA);
    const b = levelOn(game.teamBId, ageLevelB);
    return {
      ...rest,
      ageGroupId: group.id,
      ...(a === undefined ? {} : { ageLevelA: a }),
      ...(b === undefined ? {} : { ageLevelB: b }),
    };
  };
  // Same id, same pool, same pair, same date, so nothing a game is filed under moves but its page.
  const writeInPlace = (previous: ScoutGame, next: ScoutGame) => {
    const position = index.gamePos.get(previous.id);
    if (position !== undefined) games[position] = next;
    index.gamesById.set(next.id, next);
    indexFolded(index, next);
    indexHalf(index, next);
    const sameBucket = index.gamesByMatch.get(matchKeyOf(next, index.poolKeyOf));
    if (sameBucket) {
      const at = sameBucket.findIndex((entry) => entry.id === next.id);
      if (at >= 0) sameBucket[at] = next;
    }
    if (next.date) {
      [next.teamAId, next.teamBId].forEach((teamId) => {
        const onDay = index.gamesByTeamDate.get(`${teamId}\u0000${next.date}`);
        const at = onDay?.findIndex((entry) => entry.id === next.id) ?? -1;
        if (onDay && at >= 0) onDay[at] = next;
      });
    }
    if (movedPlace(previous, next)) notePlaces(index, next);
  };
  /*
   * The same, for a game its own schedule has moved to another day: what is keyed by the day moves
   * with it. The rows folded into it that were filed on its old day move too, as the game their
   * clubs' schedules described (`FoldedRow.date` is only for a row filed a day off its game).
   */
  const refileInPlace = (previous: ScoutGame, moved: ScoutGame) => {
    const rows = (moved.alsoRows ?? []).map((record) => {
      /*
       * A claimed row (`FoldedRow.filedAgainst`) is on its own schedule's day, not on the day of the
       * copy that claimed it: the copy moving takes the game to another day and leaves that row
       * where its schedule put it. Carried along, the row went back to the team it was filed
       * against on the copy's new day, beside its own schedule's start on the old one.
       */
      if (
        record.filedAgainst !== undefined &&
        record.date === undefined &&
        previous.date !== undefined &&
        previous.date !== moved.date
      ) {
        const { teamId, gameId, startTs, ...rest } = record;
        return { teamId, gameId, ...(startTs ? { startTs } : {}), date: previous.date, ...rest };
      }
      if (record.date !== moved.date) return record;
      const { date: _same, ...rest } = record;
      return rest;
    });
    const next: ScoutGame = rows.length > 0 ? { ...moved, alsoRows: rows } : moved;
    const without = <K>(map: Map<K, ScoutGame[]>, key: K) => {
      const list = map.get(key);
      if (!list) return;
      const kept = list.filter((entry) => entry.id !== previous.id);
      if (kept.length > 0) map.set(key, kept);
      else map.delete(key);
    };
    without(index.gamesByMatch, matchKeyOf(previous, index.poolKeyOf));
    push(index.gamesByMatch, matchKeyOf(next, index.poolKeyOf), next);
    if (previous.date) {
      without(index.gamesByTeamDate, `${previous.teamAId}\u0000${previous.date}`);
      without(index.gamesByTeamDate, `${previous.teamBId}\u0000${previous.date}`);
    }
    if (next.date) {
      push(index.gamesByTeamDate, `${next.teamAId}\u0000${next.date}`, next);
      push(index.gamesByTeamDate, `${next.teamBId}\u0000${next.date}`, next);
    }
    const position = index.gamePos.get(previous.id);
    if (position !== undefined) games[position] = next;
    index.gamesById.set(next.id, next);
    indexFolded(index, next);
    indexHalf(index, next);
    if (movedPlace(previous, next)) notePlaces(index, next);
  };
  /** Every row this pull filed or matched, so a record of one it no longer lists can go. */
  const seen = new Set<string>();
  /** Rows found folded into a game with nothing to say where they were filed (`filedMarkFor`). */
  const unmarkedFolds: {
    holderId: string;
    game: GcGame;
    candidate: ScoutGame;
    theirLevel: number | undefined;
  }[] = [];
  /** Every row this schedule lists now, by id, so a game whose own row it dropped can be told. */
  const listed = new Map(
    schedule.games.filter(isFilable).map((game) => [gcGameId(profile.id, game.id), game])
  );
  /*
   * The listed rows the opponent gate turned away for a drop word in the name. Counted as listed,
   * they kept a game filed on them before the rule from ever being withdrawn, and only the gate
   * reads a row's own name. A stand-in is stored under the cleaned name, so "Rowanberry Rooks
   * (Scrimmage)" stood against plain "Rowanberry Rooks", which the tidy reads as a plain name and
   * keeps. Read as no longer listed (below), the game goes as a row a schedule drops goes, and the
   * pool is the one a fresh pull of the schedule makes.
   */
  const refused = new Set<string>();
  for (const game of schedule.games) {
    if (!isFilable(game)) {
      outcome.gamesIgnored += 1;
      continue;
    }
    // A game before August 1 of the year the squad year starts is last year's squad's, however
    // GameChanger lists it. Filed nowhere: it would count on this year's table at this level.
    if (!inSquadYear(game.date, squadYear)) {
      outcome.gamesOutOfSeason += 1;
      continue;
    }

    /*
     * This schedule's own copy of this game, if it has been pulled before. Found first, because the
     * opponent it already settled on is the answer — working it out again on a name that is
     * ambiguous would mint a fresh team, and a weekly re-pull would do that every week forever.
     */
    const byId = index.gamesById.get(gcGameId(profile.id, game.id));
    /*
     * Or the game this row was folded into, the last time it came: the other club's copy of it, or
     * this schedule's own copy listed twice. That is the same game whatever its start and result
     * say now, and it is found by id rather than asked about again.
     */
    const foldedId = byId ? undefined : index.foldedInto.get(gcGameId(profile.id, game.id));
    const foldedGame = foldedId === undefined ? undefined : index.gamesById.get(foldedId);
    // Only while this club is still on it: a game since moved to another club is not its copy.
    const onIt =
      foldedGame && (foldedGame.teamAId === own.teamId || foldedGame.teamBId === own.teamId)
        ? foldedGame
        : undefined;
    // A game standing on this very row under an earlier row's id, since that row went, is its own.
    const standsHere =
      onIt?.source?.teamId === profile.id && onIt.source.gameId === game.id ? onIt : undefined;
    const known = byId ?? standsHere;
    const folded = standsHere ? undefined : onIt;
    // A row folded into a game names its opponent too: the game's other side.
    const placedIn = known ?? folded;
    const knownOpponentId = placedIn
      ? placedIn.teamAId === own.teamId
        ? placedIn.teamBId
        : placedIn.teamAId
      : undefined;

    /*
     * A wiffle ball opponent takes the game with it. The result is not a baseball result, and
     * keeping it would both count for the club that played it and mint a wiffle team in the pool
     * off the back of somebody else's schedule — the one route by which one could arrive without
     * ever having been pulled.
     */
    if (isNotBaseball(game.opponentName)) {
      outcome.gamesIgnored += 1;
      continue;
    }

    /*
     * An opponent whose name says it is no team takes the game with it, on the same terms: a
     * practice, a scrimmage, a tryout or a squad playing itself is not a result for the club that
     * played it, and keeping it would mint the page in the pool off somebody else's schedule. Not
     * an old page's name (`OpponentGate`): that is a real team's old page, and its game is filed
     * against a slot of its own (`planOpponent`).
     */
    const word = notATeamWord(game.opponentName);
    /*
     * ...unless the name is a club the owner vouched for in this pool, filed then as any name is:
     * its games are real to them, and this row is the other side's word on one, which the club's
     * games keep as it confirms them. Only the club's own game that day takes it, as any name-filed
     * row; one its schedule does not bear out stands against a stand-in of the name, which the tidy
     * keeps as it keeps the club (`namedAfterSpared`), for the refile and claim steps to settle as
     * they settle any stand-in. Deleted, it took the game, and the next pull filed the row again
     * with nothing to stop it, every night. An old page's word needs no such reading:
     * its slot gate already files the row onto the one pulled club of the name that played that day.
     * Read only for a name a rule hits, which is few.
     *
     * Only where the club's own names carry the word the row hit (`carriesWord`): the club whose
     * name reads as a tryout. A row that puts the word in a bracket beside a plain club's name,
     * "(Scrimmage)", keys as that club, but says the game was a scrimmage, and goes as one would
     * against a club nobody vouched for. Let through, it went onto the club on a day it played, a
     * game more than its schedule lists, or onto a stand-in stored without the bracket, which the
     * tidy then read as a plain name and kept.
     */
    const namesVouched =
      word?.opponent === "drop" &&
      (
        index.teamIdsByPoolName.get(
          `${index.poolKeyOf(group.id)}\u0000${teamNameKey(game.opponentName)}`
        ) ?? []
      ).some((id) => {
        const team = index.teamsById.get(id);
        return team !== undefined && vouchedFor(team) && carriesWord(team, word.word);
      });
    if (word?.opponent === "drop" && !namesVouched) {
      outcome.gamesIgnored += 1;
      if (!options.realClubsShort) refused.add(gcGameId(profile.id, game.id));
      continue;
    }

    /*
     * A high school opponent takes the game with it, for the second of those two reasons rather
     * than the first. The result is a real baseball result — a travel side really did play the
     * local varsity — but the opponent is a club this app refuses, and keeping the row would mint
     * it into the pool off the back of somebody else's schedule. That is the one route by which a
     * refused team could arrive without ever having been pulled, and it would arrive un-refusable,
     * because nothing downstream re-reads an opponent's name.
     */
    if (isSchoolName(game.opponentName)) {
      outcome.gamesIgnored += 1;
      continue;
    }

    /*
     * A row the user has thrown out stays thrown out. Deleting one without this is deleting it
     * until the next pull of the same schedule, which finds it and files it again — and the rows
     * worth deleting are the ones a schedule keeps on offering: a score on a day that has not
     * happened, which cannot be a result and which GameChanger will go on reporting. Before its
     * opponent is looked for, too: a name nothing answered made a stand-in on every pull, for a
     * row that was never filed, and nothing took the stand-ins out again.
     */
    if (isDeletedGame(deleted, gcGameId(profile.id, game.id))) {
      outcome.gamesUnchanged += 1;
      continue;
    }

    let opponentId = knownOpponentId;
    /*
     * The opponent's name as this schedule types it now, and whether the coach has renamed it since
     * the row was filed (`ScoutGame.typedAs`): then the opponent the row settled on was the old
     * name's, and the row is filed by the new one, as a row first pulled under it would be, where
     * nothing but its name says who was played (`restsOnItsName`). The owner's case of 28 October
     * 2026: a one-word name, filed onto the one pulled club of it near the namer, renamed in full
     * to a club of a longer name, stayed on the first club through every pull after.
     */
    const typedAs = teamNameKey(game.opponentName);
    const renamed =
      known !== undefined &&
      known.typedAs !== undefined &&
      known.typedAs !== typedAs &&
      restsOnItsName(known, profile.id);
    if (renamed) {
      const plan = planOpponent(
        game,
        group.id,
        index,
        own.teamId,
        profile.id,
        true,
        options.notThisTeam
      );
      opponentId = teamOfPlan(plan, game.opponentName, index, teams);
      if (plan.basis === "created") outcome.opponentsCreated += 1;
      else if (plan.basis === "game") outcome.opponentsMatchedByGame += 1;
      else outcome.opponentsMatchedByName += 1;
    }
    /*
     * The other club's copy holding this schedule on record with no row kept (`alsoFrom` alone, from
     * before rows were kept), where this row is one its name files against nobody the pool knows,
     * within the hour of the copy and not scored apart from it (`heldOnRecord`). The record stood
     * for a row of this schedule's that day, and this is it: it goes back on record there, whole,
     * as it would have stayed had rows been kept. Filed as a game of its own, the record came off
     * (below), and the tidy could pair the copy with this club's other game against that club that
     * day, a 3-12 folded into a 6-3, where the kept row held the day apart.
     */
    let onRecord: ScoutGame | undefined;
    if (opponentId === undefined) {
      const plan = planOpponent(
        game,
        group.id,
        index,
        own.teamId,
        profile.id,
        true,
        options.notThisTeam
      );
      const named = "teamId" in plan ? index.teamsById.get(plan.teamId) : undefined;
      if ("create" in plan || named?.placeholder || isStandIn(named)) {
        onRecord = heldOnRecord(index, game, own.teamId, profile.id);
      }
      if (onRecord) {
        opponentId = onRecord.teamAId === own.teamId ? onRecord.teamBId : onRecord.teamAId;
      } else {
        opponentId = teamOfPlan(plan, game.opponentName, index, teams);
        if (plan.basis === "created") outcome.opponentsCreated += 1;
        else if (plan.basis === "game") outcome.opponentsMatchedByGame += 1;
        else outcome.opponentsMatchedByName += 1;
      }
    }
    /*
     * Their level is only ever a guess from the name; ours is what GameChanger said.
     *
     * A graduating class counts as one of those guesses. Above about 13U most names carry a year
     * rather than an age — "Elite 2031" — and reading nothing from them left the game with no
     * level for that side at all, which the rating reads as a game between equals: a 16U side
     * playing the class of 2031 was recorded as a same-level game, so no age adjustment was made
     * and `crossAgeGames` counted it as none. The year is read against the squad year of the page
     * the game is filed under, which is the season both sides were playing.
     */
    const theirYear = ageGroupYear(group);
    const theirLevel =
      ageLevelFromName(game.opponentName) ??
      (theirYear === undefined ? undefined : ageFromGradYearInName(game.opponentName, theirYear));
    const candidate: ScoutGame = {
      id: gcGameId(profile.id, game.id),
      teamAId: own.teamId,
      teamBId: opponentId,
      ageGroupId: group.id,
      ...(game.teamScore === undefined ? {} : { teamAScore: game.teamScore }),
      ...(game.opponentScore === undefined ? {} : { teamBScore: game.opponentScore }),
      ...(game.date ? { date: game.date } : {}),
      ...(ourLevel === undefined ? {} : { ageLevelA: ourLevel }),
      ...(theirLevel === undefined ? {} : { ageLevelB: theirLevel }),
      ...(profile.season ? { season: formatGcSeason(profile.season) } : {}),
      ...(game.startTs ? { startTs: game.startTs } : {}),
      ...(typedAs ? { typedAs } : {}),
      source: { kind: "gamechanger", teamId: profile.id, gameId: game.id },
    };

    seen.add(candidate.id);

    /*
     * A row folded into a game: its record there takes what the schedule now says, and side B's own
     * score goes beside side A's. Nothing else is decided here. Whether the row still belongs to
     * that game is the tidy's to say, with every row of the day in front of it
     * (`collapseSameGames`), and it moves the row or stands it up as a game of its own if a start
     * or a score now says otherwise.
     */
    if (folded) {
      claimed.set(folded.id, candidate);
      /*
       * A row filed on its game's day that its schedule has moved stays with the game: the game
       * moves when its own row does (`refileInPlace`), and a record dated apart from it here stood
       * up on the new day beside a game still on the old one — one rescheduled game counted twice.
       * A row already filed a day off its game (`FoldedRow.date`) keeps its schedule's day, and so
       * does a claimed row (`FoldedRow.filedAgainst`), which is not the game's copy by its id but a
       * row the claim reads by its day and start, and goes back if they stop fitting.
       */
      const record = (folded.alsoRows ?? []).find(
        (entry) => gcRowId(entry.teamId, entry.gameId) === candidate.id
      );
      // The record keeps the club the owner said the row's opponent is (`FoldedRow.namedByAvatar`):
      // a pull says nothing of it.
      const marked =
        record?.namedByAvatar === undefined
          ? candidate
          : { ...candidate, namedByAvatar: record.namedByAvatar };
      const updated = withSchedulesOf(
        folded,
        record &&
          record.date === undefined &&
          record.filedAgainst === undefined &&
          folded.date !== undefined
          ? { ...marked, date: folded.date }
          : marked
      );
      /*
       * This schedule's own game whose own row the schedule no longer lists — deleted, and entered
       * again under a new id. The game stands on this row from now: its source is this row, which
       * comes off the record, and its result and start are what this row says, set or cleared, the
       * deleted row's going with it. Kept as a record beside a row nobody lists, a correction to it
       * never reached the game — a 6-0 re-entered and put right as 7-0 stayed 6-0 — and one entered
       * again all day was split from the row it replaced, counted twice. The id stays, so nothing
       * filed against it moves; the index finds the game by this row's id. A second listing of a
       * game whose own row is still listed gives the game its score through the tidy instead, marked
       * as that listing's (`scoreFromTwin`), so it goes with the listing.
       */
      const ownSchedule = folded.source?.teamId === profile.id;
      const orphaned = ownSchedule && !listed.has(gcGameId(profile.id, folded.source!.gameId));
      const reentered: ScoutGame = orphaned
        ? (() => {
            const {
              alsoRows,
              scoreFromB,
              scoreFromTwin: _twin,
              startTs: _start,
              teamAScore,
              teamBScore,
              ...rest
            } = updated;
            const rows = (alsoRows ?? []).filter(
              (record) => gcRowId(record.teamId, record.gameId) !== candidate.id
            );
            const scores = scoresAsExisting(updated, candidate);
            return {
              ...rest,
              source: candidate.source!,
              ...(isScored(candidate)
                ? { teamAScore: scores.a, teamBScore: scores.b }
                : scoreFromB
                  ? { teamAScore, teamBScore, scoreFromB }
                  : {}),
              ...(candidate.startTs ? { startTs: candidate.startTs } : {}),
              ...(candidate.date ? { date: candidate.date } : {}),
              ...(rows.length > 0 ? { alsoRows: rows } : {}),
            };
          })()
        : updated;
      const next = onClubPage(withSideBReport(reentered, candidate) ?? reentered);
      if (record && record.filedAgainst === undefined) {
        unmarkedFolds.push({ holderId: folded.id, game, candidate, theirLevel });
      }
      const before = scoreSeenBy(folded, candidate.teamAId);
      const after = scoreSeenBy(next, candidate.teamAId);
      if (next.date !== folded.date) refileInPlace(folded, next);
      else if (next !== folded) writeInPlace(folded, next);
      if (before?.own !== after?.own || before?.opponent !== after?.opponent) {
        outcome.gamesUpdated += 1;
      } else {
        outcome.gamesUnchanged += 1;
      }
      continue;
    }

    // Two ways the game may already be here. The same schedule's same game id is certainly it —
    // and `matchExistingGame` will not find that one, because it looks for a *different* row
    // meaning the same thing. Failing that, the other team's copy of the game.
    const existing =
      known ??
      onRecord ??
      matchExistingGame(
        candidate,
        index.gamesByMatch.get(matchKeyOf(candidate, index.poolKeyOf)) ?? [],
        ageGroups,
        (game) => {
          const evidence = sameGameEvidence(candidate, game);
          if (evidence === undefined) return false;
          // Taken by a row off this schedule already: only as that same game listed twice.
          const earlier = claimed.get(game.id);
          if (earlier !== undefined) return sameGameEvidence(candidate, earlier) !== undefined;
          return mayTakeRow(game, candidate, evidence);
        }
      );
    // Back on record as it was folded, for the note to read as any fold with nothing to say where
    // its row was filed (`filedMarkFor`).
    if (onRecord) unmarkedFolds.push({ holderId: onRecord.id, game, candidate, theirLevel });
    if (!existing) {
      addGame(index, games, candidate);
      outcome.gamesAdded += 1;
      continue;
    }
    if (existing !== known) claimed.set(existing.id, candidate);
    /*
     * A start this schedule has since moved is taken, on its own row only. Every later comparison
     * reads the stored start, and one left behind made the next copy of the game look like another
     * game. Another schedule's start is never written over a row: that is the other coach's clock.
     */
    const moved =
      existing === known &&
      candidate.startTs !== undefined &&
      !sameStart(existing.startTs, candidate.startTs);
    /*
     * And a day it has since moved the game to, the same way: kept on the old day, the game stayed
     * there while the other club's copy of it, moved too, stood up on the new one.
     */
    const redated =
      existing === known && candidate.date !== undefined && candidate.date !== existing.date;
    /*
     * Another schedule's copy of a game leaves its schedule on record, which is how the tidy's
     * count knows this game already took this club's row for the day (`withSchedulesOf`).
     */
    const recorded =
      existing === known
        ? withTypedAs(onClubPage(existing), typedAs, renamed)
        : withSchedulesOf(existing, candidate);
    /*
     * A renamed row filed by its new name against another team than the one it stands against: the
     * game's other side goes, at the level the new name gives, and nothing else of it.
     */
    const ownSideA = existing.teamAId === own.teamId;
    const refiled =
      renamed &&
      existing === known &&
      (ownSideA ? existing.teamBId : existing.teamAId) !== candidate.teamBId;
    /*
     * The other club's own copy of the game: its score goes beside this one's rather than over it
     * (`withSideBReport`), so neither club's schedule speaks for the other's and the score no longer
     * flips to whichever of the two was pulled last. Only a change to what that club's own page
     * shows is news; the rest is bookkeeping.
     */
    const reported = existing === known ? undefined : withSideBReport(recorded, candidate);
    if (reported) {
      const before = scoreSeenBy(existing, candidate.teamAId);
      const after = scoreSeenBy(reported, candidate.teamAId);
      if (reported !== existing) writeInPlace(existing, reported);
      if (before?.own !== after?.own || before?.opponent !== after?.opponent) {
        outcome.gamesUpdated += 1;
      } else {
        outcome.gamesUnchanged += 1;
      }
      continue;
    }
    /*
     * This schedule's second listing of a game it already has: its score fills the game where the
     * row the game stands on has none of its own, marked as the listing's (`scoreFromTwin`) so it
     * goes with the listing, and is noted beside one it disagrees with — as the tidy has it
     * (`collapseSameGames`). Written over the game's own score, the listing's was then read as the
     * game's own row's, and neither a correction to the listing nor the listing proving to be a
     * second game ever took it back.
     */
    if (existing !== known && existing.source?.teamId === profile.id) {
      const own = isScored(existing) && !existing.scoreFromB && !existing.scoreFromTwin;
      const scores = scoresAsExisting(existing, candidate);
      const next: ScoutGame = !isScored(candidate)
        ? recorded
        : !own
          ? (() => {
              const { scoreFromB: _borrowed, scoreFromTwin: _twin, ...rest } = recorded;
              return { ...rest, teamAScore: scores.a, teamBScore: scores.b, scoreFromTwin: true };
            })()
          : existing.teamAScore !== scores.a || existing.teamBScore !== scores.b
            ? {
                ...recorded,
                note: withNote(recorded.note, `Also reported ${scores.a}-${scores.b}.`),
              }
            : recorded;
      const before = scoreSeenBy(existing, candidate.teamAId);
      const after = scoreSeenBy(next, candidate.teamAId);
      if (next !== existing) writeInPlace(existing, next);
      if (before?.own !== after?.own || before?.opponent !== after?.opponent) {
        outcome.gamesUpdated += 1;
      } else {
        outcome.gamesUnchanged += 1;
      }
      continue;
    }
    /*
     * Side A posting its own score over one borrowed from side B's schedule: the score is its own
     * now, even where it is the same one, and must not go with side B's row (`scoreFromB`).
     */
    const ownAtLast =
      existing === known &&
      isScored(candidate) &&
      (existing.scoreFromB === true || existing.scoreFromTwin === true);
    if (!differs(existing, candidate) && !moved && !redated && !ownAtLast && !refiled) {
      // The record is bookkeeping, not news: nothing the reader would call a change.
      if (recorded !== existing) writeInPlace(existing, recorded);
      outcome.gamesUnchanged += 1;
      continue;
    }
    /*
     * The existing row keeps its id and its side order; only what the pull actually learned is
     * written. In particular an unscored copy leaves the score alone: GameChanger posts a result on
     * one team's schedule before the other's, so the opponent's copy of a game that has been played
     * routinely arrives with nothing in it, and writing that over a real result would erase it.
     */
    const scores = scoresAsExisting(existing, candidate);
    /*
     * A result written over a different result is not a correction, it is a disagreement, and it
     * has to stay visible. Two rows for one fixture can report different scores — GameChanger
     * lists a game twice and the two copies do not always agree — and silently keeping the later
     * one would leave a club's record resting on whichever row happened to arrive second.
     *
     * Noted the way `collapseSameGames` notes the same thing when the two sides of a fixture
     * disagree, so there is one convention for it rather than two.
     */
    const displaced =
      !existing.scoreFromB &&
      !existing.scoreFromTwin &&
      isScored(candidate) &&
      isScored(existing) &&
      (existing.teamAScore !== scores.a || existing.teamBScore !== scores.b)
        ? `Also reported ${existing.teamAScore}-${existing.teamBScore}.`
        : undefined;
    const { scoreFromB: _borrowed, scoreFromTwin: _twin, ...unborrowed } = recorded;
    /*
     * A game the namesake join made, on its own schedule's pull: the age that schedule types for
     * side B now is the one to put back (`joinedFromLevel`), as `differs` reads it. Kept at the age
     * typed when it was joined, every pull after counted the game updated again, and a join taken
     * back put the row back at an age its schedule no longer says. Side B's own level stays.
     */
    const kept = ownAtLast ? unborrowed : recorded;
    const { joinedFromLevel: _typed, ...untyped } = kept;
    const joined = existing === known && existing.joinedFrom !== undefined;
    const base = joined
      ? candidate.ageLevelB === undefined
        ? untyped
        : { ...kept, joinedFromLevel: candidate.ageLevelB }
      : kept;
    const merged: ScoutGame = {
      ...(refiled ? withOpponent(base, ownSideA, candidate) : base),
      ...(isScored(candidate) ? { teamAScore: scores.a, teamBScore: scores.b } : {}),
      ...(candidate.season ? { season: candidate.season } : {}),
      ...(displaced ? { note: withNote(existing.note, displaced) } : {}),
      ...(moved ? { startTs: candidate.startTs } : {}),
      ...(redated ? { date: candidate.date } : {}),
    };
    if (redated || refiled) refileInPlace(existing, merged);
    else writeInPlace(existing, merged);
    /*
     * The team a renamed row is filed against now stands on the page at its level for the rest of the
     * pull, as a new row's would, which is where a later row of the name looks it up. Noted only where
     * a level moved (`refileInPlace`), a team made for the new name stood nowhere such a row looks,
     * and the pull made it twice (Codex on #480).
     */
    if (refiled) notePlaces(index, merged);
    outcome.gamesUpdated += 1;
  }

  /*
   * The other club's copy holding a row of this schedule with nothing to say where the row was
   * filed, whose name says it was filed against somebody else (`filedMarkFor`): marked as the claim
   * it is, so the claim step can give it back. Read once every row of the answer is in the pool, as
   * a row it waits on, or one standing under the same name, may come later in the answer than the
   * fold does. A team is made for the name only here, once the mark is decided, and noted as the row
   * standing against it would have been.
   */
  if (unmarkedFolds.length > 0) {
    const standingByName = new Map<string, Set<string>>();
    (index.gamesBySchedule.get(profile.id) ?? new Set<string>()).forEach((gameId) => {
      const standing = index.gamesById.get(gameId);
      if (standing?.source?.teamId !== profile.id) return;
      const typed = listed.get(gcGameId(profile.id, standing.source.gameId));
      if (!typed) return;
      const against = standing.teamAId === own.teamId ? standing.teamBId : standing.teamAId;
      const key = teamNameKey(typed.opponentName);
      const bucket = standingByName.get(key);
      if (bucket) bucket.add(against);
      else standingByName.set(key, new Set([against]));
    });
    const marks = unmarkedFolds.flatMap(({ holderId, game, candidate, theirLevel }) => {
      const holder = index.gamesById.get(holderId);
      const record = holder?.alsoRows?.find(
        (entry) => gcRowId(entry.teamId, entry.gameId) === candidate.id
      );
      if (!holder || !record) return [];
      const plan = filedMarkFor(index, {
        game,
        candidate,
        holder,
        record,
        ownTeamId: own.teamId,
        sourceTeamId: profile.id,
        ageGroupId: group.id,
        theirLevel,
        standingByName,
      });
      return plan ? [{ holder, game, candidate, theirLevel, plan }] : [];
    });
    type Mark = (typeof marks)[number];
    /*
     * Rows naming one team on one day go to one club or none (`claimFiledRows`). Marks under one
     * name that day in two clubs' copies, or beside a claim of this club's against that team in
     * another club's copy, were all stood back up by the claim step, each beside the copy it had
     * been in: two games, each counted twice.
     */
    const nameOf = (mark: Mark) =>
      "teamId" in mark.plan ? mark.plan.teamId : `\u0000${teamNameKey(mark.game.opponentName)}`;
    const dayOf = (mark: Mark) => `${mark.candidate.date}\u0000${nameOf(mark)}`;
    const clubsOn = new Map<string, Set<string>>();
    const onDay = (key: string, clubId: string) => {
      const bucket = clubsOn.get(key);
      if (bucket) bucket.add(clubId);
      else clubsOn.set(key, new Set([clubId]));
    };
    marks.forEach((mark) => {
      onDay(dayOf(mark), mark.holder.teamAId);
      if (!("teamId" in mark.plan)) return;
      const against = mark.plan.teamId;
      (index.gamesByTeamDate.get(`${own.teamId}\u0000${mark.candidate.date}`) ?? []).forEach(
        (stale) => {
          const other = index.gamesById.get(stale.id);
          other?.alsoRows?.forEach((record) => {
            if (record.filedAgainst !== against) return;
            if (index.teamByGcId.get(record.teamId)?.id !== own.teamId) return;
            onDay(dayOf(mark), record.onSideB ? other.teamAId : other.teamBId);
          });
        }
      );
    });
    /** The team each name is marked against: made once, where the plan makes one. */
    const markedAgainst = new Map<string, string>();
    marks.forEach((mark) => {
      if ((clubsOn.get(dayOf(mark))?.size ?? 0) > 1) return;
      let against = markedAgainst.get(nameOf(mark));
      if (against === undefined) {
        against = teamOfPlan(mark.plan, mark.game.opponentName, index, teams);
        if ("create" in mark.plan) {
          noteInPool(index, group.id, against, mark.theirLevel ?? index.levelOf(group.id));
          noteOpponent(index, own.teamId, against);
          noteOpponent(index, against, own.teamId);
          outcome.opponentsCreated += 1;
        }
        markedAgainst.set(nameOf(mark), against);
      }
      const holder = index.gamesById.get(mark.holder.id) ?? mark.holder;
      writeInPlace(holder, withFiledMark(holder, mark.candidate.id, against, mark.theirLevel));
    });
  }

  /*
   * What this answer can say is gone. Nothing, from an answer with no row it could file: every row
   * undated, or cancelled, is as likely a field GameChanger renamed as a club that cancelled its
   * season, and trusting it took a club's every game. And not a row the answer held in a shape this
   * app could not read — an entry with no opponent (`rowIds`) — which is not a row it dropped.
   */
  const readable = new Set(schedule.games.map((game) => gcGameId(profile.id, game.id)));
  const returned = schedule.rowIds
    ? new Set(schedule.rowIds.map((id) => gcGameId(profile.id, id)))
    : undefined;
  const unread = (rowId: string) =>
    returned !== undefined && returned.has(rowId) && !readable.has(rowId);
  const trusted = listed.size > 0;

  /*
   * A game standing on a row this schedule no longer lists — deleted, cancelled, moved off the day,
   * or turned away by the opponent gate for a drop word in the name (`refused`, above) — is marked
   * for the tidy to take away, and one standing on a row listed again is unmarked
   * (`ScoutGame.withdrawn`). Not a game holding another row of this schedule's that it still lists:
   * that is the game entered again, which its next pull stands on the new row under the old id (the
   * folded row above). Nor a game that holds another club's copy only as a schedule on record
   * (`alsoFrom`, from before rows were kept): with no row to stand up, that club's copy would go
   * with it until its own next pull.
   */
  if (trusted) {
    const stillListed = (teamId: string, gameId: string) =>
      teamId === profile.id &&
      ((listed.has(gcGameId(teamId, gameId)) && !refused.has(gcGameId(teamId, gameId))) ||
        unread(gcGameId(teamId, gameId)));
    (index.gamesBySchedule.get(profile.id) ?? new Set<string>()).forEach((gameId) => {
      const game = index.gamesById.get(gameId);
      if (!game?.source || game.source.teamId !== profile.id) return;
      const named = new Set((game.alsoRows ?? []).map((record) => record.teamId));
      const onRecordOnly = (game.alsoFrom ?? []).some((schedule) => !named.has(schedule));
      const gone =
        !onRecordOnly &&
        !stillListed(game.source.teamId, game.source.gameId) &&
        !(game.alsoRows ?? []).some((record) => stillListed(record.teamId, record.gameId));
      if (gone === (game.withdrawn === true)) return;
      if (gone) {
        writeInPlace(game, { ...game, withdrawn: true });
      } else {
        const { withdrawn: _gone, ...rest } = game;
        writeInPlace(game, rest);
      }
    });
  }

  /*
   * A record of a row this schedule no longer files — deleted, cancelled, moved off the day — goes,
   * so a game does not go on standing for a row that is not there, and the tidy does not stand up
   * a row nobody lists. From the same answers only, and never a row the answer held unread: an
   * empty answer took the other club's copy out of every game this club's rows were folded into.
   *
   * And this schedule on record in a game with no row of it kept (`alsoFrom` alone, from before
   * rows were kept), where this answer filed no row into the game. Every row it files goes on
   * record whole, so the one the game held on record is a row it no longer files there — deleted,
   * or filed now against another name. Left on record, it answered for this club's row that day
   * with no row to read: the claim step took the game as this club's already, and the row filed
   * against another name, the same game, stood beside it and counted twice. Which row the record
   * stood for is not known, so one the answer held unread cannot keep it.
   */
  (trusted ? (index.recordsBySchedule.get(profile.id) ?? new Set<string>()) : []).forEach(
    (holderId) => {
      const holder = index.gamesById.get(holderId);
      if (!holder) return;
      const rows = holder.alsoRows ?? [];
      const onRecordOnly =
        (holder.alsoFrom ?? []).includes(profile.id) &&
        !rows.some((row) => row.teamId === profile.id);
      const kept = rows.filter(
        (row) =>
          row.teamId !== profile.id ||
          seen.has(gcRowId(row.teamId, row.gameId)) ||
          unread(gcRowId(row.teamId, row.gameId))
      );
      if (kept.length === rows.length && !onRecordOnly) return;
      const named = kept.some((row) => row.teamId === profile.id);
      const alsoFrom = named
        ? holder.alsoFrom
        : (holder.alsoFrom ?? []).filter((source) => source !== profile.id);
      const { alsoRows: _rows, alsoFrom: _from, ...rest } = holder;
      writeInPlace(holder, {
        ...rest,
        ...(alsoFrom && alsoFrom.length > 0 ? { alsoFrom } : {}),
        ...(kept.length > 0 ? { alsoRows: kept } : {}),
      });
    }
  );

  restatePlaces(index, games, leftGuess);
  return { state: { ageGroups, teams, games }, outcome };
};

/** Every schedule in turn, each seeing what the ones before it added. */
/**
 * A fold held open across schedules, for a caller that gets them one at a time.
 *
 * `importGcSchedule` is a whole fold in itself: it copies the pool and builds an index of it, uses
 * them once, and throws the index away. That is right for one schedule and ruinous for thousands —
 * a pull calls it per team as each answer lands, so the work is redone over a pool that is growing
 * underneath it, and a run of several thousand spends most of its time rebuilding what it just
 * built. `importGcSchedules` already avoids that, but only for a caller holding every schedule at
 * once, which a pull never is: it folds each one in as it arrives so that stopping keeps what has
 * already been fetched.
 *
 * So this is the same fold with the index kept. One copy, one index, and each schedule costs what
 * it actually adds. `state` is the pool as it stands after everything folded in so far, safe to
 * hand to a save at any point.
 */
export type GcImporter = {
  /** Folds one schedule in and reports what happened to that team. */
  add: (schedule: GcTeamSchedule) => GcImportOutcome;
  /** The pool as it stands. The same arrays the fold is working in, not a copy. */
  readonly state: GcImportState;
};

export const createGcImporter = (
  state: GcImportState,
  options: GcImportOptions = {}
): GcImporter => {
  let next: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const index = buildIndex(next, options.retired);
  return {
    add: (schedule) => {
      const result = importOne(schedule, next, index, options);
      next = result.state;
      return result.outcome;
    },
    get state() {
      return next;
    },
  };
};

export const importGcSchedules = (
  schedules: GcTeamSchedule[],
  state: GcImportState,
  options: GcImportOptions = {}
): { state: GcImportState; outcomes: GcImportOutcome[] } => {
  // One index and one set of working arrays for the whole fold. Rebuilding either per schedule is
  // what made a large import quadratic: the index turned every lookup into a scan, and copying the
  // arrays turned every added game into a copy of every game before it.
  let next: GcImportState = {
    ageGroups: state.ageGroups.slice(),
    teams: state.teams.slice(),
    games: state.games.slice(),
  };
  const index = buildIndex(next, options.retired);
  const outcomes: GcImportOutcome[] = [];
  for (const schedule of schedules) {
    const result = importOne(schedule, next, index, options);
    next = result.state;
    outcomes.push(result.outcome);
  }
  return { state: next, outcomes };
};

/**
 * What a finished pull did, in one line per thing worth saying. The panel shows this above the
 * per-team rows, which for a nationwide pull are far too many to read.
 */
export const summarizeGcImport = (outcomes: GcImportOutcome[]): string[] => {
  const filed = outcomes.filter((outcome) => !outcome.issue);
  // Left out because the pull was told to leave them out, which is not the same as failing.
  const otherSeason = outcomes.filter((outcome) => outcome.skip === "other-season").length;
  // Left for the pull that meets them in their season, which is not failing either.
  const later = outcomes.filter((outcome) => outcome.skip === "out-of-season").length;
  const failed = outcomes.length - filed.length - otherSeason - later;
  const sum = (pick: (outcome: GcImportOutcome) => number) =>
    filed.reduce((total, outcome) => total + pick(outcome), 0);

  const lines: string[] = [];
  lines.push(
    `${filed.length} schedule${filed.length === 1 ? "" : "s"} read${
      failed ? `, ${failed} that could not be filed` : ""
    }.`
  );
  if (otherSeason > 0) {
    lines.push(
      `${otherSeason} team${otherSeason === 1 ? "" : "s"} from a season this pull was not asked for left out.`
    );
  }
  if (later > 0) {
    lines.push(
      `${later} team${later === 1 ? "" : "s"} with no age and no games, from a season not being played, left for a later pull.`
    );
  }

  const outOfSeason = sum((outcome) => outcome.gamesOutOfSeason);
  if (outOfSeason > 0) {
    lines.push(
      `${outOfSeason} game${outOfSeason === 1 ? "" : "s"} dated before the season began (August 1) left out.`
    );
  }
  const added = sum((outcome) => outcome.gamesAdded);
  const updated = sum((outcome) => outcome.gamesUpdated);
  const unchanged = sum((outcome) => outcome.gamesUnchanged);
  lines.push(
    `${added} game${added === 1 ? "" : "s"} added, ${updated} updated, ${unchanged} already had.`
  );

  const createdTeams = filed.filter((outcome) => outcome.createdTeam).length;
  const createdOpponents = sum((outcome) => outcome.opponentsCreated);
  const byGame = sum((outcome) => outcome.opponentsMatchedByGame);
  const byName = sum((outcome) => outcome.opponentsMatchedByName);
  lines.push(
    `${createdTeams + createdOpponents} team${
      createdTeams + createdOpponents === 1 ? "" : "s"
    } new, ${byGame} opponent${byGame === 1 ? "" : "s"} found by the game, ${byName} by name.`
  );

  const newPages = filed.filter((outcome) => outcome.createdAgeGroup);
  if (newPages.length) {
    lines.push(
      `${newPages.length} page${newPages.length === 1 ? "" : "s"} created: ${newPages
        .map((outcome) => outcome.ageGroupName)
        .join(", ")}.`
    );
  }

  const unranked = filed.filter((outcome) => !isRankedAgeLevel(ageLevelOfOutcome(outcome))).length;
  if (unranked) {
    lines.push(
      `${unranked} went to a level that is not ranked; those games count as evidence about the older teams that played them.`
    );
  }

  const ignored = sum((outcome) => outcome.gamesIgnored);
  if (ignored) {
    lines.push(`${ignored} listed game${ignored === 1 ? " was" : "s were"} cancelled or undated.`);
  }
  return lines;
};
