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
 * club's own schedule holds the game at all, and if it does, what would find it.
 *
 * Every other pulled club's own row a day either side with the result mirrored is a candidate for
 * the game's other half, by what that row is filed against:
 * - `namer`: the namer itself, the claim step's case;
 * - `standIn`: a stand-in or a bracket slot of its own, the crossed halves' case;
 * - `other`: a third pulled club whose own schedules do not list it, a row filed by name onto the
 *   wrong club. A game both clubs' schedules list is theirs and is not offered.
 * Across the whole year that net is wide — on the cloud copy of 27 October 2026 a mirrored result
 * was there a week off, where the game is not, for nine rows in ten — so the candidates are then
 * narrowed a step at a time (`HALF_FUNNEL`, the owner's way: the wide net first, then narrower),
 * and a row stops at the first step that leaves it one. A step can then never take a row's only
 * candidate from it. The weeks either side go through the same funnel, which gives the rate each
 * step settles on one candidate by chance.
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
  /** Days between the two rows' dates, either way, a decoy week's own shift taken off. */
  daysApart: number;
  /** Minutes between their starts, the same; undefined where either has none. */
  minutesApart?: number;
  /** The namer and the club in one state or two that share a border (`inOneRegion`). */
  inRegion: boolean;
  /** Levels between the two rows' pages; undefined where either page has none. */
  levelGap?: number;
};

/** One step of the funnel: what a candidate must also be to stay. */
export type HalfStep = { key: string; keeps: (candidate: HalfCandidate) => boolean };

/**
 * The funnel, the widest step first and each narrowing the one before. Levels rather than the row's
 * own page, since in the fall a club often plays up and files the game under its own level, not the
 * namer's (the owner, 27 October 2026); within two, as the import reads a squad playing up
 * (`PLAYS_UP_TO`: 99.845% of the pool's games had their two sides within two). The same level comes
 * last, to settle what the clock could not. A page with no level is no disagreement; a row with no
 * start fails the step that compares starts.
 */
export const HALF_FUNNEL: readonly HalfStep[] = [
  { key: "the year, a day either side", keeps: () => true },
  { key: "the namer's region", keeps: (one) => one.inRegion },
  { key: "levels within two", keeps: (one) => one.levelGap === undefined || one.levelGap <= 2 },
  { key: "the same day", keeps: (one) => one.daysApart === 0 },
  {
    key: "starts within the hour",
    keeps: (one) => one.minutesApart !== undefined && one.minutesApart <= 60,
  },
  { key: "the same level", keeps: (one) => one.levelGap === undefined || one.levelGap === 0 },
];

/**
 * A row's candidates through the funnel, without keeping them all: how many are left at each step,
 * and one that goes furthest, which is the row's one candidate wherever a step leaves exactly one.
 */
export type Funnelled = { left: number[]; furthest?: HalfCandidate };

/** A played row against a stand-in, its candidates through the funnel, and each decoy week's. */
export type StandInRow = {
  game: ScoutGame;
  namerId: string;
  standInId: string;
  found: Funnelled;
  decoys: Funnelled[];
};

export type HalfSearch = {
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

/** How many steps of the funnel a candidate stays through, the first included. */
export const depthOf = (candidate: HalfCandidate, steps: readonly HalfStep[]): number => {
  let depth = 0;
  while (depth < steps.length && steps[depth]!.keeps(candidate)) depth += 1;
  return depth;
};

/** Candidates through the funnel, counted as they come. */
export const funnel = (
  candidates: Iterable<HalfCandidate>,
  steps: readonly HalfStep[]
): Funnelled => {
  const left = steps.map(() => 0);
  let furthest: HalfCandidate | undefined;
  let deepest = 0;
  for (const candidate of candidates) {
    const depth = depthOf(candidate, steps);
    for (let step = 0; step < depth; step += 1) left[step]! += 1;
    if (depth > deepest) {
      deepest = depth;
      furthest = candidate;
    }
  }
  return furthest ? { left, furthest } : { left };
};

/** Where a row came out: settled on one candidate at a step, emptied at a step, or several still. */
export type FunnelEnd =
  { settled: number; one: HalfCandidate } | { emptied: number } | { several: true };
export const funnelEnd = ({ left, furthest }: Funnelled): FunnelEnd => {
  for (let step = 0; step < left.length; step += 1) {
    if (left[step] === 1) return { settled: step, one: furthest! };
    if (left[step] === 0) return { emptied: step };
  }
  return { several: true };
};

/** One pulled club's own row of a game, keyed by its day and its result from that club's seat. */
type OwnRow = { game: ScoutGame; clubId: string; opponentId: string; settled: boolean };
type RowAgainst = { game: ScoutGame; namerId: string; standInId: string };

/**
 * Every played row a pulled club's own schedule gave against a stand-in, its candidates through the
 * funnel, and the same a week either side.
 */
export const findHalves = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  /** The level a page is at (`ageGroupLevel`), undefined where it has none. */
  levelOf: (ageGroupId: string) => number | undefined,
  steps: readonly HalfStep[] = HALF_FUNNEL,
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

  /** The rows a day either side of the row's date, moved by `week`, whose result mirrors it. */
  function* search(row: RowAgainst, week: number): Generator<HalfCandidate> {
    const seen = scoreSeenBy(row.game, row.namerId)!;
    const namerState = byId.get(row.namerId)?.state;
    const level = levelOf(row.game.ageGroupId);
    const start = Date.parse(row.game.startTs ?? "");
    for (let off = -1; off <= 1; off += 1) {
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
        const otherStart = Date.parse(other.game.startTs ?? "");
        const otherLevel = levelOf(other.game.ageGroupId);
        const gap =
          Number.isFinite(start) && Number.isFinite(otherStart)
            ? Math.abs(otherStart - start - week * DAY_MS) / MINUTE_MS
            : undefined;
        yield {
          game: other.game,
          clubId: other.clubId,
          opponentId: other.opponentId,
          kind,
          daysApart: Math.abs(off),
          ...(gap === undefined ? {} : { minutesApart: gap }),
          inRegion: inOneRegion(namerState, byId.get(other.clubId)?.state),
          ...(level === undefined || otherLevel === undefined
            ? {}
            : { levelGap: Math.abs(level - otherLevel) }),
        };
      }
    }
  }

  return {
    unplayed,
    decoyWeeks,
    rows: against.map((row) => ({
      ...row,
      found: funnel(search(row, 0), steps),
      decoys: decoyWeeks.map((week) => funnel(search(row, week), steps)),
    })),
  };
};

