/**
 * Where a pulled schedule's rows go: which club pulled them, which club each opponent is (the game
 * itself first, where the other club's own schedule holds it, then the name), why a team is left
 * out, and what each row is filed against. Split out of `gameChangerImport.ts`.
 */

import {
  ageFromGradYearInName,
  ageLevelFromName,
  type GcGame,
  type GcTeamProfile,
  type GcTeamSchedule,
  isAdultAgeLabel,
  isNotBaseball,
} from "../gameChangerApi";
import {
  buildScoutTeam,
  cleanTeamName,
  CLOSE_DISPUTE_RUNS,
  type FoldedRow,
  type GcAgeSource,
  type GcTeamLink,
  isPlaceholderName,
  MAX_AGE_LEVEL,
  MIN_AGE_LEVEL,
  nameFitsWithin,
  namesNobody,
  normalizeState,
  sameStart,
  type ScoutGame,
  type ScoutTeam,
  startsWithinTheHour,
  teamNameKey,
} from "../teamRankings";
import { listedByOwn, NO_REFUSALS, type NotThisTeam, refusesName } from "../notThisTeam";
import { MIN_OPPONENT_AGE_EVIDENCE } from "../opponentAgeBar";
import { notATeamWord } from "../teamNameRules";
import {
  addTeam,
  type ImportIndex,
  levelFits,
  nameSlotKey,
  noteInPool,
  PLAYS_UP_TO,
  replaceTeam,
} from "./poolIndex";
import { type AnsweredLookup, answeredNamesakes } from "./namesakes";
import { aroundDay, couldStillBeCopy, isoDayFrom, isScored, ownRowDays } from "./rows";
import type { GcSkipReason } from "./types";
import { isSchoolTeam, profileAgeLevel } from "./ages";

export const skipReason = (
  profile: GcTeamProfile,
  /** As `resolveAgeGroup` was asked it: a club the owner vouched for is not refused on a word. */
  vouched: boolean
): { code: GcSkipReason; message: string } => {
  if (isNotBaseball(profile.name)) {
    return {
      code: "not-baseball",
      message:
        "This is a wiffle ball, blitzball or softball team, which is a different game, so it was left out.",
    };
  }
  // Before the age readings, as `resolveAgeGroup` asks it: a good age does not make a practice
  // account a team. The word goes in the sentence, so a page refused on a word can be checked.
  const notATeam = vouched ? null : notATeamWord(profile.name);
  if (notATeam?.word === "team") {
    return {
      code: "not-a-team",
      message:
        "This page is named only “Team”, with nothing more than a number, a letter or an age: " +
        "the name a page has when nobody named it, so it was left out. Its name says " +
        `“${notATeam.text}”.`,
    };
  }
  if (notATeam) {
    return {
      code: "not-a-team",
      message:
        "This page's name says it is not a real team (a practice, scrimmage, test or placeholder " +
        `page, or one marked do not use), so it was left out. Its name says “${notATeam.text}”.`,
    };
  }
  /*
   * Before the school test, because the two read the same field and an over-18 men's league is
   * the more certain of the two readings: `college` and `Over 18` describe who is playing rather
   * than what season they play it in.
   */
  if (isAdultAgeLabel(profile.ageLabel)) {
    return {
      code: "not-youth",
      message:
        "GameChanger files this team as adult or college. This app ranks youth baseball, so " +
        "there is no age here to find and it is left out.",
    };
  }
  if (isSchoolTeam(profile)) {
    return {
      code: "high-school",
      message:
        "This is a high school squad. Those play their own season against other high school " +
        "squads, so their results join nothing this app ranks and they are left out.",
    };
  }
  const ageLevel = profileAgeLevel(profile);
  if (ageLevel === undefined) {
    return {
      code: "no-age",
      message:
        "GameChanger gave no age group for this team, its name does not say one, and its " +
        `opponents do not settle one either: that takes two naming one age and none another, or ${MIN_OPPONENT_AGE_EVIDENCE} agreeing.`,
    };
  }
  if (ageLevel < MIN_AGE_LEVEL) {
    return {
      code: "below-min-age",
      message: `${ageLevel}U is below the youngest level ranked here, so this team was skipped.`,
    };
  }
  if (ageLevel > MAX_AGE_LEVEL) {
    return {
      code: "above-max-age",
      message: `${ageLevel}U is above the oldest level ranked here, so this team was skipped.`,
    };
  }
  return {
    code: "no-season",
    message:
      "GameChanger gave no season for this team, so there is no squad year to file it under.",
  };
};

/** The link this pull records against a team, so a later pull knows what it already has. */
const linkFor = (
  schedule: GcTeamSchedule,
  ageGroupId: string,
  ageFrom?: GcAgeSource
): GcTeamLink => {
  const { profile, fetchedAt, listed } = schedule;
  return {
    teamId: profile.id,
    name: profile.name,
    ageGroupId,
    ...(profile.season ? { season: profile.season.season, seasonYear: profile.season.year } : {}),
    ...(profileAgeLevel(profile) === undefined ? {} : { ageLevel: profileAgeLevel(profile) }),
    // What GameChanger's own field said, and which rule filed it: see `GcTeamLink.ageFrom`.
    ...(profile.ageLabel ? { ageLabel: profile.ageLabel } : {}),
    ...(ageFrom === undefined ? {} : { ageFrom }),
    ...(profile.record ? { record: profile.record } : {}),
    /*
     * The user's list first, GameChanger's profile behind it. The list is the newer reading and
     * the one its owner can correct; the profile is what every pull carries whether a list was
     * pasted or not, which is what makes the staff index worth having at all on a pull by id.
     */
    ...(listed?.staff?.length
      ? { staff: listed.staff }
      : profile.staff?.length
        ? { staff: profile.staff }
        : {}),
    ...(listed?.playerCount === undefined
      ? {}
      : { playerCount: listed.playerCount, countedAt: fetchedAt }),
    importedAt: fetchedAt,
  };
};

/**
 * What a new link keeps from the one it replaces.
 *
 * The staff and the roster size come from the user's pasted list and from nowhere else —
 * GameChanger's public endpoints return neither — so a refresh run without the list in the box
 * carries none, and replacing the link outright erased them. A weekly rota is exactly that run,
 * which made every refresh quietly strip the evidence the merge suggestions and the under-strength
 * watch list are built on.
 *
 * A newer list still wins: these are only carried forward when the incoming link has nothing to
 * say about them. `countedAt` travels with `playerCount`, because a count without the day it was
 * taken cannot be re-checked.
 */
