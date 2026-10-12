/**
 * What a team looked like at the moment nobody could say its age.
 *
 * A schedule with no age level is filed nowhere: `importGcSchedule` hands the caller's own pool
 * back untouched, the team leaves no `ScoutTeam`, no games and no link, and the only record it
 * leaves anywhere is one row on the ageless list. So everything GameChanger said about it — the
 * roster count, its own season record, the opponent names, the dates, the scores — is read once
 * and thrown away.
 *
 * That is exactly what somebody investigating the team needs. The question "is this a real 9U club
 * or an invention?" is answerable from the schedule that was in hand: a fake carries games on days
 * that have not happened, shutout blowouts, a record of 106-13 across three listed rows, and a
 * roster of two. A real rec-league team carries four honest games and eleven players, and the only
 * thing wrong with it is that nobody in its league writes an age in a team name.
 *
 * And the most useful single thing is the tally the refusal itself computes and discards.
 * `ageFromOpponentNames` refuses for four different reasons and returns one `undefined` for all of
 * them. Keeping the counts tells the reader which: "four opponents, none of them name an age" is a
 * rec league and will never come good; "two of its three opponents say 9U" is a near miss the
 * reader settles in a second; no opponents at all is a blank schedule, which is what a made-up
 * team looks like.
 *
 * It is kept small on purpose. Measured over a 4,013-team list, the five fields this file's
 * consumers already stored came to 584 KB; the tally and three sample opponent names take it to
 * about 1.5 MB, and that is the whole budget — the full opponent list or the games themselves
 * would be several times the pool it is meant to be a footnote to.
 */

import { MAX_AGE_LEVEL, MIN_AGE_LEVEL } from "./teamRankings/seasons";
import {
  ageLevelFromName,
  type GcGame,
  type GcSeason,
  type GcSeasonName,
  type GcTeamProfile,
} from "./gameChangerApi";

/** How many opponent names are kept, for the case where none of them named an age. */
export const AGELESS_SAMPLE_OPPONENTS = 3;

/**
 * One level and how many of this team's distinct opponents named it, commonest first.
 *
 * A pair rather than an object because there may be several and this is stored per team: `[9, 2]`
 * is a quarter of the bytes of `{ level: 9, count: 2 }` and says the same thing.
 */
export type AgeTally = readonly [level: number, opponents: number];

export type AgelessEvidence = {
  /** GameChanger's own `age_group`, verbatim — "", "2027", "Varsity", "11U/12U". The parse keeps
   *  only its verdict, and the verdict is "no age"; this is the evidence behind it. */
  ageLabel?: string;
  city?: string;
  state?: string;
  /** GameChanger's own season record. 106-13 over three listed games is what an invention is. */
  record?: { win: number; loss: number; tie: number };
  /** GameChanger's `player_count`. It takes nine to field a side. */
  playerCount?: number;
  /**
   * The bodies the team plays under, lowercased — `["usssa"]`, `["little league"]`.
   *
   * Kept because it is the thing that decides what a division word means, and because this row is
   * all that survives a refusal: the schedule is read once and thrown away, so a fact not written
   * down here costs two requests to learn again. "Majors" under Little League is an age; "Major"
   * under USSSA is a skill class; without this the two are one string.
   */
  ngb?: string[];
  /**
   * The season GameChanger files the team under — "Fall 2026".
   *
   * Kept because an empty schedule means two different things by it. In the season being played it
   * is a schedule nobody has written yet, and worth asking about next week; in one that is over or
   * not started, it is a team nothing will change until its season comes round. See
   * `gcSeasonIsCurrent`.
   */
  season?: GcSeason;
  /** Rows on the schedule that was fetched. */
  games: number;
  /** Of those, how many carry a score. */
  scored: number;
  /** Scored, and dated on a day that has not happened. You cannot score a game early. */
  aheadOfToday: number;
  /** Scored 10-0 or wider. One is a mismatch; every game is somebody typing. */
  shutoutBlowouts: number;
  /** Distinct opponents, by name. */
  opponents: number;
  /** Of those, how many wrote an age in their name. */
  namedAnAge: number;
  /** Which ages they named, commonest first. Empty when none of them did. */
  tally: AgeTally[];
  /** A few opponent names, for the case the tally cannot speak to. */
  sampleOpponents?: string[];
};

/** Ten runs clear with the loser scoreless: one is a mismatch, a schedule of them is a fiction. */
const BLOWOUT_MARGIN = 10;

const normaliseName = (name: string): string => name.trim().toLowerCase();

