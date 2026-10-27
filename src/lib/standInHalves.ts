import { inOneRegion } from "./stateBorders";
import { scoreSeenBy } from "./teamRankings/games";
import { nameFitter, nameFitWords } from "./teamRankings/names";
import {
  isScoutGamePlayed,
  type FoldedRow,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings/types";

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
  /** The namer and the club in one state or two that share a border (`inOneRegion`): said, not a step. */
  inRegion: boolean;
  /** Levels between the two rows' pages; undefined where either page has none. */
  levelGap?: number;
};

/** One step of the funnel: what a candidate must also be to stay. */
export type HalfStep = { key: string; keeps: (candidate: HalfCandidate) => boolean };

/**
 * The funnel, the widest step first and each narrowing the one before. No step reads the two clubs'
 * states: a Kentucky club plays Michigan's all the time, and Michigan does not border it (the owner,
 * 27 October 2026). Levels rather than the row's own page, since in the fall a club often plays up
 * and files the game under its own level, not the namer's (the owner, the same day); within two, as
 * the import reads a squad playing up (`PLAYS_UP_TO`: 99.845% of the pool's games had their two
 * sides within two). The same level comes last, to settle what the clock could not. A page with no
 * level is no disagreement; a row with no start fails the step that compares starts.
 */
export const HALF_FUNNEL: readonly HalfStep[] = [
  { key: "the year, a day either side", keeps: () => true },
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
/** An own row with its result from its own seat, its start as an instant, and its level. */
type StartedRow = OwnRow & { own: number; opponent: number; at: number; level?: number };
type RowAgainst = { game: ScoutGame; namerId: string; standInId: string };

/** A row as its own club's schedule gave it: its day, its start, its result from that seat, its level. */
type RowView = {
  namerId: string;
  date: string;
  startTs?: string;
  own: number;
  opponent: number;
  level?: number;
  /** A game whose rows are not candidates: the one a known pair is, its other half held out. */
  skip?: string;
};

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / DAY_MS;

/**
 * The pool indexed once: every pulled club's own played rows by day and result, every played row a
 * pulled club's own schedule gave against a stand-in, and the search for a row's candidates.
 */
const halfIndex = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  levelOf: (ageGroupId: string) => number | undefined
) => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const clubOfSchedule = new Map<string, string>();
  const pageOfSchedule = new Map<string, string>();
  teams.forEach((team) =>
    team.gcTeams?.forEach((link) => {
      clubOfSchedule.set(link.teamId, team.id);
      pageOfSchedule.set(link.teamId, link.ageGroupId);
    })
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
  /**
   * The same rows by day alone, each with its result from its own seat and its start, those with a
   * start only and in the order they start, for results that differ (`nearScores`).
   */
  const byDay = new Map<string, StartedRow[]>();
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
      const at = Date.parse(game.startTs ?? "");
      if (!Number.isFinite(at)) continue;
      const day = byDay.get(game.date!);
      const level = levelOf(game.ageGroupId);
      const started = {
        ...row,
        own: seen.own,
        opponent: seen.opponent,
        at,
        ...(level === undefined ? {} : { level }),
      };
      if (day) day.push(started);
      else byDay.set(game.date!, [started]);
    }
  }

  byDay.forEach((rows) => rows.sort((a, b) => a.at - b.at));

  /** What a row is filed against, as the search reads it, or nothing for a game that is theirs. */
  const kindOf = (other: OwnRow, namerId: string): HalfKind | undefined =>
    other.opponentId === namerId
      ? "namer"
      : isUnpaired(byId.get(other.opponentId))
        ? "standIn"
        : isPulled(byId.get(other.opponentId)) && !other.settled
          ? "other"
          : undefined;

  /** A candidate's facts beside the row's: its kind as given, the days, the start, region, level. */
  const facts = (
    view: RowView,
    week: number,
    found: Pick<HalfCandidate, "game" | "clubId" | "opponentId" | "kind">,
    date: string,
    startTs: string | undefined,
    level: number | undefined
  ): HalfCandidate => {
    const start = Date.parse(view.startTs ?? "");
    const otherStart = Date.parse(startTs ?? "");
    const gap =
      Number.isFinite(start) && Number.isFinite(otherStart)
        ? Math.abs(otherStart - start - week * DAY_MS) / MINUTE_MS
        : undefined;
    return {
      ...found,
      daysApart: Math.abs(dayNumber(date) - dayNumber(view.date) - week),
      ...(gap === undefined ? {} : { minutesApart: gap }),
      inRegion: inOneRegion(byId.get(view.namerId)?.state, byId.get(found.clubId)?.state),
      ...(view.level === undefined || level === undefined
        ? {}
        : { levelGap: Math.abs(view.level - level) }),
    };
  };

  /** The rows a day either side of the row's date, moved by `week`, whose result mirrors it. */
  function* search(view: RowView, week: number): Generator<HalfCandidate> {
    for (let off = -1; off <= 1; off += 1) {
      const day = shiftDay(view.date, week + off);
      for (const other of own.get(`${day}|${view.opponent}|${view.own}`) ?? []) {
        if (other.clubId === view.namerId || other.game.id === view.skip) continue;
        const kind = kindOf(other, view.namerId);
        if (!kind) continue;
        yield facts(
          view,
          week,
          { game: other.game, clubId: other.clubId, opponentId: other.opponentId, kind },
          other.game.date!,
          other.game.startTs,
          levelOf(other.game.ageGroupId)
        );
      }
    }
  }

  return { byId, clubOfSchedule, pageOfSchedule, against, unplayed, facts, search, byDay, kindOf };
};

