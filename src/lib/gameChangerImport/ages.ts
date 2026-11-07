/**
 * Which age level a pulled team is: from its link and its profile, from the names and fixtures of
 * its opponents where it says nothing of its own, and whether it is a school squad. Split out of
 * `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  ageFitsBand,
  ageLevelFromName,
  type GcGame,
  type GcTeamProfile,
  type GcTeamSchedule,
  isNotBaseball,
  isSchoolAgeLabel,
  isSchoolName,
  squadYearOfGcTeam,
} from "../gameChangerApi";
import {
  type AgeGroup,
  ageGroupLevel,
  ageGroupYear,
  createAgeGroupId,
  formatAgeGroupName,
  type GcTeamLink,
  MAX_AGE_LEVEL,
  MIN_AGE_LEVEL,
  nameFitter,
  newPageId,
  sameStart,
  type ScoutTeam,
  squadYearForGcSeason,
  startMinuteOf,
  teamNameKey,
} from "../teamRankings";
import { agelessEvidence } from "../agelessEvidence";
import type { AgeUnknownTeam } from "../ageUnknown";
import { inOneRegion } from "../stateBorders";
import { MIN_OPPONENT_AGE_EVIDENCE } from "../opponentAgeBar";
import { notATeamWord } from "../teamNameRules";
import { queueWouldAsk } from "../agelessQueue";
import { todayIsoDay } from "../date";
import type { GcImportState } from "./types";
import { halfResultKey, halfTimeKey, type ImportIndex, isStandIn } from "./poolIndex";

/**
 * The age a GameChanger listing plays at: the level it gives, or the one written in its name.
 *
 * GameChanger's own field is often blank while the name says "11U" plainly, and the two are the
 * same fact. Undefined means nobody wrote it down anywhere, which is not an age — and is never
 * an age two listings have in common.
 */
export const linkAgeLevel = (link: GcTeamLink): number | undefined =>
  link.ageLevel ?? ageLevelFromName(link.name);

/** Seasons in the order a squad plays them, so "the next one" has a meaning. */
export const SEASON_ORDER = ["fall", "winter", "spring", "summer"] as const;

/**
 * Whether `to` is a season `from` could have carried on into, and what the ages must do if it is.
 *
 * A squad year runs Fall through the following Summer. Inside one, the squad is the same squad at
 * the same age: Fall 2026, Winter 2026, Spring 2027 and Summer 2027 are one roster playing 11U all
 * the way through, so an age that changes means two different squads and there is nothing to pair.
 * Crossing into the next squad year — Spring or Summer, then the following Fall — is the same
 * roster too, but a year older, which is the whole reason the boundary is where it is. Refusing
 * that crossing outright, which is what this did, broke the carry-over at every birthday: a club's
 * 10U in Spring and its 11U in Fall were two teams with no game between them, and a rating had
 * nothing to follow from one to the other.
 *
 * So the answer is not yes or no but which of the two, and the caller checks the ages against it.
 */
export const seasonStep = (
  from: GcTeamLink,
  to: GcTeamLink,
  /** The squad year a link plays in: its page's where known (`squadYearOfGcTeam` filed it there). */
  yearOf: (link: GcTeamLink) => number
): "same-year" | "ages-up" | null => {
  const fromIndex = SEASON_ORDER.indexOf((from.season ?? "") as (typeof SEASON_ORDER)[number]);
  const toIndex = SEASON_ORDER.indexOf((to.season ?? "") as (typeof SEASON_ORDER)[number]);
  if (fromIndex < 0 || toIndex < 0) return null;
  const fromYear = yearOf(from);
  const toYear = yearOf(to);
  if (fromYear === toYear) return toIndex > fromIndex ? "same-year" : null;
  // One squad year on, and forward in time. Two years on is a squad somebody stopped following.
  return toYear === fromYear + 1 ? "ages-up" : null;
};

