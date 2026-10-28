import { looseNameWords } from "./standInReport";
import { scoreSeenBy } from "./teamRankings/games";
import { isScoutGamePlayed, type ScoutGame, type ScoutTeam } from "./teamRankings/types";

/*
 * Why a game against a stand-in is not paired with its other half: research, which nothing in the
 * app reads (`npm run model:sweep -- --stand-in-cases`).
 *
 * The owner, 28 October 2026: "They are not private on gamechanger. You just aren't matching them
 * appropriately." The searches before this one asked for the other half's result mirrored exactly
 * (`standInHalves.ts`), or a run or two off, and found it for few rows beyond chance. A coach who
 * keeps no score, two scorekeepers who disagree, a start written as the arrival time: each would
 * hide a half that is there. So this asks less of the game and more of the name, and lays out what
 * is there for a sample of rows to be read by eye:
 * - the pulled clubs whose names share the most telling words with the stand-in's (each word
 *   weighed by how few pulled clubs' names hold it), within two levels, and their own rows that day;
 * - every pulled club's own row starting within `CLOCK_MINUTES` of the row, within two levels,
 *   scored or not, whatever its result, filed against the namer, a stand-in, a bracket slot, or a
 *   pulled club whose own schedules do not list it, the names nearest first.
 * And for every row, how often such a row is there whose club's name shares a word with the
 * stand-in's, or a rare one, beside a week either side, where the game is not.
 */

/** How far apart two starts may be and still be one game: an arrival time against a first pitch. */
export const CLOCK_MINUTES = 90;
/** A word held by no more than one in this many pulled clubs' names says which club it is. */
export const RARE_AMONG = 1000;
/** Levels apart a club may play, as the import reads a squad playing up (`PLAYS_UP_TO`). */
const LEVELS_APART = 2;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

const shiftDay = (day: string, by: number): string | undefined => {
  const at = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(at) ? new Date(at + by * DAY_MS).toISOString().slice(0, 10) : undefined;
};

const isPulled = (team: ScoutTeam | undefined): boolean => Boolean(team?.gcTeams?.length);
const isUnpaired = (team: ScoutTeam | undefined): boolean =>
  (team?.nameOnly === true || team?.placeholder === true) && !team.gcTeams?.length;
const isStandIn = (team: ScoutTeam | undefined): boolean =>
  team?.nameOnly === true && !team.placeholder && !team.gcTeams?.length;

/** A pulled club's own row of a game, scored or not, from its own seat. */
export type CaseOwnRow = {
  game: ScoutGame;
  clubId: string;
  opponentId: string;
  /** Its start as an instant; NaN where it has none. */
  at: number;
  /** Its result from its own seat, where it has one that counts. */
  own?: number;
  opponent?: number;
  level?: number;
};

/** A played row a pulled club's own schedule gave against a stand-in. */
export type CaseRow = {
  game: ScoutGame;
  namerId: string;
  standInId: string;
  at: number;
  own: number;
  opponent: number;
  level?: number;
};

/** How a pulled club's name reads beside a stand-in's: the words both hold, weighed. */
export type NameLikeness = { shared: string[]; weight: number; rare: boolean };

/**
 * The pool indexed once: every pulled club's own rows by day, in the order they start, the played
 * rows against stand-ins, and the pulled clubs' names by word.
 */