/** A row against a stand-in as its own club's schedule gave it. */
const viewOf = (row: RowAgainst, levelOf: (ageGroupId: string) => number | undefined): RowView => {
  const seen = scoreSeenBy(row.game, row.namerId)!;
  const level = levelOf(row.game.ageGroupId);
  return {
    namerId: row.namerId,
    date: row.game.date!,
    ...(row.game.startTs ? { startTs: row.game.startTs } : {}),
    own: seen.own,
    opponent: seen.opponent,
    ...(level === undefined ? {} : { level }),
  };
};

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
  const index = halfIndex(teams, games, levelOf);
  return {
    unplayed: index.unplayed,
    decoyWeeks,
    rows: index.against.map((row) => {
      const view = viewOf(row, levelOf);
      return {
        ...row,
        found: funnel(index.search(view, 0), steps),
        decoys: decoyWeeks.map((week) => funnel(index.search(view, week), steps)),
      };
    }),
  };
};

/**
 * The funnel tried where the answer is known: a game two pulled clubs' own schedules both list, one
 * club's row read as if it had named a stand-in and the other's row, as that schedule gave it (its
 * own day, start and result, at its own schedule's level), put back among the year's rows as one
 * candidate. Settled on that club is right; on another club, wrong; and the rest, nothing said.
 */
export type KnownPairTally = {
  pairs: number;
  /** Pairs whose two rows do not mirror a result, which no search by the result can find. */
  notMirrored: number;
  /** Settled on the right club, and on a wrong one, at each step. */
  right: number[];
  wrong: number[];
  emptied: number;
  several: number;
};