const carryListedFields = (link: GcTeamLink, prior: GcTeamLink | undefined): GcTeamLink => {
  if (!prior) return link;
  const kept: GcTeamLink = { ...link };
  if (kept.staff === undefined && prior.staff !== undefined) kept.staff = prior.staff;
  if (kept.playerCount === undefined && prior.playerCount !== undefined) {
    kept.playerCount = prior.playerCount;
    if (prior.countedAt !== undefined) kept.countedAt = prior.countedAt;
  }
  return kept;
};

const withLink = (team: ScoutTeam, link: GcTeamLink): ScoutTeam => {
  const prior = (team.gcTeams ?? []).find((entry) => entry.teamId === link.teamId);
  const rest = (team.gcTeams ?? []).filter((entry) => entry.teamId !== link.teamId);
  const linked: ScoutTeam = { ...team, gcTeams: [...rest, carryListedFields(link, prior)] };
  // Its own schedule is here now, so it is a club rather than a name on somebody else's.
  delete linked.nameOnly;
  /*
   * The stored name is cleaned again here, because this is the only chance it gets. A club that
   * has been pulled before is found by its GameChanger id and never by its name, so the healing
   * `resolveOrCreateTeam` does when a name matches never reaches one: an entry stored as "Premier
   * Ohio Lopez /" by a cleaner that took a bracket off as two labels would carry the debris for
   * as long as the pool existed. A rename is cleaned on its way in too, so a stored name that
   * still holds a label is always something a rule left behind rather than somebody's choice.
   */
  const cleaned = cleanTeamName(linked.name);
  if (cleaned !== linked.name) linked.name = cleaned;
  return linked;
};

/**
 * The states of the pulled clubs whose schedules named this stand-in. A stand-in has no state of
 * its own — a schedule names an opponent and says nothing about where it is from — but the clubs
 * that named it do, and a club is nearly always named by neighbours: of known-correct pairs in a
 * nationwide pull, nine in ten were in one state.
 */
const pullerStates = (index: ImportIndex, teamId: string): Set<string> => {
  const states = new Set<string>();
  index.opponentsByTeam.get(teamId)?.forEach((opponentId) => {
    const opponent = index.teamsById.get(opponentId);
    if (opponent?.gcTeams?.length && opponent.state) states.add(opponent.state);
  });
  return states;
};

/** Whether a club in `state` could be the one these pullers named: nobody knows, or somebody agrees. */
export const stateFits = (state: string | undefined, pullers: Set<string>): boolean =>
  !state || pullers.size === 0 || pullers.has(state);

/** Lower-cased for comparing; GameChanger's towns arrive as typed. */
export const townKey = (city: string | undefined): string | undefined =>
  city?.trim().toLowerCase() || undefined;

/**
 * Whether the schedule in hand holds a game that a stand-in's row is the other half of: the same
 * day, an opponent of the name the stand-in's row was filed against, and the result mirrored
 * where both sides have one. Run from the club's own side as its schedule arrives, this is the
 * same fixture test `holdsThisGame` runs from the opponent's — and it is what tells a club's own
 * stand-in from a namesake's when several share the name.
 */
const scheduleConfirms = (index: ImportIndex, standInId: string, games: GcGame[]): boolean =>
  games.some((game) => {
    if (!game.date) return false;
    const rows = index.gamesByTeamDate.get(`${standInId}\u0000${game.date}`) ?? [];
    const opponentKey = teamNameKey(game.opponentName);
    return rows.some((row) => {
      const otherId = row.teamAId === standInId ? row.teamBId : row.teamAId;
      const other = index.teamsById.get(otherId);
      if (!other || teamNameKey(other.name) !== opponentKey) return false;
      const mine = row.teamAId === standInId ? row.teamAScore : row.teamBScore;
      const theirs = row.teamAId === standInId ? row.teamBScore : row.teamAScore;
      if (mine === undefined || theirs === undefined) return true;
      if (game.teamScore === undefined || game.opponentScore === undefined) return true;
      return mine === game.teamScore && theirs === game.opponentScore;
    });
  });

/**
 * The team a pulled schedule belongs to. By GameChanger id and nothing else: a team pulled by id
 * *is* that id, and pairing a Fall squad to a Spring one is the user's call, not a guess made
 * here.
 */
