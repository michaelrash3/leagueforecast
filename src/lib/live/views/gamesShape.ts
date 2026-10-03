import type { ScoutGame } from "../../teamRankings";

/**
 * What a published Games list is, as both its publisher (`games.ts`) and a member's device read
 * it: its key, its shape and the check of that shape. The Games tab lists a page's stored games,
 * newest first, each by its clubs' names, its score or that it is still to be played, its event,
 * its day and whether it is set not to count (`GamesSection`). So each page has a list of exactly
 * those, and a device that opens the tab reads its page's list rather than the year's pool; which
 * of them it shows first, today's, it works out on the reader's own day, as the page does
 * (`gamesWindow.ts`).
 */

/** The family of views the Games lists are: every key under this prefix. */
export const GAMES_FAMILY = "games:";

/** A page's list's key in `live/meta`: `games:{year}:{page}`, "none" for a page with no year. */
export const gamesKey = (year: number | undefined, pageId: string): string =>
  `games:${year ?? "none"}:${pageId}`;

/** A page's Games list as read back: its page, its games in the tab's order, and its clubs' names. */
export type GamesView = { page: string; games: ScoutGame[]; names: Map<string, string> };

/**
 * A game on the wire: its clubs by their places in the list's `teams`, its scores (null when it
 * has none), its day and event ("" when it has none), and 1 when it is set not to count. A game's
 * id is its place in the list: the tab keys rows by it and reads it for nothing else.
 */
type GameWire = [
  a: number,
  b: number,
  scoreA: number | null,
  scoreB: number | null,
  date: string,
  event: string,
  excluded: 0 | 1,
];

/**
 * A page's list as published: its page, its clubs once each, by id and name or by id alone, and
 * its games, every one filed on the page.
 */
export type GamesWire = {
  page: string;
  teams: Array<[id: string, name: string] | [id: string]>;
  games: GameWire[];
};

/** A list as it is published, each club named once. Every game must be filed on the page. */
export const encodeGames = (view: GamesView): GamesWire => {
  const teams: GamesWire["teams"] = [];
  const places = new Map<string, number>();
  const placeOf = (teamId: string): number => {
    const held = places.get(teamId);
    if (held !== undefined) return held;
    const name = view.names.get(teamId);
    teams.push(name === undefined ? [teamId] : [teamId, name]);
    places.set(teamId, teams.length - 1);
    return teams.length - 1;
  };
  const games = view.games.map((game): GameWire => {
    if (game.ageGroupId !== view.page)
      throw new Error(`Game ${game.id} on ${view.page}'s list is filed on ${game.ageGroupId}.`);
    return [
      placeOf(game.teamAId),
      placeOf(game.teamBId),
      game.teamAScore ?? null,
      game.teamBScore ?? null,
      game.date ?? "",
      game.event ?? "",
      game.excluded ? 1 : 0,
    ];
  });
  return { page: view.page, teams, games };
};

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const isScore = (raw: unknown): raw is number | null =>
  raw === null || (typeof raw === "number" && Number.isFinite(raw));

/**
 * A published list as read back, or null when any part of it is not what a list holds: a game
 * dropped on the way would be one the tab does not count among the page's, so one bad game
 * refuses the list.
 */
export const coerceGames = (raw: unknown): GamesView | null => {
  if (!isRecord(raw) || typeof raw.page !== "string" || raw.page === "") return null;
  if (!Array.isArray(raw.teams) || !Array.isArray(raw.games)) return null;
  const page = raw.page;
  const ids: string[] = [];
  const seen = new Set<string>();
  const names = new Map<string, string>();
  for (const entry of raw.teams as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 1 || entry.length > 2) return null;
    const [id, name] = entry as unknown[];
    if (typeof id !== "string" || id === "" || seen.has(id)) return null;
    if (entry.length === 2 && typeof name !== "string") return null;
    ids.push(id);
    seen.add(id);
    if (typeof name === "string") names.set(id, name);
  }
  const games: ScoutGame[] = [];
  for (const [at, entry] of (raw.games as unknown[]).entries()) {
    if (!Array.isArray(entry) || entry.length !== 7) return null;
    const [a, b, scoreA, scoreB, date, event, excluded] = entry as unknown[];
    const teamAId = typeof a === "number" ? ids[a] : undefined;
    const teamBId = typeof b === "number" ? ids[b] : undefined;
    if (teamAId === undefined || teamBId === undefined) return null;
    if (!isScore(scoreA) || !isScore(scoreB)) return null;
    if (typeof date !== "string" || typeof event !== "string") return null;
    if (excluded !== 0 && excluded !== 1) return null;
    games.push({
      id: String(at),
      teamAId,
      teamBId,
      ageGroupId: page,
      ...(scoreA === null ? {} : { teamAScore: scoreA }),
      ...(scoreB === null ? {} : { teamBScore: scoreB }),
      ...(date ? { date } : {}),
      ...(event ? { event } : {}),
      ...(excluded === 1 ? { excluded: true } : {}),
    });
  }
  return { page, games, names };
};