export const testKnownPairs = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  levelOf: (ageGroupId: string) => number | undefined,
  steps: readonly HalfStep[] = HALF_FUNNEL,
  /** Which pairs to read: all, or only the rows the claim step took from a name (`filedAgainst`). */
  keep: (row: FoldedRow) => boolean = () => true
): KnownPairTally => {
  const index = halfIndex(teams, games, levelOf);
  const tally: KnownPairTally = {
    pairs: 0,
    notMirrored: 0,
    right: steps.map(() => 0),
    wrong: steps.map(() => 0),
    emptied: 0,
    several: 0,
  };
  const levelOfSchedule = (schedule: string | undefined, fallback: string) =>
    levelOf((schedule === undefined ? undefined : index.pageOfSchedule.get(schedule)) ?? fallback);
  for (const game of games) {
    const namerId = game.source ? index.clubOfSchedule.get(game.source.teamId) : undefined;
    if (!namerId || !counts(game) || (namerId !== game.teamAId && namerId !== game.teamBId))
      continue;
    const truthId = namerId === game.teamAId ? game.teamBId : game.teamAId;
    const seen = scoreSeenBy(game, namerId)!;
    for (const folded of game.alsoRows ?? []) {
      if (index.clubOfSchedule.get(folded.teamId) !== truthId || !keep(folded)) continue;
      if (folded.ownScore === undefined || folded.opponentScore === undefined) continue;
      tally.pairs += 1;
      if (folded.ownScore !== seen.opponent || folded.opponentScore !== seen.own) {
        tally.notMirrored += 1;
        continue;
      }
      const level = levelOfSchedule(game.source?.teamId, game.ageGroupId);
      const view: RowView = {
        namerId,
        date: game.date!,
        ...(game.startTs ? { startTs: game.startTs } : {}),
        own: seen.own,
        opponent: seen.opponent,
        ...(level === undefined ? {} : { level }),
        skip: game.id,
      };
      const truth = index.facts(
        view,
        0,
        { game, clubId: truthId, opponentId: namerId, kind: "namer" },
        folded.date ?? game.date!,
        folded.startTs,
        levelOfSchedule(folded.teamId, game.ageGroupId)
      );
      const end = funnelEnd(funnel([...index.search(view, 0), truth], steps));
      if ("emptied" in end) tally.emptied += 1;
      else if ("several" in end) tally.several += 1;
      else if (end.one.clubId === truthId) tally.right[end.settled]! += 1;
      else tally.wrong[end.settled]! += 1;
    }
  }
  return tally;
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
  /** The two clubs in one state or two that share a border, said though no step reads it. */
  inRegion: number;
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
    inRegion: 0,
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
    if (end.one.inRegion) tally.inRegion += 1;
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

/**
 * The owner's question of 27 October 2026: of the rows against a stand-in, how many have another
 * club's own row at the same date and start whose result is off by a run or two rather than
 * mirrored, as two scorekeepers' books of one game can be. Read at levels within two, anywhere in the
 * country (a club travels further than the next state), the start to the minute or within the hour,
 * beside the same a week either side at the same hour for the rate it happens by chance.
 */
export type NearScoreTally = {
  rows: number;
  /** Rows with no start of their own, which no start can be matched to. */
  noStart: number;
  /** Rows with a candidate whose result mirrors exactly. */
  exact: number;
  /** Rows with none exact but one or more off by one or two runs in all, and exactly one such. */
  near: number;
  nearOne: number;
  /** Of `near`, those whose one or more candidates name the same winner (or a tie both ways). */
  nearSameWinner: number;
  /** Rows whose candidates are all off by three runs or more, and rows with none at all. */
  far: number;
  none: number;
  /** The same a week either side, a week on average. */
  decoyExact: number;
  decoyNear: number;
  decoyNearOne: number;
};

export const nearScores = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  levelOf: (ageGroupId: string) => number | undefined,
  withinMinutes: number,
  /** The groups of rows to tally, each by its own test, read in one pass. */
  groups: ReadonlyArray<(row: { namerId: string; standInId: string }) => boolean> = [() => true],
  decoyWeeks: readonly number[] = DECOY_WEEKS
): NearScoreTally[] => {
  const index = halfIndex(teams, games, levelOf);
  const tallies = groups.map((): NearScoreTally => ({
    rows: 0,
    noStart: 0,
    exact: 0,
    near: 0,
    nearOne: 0,
    nearSameWinner: 0,
    far: 0,
    none: 0,
    decoyExact: 0,
    decoyNear: 0,
    decoyNearOne: 0,
  }));
  const weeks = Math.max(1, decoyWeeks.length);
  const sign = (a: number, b: number) => Math.sign(a - b);
  /** What the rows at the row's start, moved by `week`, say: exact, near (how many, a same winner), far. */
  const read = (view: RowView, week: number) => {
    const out = { exact: false, near: 0, sameWinner: false, far: false };
    const day = index.byDay.get(shiftDay(view.date, week)!) ?? [];
    const from = Date.parse(view.startTs!) + week * DAY_MS - withinMinutes * MINUTE_MS;
    const to = from + 2 * withinMinutes * MINUTE_MS;
    // The first row starting at `from` or later, by halves: a day can hold thousands.
    let low = 0;
    let high = day.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (day[middle]!.at < from) low = middle + 1;
      else high = middle;
    }
    for (let at = low; at < day.length && day[at]!.at <= to; at += 1) {
      const other = day[at]!;
      // The runs off first, which is arithmetic: once one row three or more off is known, another
      // says nothing more, and most rows at a start are that.
      const off = Math.abs(other.own - view.opponent) + Math.abs(other.opponent - view.own);
      if (off > 2 && out.far) continue;
      if (other.clubId === view.namerId || !index.kindOf(other, view.namerId)) continue;
      if (view.level !== undefined && other.level !== undefined) {
        if (Math.abs(view.level - other.level) > 2) continue;
      }
      if (off === 0) out.exact = true;
      else if (off <= 2) {
        out.near += 1;
        // The other club's own win is the namer's loss, read from the namer's seat.
        if (sign(other.opponent, other.own) === sign(view.own, view.opponent)) {
          out.sameWinner = true;
        }
      } else out.far = true;
    }
    return out;
  };
  for (const row of index.against) {
    const kept = tallies.filter((_, at) => groups[at]!(row));
    if (kept.length === 0) continue;
    const view = viewOf(row, levelOf);
    if (!Number.isFinite(Date.parse(view.startTs ?? ""))) {
      kept.forEach((tally) => {
        tally.rows += 1;
        tally.noStart += 1;
      });
      continue;
    }
    const found = read(view, 0);
    const decoys = decoyWeeks.map((week) => read(view, week));
    for (const tally of kept) {
      tally.rows += 1;
      if (found.exact) tally.exact += 1;
      else if (found.near > 0) {
        tally.near += 1;
        if (found.near === 1) tally.nearOne += 1;
        if (found.sameWinner) tally.nearSameWinner += 1;
      } else if (found.far) tally.far += 1;
      else tally.none += 1;
      for (const decoy of decoys) {
        if (decoy.exact) tally.decoyExact += 1 / weeks;
        else if (decoy.near > 0) {
          tally.decoyNear += 1 / weeks;
          if (decoy.near === 1) tally.decoyNearOne += 1 / weeks;
        }
      }
    }
  }
  return tallies;
};