export const resolveOwnTeam = (
  schedule: GcTeamSchedule,
  ageGroupId: string,
  teams: ScoutTeam[],
  index: ImportIndex,
  ageFrom?: GcAgeSource
): { teamId: string; created: boolean } => {
  const { profile } = schedule;
  const link = linkFor(schedule, ageGroupId, ageFrom);
  const known = index.teamByGcId.get(profile.id);
  if (known) {
    replaceTeam(index, teams, withLink(known, link));
    return { teamId: known.id, created: false };
  }

  /** An entry put here by somebody else's schedule, with no GameChanger id of its own yet. */
  const isStub = (team: ScoutTeam | undefined): team is ScoutTeam =>
    Boolean(team) && !team?.gcTeams?.length;

  /**
   * This club is very likely already here as a name-only opponent, put there
   * by a schedule pulled earlier. Adopting that entry is what keeps one club one team — in a pull
   * of a whole list nearly every team appears as somebody's opponent before its own turn comes,
   * so creating a second would duplicate most of the pull. Only an entry with no GameChanger id
   * of its own qualifies, and only on this page, which is the same rule opponents are matched by.
   */
  /*
   * Any level, not just this club's own. An entry put here by somebody else's schedule was filed
   * at whatever level *they* play at — the schedule that named it never said what level the club
   * was — so matching on that level misses the club that played up, and mints a second team for
   * it. What the level would have guarded against, one club's 9U and 11U squads folding together,
   * is guarded instead by there being exactly one such entry to adopt.
   */
  const key = teamNameKey(profile.name);
  const pool = index.poolKeyOf(ageGroupId);
  const sameName = index.teamIdsByPoolName.get(`${pool}\u0000${key}`) ?? [];
  const placeholders = sameName.map((teamId) => index.teamsById.get(teamId)).filter(isStub);
  const level = profileAgeLevel(profile);
  const ownState = normalizeState(profile.state ?? "") || undefined;

  /*
   * Which of them is this club. The game first: a stand-in whose row this schedule holds — same
   * day, that opponent, the result mirrored — was made for this club. Then the level, since the
   * stand-in a schedule named at 9U is not the club's 10U squad. Then the state: a stand-in named
   * only by clubs in other states is somebody else's namesake, however lonely it looks. Refusing
   * whenever two stand-ins shared the name, which is what this did before, left 1,589 clubs
   * standing beside their own stand-in — 4,283 games on an entry with no id — because a club
   * named at two levels is two stand-ins.
   */
  const confirmed = placeholders.filter((stub) => scheduleConfirms(index, stub.id, schedule.games));
  const atLevel =
    level === undefined
      ? placeholders
      : placeholders.filter((stub) =>
          (index.teamIdsByGroupName.get(nameSlotKey(pool, key, level)) ?? []).includes(stub.id)
        );
  const inState = (stubs: ScoutTeam[]) =>
    stubs.filter((stub) => stateFits(ownState, pullerStates(index, stub.id)));
  const pick = (stubs: ScoutTeam[]): ScoutTeam | undefined =>
    stubs.length === 1 ? stubs[0] : undefined;
  /*
   * ...and only a stand-in this club could have been. Adopting the sole stand-in of the name
   * whatever level it was filed at is what put a 15U result on a 9U club: one schedule named
   * "Lookouts Baseball Club" at 15U, the 9U club of that name was pulled next, and being the only
   * one it took the stand-in and the 15U loss with it. The 15U club arrived afterwards as a second
   * team, and no later step could undo it — the fixture tests all need the real club's own
   * schedule to hold the row, and it did not. A level that disagrees by more than `PLAYS_UP_TO`
   * is the one thing that says this stand-in belongs to a namesake rather than to this club.
   */
  const couldBe = placeholders.filter((stub) => levelFits(index.levelsByTeam.get(stub.id), level));
  const placeholder =
    pick(confirmed) ??
    pick(inState(atLevel)) ??
    (couldBe.length === 1 ? pick(inState(couldBe)) : undefined);
  if (placeholder) {
    const updated = withLink(placeholder, link);
    if (ownState && !updated.state) updated.state = ownState;
    if (profile.city && !updated.city) updated.city = profile.city;
    replaceTeam(index, teams, updated);
    noteInPool(index, ageGroupId, placeholder.id, level);
    return { teamId: placeholder.id, created: false };
  }

  const extras: Partial<ScoutTeam> = { gcTeams: [link] };
  if (ownState) extras.state = ownState;
  if (profile.city) extras.city = profile.city;
  const team = buildScoutTeam(profile.name, index.usedTeamIds, extras);
  addTeam(index, teams, team);
  /*
   * Named in the index now, not when its first game is filed: a club whose schedule is empty or
   * entirely in the future is still the club its neighbours' schedules name, and a pull carried
   * 3,272 of those with nothing to file — each of which then got a stand-in beside it.
   */
  noteInPool(index, ageGroupId, team.id, level);
  return { teamId: team.id, created: true };
};

type OpponentMatch = {
  teamId: string;
  basis: "game" | "name" | "created";
};

/**
 * Whether anything beyond a shared name says these two are the same club.
 *
 * A name is not an identity. A nationwide pool holds twenty clubs called the Yankees and a dozen
 * Trash Pandas, and at one age level in one season year there can easily be two — so a bare name
 * match is a coin toss dressed up as a fact. These are the things that are not coincidences: two
 * clubs that have played each other, two that have a club in common, and two that give the same
 * town or state.
 *
 * Where none of them holds, the importer makes a separate team instead. That leaves duplicates,
 * which is the cheaper mistake by a distance: a duplicate is visible in the table and can be
 * folded together in a few seconds, while a wrong merge silently pools two clubs' results into one
 * rating and leaves nothing behind to notice.
 */
/**
 * Whether this club's own schedule already holds the game being filed.
 *
 * This is the question a person would ask. The Raiders' schedule says they played the River City
 * Raptors on the 2nd: go and look at the Raptors' schedule for a game that day and see whether it
 * is the same one. A club that has it is the club that played it; a club that does not, is not.
 *
 * What counts as "the same one": the day has to match, a start time on both sides has to agree,
 * and where both rows carry a result the results have to mirror. The other side of their row must
 * be this very team, or a stand-in — a bracket slot, or a club nobody has pulled yet — because
 * that is what their row looks like before this team's own turn comes round. The start has to be
 * the same one, not merely within the hour: this is choosing between namesakes, and a namesake's
 * own game against this team an hour later would read as holding this one too.
 */
const holdsThisGame = (
  index: ImportIndex,
  ownTeamId: string,
  candidateId: string,
  game: GcGame,
  /**
   * Only the candidate's own row naming this very team: asked of a club the owner has said this
   * name is not (`notThisTeam.ts`), where only the club's own word that it played this team beats
   * the refusal, and a row of its own against some stand-in that day is a name and no more.
   */
  ownWordOnly = false
): boolean => {
  if (!game.date) return false;
  const sameDay = index.gamesByTeamDate.get(`${candidateId}\u0000${game.date}`) ?? [];
  const candidate = ownWordOnly ? index.teamsById.get(candidateId) : undefined;
  return sameDay.some((existing) => {
    const other = existing.teamAId === candidateId ? existing.teamBId : existing.teamAId;
    if (ownWordOnly && (other !== ownTeamId || !listedByOwn(existing, candidate))) return false;
    if (game.startTs && existing.startTs && !sameStart(game.startTs, existing.startTs))
      return false;
    const theirs = existing.teamAId === candidateId ? existing.teamAScore : existing.teamBScore;
    const ours = existing.teamAId === candidateId ? existing.teamBScore : existing.teamAScore;
    const resultsAgree =
      theirs === undefined ||
      ours === undefined ||
      game.teamScore === undefined ||
      game.opponentScore === undefined ||
      (theirs === game.opponentScore && ours === game.teamScore);
    if (!resultsAgree) return false;
    if (other === ownTeamId) return true;
    const stand = index.teamsById.get(other);
    return Boolean(stand?.placeholder || stand?.nameOnly);
  });
};

/**
 * Whether a club a name points at could have played this game: a stand-in, which has no schedule
 * to ask, or a pulled club whose own schedules have a game that day.
 *
 * The double check a name needs before it files a game onto a pulled club. GameChanger gives an
 * opponent as the words somebody typed and nothing else, so a name is where to look rather than
 * who played; the club it points at either has a game that day on its own schedule or did not
 * play this one. Asked only of the name's own guesses: the game itself (`clubHoldingThisGame`,
 * `opponentFromSameFixture`) is already the club's own word.
 */
