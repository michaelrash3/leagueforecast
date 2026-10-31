import type { GameLog, Matchup } from "./types";

/**
 * "Since you last looked": what changed in a League season between one visit and the next, told
 * about the team followed. A look is kept on this device only (localStorage, one per season): the
 * places, the Gold odds, the games final, and the chance each game still to play was given. The
 * next visit compares the season with it, and the look is kept again when the card is put away.
 *
 * The chances are kept because nothing else keeps them: the forecast of a game is worked out only
 * while it is still to play, so once it is final, the chance it had is the one the last look saw.
 */

/**
 * A team as the look reads it: its name as shown, its place, and its Gold odds where the league
 * has a cut.
 */
export type LookRow = { id: string; name: string; rank?: number; goldPct?: number };

/** A game as the look reads it, with its score once final. */
export type LookGame = {
  id: string;
  away: string;
  home: string;
  final: boolean;
  awayRuns: string;
  homeRuns: string;
};

/** The season's games as the look reads them, each with its score once final. */
export const lookGames = (
  matchups: readonly Matchup[],
  logs: Readonly<Record<string, GameLog>>
): LookGame[] =>
  matchups.map((game) => {
    const log = logs[game.id];
    return {
      id: game.id,
      away: game.away,
      home: game.home,
      final: Boolean(log?.isFinal),
      awayRuns: log?.awayRuns ?? "",
      homeRuns: log?.homeRuns ?? "",
    };
  });

/** A game still to play, and the chance its first side (`a`) was given of winning it. */
export type LookChance = { a: string; pA: number };

export type LookSnapshot = {
  v: 1;
  /** When it was taken, in milliseconds. */
  at: number;
  /**
   * When its season was made (`SeasonMeta.createdAt`), which tells it from another season under
   * the same id (`readLook`). Absent from a look kept before looks said so.
   */
  createdAt?: string;
  places: Record<string, number>;
  gold?: Record<string, number>;
  finals: string[];
  chances: Record<string, LookChance>;
};

export type LookResult = {
  gameId: string;
  opponent: string;
  /** Null for a tie. */
  won: boolean | null;
  /** The followed team's runs first: "9–4". */
  score: string;
  /** The chance the followed team was given, where the last look saw the game still to play. */
  chance?: number;
};

export type LookChanges = {
  since: number;
  /** The team followed, where one is and it was in the last look. */
  team?: {
    name: string;
    placeBefore: number;
    placeNow: number;
    goldBefore?: number;
    goldNow?: number;
  };
  /** The followed team's games made final since, in schedule order. */
  results: LookResult[];
  /** Every game made final since. */
  newFinals: number;
  /** Of those, the one whose winner had been given the smallest chance, under one in two. */
  upset?: { winner: string; loser: string; score: string; chance: number };
  passedYou: string[];
  youPassed: string[];
  /** With no team followed: the team that climbed most. */
  climber?: { name: string; from: number; to: number };
};

/** The look at the season as it stands. */
export const takeLook = (
  at: number,
  rows: readonly LookRow[],
  games: readonly LookGame[],
  predictions: readonly { gameId: string; teamAId: string; pA: number }[],
  withGold: boolean
): LookSnapshot => {
  const places: Record<string, number> = {};
  const gold: Record<string, number> = {};
  for (const row of rows) {
    if (row.rank !== undefined) places[row.id] = row.rank;
    if (withGold && row.goldPct !== undefined) gold[row.id] = row.goldPct;
  }
  const chances: Record<string, LookChance> = {};
  for (const call of predictions) chances[call.gameId] = { a: call.teamAId, pA: call.pA };
  return {
    v: 1,
    at,
    places,
    ...(withGold ? { gold } : {}),
    finals: games.filter((game) => game.final).map((game) => game.id),
    chances,
  };
};

const runs = (text: string) => Number(text);

/**
 * What changed between two looks, or null when nothing a person would want told did: no game made
 * final, no team's place moved, and the followed team's Gold odds within a point.
 */