export const caseIndex = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  levelOf: (ageGroupId: string) => number | undefined,
  rareAmong = RARE_AMONG
) => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const clubOfSchedule = new Map<string, string>();
  teams.forEach((team) =>
    team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
  );
  const listers = (game: ScoutGame): Set<string> => {
    const clubs = new Set<string>();
    [game.source?.teamId, ...(game.alsoFrom ?? []), ...(game.alsoRows ?? []).map((r) => r.teamId)]
      .map((schedule) => (schedule === undefined ? undefined : clubOfSchedule.get(schedule)))
      .forEach((club) => club && clubs.add(club));
    return clubs;
  };

  // The pulled clubs' words, each club's once, and the levels each club is listed at.
  const wordsOfClub = new Map<string, Set<string>>();
  const holding = new Map<string, number>();
  const byWord = new Map<string, string[]>();
  const levelsOf = new Map<string, Set<number>>();
  teams.forEach((team) => {
    if (!isPulled(team)) return;
    const words = new Set(looseNameWords(team.name));
    wordsOfClub.set(team.id, words);
    words.forEach((word) => {
      holding.set(word, (holding.get(word) ?? 0) + 1);
      const clubs = byWord.get(word);
      if (clubs) clubs.push(team.id);
      else byWord.set(word, [team.id]);
    });
    const levels = new Set<number>();
    team.gcTeams?.forEach((link) => {
      const level = link.ageLevel ?? levelOf(link.ageGroupId);
      if (level !== undefined) levels.add(level);
    });
    levelsOf.set(team.id, levels);
  });
  const names = wordsOfClub.size;

  const byDay = new Map<string, CaseOwnRow[]>();
  const rowsOf = new Map<string, CaseOwnRow[]>();
  const against: CaseRow[] = [];
  for (const game of games) {
    if (game.excluded || game.withdrawn || game.date === undefined) continue;
    const listed = listers(game);
    const played = isScoutGamePlayed(game);
    const level = levelOf(game.ageGroupId);
    for (const [side, other] of [
      [game.teamAId, game.teamBId],
      [game.teamBId, game.teamAId],
    ] as const) {
      if (!isPulled(byId.get(side)) || !listed.has(side)) continue;
      // A game both clubs' own schedules list is theirs, and is nobody's other half.
      if (listed.has(other)) continue;
      const seen = played ? scoreSeenBy(game, side) : undefined;
      const at = Date.parse(game.startTs ?? "");
      if (isStandIn(byId.get(other)) && seen) {
        against.push({
          game,
          namerId: side,
          standInId: other,
          at,
          own: seen.own,
          opponent: seen.opponent,
          ...(level === undefined ? {} : { level }),
        });
      }
      const row: CaseOwnRow = {
        game,
        clubId: side,
        opponentId: other,
        at,
        ...(seen ? { own: seen.own, opponent: seen.opponent } : {}),
        ...(level === undefined ? {} : { level }),
      };
      const day = byDay.get(game.date);
      if (day) day.push(row);
      else byDay.set(game.date, [row]);
      const key = `${side}|${game.date}`;
      const mine = rowsOf.get(key);
      if (mine) mine.push(row);
      else rowsOf.set(key, [row]);
    }
  }
  // Each day's rows in the order they start, those with no start after them.
  byDay.forEach((rows) =>
    rows.sort((a, b) => (Number.isNaN(a.at) ? 1 : Number.isNaN(b.at) ? -1 : a.at - b.at))
  );

  /**
   * How a pulled club's name reads beside a name's words (`looseNameWords`, once each): the words
   * both hold, each weighed by how few pulled clubs' names hold it.
   */
  const likeness = (words: ReadonlySet<string>, clubId: string): NameLikeness => {
    const theirs = wordsOfClub.get(clubId) ?? new Set<string>();
    const shared = [...words].filter((word) => theirs.has(word));
    const weight = shared.reduce(
      (sum, word) => sum + Math.log(names / Math.max(1, holding.get(word) ?? 1)),
      0
    );
    const rare = shared.some((word) => (holding.get(word) ?? 0) * rareAmong <= names);
    return { shared, weight, rare };
  };

  /** Whether a club is listed within two levels of a row's; a level unknown is no disagreement. */
  const nearLevel = (clubId: string, level: number | undefined): boolean => {
    const levels = levelsOf.get(clubId);
    if (level === undefined || !levels || levels.size === 0) return true;
    return [...levels].some((at) => Math.abs(at - level) <= LEVELS_APART);
  };

  /**
   * The rows another pulled club's own schedule gave starting within `CLOCK_MINUTES` of the row,
   * `week` weeks on, within two levels, filed against the namer, a stand-in, a bracket slot, or a
   * pulled club whose own schedules do not list the game.
   */
  const onTheClock = (row: CaseRow, week = 0): CaseOwnRow[] => {
    if (Number.isNaN(row.at)) return [];
    const day = shiftDay(row.game.date!, week * 7);
    const rows = (day === undefined ? undefined : byDay.get(day)) ?? [];
    const at = row.at + week * 7 * DAY_MS;
    const from = at - CLOCK_MINUTES * MINUTE_MS;
    // The first row starting no earlier than the window, by halving.
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      const start = rows[middle]!.at;
      if (!Number.isNaN(start) && start < from) low = middle + 1;
      else high = middle;
    }
    const found: CaseOwnRow[] = [];
    for (let index = low; index < rows.length; index += 1) {
      const other = rows[index]!;
      if (Number.isNaN(other.at) || other.at > at + CLOCK_MINUTES * MINUTE_MS) break;
      if (other.clubId === row.namerId || other.game.id === row.game.id) continue;
      if (
        row.level !== undefined &&
        other.level !== undefined &&
        Math.abs(row.level - other.level) > LEVELS_APART
      ) {
        continue;
      }
      const facing = byId.get(other.opponentId);
      if (other.opponentId !== row.namerId && !isUnpaired(facing) && !isPulled(facing)) continue;
      found.push(other);
    }
    return found;
  };

  /** The pulled clubs whose names read most like a name, within two levels, the most alike first. */
  const alike = (
    words: ReadonlySet<string>,
    level: number | undefined,
    not: string,
    top: number
  ) => {
    const clubs = new Set<string>();
    words.forEach((word) => (byWord.get(word) ?? []).forEach((clubId) => clubs.add(clubId)));
    return [...clubs]
      .filter((clubId) => clubId !== not && nearLevel(clubId, level))
      .map((clubId) => ({ clubId, ...likeness(words, clubId) }))
      .sort((a, b) => b.weight - a.weight || a.clubId.localeCompare(b.clubId))
      .slice(0, top);
  };

  /** A stand-in's words, read once. */
  const wordsOf = (teamId: string): Set<string> =>
    new Set(looseNameWords(byId.get(teamId)?.name ?? ""));

  return { byId, against, rowsOf, likeness, onTheClock, alike, wordsOf, names };
};