/**
 * The evidence, off the schedule in hand.
 *
 * `today` is passed rather than read so one clock decides it and a test can say which day it is —
 * the same reason `poolHealth` and `countsTowardRating` take one.
 */
export const agelessEvidence = (
  profile: GcTeamProfile,
  games: readonly GcGame[],
  today: string
): AgelessEvidence => {
  const seen = new Set<string>();
  const counts = new Map<number, number>();
  const sample: string[] = [];
  let scored = 0;
  let aheadOfToday = 0;
  let shutoutBlowouts = 0;
  let namedAnAge = 0;

  games.forEach((game) => {
    const hasScore = game.teamScore !== undefined && game.opponentScore !== undefined;
    if (hasScore) {
      scored += 1;
      if (game.date !== undefined && game.date > today) aheadOfToday += 1;
      const low = Math.min(game.teamScore!, game.opponentScore!);
      const high = Math.max(game.teamScore!, game.opponentScore!);
      if (low === 0 && high >= BLOWOUT_MARGIN) shutoutBlowouts += 1;
    }
    // Per opponent rather than per game: a tournament against the same club four times is one
    // club's opinion, which is the rule `ageFromOpponentNames` counts by.
    const key = normaliseName(game.opponentName);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const level = ageLevelFromName(game.opponentName);
    if (level === undefined) {
      if (sample.length < AGELESS_SAMPLE_OPPONENTS) sample.push(game.opponentName);
      return;
    }
    namedAnAge += 1;
    counts.set(level, (counts.get(level) ?? 0) + 1);
  });

  const tally: AgeTally[] = [...counts.entries()]
    .map(([level, opponents]): AgeTally => [level, opponents])
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);

  return {
    ...(profile.ageLabel ? { ageLabel: profile.ageLabel } : {}),
    ...(profile.city ? { city: profile.city } : {}),
    ...(profile.state ? { state: profile.state } : {}),
    ...(profile.record ? { record: profile.record } : {}),
    ...(profile.playerCount === undefined ? {} : { playerCount: profile.playerCount }),
    ...(profile.ngb?.length ? { ngb: profile.ngb } : {}),
    ...(profile.season ? { season: profile.season } : {}),
    games: games.length,
    scored,
    aheadOfToday,
    shutoutBlowouts,
    opponents: seen.size,
    namedAnAge,
    tally,
    ...(sample.length > 0 ? { sampleOpponents: sample } : {}),
  };
};