const couldHavePlayed = (index: ImportIndex, clubId: string, date: string | undefined): boolean => {
  const club = index.teamsById.get(clubId);
  if (!club?.gcTeams?.length) return true;
  if (!date) return false;
  const own = new Set(club.gcTeams.map((link) => link.teamId));
  const near = new Set(aroundDay(date));
  const ofClub = (schedule: string) => (own.has(schedule) ? clubId : undefined);
  /*
   * Games are filed under their own day and a row folded into one keeps its own, a day off at most
   * (`ownRowDays`), so the games two days either side are read and each row at its own day.
   */
  return [-2, -1, 0, 1, 2].some((offset) => {
    const day = isoDayFrom(date, offset);
    return (index.gamesByTeamDate.get(`${clubId}\u0000${day}`) ?? []).some((game) =>
      ownRowDays(game, ofClub).some(([, rowDay]) => near.has(rowDay))
    );
  });
};

/**
 * Of the clubs of this name, the one whose schedule holds this game. Exactly one, or the schedules
 * cannot tell them apart either and the question is left to whatever comes after.
 */
const clubHoldingThisGame = (
  index: ImportIndex,
  ownTeamId: string,
  candidates: readonly string[],
  game: GcGame,
  /** The candidates asked for their own word alone (`holdsThisGame`'s `ownWordOnly`). */
  ownWordOnly: (teamId: string) => boolean = () => false
): string | undefined => {
  const holders = candidates.filter((id) =>
    holdsThisGame(index, ownTeamId, id, game, ownWordOnly(id))
  );
  return holders.length === 1 ? holders[0] : undefined;
};

const corroborates = (
  index: ImportIndex,
  ownTeamId: string,
  candidateId: string,
  game: GcGame
): boolean => {
  /**
   * The strongest of the lot, and the one that makes a bracket work: the club of that name already
   * has a game on this day that this could be — against this very team, or against a placeholder
   * that nobody has named yet. Two schedules describing one fixture is not a coincidence. Where
   * both give a start time they have to agree on it, so the two halves of a doubleheader cannot
   * stand in for each other.
   */
  if (game.date) {
    const sameDay = index.gamesByTeamDate.get(`${candidateId}\u0000${game.date}`) ?? [];
    const couldBeThisGame = sameDay.some((existing) => {
      if (game.startTs && existing.startTs && !sameStart(game.startTs, existing.startTs)) {
        return false;
      }
      const other = existing.teamAId === candidateId ? existing.teamBId : existing.teamAId;
      if (other === ownTeamId) return true;
      /*
       * The result, mirrored, from the two sides of one fixture. This is what settles it when the
       * other row was filed against a stand-in — a bracket slot, or a club some schedule named
       * before anybody pulled it — which is exactly what the row looks like before the club whose
       * game this is has had its turn.
       */
      const stand = index.teamsById.get(other);
      if (!stand?.placeholder && !stand?.nameOnly) return false;
      const theirs = existing.teamAId === candidateId ? existing.teamAScore : existing.teamBScore;
      const ours = existing.teamAId === candidateId ? existing.teamBScore : existing.teamAScore;
      const scored = theirs !== undefined && ours !== undefined;
      if (!scored) return true;
      return theirs === game.opponentScore && ours === game.teamScore;
    });
    if (couldBeThisGame) return true;
  }

  const met = index.opponentsByTeam.get(candidateId);
  // They have played each other, so the club on the other side of that game is this one.
  if (met?.has(ownTeamId)) return true;

  const ours = index.opponentsByTeam.get(ownTeamId);
  if (ours && met) {
    for (const opponent of met) {
      if (ours.has(opponent)) return true;
    }
  }

  const own = index.teamsById.get(ownTeamId);
  const candidate = index.teamsById.get(candidateId);
  if (!own || !candidate) return false;
  if (own.city && candidate.city && own.city.toLowerCase() === candidate.city.toLowerCase()) {
    return true;
  }
  return Boolean(own.state && candidate.state && own.state === candidate.state);
};

/**
 * The club on the other side of this very game, found by the game rather than by the name.
 *
 * Both clubs post the fixture, and the two rows agree on the things a fixture actually is: the
 * day, the time it started, and how it finished, mirrored. That is a far better identifier than a
 * name — it survives the two schedules spelling the club differently, and works
 * on a name that identifies nobody at all, which is what makes it the answer for a bracket's
 * "TBD". Where exactly one game already filed for this team that day says the same thing, the club
 * it was filed against is who this game was against.
 *
 * The row has to come from a *different* GameChanger schedule. A club's own schedule listing two
 * games that day is listing two games, and letting one answer for the other would file them both
 * against the same opponent and lose one.
 *
 * Given with the row that answered, so the caller can ask whose schedule gave it (`planOpponent`).
 */
const opponentFromSameFixture = (
  index: ImportIndex,
  ownTeamId: string,
  ageGroupId: string,
  game: GcGame,
  sourceTeamId: string
): { teamId: string; row: ScoutGame } | undefined => {
  if (!game.date) return undefined;
  const pool = index.poolKeyOf(ageGroupId);
  const sameDay = index.gamesByTeamDate.get(`${ownTeamId}\u0000${game.date}`) ?? [];

  const candidates = sameDay.filter((existing) => {
    if (existing.source?.teamId === sourceTeamId) return false;
    if (index.poolKeyOf(existing.ageGroupId) !== pool) return false;
    // A time on both sides has to agree: two games in a day are two games.
    if (game.startTs && existing.startTs && !sameStart(game.startTs, existing.startTs))
      return false;

    const ourScore = existing.teamAId === ownTeamId ? existing.teamAScore : existing.teamBScore;
    const theirScore = existing.teamAId === ownTeamId ? existing.teamBScore : existing.teamAScore;
    const scoresAgree =
      ourScore !== undefined &&
      theirScore !== undefined &&
      ourScore === game.teamScore &&
      theirScore === game.opponentScore;
    /*
     * Either the result matches, or the day and the start time pin it on their own — but not two
     * results further apart than two scorekeepers are (`CLOSE_DISPUTE_RUNS`), which the claim step
     * reads as two games. Taken on the clock alone, the reading hung on which club was pulled first:
     * on the pool of 26 September 2026 the claim step left 69 rows at the very start of another
     * club's copy with results more than four runs apart, 20 against a slot and 49 against a name
     * none of which fitted that club, where 13 of the 27 with the same result did.
     */
    const scoredApart =
      ourScore !== undefined &&
      theirScore !== undefined &&
      game.teamScore !== undefined &&
      game.opponentScore !== undefined &&
      Math.abs(ourScore - game.teamScore) + Math.abs(theirScore - game.opponentScore) >
        CLOSE_DISPUTE_RUNS;
    const timeAgrees = sameStart(game.startTs, existing.startTs) && !scoredApart;
    return scoresAgree || timeAgrees;
  });

  if (candidates.length !== 1) return undefined;
  const found = candidates[0]!;
  const other = found.teamAId === ownTeamId ? found.teamBId : found.teamAId;
  // A slot answers for nobody; naming this game after one would put two games on one placeholder.
  return index.teamsById.get(other)?.placeholder ? undefined : { teamId: other, row: found };
};

