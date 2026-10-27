import { inOneRegion } from "./stateBorders";
import { scoreSeenBy } from "./teamRankings/games";
import { nameFitter, nameFitWords } from "./teamRankings/names";
import { isScoutGamePlayed, type ScoutGame, type ScoutTeam } from "./teamRankings/types";

/*
 * Where the other half of a game against a stand-in is, if anywhere: research, which nothing in the
 * app reads (`npm run model:sweep -- --stand-in-halves`).
 *
 * A stand-in is a name a pulled club's schedule gave its opponent that the pool could not file onto
 * a pulled club. Three steps of the tidy already pair one by the game rather than the name: the
 * claim step, where the other club's own row names the namer (`claimFiledRows`); the crossed
 * halves, where it names a stand-in whose name fits the namer's (`joinCrossedHalves`); and the
 * refile, by a namesake in the namer's state (`refileStandIns`). What is left is what none of them
 * could prove. Every team on GameChanger has been pulled (the owner, 27 October 2026), so a
 * stand-in is a pulled club under a name its opponent's coach wrote; the question is whether that
 * club's own schedule holds the game at all, and if it does, what kept the steps from pairing it.
 *
 * So for each played row against a stand-in, another pulled club's own row near it with the result
 * mirrored is a candidate for its other half, by what that row is filed against:
 * - `namer`: the namer itself, the claim step's case;
 * - `standIn`: a stand-in or a bracket slot of its own, the crossed halves' case;
 * - `other`: a third pulled club whose own schedules do not list it, a row filed by name onto the
 *   wrong club. A game both clubs' schedules list is theirs and is not offered.
 * How near is a reach (`HalfReach`): the days either side, the row's own page or any of the year's,
 * the two clubs in one region or anywhere, the starts within so many minutes or not compared. The
 * same search a week either side, where the game is not, gives the rate each reach finds one by
 * chance. Searched across the whole year, a day either side, a mirrored result is there by chance
 * for nine rows in ten (the cloud copy of 27 October 2026), so only a narrower reach can say
 * anything, and the run reads several.
 */

export type HalfKind = "namer" | "standIn" | "other";
export const HALF_KINDS: readonly HalfKind[] = ["namer", "standIn", "other"];

/** How near another club's row has to be to a row against a stand-in to be its other half. */
export type HalfReach = {
  key: string;
  /** Days either side of the row's date. */
  days: number;
  /** Filed on the row's own page (one age level of one year), not just any page of the year. */
  samePage: boolean;
  /** The namer and the club in one state or two that share a border (`inOneRegion`). */
  inRegion: boolean;
  /** Starts no more than this many minutes apart, both given; undefined compares no start. */
  withinMinutes?: number;
};

/** The reaches a run reads, the widest first: the first run's, then narrower. */
export const HALF_REACHES: readonly HalfReach[] = [
  { key: "the year, a day either side", days: 1, samePage: false, inRegion: false },
  { key: "page and region, a day either side", days: 1, samePage: true, inRegion: true },
  { key: "page and region, the same day", days: 0, samePage: true, inRegion: true },
  {
    key: "page and region, starts within the hour",
    days: 1,
    samePage: true,
    inRegion: true,
    withinMinutes: 60,
  },
  {
    key: "region, any page, starts within the hour",
    days: 1,
    samePage: false,
    inRegion: true,
    withinMinutes: 60,
  },
];

/** Another pulled club's own row that could be the other half of a row against a stand-in. */
export type HalfCandidate = {
  game: ScoutGame;
  /** The pulled club whose own schedule lists it. */
  clubId: string;
  /** Who that row is filed against. */
  opponentId: string;
  kind: HalfKind;
  /** Days between the two rows' dates, either way. */
  daysApart: number;
  /** Minutes between their starts, a decoy week's own shift taken off; undefined where either has none. */
  minutesApart?: number;
};

/** What the weeks either side found for a row: how many found any, and exactly one, and of which kind. */
export type HalfDecoys = { any: number; unique: number; kinds: Record<HalfKind, number> };

/** A played row against a stand-in and its candidates within a reach. */
export type StandInRow = {
  game: ScoutGame;
  namerId: string;
  standInId: string;
  candidates: HalfCandidate[];
  decoys: HalfDecoys;
};

export type HalfSearch = {
  reach: HalfReach;
  rows: StandInRow[];
  /** Rows against a stand-in not read: no result yet, or set not to count. */
  unplayed: number;
  /** The weeks either side searched for the chance rate. */
  decoyWeeks: readonly number[];
};

/** The weeks either side where the game is not, at the same day of the week. */
export const DECOY_WEEKS: readonly number[] = [-7, 7];

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** An ISO day moved by whole days; undefined for anything that is not one. */
export const shiftDay = (day: string, by: number): string | undefined => {
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(at) ? new Date(at + by * DAY_MS).toISOString().slice(0, 10) : undefined;
};

const isStandIn = (team: ScoutTeam | undefined): boolean =>
  team?.nameOnly === true && !team.placeholder && !team.gcTeams?.length;