export const changesSince = (
  prev: LookSnapshot,
  now: LookSnapshot,
  rows: readonly LookRow[],
  games: readonly LookGame[],
  followed: string | null
): LookChanges | null => {
  const nameOf = (id: string) => rows.find((row) => row.id === id)?.name ?? id;
  const seen = new Set(prev.finals);
  const fresh = games.filter((game) => game.final && !seen.has(game.id));

  // The chance a side was given, from the last look's forecast of the game.
  const chanceOf = (gameId: string, side: string): number | undefined => {
    const call = prev.chances[gameId];
    if (!call) return undefined;
    return call.a === side ? call.pA : 1 - call.pA;
  };

  let upset: LookChanges["upset"];
  for (const game of fresh) {
    const away = runs(game.awayRuns);
    const home = runs(game.homeRuns);
    if (!Number.isFinite(away) || !Number.isFinite(home) || away === home) continue;
    const [winner, loser] = away > home ? [game.away, game.home] : [game.home, game.away];
    const chance = chanceOf(game.id, winner);
    if (chance === undefined || chance >= 0.5) continue;
    if (upset && upset.chance <= chance) continue;
    upset = {
      winner: nameOf(winner),
      loser: nameOf(loser),
      score: `${Math.max(away, home)}–${Math.min(away, home)}`,
      chance,
    };
  }

  const results: LookResult[] = [];
  if (followed) {
    for (const game of fresh) {
      if (game.away !== followed && game.home !== followed) continue;
      const ours = runs(game.away === followed ? game.awayRuns : game.homeRuns);
      const theirs = runs(game.away === followed ? game.homeRuns : game.awayRuns);
      if (!Number.isFinite(ours) || !Number.isFinite(theirs)) continue;
      const chance = chanceOf(game.id, followed);
      results.push({
        gameId: game.id,
        opponent: nameOf(game.away === followed ? game.home : game.away),
        won: ours === theirs ? null : ours > theirs,
        score: `${ours}–${theirs}`,
        ...(chance === undefined ? {} : { chance }),
      });
    }
  }

  const placeBefore = followed ? prev.places[followed] : undefined;
  const placeNow = followed ? now.places[followed] : undefined;
  const passedYou: string[] = [];
  const youPassed: string[] = [];
  if (placeBefore !== undefined && placeNow !== undefined) {
    for (const [id, before] of Object.entries(prev.places)) {
      const after = now.places[id];
      if (id === followed || after === undefined) continue;
      if (before > placeBefore && after < placeNow) passedYou.push(nameOf(id));
      if (before < placeBefore && after > placeNow) youPassed.push(nameOf(id));
    }
  }

  let climber: LookChanges["climber"];
  if (!followed) {
    for (const [id, before] of Object.entries(prev.places)) {
      const after = now.places[id];
      if (after === undefined || after >= before) continue;
      if (!climber || before - after > climber.from - climber.to) {
        climber = { name: nameOf(id), from: before, to: after };
      }
    }
  }

  const goldBefore = followed ? prev.gold?.[followed] : undefined;
  const goldNow = followed ? now.gold?.[followed] : undefined;
  const placesMoved = Object.entries(now.places).some(
    ([id, after]) => prev.places[id] !== undefined && prev.places[id] !== after
  );
  const goldMoved =
    goldBefore !== undefined && goldNow !== undefined && Math.abs(goldNow - goldBefore) >= 1;
  if (fresh.length === 0 && !placesMoved && !goldMoved) return null;

  return {
    since: prev.at,
    ...(followed && placeBefore !== undefined && placeNow !== undefined
      ? {
          team: {
            name: nameOf(followed),
            placeBefore,
            placeNow,
            ...(goldBefore !== undefined && goldNow !== undefined ? { goldBefore, goldNow } : {}),
          },
        }
      : {}),
    results,
    newFinals: fresh.length,
    ...(upset ? { upset } : {}),
    passedYou,
    youPassed,
    ...(climber ? { climber } : {}),
  };
};

const lookKey = (seasonId: string) => `lf_last_look_v1_${seasonId}`;

const isLook = (value: unknown): value is LookSnapshot => {
  if (!value || typeof value !== "object") return false;
  const look = value as Partial<LookSnapshot>;
  return (
    look.v === 1 &&
    typeof look.at === "number" &&
    (look.createdAt === undefined || typeof look.createdAt === "string") &&
    typeof look.places === "object" &&
    look.places !== null &&
    Array.isArray(look.finals) &&
    typeof look.chances === "object" &&
    look.chances !== null
  );
};

/**
 * The last look kept for a season on this device, or null (none, unreadable, or storage off).
 *
 * A look is kept under its season's id, apart from what `forgetSeasons` clears or moves, and ids
 * are handed out again: a season deleted and its id given to another, one a restore put another
 * under, or this device's moved to a new id by a cloud merge and the other side's left under the
 * old one. So a look kept of a season made at another moment than `createdAt` is none, and the
 * season starts afresh from where it stands; compared with it, every final of the season under the
 * id was told as new. Where either does not say when its season was made, from before they said,
 * the look is the season's.
 */
export const readLook = (seasonId: string, createdAt = ""): LookSnapshot | null => {
  try {
    const raw = window.localStorage.getItem(lookKey(seasonId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLook(parsed)) return null;
    return createdAt && parsed.createdAt && parsed.createdAt !== createdAt ? null : parsed;
  } catch {
    return null;
  }
};

/** Keeps a look for a season on this device; a storage that refuses it changes nothing else. */
export const saveLook = (seasonId: string, look: LookSnapshot): void => {
  try {
    window.localStorage.setItem(lookKey(seasonId), JSON.stringify(look));
  } catch {
    // Storage full or off: the card is only shown again next time, which is no loss.
  }
};