/** The team `planOpponent` found for a name, or the kind of team it would make for one. */
type OpponentPlan = OpponentMatch | { create: Partial<ScoutTeam>; basis: "created" };

/**
 * The owner's answers as the import reads them (`answeredNamesakes`): a club's own games are the
 * games standing on a row of its schedules or holding one folded in or on record, as the index
 * keeps them up to date through the fold.
 */
const answeredFor = (index: ImportIndex): AnsweredLookup =>
  (index.answered ??= answeredNamesakes(
    index.teamsById.values(),
    (teamId) => index.teamsById.get(teamId),
    (club) => {
      const ids = new Set<string>();
      club.gcTeams?.forEach((link) => {
        index.gamesBySchedule.get(link.teamId)?.forEach((id) => ids.add(id));
        index.recordsBySchedule.get(link.teamId)?.forEach((id) => ids.add(id));
      });
      return [...ids].flatMap((id) => {
        const game = index.gamesById.get(id);
        return game ? [game] : [];
      });
    },
    index.poolKeyOf
  ));

/**
 * The team an opponent name refers to. The game first, where the other club's own schedule holds
 * it. Failing that, a name — but only among teams already on this page, since a name on its own
 * says nothing across levels or seasons. Failing that, a new team, which is the honest answer for a
 * club nobody has pulled.
 *
 * Only looked up here, never made: `teamOfPlan` makes the team a plan asks for. `byFixture`
 * asks the game itself as well, which a caller asking what a name says leaves out.
 */