/**
 * The same season, on both cards. Not a squad carrying on — the same squad, twice.
 *
 * Both labels have to be there. An id GameChanger gave no season is not evidence of anything, and
 * treating two unlabelled ids as one season would pair every such id in the pool with every other.
 */
export const isSameSeason = (from: GcTeamLink, to: GcTeamLink): boolean =>
  from.season !== undefined &&
  from.season === to.season &&
  from.seasonYear !== undefined &&
  from.seasonYear === to.seasonYear;

/** The level a profile is for: what GameChanger says, else what the name says. */
export const profileAgeLevel = (profile: GcTeamProfile): number | undefined =>
  profile.ageLevel ?? ageLevelFromName(profile.name);

/**
 * The age level a team's opponents say it is, when they agree.
 *
 * Thousands of teams reach the pool with no age at all — GameChanger's field is empty, the name
 * says nothing, and there is no graduating class to read — and a team with no level is a team
 * nothing ranks and whose results count for nobody on either side. But a schedule is a list of
 * clubs that mostly do put their age in their name, and a side plays its own age nearly all of
 * the time. So the opponents answer the question the team itself would not.
 *
 * It refuses far more readily than it answers. Fewer than three opponents naming an age, a tie, or
 * anything short of a clear majority all come back undefined, because the cost is not symmetric: a
 * team left unrated costs its own ranking, and a team rated at the wrong age corrupts every club
 * it played.
 */