const asCount = (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 0;

const asText = (raw: unknown): string | undefined =>
  typeof raw === "string" && raw.length > 0 ? raw : undefined;

const SEASON_NAMES: readonly GcSeasonName[] = ["fall", "winter", "spring", "summer"];

const asSeason = (raw: unknown): GcSeason | undefined => {
  if (!raw || typeof raw !== "object") return undefined;
  const { season, year } = raw as Record<string, unknown>;
  const name = SEASON_NAMES.find((one) => one === season);
  return name && typeof year === "number" && Number.isInteger(year)
    ? { season: name, year }
    : undefined;
};

/**
 * Whatever was stored, as evidence — anything unreadable dropped rather than guessed at.
 *
 * Stored JSON is untrusted like every other stored thing here, and this one is read straight into
 * a list somebody makes decisions from. A missing count reads as zero, which is the honest answer
 * for "how many of its games are dated ahead of today" when nobody recorded one.
 */
export const coerceAgelessEvidence = (raw: unknown): AgelessEvidence => {
  const row = (raw ?? {}) as Record<string, unknown>;
  const record = row.record as Record<string, unknown> | undefined;
  const tally = Array.isArray(row.tally)
    ? row.tally.flatMap((entry): AgeTally[] => {
        if (!Array.isArray(entry) || entry.length < 2) return [];
        const level = asCount(entry[0]);
        const opponents = asCount(entry[1]);
        return level >= MIN_AGE_LEVEL && level <= MAX_AGE_LEVEL && opponents > 0
          ? [[level, opponents]]
          : [];
      })
    : [];
  const ngb = Array.isArray(row.ngb)
    ? row.ngb.flatMap((one) => {
        const text = asText(one);
        return text ? [text.toLowerCase()] : [];
      })
    : [];
  const sample = Array.isArray(row.sampleOpponents)
    ? row.sampleOpponents.flatMap((one) => {
        const text = asText(one);
        return text ? [text] : [];
      })
    : [];
  return {
    ...(asText(row.ageLabel) ? { ageLabel: asText(row.ageLabel) as string } : {}),
    ...(asText(row.city) ? { city: asText(row.city) as string } : {}),
    ...(asText(row.state) ? { state: asText(row.state) as string } : {}),
    ...(record && typeof record === "object"
      ? {
          record: {
            win: asCount(record.win),
            loss: asCount(record.loss),
            tie: asCount(record.tie),
          },
        }
      : {}),
    ...(typeof row.playerCount === "number" && Number.isFinite(row.playerCount)
      ? { playerCount: asCount(row.playerCount) }
      : {}),
    ...(ngb.length > 0 ? { ngb } : {}),
    ...(asSeason(row.season) ? { season: asSeason(row.season) as GcSeason } : {}),
    games: asCount(row.games),
    scored: asCount(row.scored),
    aheadOfToday: asCount(row.aheadOfToday),
    shutoutBlowouts: asCount(row.shutoutBlowouts),
    opponents: asCount(row.opponents),
    namedAnAge: asCount(row.namedAnAge),
    tally,
    ...(sample.length > 0 ? { sampleOpponents: sample.slice(0, AGELESS_SAMPLE_OPPONENTS) } : {}),
  };
};

/**
 * Why the age could not be read, in a sentence a person can act on.
 *
 * The four refusals `ageFromOpponentNames` collapses into one `undefined` are different problems
 * with different answers, and saying which is most of the help this list can give.
 */
export const whyNoAge = (evidence: AgelessEvidence, needed: number): string => {
  if (evidence.games === 0) return "GameChanger lists no games for this team at all.";
  if (evidence.namedAnAge === 0)
    return `None of its ${evidence.opponents} opponent${evidence.opponents === 1 ? "" : "s"} writes an age in its name either.`;
  const top = evidence.tally[0];
  if (top && evidence.tally.length === 1 && top[1] === 1)
    return `1 of its opponents says ${top[0]}U — it needs two to agree.`;
  // Two agreeing settle a team now (`ageFromTwoOpponents`); a row still saying so was either last
  // asked before that, or the age is one GameChanger's own band rules out.
  if (top && evidence.tally.length === 1 && top[1] === 2)
    return `2 of its opponents say ${top[0]}U. Two agreeing settle a team now, so its next ask files it unless GameChanger's own band rules ${top[0]}U out.`;
  if (top && evidence.tally.length === 1)
    return `${top[1]} of its opponents say ${top[0]}U — it needs ${needed}.`;
  const second = evidence.tally[1];
  if (top && second && top[1] === second[1])
    return `Its opponents are split: ${top[1]} say ${top[0]}U and ${second[1]} say ${second[0]}U.`;
  return `Its opponents do not agree: ${evidence.tally.map(([level, n]) => `${n}×${level}U`).join(", ")}.`;
};

/**
 * How much this looks like something nobody plays against, from 0 to 1.
 *
 * Only ever an ordering for a queue somebody works through by hand — it decides what a person
 * looks at first and nothing else. Nothing is thrown out on this number, because every part of it
 * has an innocent explanation: a brand-new club has an empty schedule, a good team beats a bad one
 * 12-0, and a roster of six in September is twelve in October.
 *
 * Games on days that have not happened are weighted hardest because they are the one signal with
 * no innocent reading at all — you cannot score a game early — and the pool where this was first
 * seen held a "Test team" with 68 of 68 games ahead of today.
 */
export const looksInvented = (evidence: AgelessEvidence): number => {
  let score = 0;
  if (evidence.scored > 0) score += 0.5 * (evidence.aheadOfToday / evidence.scored);
  if (evidence.scored > 0) score += 0.2 * (evidence.shutoutBlowouts / evidence.scored);
  // A record claiming many more games than the schedule lists is a record about nothing.
  const claimed = evidence.record
    ? evidence.record.win + evidence.record.loss + evidence.record.tie
    : 0;
  if (claimed > evidence.games * 2 && claimed > 10) score += 0.2;
  if (evidence.playerCount !== undefined && evidence.playerCount < MIN_REAL_ROSTER) score += 0.1;
  return Math.min(1, score);
};

/** Players needed to field a side. Re-stated rather than imported to keep this file free of the
 *  roster module, which is about pulled clubs; an ageless team is never one. */
const MIN_REAL_ROSTER = 9;

/** A level a person may name: only the ones this app ranks. */
export const nameableAgeLevels = (): number[] =>
  Array.from({ length: MAX_AGE_LEVEL - MIN_AGE_LEVEL + 1 }, (_, i) => MIN_AGE_LEVEL + i);
