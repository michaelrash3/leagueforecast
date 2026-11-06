/**
 * What an import is handed and hands back: the pool as it stands (`GcImportState`), one pulled
 * team's outcome (`GcImportOutcome`), why a team was refused (`GcSkipReason`), and a pairing of two
 * squads' seasons offered for approval (`GcSeasonPairing`). Split out of `gameChangerImport.ts`,
 * which re-exports each.
 */

import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import type { AgelessEvidence } from "../agelessEvidence";
import type { GcPairingEvidence } from "../gcPairingEvidence";

/** The pool, as the importer reads and returns it. */
export type GcImportState = {
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
};

/** What one team's schedule did to the pool. One row of the panel's report. */
export type GcImportOutcome = {
  gcTeamId: string;
  teamName: string;
  /** The team in our roster this schedule belongs to. */
  teamId: string;
  /** The page its games were filed under. */
  ageGroupId: string;
  ageGroupName: string;
  /** A group that did not exist until this schedule arrived. */
  createdAgeGroup: boolean;
  /** This GameChanger id had never been pulled before. */
  createdTeam: boolean;
  gamesAdded: number;
  /** Matched an existing game and changed something — usually a score that has since been played. */
  gamesUpdated: number;
  /** Matched an existing game with nothing to change. */
  gamesUnchanged: number;
  /** Listed by GameChanger but not filed: cancelled, or missing the date a game is matched on. */
  gamesIgnored: number;
  /** Dated before this squad year began (or after it ends): last year's squad's games. */
  gamesOutOfSeason: number;
  opponentsCreated: number;
  /** Found by the other club's own row of the game (`opponentFromSameFixture`). */
  opponentsMatchedByGame: number;
  opponentsMatchedByName: number;
  /**
   * The level this team was filed under because its opponents named one, GameChanger having named
   * none. Absent whenever the team said its own age, which is nearly always.
   */
  ageFromOpponents?: number;
  /** The level a person named by hand, which was used in place of whatever GameChanger said. */
  ageNamedByUser?: number;
  /**
   * The level a league the user's list names filed this team under, GameChanger having named
   * none. Recorded for the same reason as the two above: a level the club did not state itself
   * is worth being able to trace back to whoever did.
   */
  ageFromLeague?: number;
  /**
   * The level this team was filed under because the pulled clubs whose own schedules hold its
   * games are filed there (`ageFromFixtures`). Also counted in `ageFromOpponents`, which it is a
   * kind of; kept apart so a level can be traced to the rung that set it.
   */
  ageFromFixtures?: number;
  /**
   * The level read off the name by `ageLevelFromLooseName` — glued to its other words, or a span
   * written without its U — nothing else having answered. Kept so the level can be traced.
   */
  ageFromLooseName?: number;
  /**
   * The oldest age the team's opponents are, where nothing above answered and its opponents do not
   * yet settle one (`oldestOpponentAge`): the level it is filed at until they do.
   */
  ageFromOldest?: number;
  /** Which way it could not be filed, for anything deciding what to do about it. */
  skip?: GcSkipReason;
  /** Set when the schedule could not be filed at all; the pool is returned untouched. */
  issue?: string;
  /**
   * The squad year the team plays in, on a team refused as another season's (`other-season`), so
   * the refusal can be remembered against that year and hold only while it is not asked for.
   */
  otherSeasonYear?: number;
  /**
   * What GameChanger said about a team nobody could age.
   *
   * Present only with `skip: "no-age"`. The team is filed nowhere, so this outcome is the only
   * route out for anything a person would need to judge it by later.
   */
  noAgeEvidence?: AgelessEvidence;
};

/** A club that looks like the same club a season later, offered for the user to confirm. */
export type GcSeasonPairing = {
  /** The earlier squad. */
  fromTeamId: string;
  fromTeamName: string;
  fromSeason: string;
  /** The later squad, a season on. */
  toTeamId: string;
  toTeamName: string;
  toSeason: string;
  /**
   * The two GameChanger ids this pairing is really about.
   *
   * The team ids above are this app's own and do not survive the answer: folding deletes one of
   * them, and a reset mints new ones for everybody. A GameChanger id is minted once by
   * GameChanger and never again, so it is what a decision about this pair — "yes, fold" or "no,
   * these are two clubs" — has to be recorded against if it is to mean anything after the next
   * pull. See `keptApart.ts`.
   */
  fromGcId: string;
  toGcId: string;
  /**
   * What says these are one club, beyond the name. Never empty: a shared name alone is not
   * evidence, because the country is full of clubs that share one.
   */
  evidence: GcPairingEvidence[];
  /** Whether the name matches too, which is corroboration rather than the case on its own. */
  sameName: boolean;
  /** Two coaches in common, or a town they both give, is as strong as this gets. */
  confidence: "strong" | "likely";
  /**
   * What kind of pairing this is, because the two read very differently to whoever is deciding.
   *
   * "next-season" is a squad carrying on — a Fall id and the Spring id that follows it. "same
   * season" is one squad listed twice inside a single season, which is not a squad carrying on at
   * all: GameChanger mints an id per team per season, and a club that creates one, abandons it and
   * creates another ends up with two ids for one roster in one season, one of them holding every
   * game and the other holding whatever other schedules happened to name it.
   */
  kind: "next-season" | "same-season";
};

/**
 * Why a schedule was left where it was — a code as well as a sentence.
 *
 * The code matters because the four are not the same kind of problem. A team with no age might
 * have one next week: GameChanger's field gets filled in, a club renames a squad, or the team
 * plays more games against opponents who do name an age. A 6U team never will. So one of these is
 * worth asking about again every week and the others are not, and telling them apart by reading
 * the sentence would break the first time somebody reworded it.
 */
export type GcSkipReason =
  /** A club the user threw out. Refused before a game is read, or the pull rebuilds it. */
  | "deleted"
  | "no-age"
  | "below-min-age"
  | "above-max-age"
  | "no-season"
  /**
   * A wiffle ball, blitzball or softball team. A different game, so its results belong to no
   * baseball ranking.
   */
  | "not-baseball"
  /**
   * A page whose name says it is no team (`notATeamWord`): a practice, a scrimmage, a test, an old
   * page marked do not use. Not remembered for good, since a coach can rename the page.
   */
  | "not-a-team"
  /** A high school squad. A different season, played against a pool this app does not hold. */
  | "high-school"
  /** Grown men or a college side. There is no youth age to find, so it is never asked about. */
  | "not-youth"
  /**
   * Every game on the schedule has a result on a day that has not happened. Refused before its
   * age is asked, and remembered with the clubs the user threw out; see `isInventedSchedule`.
   */
  | "invented"
  /**
   * No age, no games, and a season that is not the one being played. Not remembered anywhere:
   * the team leaves the waiting list, and a later pull may find it again once its season comes
   * round with a schedule. See `gcSeasonIsCurrent`.
   */
  | "out-of-season"
  /**
   * A team from a season this pull was not asked for: its GameChanger season falls in a baseball
   * year outside `GcImportOptions.seasonYears`. Refused before its age is read, and not remembered
   * anywhere, because a later pull that ticks that year should file it as normal.
   */
  | "other-season";
