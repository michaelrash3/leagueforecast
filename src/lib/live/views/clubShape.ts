import { coerceScoutTeams } from "../../teamRankingsCompact";
import type { ClubAge } from "../../teamRankings/clubAge";
import type { ScoutGame, ScoutTeam } from "../../teamRankings";

/**
 * What a published club card is, as both its publisher (`clubs.ts`) and a member's device read it:
 * its key, its bucket, its shape and the check of that shape. The team panel a club opens reads
 * no fit (`TeamDetailPanel`): only the club, its own games of the year, its opponents' names, its
 * age and its League Standings link. So each club has a card with exactly those, and a device that
 * opens a club reads that club's card rather than the year's pool.
 *
 * Cards are published in buckets, a squad year's clubs split by their id into `CLUB_BUCKETS`
 * views: one view per club would be a hundred thousand documents to write on a night every club
 * is pulled, and one per year would be the whole pool to read for one club.
 */

/** The family of views the club cards are: every key under this prefix. */
export const CLUB_FAMILY = "club:";

/**
 * How many buckets a year's clubs are split into. On the 29 Sep backup's 112,228 clubs of 2027 the
 * biggest bucket held 1,838 and came to 281 KB gzipped (measured): what a device reads to open one
 * club, and then nothing more for any other club in it until the next publish.
 */
export const CLUB_BUCKETS = 64;

/**
 * A club's bucket: the 32-bit FNV-1a hash of its id, by UTF-16 code unit, modulo `CLUB_BUCKETS`.
 * The publisher and every device must agree on it, so it is pinned in `clubShape.test.ts`.
 */