export const ageFromOpponentNames = (games: readonly GcGame[]): number | undefined => {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  let readable = 0;
  games.forEach((game) => {
    const key = teamNameKey(game.opponentName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const level = ageLevelFromName(game.opponentName);
    if (level === undefined) return;
    readable += 1;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  });
  if (readable < MIN_OPPONENT_AGE_EVIDENCE) return undefined;

  let best: number | undefined;
  let bestCount = 0;
  let tied = false;
  counts.forEach((count, level) => {
    if (count > bestCount) {
      best = level;
      bestCount = count;
      tied = false;
      return;
    }
    if (count === bestCount) tied = true;
  });
  if (best === undefined || tied) return undefined;
  // A strict majority of the opponents who said anything. Half of them is not an answer.
  if (bestCount * 2 <= readable) return undefined;
  return bestCount >= MIN_OPPONENT_AGE_EVIDENCE ? best : undefined;
};

/**
 * The age two opponents give a team when they both name it and nobody names another.
 *
 * Below `ageFromOpponentNames`' three, and measured before it was allowed: over the pool-names
 * export of 23 September 2026, on the teams whose age the pool already files, exactly two opponents
 * naming one age with none naming another matched the filed age for 10,330 of 10,623 teams — 97.2%
 * exact, 99.7% within a year — where three agreeing is 99.0%. The two-opponent case is also the
 * clean measurement: nothing could have been aged by two opponents before this, so none of those
 * teams was filed by the rule being measured. On the waiting list of the same day it answers 554
 * teams inside GameChanger's own band.
 *
 * Unanimous or nothing: two against one is not two agreeing, it is a split, and a split is the
 * three-opponent rule's to judge. The caller holds it to the band, which the three-opponent reading
 * has never been, and is left as it was.
 */
export const ageFromTwoOpponents = (games: readonly GcGame[]): number | undefined => {
  const seen = new Set<string>();
  const levels: number[] = [];
  games.forEach((game) => {
    const key = teamNameKey(game.opponentName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const level = ageLevelFromName(game.opponentName);
    if (level !== undefined) levels.push(level);
  });
  if (levels.length !== 2 || levels[0] !== levels[1]) return undefined;
  return levels[0];
};

/**
 * The schedule with an age filled in from its opponents, when it had none and they agree.
 *
 * Done here rather than in the API layer on purpose: `GcTeamProfile` is what GameChanger said
 * about a team, and this is not. It is the pool's reading of the company a team keeps, and it
 * belongs to the import that has the schedule in hand.
 */
/**
 * A club the import filed only at the oldest age it has played (`oldestOpponentAge`), every link
 * of it so. Its level is the pool's guess, so it is no evidence of another team's: a guess read as
 * a fact would file the next team by it, and that one the next.
 */
const isTentativeClub = (team: ScoutTeam | undefined): boolean => {
  const links = team?.gcTeams ?? [];
  return links.length > 0 && links.every((link) => link.ageFrom === "tentative");
};

/**
 * The level of each distinct pulled club a schedule's games were against, found by the other half
 * of each game (`ageFromFixtures`): one level a club, and none for a game two clubs could each have
 * been, a club filed at two levels, or a club filed only by its oldest opponent.
 */
const fixtureOpponentLevels = (schedule: GcTeamSchedule, index: ImportIndex): number[] => {
  const { profile } = schedule;
  if (!profile.season) return [];
  // `today` only decides for a winter team with no dated game, and then there is nothing to read.
  const pool = `y:${squadYearOfGcTeam(profile.season, schedule.games, todayIsoDay())}`;
  const fits = nameFitter();
  const seen = new Set<string>();
  const found: number[] = [];
  schedule.games.forEach((game) => {
    if (!game.date) return;
    const scored = game.teamScore !== undefined && game.opponentScore !== undefined;
    const ids = new Set([
      ...(scored
        ? (index.halvesByResult.get(
            halfResultKey(pool, game.date, game.opponentScore!, game.teamScore!)
          ) ?? [])
        : []),
      ...(startMinuteOf(game.startTs) === undefined
        ? []
        : (index.halvesByTime.get(halfTimeKey(pool, startMinuteOf(game.startTs)!)) ?? [])),
    ]);
    const clubs = new Set<string>();
    ids.forEach((id) => {
      const row = index.gamesById.get(id);
      if (!row) return;
      const standInIsA = isStandIn(index.teamsById.get(row.teamAId));
      const standIn = index.teamsById.get(standInIsA ? row.teamAId : row.teamBId);
      const club = index.teamsById.get(standInIsA ? row.teamBId : row.teamAId);
      // Still a stand-in: one a club has adopted since, pulled under that name, is that club's.
      if (!club || !standIn || !isStandIn(standIn)) return;
      // The club's own half, off its own schedule.
      if (!club.gcTeams?.some((link) => link.teamId === row.source?.teamId)) return;
      const clubScore = standInIsA ? row.teamBScore : row.teamAScore;
      const standInScore = standInIsA ? row.teamAScore : row.teamBScore;
      const mirrored =
        scored && clubScore === game.opponentScore && standInScore === game.teamScore;
      if (!mirrored && !sameStart(game.startTs, row.startTs)) return;
      if (!fits(standIn.name, profile.name) || !fits(game.opponentName, club.name)) return;
      if (!inOneRegion(profile.state, club.state)) return;
      clubs.add(club.id);
    });
    if (clubs.size !== 1) return;
    const clubId = [...clubs][0]!;
    if (seen.has(clubId)) return;
    seen.add(clubId);
    if (isTentativeClub(index.teamsById.get(clubId))) return;
    const levels = new Set<number>();
    index.teamsById.get(clubId)?.gcTeams?.forEach((link) => {
      const level = link.ageLevel ?? index.levelOf(link.ageGroupId);
      if (level !== undefined) levels.add(level);
    });
    if (levels.size !== 1) return;
    found.push([...levels][0]!);
  });
  return found;
};

/**
 * The age the pulled clubs a no-age team played are filed at — the clubs found by the games.
 *
 * A team refused for having no age has usually been met already. Each club that played it and was
 * pulled holds its own half of the game, filed against a stand-in carrying whatever its coach
 * typed for this team, so the evidence of who this team played is sitting in the pool. The names
 * alone cannot find it: this team's coach wrote "Stix" and theirs wrote "Hurricanes", and a pool
 * of a hundred thousand teams holds a great many of each. The game can. A row a pulled club filed
 * that day, against a stand-in whose name is a shorthand for this team, with the result mirrored
 * or at the same start time, is the other half of one of this team's games — once the name this
 * team typed is a shorthand for that club and the two are in one region, as the crossed-halves
 * join asks (`joinCrossedHalves`). Where two clubs could each have been one game, that game names
 * nobody.
 *
 * The level read off each club is its own listing's, and a club listed at two levels says
 * nothing. The answer is held to the name rule's bar (`ageFromOpponentNames`): `needed` distinct
 * clubs, a strict majority, and at least `needed` of them on the level it gives. The bar is not a
 * formality. On the stand-in fixtures export of 22 September 2026 the two clubs of a game joined
 * this way were filed at the same level 73.5% of the time and a level apart 22%, so one opponent's
 * level is a guess and three agreeing is not.
 */
export const ageFromFixtures = (
  schedule: GcTeamSchedule,
  index: ImportIndex,
  needed: number
): number | undefined => {
  const levels = fixtureOpponentLevels(schedule, index);
  const counts = new Map<number, number>();
  levels.forEach((level) => counts.set(level, (counts.get(level) ?? 0) + 1));
  const readable = levels.length;

  let best: number | undefined;
  let bestCount = 0;
  let tied = false;
  counts.forEach((count, level) => {
    if (count > bestCount) {
      best = level;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) tied = true;
  });
  if (best === undefined || tied) return undefined;
  // A strict majority of the clubs that said anything, and enough of them on its level.
  if (bestCount * 2 <= readable) return undefined;
  return bestCount >= needed ? best : undefined;
};

/**
 * The age a team nobody could age is filed at until its opponents settle one: the oldest any of
 * them is, by its name (`ageLevelFromName`) or by the club its games found
 * (`fixtureOpponentLevels`). The owner's rule of 23 October 2026,
 * to file such a team "under the oldest age of the team they play until they meet the threshold
 * for confirming their age based on opponents". Every pull of it reads the rules afresh, so the
 * pull that finds its opponents agreeing (`ageFromOpponentNames` and the rest) moves it to their
 * age, and one that finds an older opponent moves it up to that.
 *
 * The oldest rather than the commonest because the two disagree only where a squad plays up, and
 * a team plays up far more often than down. Measured on the backup of 11 October 2026, on the
 * 52,546 clubs whose age GameChanger or their own name gave and that had a game: the first
 * opponent alone is the club's own age for 86.9%, the older of the first two for 89.2% (a year
 * too old for 8.0%, a year too young for 1.7%), and where those two disagreed the older was right
 * for 56.3% and the younger for 35.8%. The bar the rules above hold to is far surer — two
 * agreeing 97.2%, three 99.0% — which is why this answers only below it.
 *
 * Only ages this app ranks, inside GameChanger's own band (`ageFitsBand`), and only for a team the
 * waiting list would put in front of a person (`queueWouldAsk`): a full roster, games, and an
 * opponent writing an age, and nothing that reads as a school's side, a made-up schedule or a page
 * that is no team. A club filed this way is no evidence of another's age (`isTentativeClub`).
 */
export const oldestOpponentAge = (
  schedule: GcTeamSchedule,
  index: ImportIndex,
  today: string
): number | undefined => {
  const { profile, games } = schedule;
  if (profileAgeLevel(profile) !== undefined) return undefined;
  const row: AgeUnknownTeam = {
    teamId: profile.id,
    name: profile.name,
    firstSeen: today,
    lastTried: today,
    tries: 0,
    evidence: agelessEvidence(profile, games, today),
  };
  if (!queueWouldAsk(row)) return undefined;
  const levels = [
    ...games.flatMap((game) => {
      const level = ageLevelFromName(game.opponentName);
      return level === undefined ? [] : [level];
    }),
    ...fixtureOpponentLevels(schedule, index),
  ].filter(
    (level) =>
      level >= MIN_AGE_LEVEL && level <= MAX_AGE_LEVEL && ageFitsBand(level, profile.ageLabel)
  );
  return levels.length === 0 ? undefined : Math.max(...levels);
};

export const withOpponentAge = (
  schedule: GcTeamSchedule
): { schedule: GcTeamSchedule; inferred?: number } => {
  if (profileAgeLevel(schedule.profile) !== undefined) return { schedule };
  const two = ageFromTwoOpponents(schedule.games);
  const inferred =
    ageFromOpponentNames(schedule.games) ??
    (two !== undefined && ageFitsBand(two, schedule.profile.ageLabel) ? two : undefined);
  if (inferred === undefined) return { schedule };
  return {
    schedule: { ...schedule, profile: { ...schedule.profile, ageLevel: inferred } },
    inferred,
  };
};

/** A game id nobody else will mint, derived from the GameChanger ids it came from. */
export const gcGameId = (gcTeamId: string, gameId: string): string => `gc_${gcTeamId}_${gameId}`;

/**
 * The page a pulled schedule belongs on: its age level, in the squad year its GameChanger season
 * falls in. Creates the group when there is not one, because a nationwide pull cannot expect the
 * user to have made a page for every level first.
 */
export const resolveAgeGroup = (
  profile: GcTeamProfile,
  state: GcImportState,
  /** The squad year the team plays in (`squadYearOfGcTeam`), where the caller has worked it out. */
  squadYear: number | undefined,
  /** Whether the owner vouched for the club (`vouchedFor`), whose name then refuses nothing. */
  vouched: boolean
): { ageGroups: AgeGroup[]; group: AgeGroup; created: boolean } | null => {
  // A different game entirely. Checked before the age, because a wiffle team filed under 12U has
  // a perfectly good age level and that is exactly what makes it invisible.
  if (isNotBaseball(profile.name)) return null;
  // No team at all, a practice or an old page somebody marked do not use, and the same trap: a
  // "Practice 12U" has a perfectly good level, and filing it would rank a coach's practice account.
  if (!vouched && notATeamWord(profile.name)) return null;
  // A different season entirely, and the same trap: a varsity side whose age field reads 18U has
  // a perfectly good level, and filing it would put a closed cluster in the 18U table.
  if (isSchoolTeam(profile)) return null;
  const ageLevel = profileAgeLevel(profile);
  // Below the youngest level the app ranks there is nothing worth filing. A nationwide team list
  // is full of 6U and 7U squads whose results say more about which league plays coach pitch than
  // about any team, and filing them would mint pages nobody asked for and fetch schedules nobody
  // reads. They are skipped outright rather than ranked or half-created.
  if (ageLevel === undefined || ageLevel < MIN_AGE_LEVEL || ageLevel > MAX_AGE_LEVEL) return null;
  if (!profile.season) return null;
  const year = squadYear ?? squadYearForGcSeason(profile.season.season, profile.season.year);

  // Few enough age groups that a scan is honest here — one per level per year, not one per team.
  const existing = state.ageGroups.find(
    (group) => ageGroupLevel(group) === ageLevel && ageGroupYear(group) === year
  );
  if (existing) return { ageGroups: state.ageGroups, group: existing, created: false };

  const group: AgeGroup = {
    id: newPageId(ageLevel, year, state.ageGroups, createAgeGroupId()),
    name: formatAgeGroupName(ageLevel, year),
    ageLevel,
    year,
    seasonIds: [],
  };
  return { ageGroups: [...state.ageGroups, group], group, created: true };
};

/**
 * Whether GameChanger's answer describes a high school squad, by either of the two things it says.
 *
 * The name and the age field are both read because a club that writes "Varsity" in one of them
 * very often leaves the other as the school's plain name.
 */
export const isSchoolTeam = (profile: GcTeamProfile): boolean =>
  isSchoolName(profile.name) || isSchoolAgeLabel(profile.ageLabel);
