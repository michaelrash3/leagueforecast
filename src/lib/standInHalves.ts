import { inOneRegion } from "./stateBorders";
import { minutesApart, scoreSeenBy } from "./teamRankings/games";
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
 * So for each played row against a stand-in, every other pulled club's own row a day either side
 * with the result mirrored is a candidate for its other half, by what that row is filed against:
 * - `namer`: the namer itself, the claim step's case;
 * - `standIn`: a stand-in or a bracket slot of its own, the crossed halves' case;
 * - `other`: a third pulled club whose own schedules do not list it, a row filed by name onto the
 *   wrong club. A game both clubs' schedules list is theirs and is not offered.
 * The same search a week either side, where the game is not, gives the rate it finds one by chance.
 */

export type HalfKind = "namer" | "standIn" | "other";
export const HALF_KINDS: readonly HalfKind[] = ["namer", "standIn", "other"];

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
  /** Minutes between their starts; undefined where either has none. */
  minutesApart?: number;
  /** Its opponent's own schedules list it too: for the namer, a second row of its own that day. */
  bothListed: boolean;
};

/** A played row against a stand-in, its candidates, and how many the weeks either side found. */
export type StandInRow = {
  game: ScoutGame;
  namerId: string;
  standInId: string;
  candidates: HalfCandidate[];
  /** For each kind, how many of the decoy weeks found one or more. */
  decoys: Record<HalfKind, number>;
};

export type HalfSearch = {
  rows: StandInRow[];
  /** Rows against a stand-in not read: no result yet, set not to count, or not the namer's own. */
  unplayed: number;
  /** The weeks either side searched for the chance rate. */
  decoyWeeks: readonly number[];
};

/** The days either side of a row's date its other half may be dated on, as the claim step allows. */
export const HALF_DAYS = 1;
/** The weeks either side where the game is not, at the same day of the week. */
export const DECOY_WEEKS: readonly number[] = [-7, 7];

const DAY_MS = 86_400_000;
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

export const findHalves = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  decoyWeeks: readonly number[] = DECOY_WEEKS
): HalfSearch => {
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
  const rowsAgainstStandIns: { game: ScoutGame; namerId: string; standInId: string }[] = [];
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
        if (counts(game)) rowsAgainstStandIns.push({ game, namerId: side, standInId: other });
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

  /** The rows a day either side of `day` (moved by `week`) whose result mirrors the stand-in row's. */
  const search = (
    row: { game: ScoutGame; namerId: string; standInId: string },
    week: number
  ): HalfCandidate[] => {
    const seen = scoreSeenBy(row.game, row.namerId)!;
    const found: HalfCandidate[] = [];
    for (let off = -HALF_DAYS; off <= HALF_DAYS; off += 1) {
      const day = shiftDay(row.game.date!, week + off);
      for (const other of own.get(`${day}|${seen.opponent}|${seen.own}`) ?? []) {
        if (other.clubId === row.namerId) continue;
        const kind: HalfKind | undefined =
          other.opponentId === row.namerId
            ? "namer"
            : isUnpaired(byId.get(other.opponentId))
              ? "standIn"
              : isPulled(byId.get(other.opponentId)) && !other.settled
                ? "other"
                : undefined;
        if (!kind) continue;
        const gap = minutesApart(row.game.startTs, other.game.startTs);
        found.push({
          game: other.game,
          clubId: other.clubId,
          opponentId: other.opponentId,
          kind,
          daysApart: Math.abs(off),
          bothListed: other.settled,
          ...(gap === undefined || week !== 0 ? {} : { minutesApart: gap }),
        });
      }
    }
    return found;
  };

  const rows = rowsAgainstStandIns.map((row): StandInRow => {
    const decoys: Record<HalfKind, number> = { namer: 0, standIn: 0, other: 0 };
    for (const week of decoyWeeks) {
      const kinds = new Set(search(row, week).map((candidate) => candidate.kind));
      kinds.forEach((kind) => (decoys[kind] += 1));
    }
    return { ...row, candidates: search(row, 0), decoys };
  });
  return { rows, unplayed, decoyWeeks };
};

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
  /** Its opponent's own schedules list it too (`HalfCandidate.bothListed`). */
  bothListed: number;
};

export type HalfTally = {
  rows: number;
  /** Rows with no candidate at all: no other schedule holds the game, by its date and result. */
  none: number;
  /** Rows with two candidates or more, which nothing here would choose between. */
  several: number;
  kinds: Record<HalfKind, KindTally>;
  /** Stand-ins with two rows or more each answered by one candidate, all the same club, or not. */
  agreeing: number;
  split: number;
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
  bothListed: 0,
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
  let rows = 0;
  let none = 0;
  let several = 0;
  for (const row of search.rows) {
    if (!keep(row)) continue;
    rows += 1;
    HALF_KINDS.forEach((kind) => {
      if (row.candidates.some((candidate) => candidate.kind === kind)) kinds[kind].rows += 1;
      kinds[kind].decoyRows += row.decoys[kind] / weeks;
    });
    if (row.candidates.length === 0) none += 1;
    if (row.candidates.length > 1) several += 1;
    const only = row.candidates.length === 1 ? row.candidates[0]! : undefined;
    if (!only) continue;
    const tally = kinds[only.kind];
    tally.only += 1;
    if (only.daysApart === 0) tally.sameDay += 1;
    if (only.minutesApart === undefined) tally.noStart += 1;
    else {
      if (only.minutesApart < 1) tally.sameStart += 1;
      if (only.minutesApart <= 60) tally.withinHour += 1;
    }
    const standIn = byId.get(row.standInId);
    const club = byId.get(only.clubId);
    if (inOneRegion(byId.get(row.namerId)?.state, club?.state)) tally.inRegion += 1;
    if (only.game.ageGroupId === row.game.ageGroupId) tally.samePage += 1;
    if (only.bothListed) tally.bothListed += 1;
    if (standIn && club) {
      if (fits(standIn.name, club.name)) tally.namesFit += 1;
      const words = nameFitWords(club.name);
      if ([...nameFitWords(standIn.name)].some((word) => words.has(word))) tally.shareWord += 1;
    }
    const clubs = answeredBy.get(row.standInId) ?? new Set<string>();
    clubs.add(only.clubId);
    answeredBy.set(row.standInId, clubs);
    answered.set(row.standInId, (answered.get(row.standInId) ?? 0) + 1);
  }
  let agreeing = 0;
  let split = 0;
  answered.forEach((times, standInId) => {
    if (times < 2) return;
    if (answeredBy.get(standInId)!.size === 1) agreeing += 1;
    else split += 1;
  });
  return { rows, none, several, kinds, agreeing, split };
};