/** A side no schedule of its own answers for: a stand-in, or a bracket slot nobody resolved. */
const isUnpaired = (team: ScoutTeam | undefined): boolean =>
  (team?.nameOnly === true || team?.placeholder === true) && !team.gcTeams?.length;
const isPulled = (team: ScoutTeam | undefined): boolean => Boolean(team?.gcTeams?.length);
const counts = (game: ScoutGame) =>
  !game.excluded && !game.withdrawn && game.date !== undefined && isScoutGamePlayed(game);

/** One pulled club's own row of a game, keyed by its day and its result from that club's seat. */
type OwnRow = { game: ScoutGame; clubId: string; opponentId: string; settled: boolean };
type RowAgainst = { game: ScoutGame; namerId: string; standInId: string };

/**
 * The pool indexed once, and a search of it for any reach: every pulled club's own played rows by
 * day and result, and every played row a pulled club's own schedule gave against a stand-in.
 */
export const halfSearcher = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[]
): ((reach: HalfReach, decoyWeeks?: readonly number[]) => HalfSearch) => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const clubOfSchedule = new Map<string, string>();
  teams.forEach((team) =>
    team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
  );
  /** The clubs whose own schedules gave a game a row: its own, folded in, or on record. */
  const listers = (game: ScoutGame): Set<string> => {
    const schedules = [
      game.source?.teamId,
      ...(game.alsoFrom ?? []),
      ...(game.alsoRows ?? []).map((row) => row.teamId),
    ];
    const clubs = new Set<string>();
    schedules.forEach((schedule) => {
      const club = schedule === undefined ? undefined : clubOfSchedule.get(schedule);
      if (club) clubs.add(club);
    });
    return clubs;
  };

  const own = new Map<string, OwnRow[]>();
  const against: RowAgainst[] = [];
  let unplayed = 0;
  for (const game of games) {
    const listed = listers(game);
    const sides: Array<[string, string]> = [
      [game.teamAId, game.teamBId],
      [game.teamBId, game.teamAId],
    ];
    for (const [side, other] of sides) {
      if (!isPulled(byId.get(side)) || !listed.has(side)) continue;
      if (isStandIn(byId.get(other))) {
        if (counts(game)) against.push({ game, namerId: side, standInId: other });
        else unplayed += 1;
      }
      const seen = counts(game) ? scoreSeenBy(game, side) : undefined;
      if (!seen) continue;
      const key = `${game.date}|${seen.own}|${seen.opponent}`;
      const row = { game, clubId: side, opponentId: other, settled: listed.has(other) };
      const bucket = own.get(key);
      if (bucket) bucket.push(row);
      else own.set(key, [row]);
    }
  }

  /** The rows within `reach` of `row`, its date moved by `week`, whose result mirrors the row's. */
  const search = (row: RowAgainst, reach: HalfReach, week: number): HalfCandidate[] => {
    const seen = scoreSeenBy(row.game, row.namerId)!;
    const namerState = byId.get(row.namerId)?.state;
    const start = Date.parse(row.game.startTs ?? "");
    const found: HalfCandidate[] = [];
    for (let off = -reach.days; off <= reach.days; off += 1) {
      const day = shiftDay(row.game.date!, week + off);
      for (const other of own.get(`${day}|${seen.opponent}|${seen.own}`) ?? []) {
        if (other.clubId === row.namerId) continue;
        if (reach.samePage && other.game.ageGroupId !== row.game.ageGroupId) continue;
        if (reach.inRegion && !inOneRegion(namerState, byId.get(other.clubId)?.state)) continue;
        const otherStart = Date.parse(other.game.startTs ?? "");
        const gap =
          Number.isFinite(start) && Number.isFinite(otherStart)
            ? Math.abs(otherStart - start - week * DAY_MS) / MINUTE_MS
            : undefined;
        if (reach.withinMinutes !== undefined && (gap === undefined || gap > reach.withinMinutes))
          continue;
        const kind: HalfKind | undefined =
          other.opponentId === row.namerId
            ? "namer"
            : isUnpaired(byId.get(other.opponentId))
              ? "standIn"
              : isPulled(byId.get(other.opponentId)) && !other.settled
                ? "other"
                : undefined;
        if (!kind) continue;
        found.push({
          game: other.game,
          clubId: other.clubId,
          opponentId: other.opponentId,
          kind,
          daysApart: Math.abs(off),
          ...(gap === undefined ? {} : { minutesApart: gap }),
        });
      }
    }
    return found;
  };

  return (reach, decoyWeeks = DECOY_WEEKS) => ({
    reach,
    unplayed,
    decoyWeeks,
    rows: against.map((row): StandInRow => {
      const decoys: HalfDecoys = { any: 0, unique: 0, kinds: { namer: 0, standIn: 0, other: 0 } };
      for (const week of decoyWeeks) {
        const found = search(row, reach, week);
        if (found.length > 0) decoys.any += 1;
        if (found.length === 1) decoys.unique += 1;
        new Set(found.map((candidate) => candidate.kind)).forEach(
          (kind) => (decoys.kinds[kind] += 1)
        );
      }
      return { ...row, candidates: search(row, reach, 0), decoys };
    }),
  });
};