export type CaseIndex = ReturnType<typeof caseIndex>;

/** How often a row has another club's own row on the clock that might be its other half. */
export type ClockTally = {
  rows: number;
  /** Rows with no start, which the clock cannot read. */
  noStart: number;
  /** Rows with any such row on the clock; with one whose club's name shares a word; a rare word. */
  any: number;
  sharesWord: number;
  sharesRare: number;
  /** Of those sharing a word: its result mirrored exactly; scored otherwise; not scored. */
  mirrored: number;
  scoredOtherwise: number;
  unscored: number;
  /** The same, a week either side, where the game is not: the rate by chance, averaged. */
  decoy: { any: number; sharesWord: number; sharesRare: number };
};

export const tallyClock = (
  index: CaseIndex,
  keep: (row: CaseRow) => boolean,
  /** At most this many rows, evenly through those kept: the rate, not every row, is the question. */
  most = Number.MAX_SAFE_INTEGER,
  decoyWeeks: readonly number[] = [-1, 1]
): ClockTally => {
  const tally: ClockTally = {
    rows: 0,
    noStart: 0,
    any: 0,
    sharesWord: 0,
    sharesRare: 0,
    mirrored: 0,
    scoredOtherwise: 0,
    unscored: 0,
    decoy: { any: 0, sharesWord: 0, sharesRare: 0 },
  };
  const read = (row: CaseRow, words: ReadonlySet<string>, week: number) => {
    const found = index.onTheClock(row, week);
    const named = found
      .map((other) => ({ other, like: index.likeness(words, other.clubId) }))
      .filter(({ like }) => like.shared.length > 0);
    return { found, named };
  };
  const kept = index.against.filter(keep);
  const step = Math.max(1, Math.ceil(kept.length / most));
  for (let at = 0; at < kept.length; at += step) {
    const row = kept[at]!;
    tally.rows += 1;
    if (Number.isNaN(row.at)) {
      tally.noStart += 1;
      continue;
    }
    const words = index.wordsOf(row.standInId);
    const { found, named } = read(row, words, 0);
    if (found.length > 0) tally.any += 1;
    if (named.length > 0) {
      tally.sharesWord += 1;
      if (named.some(({ other }) => other.own === row.opponent && other.opponent === row.own)) {
        tally.mirrored += 1;
      } else if (named.some(({ other }) => other.own !== undefined)) {
        tally.scoredOtherwise += 1;
      } else {
        tally.unscored += 1;
      }
    }
    if (named.some(({ like }) => like.rare)) tally.sharesRare += 1;
    for (const week of decoyWeeks) {
      const decoy = read(row, words, week);
      const share = 1 / decoyWeeks.length;
      if (decoy.found.length > 0) tally.decoy.any += share;
      if (decoy.named.length > 0) tally.decoy.sharesWord += share;
      if (decoy.named.some(({ like }) => like.rare)) tally.decoy.sharesRare += share;
    }
  }
  return tally;
};

/** One row of the sample, with what the names and the clock offer for it. */
export type StandInCase = {
  row: CaseRow;
  byName: Array<{ clubId: string; like: NameLikeness; thatDay: CaseOwnRow[] }>;
  byClock: Array<{ other: CaseOwnRow; like: NameLikeness }>;
};

/** `size` rows of those kept, evenly through them, each laid out (`StandInCase`). */
export const standInCases = (
  index: CaseIndex,
  keep: (row: CaseRow) => boolean,
  size: number,
  top = 3,
  clock = 5
): StandInCase[] => {
  const kept = index.against.filter(keep);
  const step = Math.max(1, Math.floor(kept.length / size));
  return kept
    .filter((_, at) => at % step === 0)
    .slice(0, size)
    .map((row) => {
      const words = index.wordsOf(row.standInId);
      const byName = index.alike(words, row.level, row.namerId, top).map(({ clubId, ...like }) => ({
        clubId,
        like,
        thatDay: [-1, 0, 1].flatMap(
          (off) => index.rowsOf.get(`${clubId}|${shiftDay(row.game.date!, off)}`) ?? []
        ),
      }));
      const byClock = index
        .onTheClock(row)
        .map((other) => ({ other, like: index.likeness(words, other.clubId) }))
        .sort(
          (a, b) =>
            b.like.weight - a.like.weight ||
            Math.abs(a.other.at - row.at) - Math.abs(b.other.at - row.at)
        )
        .slice(0, clock);
      return { row, byName, byClock };
    });
};