export const clubBucketOf = (teamId: string): number => {
  let hash = 0x811c9dc5;
  for (let at = 0; at < teamId.length; at += 1) {
    hash ^= teamId.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % CLUB_BUCKETS;
};

/** A bucket's key in `live/meta`: `club:{year}:{bucket}`, "none" for the pages with no year. */
export const clubKey = (year: number | undefined, bucket: number): string =>
  `club:${year ?? "none"}:${bucket}`;

/**
 * One club as its panel reads it, for one squad year:
 * - `team`: the club as the year's roster holds it, League Standings' own teams included.
 * - `games`: every game of the year it played or is down to play, League Standings' included, in
 *   the order the year's pool holds them (`gamesForTeam`), each as the panel reads it
 *   (`panelGame`). A game's `id` is its place in the list: the panel keys rows by it and reads it
 *   for nothing else, and the stored ids were a third of a card's weight.
 * - `names`: its opponents' names, by id.
 * - `leaguePages`: the pages its League Standings games are filed on, and `picked`, that League
 *   Standings reaches it only by a person's pick: together the panel's `leagueLink` on any page.
 * - `age`: its level in the year, and the level a person pinned it at (`clubAgeOf`).
 */
export type ClubCard = {
  team: ScoutTeam;
  games: ScoutGame[];
  names: Record<string, string>;
  leaguePages?: string[];
  picked?: true;
  age?: ClubAge;
};

/**
 * A game on the wire, from the club's side: `s` 0 when the club is side A and 1 when it is side
 * B; `o` its opponent's place in the card's `opponents`, or -1 for a game against its own name;
 * `p` the page it is filed on; `a` and `b` the scores; `ra` and `rb` side B's own report of them;
 * `x` set not to count; `c` the margin a person confirmed; `d` and `e` its day and event; `la` and
 * `lb` each side's level.
 */
type GameWire = {
  s: 0 | 1;
  o: number;
  p: string;
  a?: number;
  b?: number;
  ra?: number;
  rb?: number;
  x?: 1;
  c?: number;
  d?: string;
  e?: string;
  la?: number;
  lb?: number;
};

/**
 * A card on the wire: its opponents once each, by id and name (an id alone for one the roster has
 * no name for, which the panel calls "Unknown"), and its games against them.
 */
type CardWire = {
  team: ScoutTeam;
  opponents: Array<[id: string, name: string] | [id: string]>;
  games: GameWire[];
  leaguePages?: string[];
  picked?: true;
  age?: ClubAge;
};

/** A bucket of a year's club cards, by club id, as published. */
export type ClubBucketWire = { clubs: Record<string, CardWire> };

/** A bucket of a year's club cards, by club id, as read back. */
export type ClubBucket = { clubs: Record<string, ClubCard> };

/** The panel's League Standings link for a club on page `pageId` (`TeamDetailPanel.leagueLink`). */
export const leagueLinkOf = (card: ClubCard, pageId: string): "name" | "pick" | undefined =>
  card.leaguePages?.includes(pageId) ? (card.picked ? "pick" : "name") : undefined;

/**
 * A card as it is published: each game from the club's side, its opponent by its place in the
 * card's list, and without its stored id. Every game must be the club's.
 */
export const encodeClubCard = (card: ClubCard): CardWire => {
  const teamId = card.team.id;
  const opponents: CardWire["opponents"] = [];
  const places = new Map<string, number>();
  const placeOf = (opponent: string): number => {
    const held = places.get(opponent);
    if (held !== undefined) return held;
    const name = card.names[opponent];
    opponents.push(name === undefined ? [opponent] : [opponent, name]);
    places.set(opponent, opponents.length - 1);
    return opponents.length - 1;
  };
  const games = card.games.map((game): GameWire => {
    if (game.teamAId !== teamId && game.teamBId !== teamId)
      throw new Error(`Game ${game.id} on ${teamId}'s card is not its own.`);
    const side = game.teamAId === teamId ? 0 : 1;
    const opponent = side === 0 ? game.teamBId : game.teamAId;
    return {
      s: side,
      o: opponent === teamId ? -1 : placeOf(opponent),
      p: game.ageGroupId,
      ...(game.teamAScore === undefined ? {} : { a: game.teamAScore }),
      ...(game.teamBScore === undefined ? {} : { b: game.teamBScore }),
      ...(game.reportedByB
        ? { ra: game.reportedByB.teamAScore, rb: game.reportedByB.teamBScore }
        : {}),
      ...(game.excluded ? { x: 1 as const } : {}),
      ...(game.scoreConfirmed === undefined ? {} : { c: game.scoreConfirmed }),
      ...(game.date === undefined ? {} : { d: game.date }),
      ...(game.event === undefined ? {} : { e: game.event }),
      ...(game.ageLevelA === undefined ? {} : { la: game.ageLevelA }),
      ...(game.ageLevelB === undefined ? {} : { lb: game.ageLevelB }),
    };
  });
  return {
    team: card.team,
    opponents,
    games,
    ...(card.leaguePages ? { leaguePages: card.leaguePages } : {}),
    ...(card.picked ? { picked: true as const } : {}),
    ...(card.age ? { age: card.age } : {}),
  };
};

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const isLevel = (raw: unknown): raw is number =>
  typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0;

const isScore = (raw: unknown): raw is number => typeof raw === "number" && Number.isFinite(raw);

const isText = (raw: unknown): raw is string => typeof raw === "string";

const ageOf = (raw: unknown): ClubAge | null => {
  if (!isRecord(raw)) return null;
  if (raw.level !== undefined && !isLevel(raw.level)) return null;
  let pinned: ClubAge["pinned"];
  if (raw.pinned !== undefined) {
    const pin = raw.pinned;
    if (!isRecord(pin) || !isLevel(pin.level)) return null;
    if (pin.was !== undefined && !isLevel(pin.was)) return null;
    pinned = { level: pin.level, ...(pin.was === undefined ? {} : { was: pin.was }) };
  }
  return {
    ...(raw.level === undefined ? {} : { level: raw.level }),
    ...(pinned ? { pinned } : {}),
  };
};

/** One game read back off the wire, or null when any field of it is not what it should be. */
const gameOf = (
  raw: unknown,
  at: number,
  teamId: string,
  opponents: readonly string[]
): ScoutGame | null => {
  if (!isRecord(raw) || (raw.s !== 0 && raw.s !== 1) || !isText(raw.p) || raw.p === "") return null;
  if (typeof raw.o !== "number" || !Number.isSafeInteger(raw.o)) return null;
  const opponent = raw.o === -1 ? teamId : opponents[raw.o];
  if (opponent === undefined) return null;
  const optional: Array<[string, (value: unknown) => boolean]> = [
    ["a", isScore],
    ["b", isScore],
    ["ra", isScore],
    ["rb", isScore],
    ["x", (value) => value === 1],
    ["c", isScore],
    ["d", isText],
    ["e", isText],
    ["la", isLevel],
    ["lb", isLevel],
  ];
  if (optional.some(([field, valid]) => raw[field] !== undefined && !valid(raw[field])))
    return null;
  if ((raw.ra === undefined) !== (raw.rb === undefined)) return null;
  const [teamAId, teamBId] = raw.s === 0 ? [teamId, opponent] : [opponent, teamId];
  return {
    id: String(at),
    teamAId,
    teamBId,
    ageGroupId: raw.p,
    ...(raw.a === undefined ? {} : { teamAScore: raw.a as number }),
    ...(raw.b === undefined ? {} : { teamBScore: raw.b as number }),
    ...(raw.ra === undefined
      ? {}
      : { reportedByB: { teamAScore: raw.ra as number, teamBScore: raw.rb as number } }),
    ...(raw.x === 1 ? { excluded: true } : {}),
    ...(raw.c === undefined ? {} : { scoreConfirmed: raw.c as number }),
    ...(raw.d === undefined ? {} : { date: raw.d as string }),
    ...(raw.e === undefined ? {} : { event: raw.e as string }),
    ...(raw.la === undefined ? {} : { ageLevelA: raw.la as number }),
    ...(raw.lb === undefined ? {} : { ageLevelB: raw.lb as number }),
  };
};

/**
 * One card as read back, or null when any part of it is not what a card holds: the club must come
 * through the roster's own check whole (`coerceScoutTeams`), and every game and opponent must read,
 * since a game dropped on the way would change the record the panel shows.
 */
const cardOf = (teamId: string, raw: unknown): ClubCard | null => {
  if (!isRecord(raw) || !Array.isArray(raw.games) || !Array.isArray(raw.opponents)) return null;
  const [team, ...others] = coerceScoutTeams([raw.team]);
  if (!team || others.length > 0 || team.id !== teamId) return null;
  const opponents: string[] = [];
  const names: Record<string, string> = {};
  for (const entry of raw.opponents as unknown[]) {
    if (!Array.isArray(entry) || entry.length < 1 || entry.length > 2) return null;
    const [id, name] = entry as unknown[];
    if (!isText(id) || id === "" || id === teamId || opponents.includes(id)) return null;
    if (entry.length === 2 && !isText(name)) return null;
    opponents.push(id);
    if (isText(name)) names[id] = name;
  }
  const games: ScoutGame[] = [];
  for (const [at, entry] of (raw.games as unknown[]).entries()) {
    const game = gameOf(entry, at, teamId, opponents);
    if (!game) return null;
    games.push(game);
  }
  let leaguePages: string[] | undefined;
  if (raw.leaguePages !== undefined) {
    const pages = raw.leaguePages;
    if (!Array.isArray(pages) || pages.length === 0) return null;
    if (!pages.every((page): page is string => isText(page) && page !== "")) return null;
    leaguePages = pages;
  }
  if (raw.picked !== undefined && raw.picked !== true) return null;
  const age = raw.age === undefined ? undefined : ageOf(raw.age);
  if (age === null) return null;
  return {
    team,
    games,
    names,
    ...(leaguePages ? { leaguePages } : {}),
    ...(raw.picked === true ? { picked: true as const } : {}),
    ...(age ? { age } : {}),
  };
};

/** A published bucket as read back, or null when any card in it is not one (`cardOf`). */
export const coerceClubBucket = (raw: unknown): ClubBucket | null => {
  if (!isRecord(raw) || !isRecord(raw.clubs)) return null;
  const clubs: Record<string, ClubCard> = {};
  for (const [teamId, value] of Object.entries(raw.clubs)) {
    const card = cardOf(teamId, value);
    if (!card) return null;
    clubs[teamId] = card;
  }
  return { clubs };
};