export const planOpponent = (
  game: GcGame,
  ageGroupId: string,
  index: ImportIndex,
  ownTeamId: string,
  sourceTeamId: string,
  byFixture: boolean,
  refused: NotThisTeam = NO_REFUSALS
): OpponentPlan => {
  /*
   * A club the owner has said this name, on this schedule, is not ("Not this team",
   * `notThisTeam.ts`) is no answer to the name: not as the one club of it, nor as the one something
   * corroborates, nor as the club its own row of the day could be. It is still the answer to the
   * game where its own schedule lists the game against this very club: a refusal is about a name,
   * and the club's own word that it played this team is not a reading of one. Kept from the fixture
   * as well, the two clubs' next meeting stood twice on this club's record, once against the club
   * from its schedule and once against a stand-in from this one.
   */
  const refusedHere = (teamId: string) =>
    refusesName(refused, sourceTeamId, game.opponentName, index.teamsById.get(teamId));
  const allowed = (teamId: string) => !refusedHere(teamId);

  /*
   * The game itself, which beats the name even when the name is a real one — and is the only
   * thing that can answer a name that identifies nobody, so it comes before the slot below.
   */
  const fixture = byFixture
    ? opponentFromSameFixture(index, ownTeamId, ageGroupId, game, sourceTeamId)
    : undefined;
  if (
    fixture &&
    (allowed(fixture.teamId) || listedByOwn(fixture.row, index.teamsById.get(fixture.teamId)))
  ) {
    return { teamId: fixture.teamId, basis: "game" };
  }

  /**
   * "TBD", "Winner of Game 3", a blank cell on a bracket: a name that stands in for a team nobody
   * had decided yet. Matching one to anything is the mistake — a single shared "TBD" would collect
   * games from dozens of unrelated schedules and then sit in the rating graph as an opponent all
   * of them had played, which the fit would read as evidence about how they compare. Each gets a
   * slot of its own, marked as one, and the game is filed exactly as any other so it still counts
   * for the team that played it.
   */
  const key = teamNameKey(game.opponentName);
  const pool = index.poolKeyOf(ageGroupId);
  const typed = ageLevelFromName(game.opponentName);
  const year = index.yearOf(ageGroupId);
  /*
   * A graduating class is an age as well, read against the page's squad year just as the row is
   * filed at it: "Mojo Gold 2036" on a 10U page of 2027 is a 9U squad. Looked up at the page's own
   * level it was filed at another, and never found again: Oklahoma's 10U clubs had made ten stand-ins
   * of it by 24 September 2026, and 55 fewer of all such names would have been made at the class's.
   */
  const classLevel =
    typed === undefined && year !== undefined
      ? ageFromGradYearInName(game.opponentName, year)
      : undefined;
  const pageLevel = typed ?? index.levelOf(ageGroupId);
  const theirLevel = classLevel ?? pageLevel;
  const atLevel = index.teamIdsByGroupName.get(nameSlotKey(pool, key, theirLevel)) ?? [];
  /*
   * ...and a club pulled under that name and found at the page's level is still found there: "NWNC
   * Elite 2034" lists itself at 10U though its class reads 11U, and five 10U clubs named it. Looked
   * up at the class alone, 13 rows naming six such clubs went to stand-ins beside them.
   */
  const pulledAtPage =
    theirLevel === pageLevel
      ? []
      : (index.teamIdsByGroupName.get(nameSlotKey(pool, key, pageLevel)) ?? []).filter(
          (id) => index.teamsById.get(id)?.gcTeams?.length && !atLevel.includes(id)
        );
  const named = [...atLevel, ...pulledAtPage];
  const sameName = named.filter(allowed);

  /*
   * A name that marks a real team's old page — void, do not use, delete, duplicate, placeholder —
   * names nobody this pool can rank, and is filed the way "TBD" is: a slot of its own, so the result
   * stays on the record of the club that played it (`OpponentGate`).
   */
  if (
    isPlaceholderName(game.opponentName) ||
    notATeamWord(game.opponentName)?.opponent === "slot"
  ) {
    /*
     * ...unless a club somebody pulled by id is called this. A schedule that writes the weekend in
     * the opponent column — "USSSA Cactus Classic" — names nobody, but a club really can call its
     * travel squad "Miami Bulldogs Tournament", and 74 of them do in a nationwide pool. An id is
     * an identity and a reading of a name is not, so where exactly one club of this name at this
     * level was pulled, the mention is that club rather than a slot.
     */
    const pulled = sameName.filter((id) => index.teamsById.get(id)?.gcTeams?.length);
    // Not a name that could be nothing but a slot, which a pulled "Tbd" is a coach's placeholder
    // for rather than a club anybody plays (`namesNobody`); and only a club that played that day.
    if (
      pulled.length === 1 &&
      pulled[0] &&
      !namesNobody(game.opponentName) &&
      couldHavePlayed(index, pulled[0], game.date)
    ) {
      return { teamId: pulled[0], basis: "name" };
    }
    return { create: { placeholder: true }, basis: "created" };
  }

  /*
   * Of the clubs of this name, the one whose own schedule holds this game. This is the question
   * worth asking and it beats every other test, because it is about this fixture rather than
   * about the name: it tells a club apart from its namesakes however many of them there are.
   */
  const anyLevel = index.teamIdsByPoolName.get(`${pool}\u0000${key}`) ?? named;
  const holder = clubHoldingThisGame(index, ownTeamId, anyLevel, game, refusedHere);
  if (holder) return { teamId: holder, basis: "name" };

  /*
   * Failing the game, the club the owner said this schedule's name is, by folding a stand-in of it
   * into that club ("Same team as", `answeredNamesakes`): ahead of any reading of the name alone,
   * since it is the owner's word on who this coach means by it, and held to the guards the tidy
   * reads it by, which leaves the row where this files it.
   */
  const answered = answeredFor(index)(
    {
      schedule: sourceTeamId,
      typed: key,
      pool,
      level: theirLevel,
      date: game.date,
      start: game.startTs,
      namerId: ownTeamId,
    },
    refused
  );
  if (answered) return { teamId: answered.id, basis: "name" };

  /*
   * Failing that, one club of that name at that level in this pool — and a pool is one season year
   * at one age, not the whole country. Insisting on more than that was making a second entry to
   * stand beside a club already here and shadow it: the name matched, nothing corroborated because
   * the two had not met yet, and the game went to a copy. A club a schedule names is nearly always
   * the one club of that name here; where it is not, there is more than one and the tests below
   * decide between them rather than inventing a third.
   */
  const own = index.teamsById.get(ownTeamId);
  const only = sameName.length === 1 ? sameName[0] : undefined;
  if (only) {
    /*
     * ...provided it is where this club's opponents are. A sole club of the name in another state
     * is, four times in ten, not the one this schedule played but a namesake pulled first, with
     * the real one — in the puller's own state — arriving later or not at all. A schedule's
     * opponents are in its own state nine times in ten; the tenth needs the game or a club in
     * common to vouch for it, and otherwise waits as a stand-in for the tidy to settle.
     */
    const candidate = index.teamsById.get(only);
    // A pulled club is where it says; a stand-in is where the clubs that named it are.
    const sameState = candidate?.gcTeams?.length
      ? !own?.state || !candidate.state || own.state === candidate.state
      : stateFits(own?.state, pullerStates(index, only));
    if (
      (sameState || corroborates(index, ownTeamId, only, game)) &&
      couldHavePlayed(index, only, game.date)
    ) {
      return { teamId: only, basis: "name" };
    }
  }

  // Several of that name: the one something beyond the name agrees with, that played that day.
  const corroborated = sameName.filter(
    (id) => corroborates(index, ownTeamId, id, game) && couldHavePlayed(index, id, game.date)
  );
  if (corroborated.length === 1 && corroborated[0]) {
    return { teamId: corroborated[0], basis: "name" };
  }

  /*
   * Failing that, an entry nobody has pulled — a name some schedule wrote down, and no more than
   * that. Reusing one is not the claim that attaching to a real club is, and refusing to reuse it
   * is far worse than it sounds: the second entry of a name makes every later mention ambiguous,
   * so it mints a third, and a fourth, until one club is hundreds of teams and its games are
   * scattered across all of them. A pull of a few thousand schedules did exactly that.
   *
   * Nothing about the picture enters into it. GameChanger mints a fresh one for every listing
   * rather than giving a club one that follows it about — measured over a nationwide pull, 7,948
   * teams carried 7,948 distinct pictures and not one was shared by two of them, while the clubs
   * actually pulled by id often carried none at all. Read as identity it said "different club"
   * about every mention of the same club, which is how one River City Raptors became six.
   */
  const reusable = sameName
    .map((teamId) => index.teamsById.get(teamId))
    .find(
      (team): team is ScoutTeam =>
        team !== undefined &&
        !team.placeholder &&
        !team.gcTeams?.length &&
        /*
         * ...named by this club's neighbours. One "Red Sox" stand-in shared by twenty-nine clubs
         * in ten states is not a club; it is a knot in the rating graph that ties every one of
         * them to every other. A stand-in per state keeps a name that is nobody in particular
         * from being everybody's opponent.
         */
        stateFits(own?.state, pullerStates(index, team.id))
    );
  if (reusable) return { teamId: reusable.id, basis: "name" };

  return { create: { nameOnly: true }, basis: "created" };
};

/** The team `plan` asks for, made where it asks for one and added to the roster. */
export const teamOfPlan = (
  plan: OpponentPlan,
  name: string,
  index: ImportIndex,
  teams: ScoutTeam[]
): string => {
  if (!("create" in plan)) return plan.teamId;
  const created = buildScoutTeam(name, index.usedTeamIds, plan.create);
  addTeam(index, teams, created);
  return created.id;
};