/** Where the rows came out of the funnel, beside where the weeks either side did. */
export type FunnelTally = {
  rows: number;
  /** Rows settled on one candidate at each step; the weeks either side the same, a week on average. */
  settled: number[];
  decoySettled: number[];
  /** Rows a step emptied before any left one, and rows several still had after the last. */
  emptied: number;
  several: number;
  decoyEmptied: number;
  decoySeveral: number;
  /** Of the rows settled: the kind of row each settled on. */
  kinds: Record<HalfKind, number>;
  /** The stand-in's name fits the club's (`nameFitter`), or shares a word with it at least. */
  namesFit: number;
  shareWord: number;
  /** Filed on the same page as the row against the stand-in. */
  samePage: number;
  /**
   * Stand-ins with two rows or more settled: all on the same club, or not; and the rows of the
   * agreeing ones, which a rule of two games agreeing would file.
   */
  agreeing: number;
  split: number;
  agreeingRows: number;
};

export const tallyFunnel = (
  search: HalfSearch,
  teams: readonly ScoutTeam[],
  steps: readonly HalfStep[] = HALF_FUNNEL,
  keep: (row: StandInRow) => boolean = () => true
): FunnelTally => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const fits = nameFitter();
  const weeks = Math.max(1, search.decoyWeeks.length);
  const tally: FunnelTally = {
    rows: 0,
    settled: steps.map(() => 0),
    decoySettled: steps.map(() => 0),
    emptied: 0,
    several: 0,
    decoyEmptied: 0,
    decoySeveral: 0,
    kinds: { namer: 0, standIn: 0, other: 0 },
    namesFit: 0,
    shareWord: 0,
    samePage: 0,
    agreeing: 0,
    split: 0,
    agreeingRows: 0,
  };
  const settledOn = new Map<string, string[]>();
  for (const row of search.rows) {
    if (!keep(row)) continue;
    tally.rows += 1;
    for (const decoy of row.decoys) {
      const end = funnelEnd(decoy);
      if ("settled" in end) tally.decoySettled[end.settled]! += 1 / weeks;
      else if ("emptied" in end) tally.decoyEmptied += 1 / weeks;
      else tally.decoySeveral += 1 / weeks;
    }
    const end = funnelEnd(row.found);
    if ("emptied" in end) {
      tally.emptied += 1;
      continue;
    }
    if ("several" in end) {
      tally.several += 1;
      continue;
    }
    tally.settled[end.settled]! += 1;
    tally.kinds[end.one.kind] += 1;
    if (end.one.game.ageGroupId === row.game.ageGroupId) tally.samePage += 1;
    const standIn = byId.get(row.standInId);
    const club = byId.get(end.one.clubId);
    if (standIn && club) {
      if (fits(standIn.name, club.name)) tally.namesFit += 1;
      const words = nameFitWords(club.name);
      if ([...nameFitWords(standIn.name)].some((word) => words.has(word))) tally.shareWord += 1;
    }
    const clubs = settledOn.get(row.standInId) ?? [];
    clubs.push(end.one.clubId);
    settledOn.set(row.standInId, clubs);
  }
  settledOn.forEach((clubs) => {
    if (clubs.length < 2) return;
    if (new Set(clubs).size === 1) {
      tally.agreeing += 1;
      tally.agreeingRows += clubs.length;
    } else tally.split += 1;
  });
  return tally;
};