/** One reach searched, as `halfSearcher` searches it. */
export const findHalves = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  reach: HalfReach = HALF_REACHES[0]!,
  decoyWeeks: readonly number[] = DECOY_WEEKS
): HalfSearch => halfSearcher(teams, games)(reach, decoyWeeks);

/** What the rows of one kind of candidate say, of the rows whose one candidate is of it. */
export type KindTally = {
  /** Rows with one or more candidates of this kind. */
  rows: number;
  /** The rows a week either side found one of this kind, a week on average: the chance rate. */
  decoyRows: number;
  /** Rows whose only candidate is of this kind, and of those: */
  only: number;
  sameDay: number;
  /** Starts within a minute, within the hour (the minute included), and either with none. */
  sameStart: number;
  withinHour: number;
  noStart: number;
  /** The two clubs in one state or two that share a border (`inOneRegion`). */
  inRegion: number;
  /** Filed on the same page as the row against the stand-in. */
  samePage: number;
  /** The stand-in's name fits the club's (`nameFitter`), or shares a word with it at least. */
  namesFit: number;
  shareWord: number;
};

export type HalfTally = {
  rows: number;
  /** Rows with no candidate at all within the reach. */
  none: number;
  /** Rows with exactly one candidate, and with two or more, which nothing here chooses between. */
  unique: number;
  several: number;
  /** The same a week either side, a week on average: rows with any, and with exactly one. */
  decoyAny: number;
  decoyUnique: number;
  kinds: Record<HalfKind, KindTally>;
  /**
   * Stand-ins with two rows or more each answered by one candidate: all the same club, or not; and
   * the rows of the agreeing ones, which a rule of two games agreeing would file.
   */
  agreeing: number;
  split: number;
  agreeingRows: number;
};

const emptyKind = (): KindTally => ({
  rows: 0,
  decoyRows: 0,
  only: 0,
  sameDay: 0,
  sameStart: 0,
  withinHour: 0,
  noStart: 0,
  inRegion: 0,
  samePage: 0,
  namesFit: 0,
  shareWord: 0,
});

export const tallyHalves = (
  search: HalfSearch,
  teams: readonly ScoutTeam[],
  keep: (row: StandInRow) => boolean = () => true
): HalfTally => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const fits = nameFitter();
  const kinds: Record<HalfKind, KindTally> = {
    namer: emptyKind(),
    standIn: emptyKind(),
    other: emptyKind(),
  };
  const weeks = Math.max(1, search.decoyWeeks.length);
  const answeredBy = new Map<string, Set<string>>();
  const answered = new Map<string, number>();
  const tally = {
    rows: 0,
    none: 0,
    unique: 0,
    several: 0,
    decoyAny: 0,
    decoyUnique: 0,
  };
  for (const row of search.rows) {
    if (!keep(row)) continue;
    tally.rows += 1;
    tally.decoyAny += row.decoys.any / weeks;
    tally.decoyUnique += row.decoys.unique / weeks;
    HALF_KINDS.forEach((kind) => {
      if (row.candidates.some((candidate) => candidate.kind === kind)) kinds[kind].rows += 1;
      kinds[kind].decoyRows += row.decoys.kinds[kind] / weeks;
    });
    if (row.candidates.length === 0) tally.none += 1;
    if (row.candidates.length > 1) tally.several += 1;
    const only = row.candidates.length === 1 ? row.candidates[0]! : undefined;
    if (!only) continue;
    tally.unique += 1;
    const kind = kinds[only.kind];
    kind.only += 1;
    if (only.daysApart === 0) kind.sameDay += 1;
    if (only.minutesApart === undefined) kind.noStart += 1;
    else {
      if (only.minutesApart < 1) kind.sameStart += 1;
      if (only.minutesApart <= 60) kind.withinHour += 1;
    }
    const standIn = byId.get(row.standInId);
    const club = byId.get(only.clubId);
    if (inOneRegion(byId.get(row.namerId)?.state, club?.state)) kind.inRegion += 1;
    if (only.game.ageGroupId === row.game.ageGroupId) kind.samePage += 1;
    if (standIn && club) {
      if (fits(standIn.name, club.name)) kind.namesFit += 1;
      const words = nameFitWords(club.name);
      if ([...nameFitWords(standIn.name)].some((word) => words.has(word))) kind.shareWord += 1;
    }
    const clubs = answeredBy.get(row.standInId) ?? new Set<string>();
    clubs.add(only.clubId);
    answeredBy.set(row.standInId, clubs);
    answered.set(row.standInId, (answered.get(row.standInId) ?? 0) + 1);
  }
  let agreeing = 0;
  let split = 0;
  let agreeingRows = 0;
  answered.forEach((times, standInId) => {
    if (times < 2) return;
    if (answeredBy.get(standInId)!.size === 1) {
      agreeing += 1;
      agreeingRows += times;
    } else split += 1;
  });
  return { ...tally, kinds, agreeing, split, agreeingRows };
};