/**
 * A club's own row held in another club's copy of the game with nothing to say where it was filed
 * (`FoldedRow.filedAgainst`), read on its schedule's next pull: the team its name says, where that
 * is a stand-in or a slot the row is claimed from (`claimFiledRows`), or nothing.
 *
 * #270 settled a row filed by name against a stand-in into the other club's copy of the game with
 * no such mark, and the pools it tidied hold those folds with nothing that can give them back: on
 * the pool of 24 September 2026, 1,223 of them. The row's name is not kept in the pool, so its
 * next pull is where it can be read, and the fold marked as the claim step would have made it.
 * A fold the name files against the other club is left as it is:
 *
 * - The same day, the club's own row on side B of the other club's own copy, and no other row of
 *   the club in it: a claim is read by its own day, and a copy holding the club's own row is not
 *   one the claim step offers.
 * - A name that is not the other club's, by its key or a GameChanger listing's, nor a
 *   shorthand for it at the very start, as the slot settle files one; nor one this pull's other
 *   rows already stand against the other club under, which is what a hand merge leaves. The name
 *   is read as a pull reads one, less the game itself (`planOpponent`), and a pulled club is not
 *   marked.
 * - Not the same result, nor the very start with results that do not disagree: the slot settle
 *   folds those back with no mark (`resolveSlotGames`), and a mark it undid would be made again,
 *   with a new stand-in, on every pull.
 * - The claim step's own rules for a stand-in: levels in reach, a stand-in the other club has not
 *   played, the clock, scores within four runs, and no row of the club's against the other club
 *   waiting that day or either side of it that could yet be the copy (`couldStillBeCopy`). Its
 *   rule for the whole day, one club for one name, is read over all of the pull's marks at once,
 *   where they are made.
 *
 * A fold the fixture match or the slot settle made at the very start with results a run or so
 * apart is marked too, the first time its club is pulled after it: it is the claim the claim step
 * makes where the two clubs' rows come in the other order. A merge settles the rows it folds
 * (`isSettledClaim`), so nothing a merge made is read here.
 */
export const filedMarkFor = (
  index: ImportIndex,
  fold: {
    /** The row as the schedule lists it now. */
    game: GcGame;
    /** That row, filed against the club whose copy holds it. */
    candidate: ScoutGame;
    holder: ScoutGame;
    record: FoldedRow;
    ownTeamId: string;
    sourceTeamId: string;
    ageGroupId: string;
    /** The level the row's name gives, as a standing row would carry it (`ageLevelB`). */
    theirLevel: number | undefined;
    /** Every team this pull's own standing rows are filed against, by the name each was typed. */
    standingByName: ReadonlyMap<string, ReadonlySet<string>>;
  }
): OpponentPlan | undefined => {
  const { game, candidate, holder, record, ownTeamId, sourceTeamId } = fold;
  if (candidate.date === undefined || candidate.date !== holder.date || holder.excluded) {
    return undefined;
  }
  const clubId = holder.teamAId;
  const club = index.teamsById.get(clubId);
  // The other club's own copy, as the claim step offers one: a copy nobody's schedule gave, typed
  // in by hand, is not offered, and a row marked in it went back beside it.
  const copyClub = holder.source && index.teamByGcId.get(holder.source.teamId)?.id;
  if (!club || holder.teamBId !== ownTeamId || copyClub !== clubId) return undefined;
  const ours = (schedule: string) => index.teamByGcId.get(schedule)?.id === ownTeamId;
  const alsoOurs =
    (holder.alsoRows ?? []).some(
      (other) =>
        ours(other.teamId) && (other.teamId !== record.teamId || other.gameId !== record.gameId)
    ) || (holder.alsoFrom ?? []).some((schedule) => schedule !== sourceTeamId && ours(schedule));
  if (alsoOurs) return undefined;

  const key = teamNameKey(game.opponentName);
  const links = club.gcTeams ?? [];
  const listings = [club.name, ...links.map((link) => link.name)].filter((name): name is string =>
    Boolean(name)
  );
  if (listings.some((name) => teamNameKey(name) === key)) return undefined;
  if (fold.standingByName.get(key)?.has(clubId)) return undefined;

  const mine: [number, number] | undefined = isScored(candidate)
    ? [candidate.teamAScore!, candidate.teamBScore!]
    : undefined;
  // The copy's own score: one lent it by this club's row (`scoreFromB`) is this club's word.
  const theirs: [number, number] | undefined =
    isScored(holder) && !holder.scoreFromB ? [holder.teamBScore!, holder.teamAScore!] : undefined;
  const same =
    mine !== undefined && theirs !== undefined && mine[0] === theirs[0] && mine[1] === theirs[1];
  const disagree = mine !== undefined && theirs !== undefined && !same;
  const atStart = sameStart(candidate.startTs, holder.startTs);
  if (same || (atStart && !disagree)) return undefined;
  if (
    disagree &&
    Math.abs(mine[0] - theirs[0]) + Math.abs(mine[1] - theirs[1]) > CLOSE_DISPUTE_RUNS
  ) {
    return undefined;
  }
  if (!atStart && !startsWithinTheHour(candidate.startTs, holder.startTs)) return undefined;
  // A shorthand for the other club's name at the very start is what the slot settle files against
  // it wherever the two clubs are (`resolveSlotGames`), and the joins in one region; the same
  // result is left above.
  if (atStart && listings.some((name) => nameFitsWithin(game.opponentName, name))) {
    return undefined;
  }
  const level = holder.ageLevelA ?? index.levelOf(holder.ageGroupId);
  if (
    fold.theirLevel !== undefined &&
    level !== undefined &&
    Math.abs(fold.theirLevel - level) > PLAYS_UP_TO
  ) {
    return undefined;
  }

  const plan = planOpponent(game, fold.ageGroupId, index, ownTeamId, sourceTeamId, false);
  if ("teamId" in plan) {
    const named = index.teamsById.get(plan.teamId);
    if (
      !named ||
      !(named.placeholder || named.nameOnly) ||
      named.gcTeams?.length ||
      index.opponentsByTeam.get(clubId)?.has(plan.teamId)
    ) {
      return undefined;
    }
  }

  // A row of this club's own against the other club, that day or either side, that no row of
  // theirs answers and that could yet be the copy: the claim step waits on it, and a mark made now
  // would be stood back up.
  const clubOwns = (other: ScoutGame, teamId: string) => {
    const of = (schedule: string | undefined) =>
      schedule !== undefined && index.teamByGcId.get(schedule)?.id === teamId;
    return (
      of(other.source?.teamId) ||
      (other.alsoRows ?? []).some((row) => of(row.teamId)) ||
      (other.alsoFrom ?? []).some(of)
    );
  };
  const waiting = [-1, 0, 1].some((days) => {
    const day = days === 0 ? candidate.date : isoDayFrom(candidate.date!, days);
    if (day === undefined) return false;
    return (index.gamesByTeamDate.get(`${ownTeamId}\u0000${day}`) ?? []).some((stale) => {
      const other = index.gamesById.get(stale.id);
      if (!other || other.id === holder.id) return false;
      const sides = [other.teamAId, other.teamBId];
      return (
        sides.includes(clubId) &&
        sides.includes(ownTeamId) &&
        clubOwns(other, ownTeamId) &&
        !clubOwns(other, clubId) &&
        couldStillBeCopy(other, holder)
      );
    });
  });
  return waiting ? undefined : plan;
};