/**
 * The strictest pairing the game and the name together allow, tried before anything is built on
 * it: another club's own row at the row's start (within `withinMinutes`), the result mirrored
 * exactly, at levels within two, whose club's name shares a word with the stand-in's
 * (`nameFitWords`) or, stricter, fits it (`nameFitter`). Counted where exactly one row passes,
 * beside the same a week either side at the same hour, and how many stand-ins have two rows or more
 * so answered, all by the same club.
 */
export type StrictPairTally = {
  rows: number;
  /** Rows with exactly one row passing, and with two or more. */
  one: number;
  several: number;
  /** The same a week either side, a week on average. */
  decoyOne: number;
  decoySeveral: number;
  agreeing: number;
  split: number;
  agreeingRows: number;
};

export const strictPairs = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  levelOf: (ageGroupId: string) => number | undefined,
  withinMinutes: number,
  names: "shareWord" | "fit",
  groups: ReadonlyArray<(row: { namerId: string; standInId: string }) => boolean> = [() => true],
  decoyWeeks: readonly number[] = DECOY_WEEKS
): StrictPairTally[] => {
  const index = halfIndex(teams, games, levelOf);
  const fits = nameFitter();
  const wordsOf = new Map<string, ReadonlySet<string>>();
  const words = (name: string) => {
    const known = wordsOf.get(name);
    if (known) return known;
    const read = nameFitWords(name);
    wordsOf.set(name, read);
    return read;
  };
  const named = (standIn: string, club: string) => {
    if (names === "fit") return fits(standIn, club);
    const clubWords = words(club);
    return [...words(standIn)].some((word) => clubWords.has(word));
  };
  const tallies = groups.map((): StrictPairTally => ({
    rows: 0,
    one: 0,
    several: 0,
    decoyOne: 0,
    decoySeveral: 0,
    agreeing: 0,
    split: 0,
    agreeingRows: 0,
  }));
  const settledOn = groups.map(() => new Map<string, string[]>());
  const weeks = Math.max(1, decoyWeeks.length);
  /** The clubs whose own rows at the row's start, moved by `week`, pass. */
  const passing = (view: RowView, standInName: string, week: number): string[] => {
    const day = index.byDay.get(shiftDay(view.date, week)!) ?? [];
    const from = Date.parse(view.startTs!) + week * DAY_MS - withinMinutes * MINUTE_MS;
    const to = from + 2 * withinMinutes * MINUTE_MS;
    let low = 0;
    let high = day.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (day[middle]!.at < from) low = middle + 1;
      else high = middle;
    }
    const clubs: string[] = [];
    for (let at = low; at < day.length && day[at]!.at <= to; at += 1) {
      const other = day[at]!;
      if (other.own !== view.opponent || other.opponent !== view.own) continue;
      if (other.clubId === view.namerId || !index.kindOf(other, view.namerId)) continue;
      if (view.level !== undefined && other.level !== undefined) {
        if (Math.abs(view.level - other.level) > 2) continue;
      }
      const club = index.byId.get(other.clubId);
      if (club && named(standInName, club.name)) clubs.push(other.clubId);
    }
    return clubs;
  };
  for (const row of index.against) {
    const kept = groups.map((keep) => keep(row));
    if (!kept.some(Boolean)) continue;
    const view = viewOf(row, levelOf);
    const standInName = index.byId.get(row.standInId)?.name ?? "";
    const hasStart = Number.isFinite(Date.parse(view.startTs ?? ""));
    const found = hasStart ? passing(view, standInName, 0) : [];
    const decoys = hasStart ? decoyWeeks.map((week) => passing(view, standInName, week)) : [];
    tallies.forEach((tally, at) => {
      if (!kept[at]) return;
      tally.rows += 1;
      if (found.length === 1) {
        tally.one += 1;
        const clubs = settledOn[at]!.get(row.standInId) ?? [];
        clubs.push(found[0]!);
        settledOn[at]!.set(row.standInId, clubs);
      } else if (found.length > 1) tally.several += 1;
      decoys.forEach((decoy) => {
        if (decoy.length === 1) tally.decoyOne += 1 / weeks;
        else if (decoy.length > 1) tally.decoySeveral += 1 / weeks;
      });
    });
  }
  tallies.forEach((tally, at) =>
    settledOn[at]!.forEach((clubs) => {
      if (clubs.length < 2) return;
      if (new Set(clubs).size === 1) {
        tally.agreeing += 1;
        tally.agreeingRows += clubs.length;
      } else tally.split += 1;
    })
  );
  return tallies;
};