/**
 * The one copy of another club's holding `sourceTeamId` on record with no row kept (`alsoFrom`
 * alone) that `row`, one of that schedule's rows, can be: its club on one side, the other club's own
 * copy, the same day, within the hour, and not scored further apart than scorekeepers are
 * (`CLOSE_DISPUTE_RUNS`). None where two could be.
 */
export const heldOnRecord = (
  index: ImportIndex,
  row: GcGame,
  ownTeamId: string,
  sourceTeamId: string
): ScoutGame | undefined => {
  if (!row.date) return undefined;
  const mine =
    row.teamScore !== undefined && row.opponentScore !== undefined
      ? [row.teamScore, row.opponentScore]
      : undefined;
  const found = new Map<string, ScoutGame>();
  (index.gamesByTeamDate.get(`${ownTeamId}\u0000${row.date}`) ?? []).forEach((stale) => {
    const holder = index.gamesById.get(stale.id);
    if (!holder || found.has(holder.id) || holder.date !== row.date) return;
    if (!(holder.alsoFrom ?? []).includes(sourceTeamId)) return;
    if ((holder.alsoRows ?? []).some((record) => record.teamId === sourceTeamId)) return;
    const ownOnA = holder.teamAId === ownTeamId;
    const clubId = ownOnA ? holder.teamBId : holder.teamAId;
    if (!ownOnA && holder.teamBId !== ownTeamId) return;
    if (!holder.source || index.teamByGcId.get(holder.source.teamId)?.id !== clubId) return;
    if (!startsWithinTheHour(row.startTs, holder.startTs)) return;
    const theirs =
      isScored(holder) && !holder.scoreFromB
        ? ownOnA
          ? [holder.teamAScore!, holder.teamBScore!]
          : [holder.teamBScore!, holder.teamAScore!]
        : undefined;
    if (
      mine &&
      theirs &&
      Math.abs(mine[0]! - theirs[0]!) + Math.abs(mine[1]! - theirs[1]!) > CLOSE_DISPUTE_RUNS
    ) {
      return;
    }
    found.set(holder.id, holder);
  });
  return found.size === 1 ? [...found.values()][0] : undefined;
};

/** Games GameChanger lists but that cannot be filed: no date to match on, or called off. */
export const isFilable = (game: GcGame): boolean =>
  Boolean(game.date) && game.status !== "canceled";

/**
 * The candidate's scores as they would sit on the existing row's sides.
 *
 * The same game is on both teams' schedules and each lists itself first, so the copy arriving may
 * be the mirror of the row already here. Comparing them side for side would call every mirrored
 * game a change and rewrite it on every pull.
 */
export const scoresAsExisting = (
  existing: ScoutGame,
  candidate: ScoutGame
): { a: number | undefined; b: number | undefined } =>
  existing.teamAId === candidate.teamAId
    ? { a: candidate.teamAScore, b: candidate.teamBScore }
    : { a: candidate.teamBScore, b: candidate.teamAScore };

/**
 * Whether a game rests on its own row's name alone, so a name its coach has since changed is the
 * game's opponent changed (`ScoutGame.typedAs`): its own row is the one `schedule` lists, and
 * nothing else says who was played. Not a game holding another schedule's row or record of it,
 * which is that club's own word that the two met; nor one the namesake join made (`joinedFrom`),
 * which holds the other club's row; nor one the owner said is against its club (`namedByAvatar`,
 * Same team as), whose word stands where a name is a guess.
 */
export const restsOnItsName = (game: ScoutGame, schedule: string): boolean =>
  game.source?.teamId === schedule &&
  game.joinedFrom === undefined &&
  game.namedByAvatar === undefined &&
  (game.alsoRows ?? []).every((row) => row.teamId === schedule) &&
  (game.alsoFrom ?? []).every((teamId) => teamId === schedule);

/**
 * `game` carrying the name its own row typed (`ScoutGame.typedAs`): learned where it has none, and
 * taken where the row was filed again by it (`renamed`). A name typed otherwise on a game that
 * rests on more than it is left as it was, so the rename is still read once nothing else does.
 */
export const withTypedAs = (game: ScoutGame, typedAs: string, renamed: boolean): ScoutGame =>
  !typedAs || game.typedAs === typedAs || (game.typedAs !== undefined && !renamed)
    ? game
    : { ...game, typedAs };

/**
 * `game` with its other side, the one its own row named, replaced by the side `filed` names: at the
 * level read off the name that files it there, or none where that name gives none.
 */
export const withOpponent = (game: ScoutGame, ownSideA: boolean, filed: ScoutGame): ScoutGame => {
  if (ownSideA) {
    const { ageLevelB: _old, ...rest } = game;
    return {
      ...rest,
      teamBId: filed.teamBId,
      ...(filed.ageLevelB === undefined ? {} : { ageLevelB: filed.ageLevelB }),
    };
  }
  const { ageLevelA: _old, ...rest } = game;
  return {
    ...rest,
    teamAId: filed.teamBId,
    ...(filed.ageLevelB === undefined ? {} : { ageLevelA: filed.ageLevelB }),
  };
};

export const differs = (existing: ScoutGame, candidate: ScoutGame): boolean => {
  const scores = scoresAsExisting(existing, candidate);
  // An unscored copy says nothing about the result; it must not be read as disagreeing with one.
  const scoreChanged =
    isScored(candidate) && (existing.teamAScore !== scores.a || existing.teamBScore !== scores.b);
  /*
   * A game the namesake join made carries side B's own level, and keeps beside it the level the
   * row's name gave (`ScoutGame.joinedFromLevel`), which is what the schedule says again. Read
   * against side B's own, every pull of the club rewrote the game and counted it updated.
   *
   * No other level is news, because the update writes no other level: the club's own stays as it
   * was filed (rewritten in place it would leave the import's index, `levelsByTeam` and the name
   * lookup by level, on the old one for the rest of the batch), and side B's on a game nothing
   * joined may be B's own, put in by the crossed-halves join from B's schedule with no mark to say
   * so. Read as changes and never written, a club GameChanger moved a level, or a coach's retyped
   * age for an opponent, counted the game updated on every pull.
   */
  const levelB =
    existing.joinedFrom !== undefined && existing.joinedFromLevel !== candidate.ageLevelB;
  return scoreChanged || existing.season !== candidate.season || levelB;
};
