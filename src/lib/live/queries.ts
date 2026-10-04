import { agelessCsvParts } from "../agelessCsv";
import { agelessSearch, agelessWaiting, type AgelessAside } from "../agelessQueue";
import { agelessClearPlan, agelessSitting, type AgelessGroup } from "../agelessSitting";
import { agelessClearable } from "../agelessTriage";
import type { AgeUnknownTeam } from "../ageUnknown";
import { GC_PAIRING_EVIDENCE_LABEL, type GcImportState } from "../gameChangerImport";
import { poolHealth, settleableNow, type PoolHealth } from "../poolHealth";
import { poolHealthSummary, type PoolHealthSummary } from "../poolHealthSummary";
import { poolLists, TO_PULL_DRAWN, type PoolLists } from "../poolLists";
import { whatIfCurve, type WhatIfCurve } from "../scoutWhatIf";
import { ageGroupYear, rankingPoolGroupIds, type SeasonSegment } from "../teamRankings/seasons";
import type { ScoutGame, ScoutTeam } from "../teamRankings/types";
import { cleanTeamName, teamNameKey } from "../teamRankings/names";
import { unpulledClubs, unpulledClubsCsv } from "../unpulledClubs";
import {
  loadAgeGroups,
  loadAgeRightClubs,
  loadAgeUnknown,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadRealClubs,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
  storedGamesByYear,
} from "../teamRankingsStorage";
import { loggedGamesOn } from "../teamRankings/gamesWindow";
import { planClubAges, type AgeAsked } from "./agePlan";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "./allKnown";
import { coerceCommand, everyOne, oneAgeless, oneGame, oneTeam, sameValue } from "./commands";
import { cardGamesOf, panelGame } from "./views/clubs";
import { fits, type Shape } from "./shapes";
import { findListed, type GameSeen } from "./views/gamesShape";

/**
 * Read-only questions a member's device asks of the pool the edit function keeps warm (1.5): what
 * a section has to say before it sends an edit, worked out on the copy rather than on a pool the
 * device no longer needs to hold. Each is answered from the process's store by the code the page
 * answers it with, so the device is told what its own copy would have said. Pure, as the commands
 * are, so it is tested without a server: `runQuery` (`editRun.ts`) brings the pool to the copy and
 * asks.
 */

/**
 * - `merge.preview`: folding `fromId` into `intoId`, as `teams.merge` does: whether both clubs are
 *   there to fold (the roster's, or one League Standings made, offered in `adopt` as the command
 *   takes it), and the counts `foldCounts` gives.
 * - `rename.preview`: renaming `teamId` to `name`, as the page does: the name as it would be kept,
 *   and the club already under it on the roster, which the rename folds the club into instead
 *   (`renameScoutTeam`), with the counts of that fold. A club League Standings made is not on the
 *   server's roster to be found by its name until it joins it.
 * - `health.summary`: what Pool health shows as it opens, on the device's day `today`
 *   (`poolHealthSummary`), and the answers already given that its lists leave out.
 * - `health.inspect`: what it shows once asked to look harder, as the tidy worker answers it
 *   (`poolHealth`, `settleableNow`, `poolLists`), against the copy's own tidy stamp; of the clubs
 *   worth pulling, only the ones the card draws, and how many there are.
 * - `health.toPull`: every club worth pulling, as the file the card downloads (`unpulledClubsCsv`).
 * - `ages.plan`: Pool health's suggested ages, approved together, as the commands that file them
 *   (`planClubAges`), with page ids from `base`, for the device to send as one edit.
 * - `ageless.queue`: the card of teams waiting on an age at a sitting, on the device's day
 *   (`agelessSitting`), with the ten the device holds pinned: the entries alone, which the device
 *   makes rows of as its own card does (`agelessRowFor`), since every line of a row is worked out
 *   from its entry.
 * - `ageless.search`: the teams on that list answering to `query`, whatever stands between each and
 *   the queue (`agelessSearch`), as entries.
 * - `ageless.file`: the card's file of every team still waiting (`agelessCsvParts`).
 * - `ageless.clearPlan`: what clearing the rows of the rules ticked takes off the list
 *   (`agelessClearPlan`), for the device to ask about and send as one edit.
 */
export type PoolQuery =
  | { kind: "merge.preview"; fromId: string; intoId: string; adopt: ScoutTeam[] }
  | { kind: "rename.preview"; teamId: string; name: string }
  | { kind: "health.summary"; today: string }
  | { kind: "health.inspect"; today: string }
  | { kind: "health.toPull" }
  | { kind: "ages.plan"; clubs: AgeAsked[]; at: string; base: string }
  | { kind: "ageless.queue"; today: string; pinned: string[] }
  | { kind: "ageless.search"; today: string; query: string }
  | { kind: "ageless.file"; today: string }
  | { kind: "ageless.clearPlan"; today: string; rules: string[] }
  /**
   * The id of a game a page's published list shows (`findListed`), which the list does not carry:
   * asked before the Games tab edits one, of the page's games in `year` (null: no year).
   */
  | { kind: "games.find"; year: number | null; page: string; at: number; game: GameSeen }
  /**
   * What winning or losing one fixture would do to a club's place on a page's board of `segment`
   * (null: the year's), refitted with the result in it (`whatIfCurve`), as Scouting asks. The
   * fixture is `game` as the club's card holds it (`panelGame`), its id its place on the card,
   * since a card carries no game ids (`cardFixture`).
   */
  | {
      kind: "scouting.whatIf";
      page: string;
      segment: SeasonSegment | null;
      forTeamId: string;
      game: ScoutGame;
      today: string;
    };

/**
 * What folding one club into another touches: the stored games that name the club folded away,
 * and of those the games between the two, which a fold drops since a club cannot play itself
 * (`mergeScoutTeams`). A club's game against its own name is not between the two, the two being
 * two clubs in every question that asks.
 */
export type FoldCounts = { games: number; dropped: number };

export type MergePreview = FoldCounts & { found: boolean };

export type RenamePreview = FoldCounts & {
  /** The name as it would be kept (`cleanTeamName`), empty where none would be. */
  name: string;
  into: { id: string; name: string } | null;
};

/** The answers Pool health's lists leave out, by GameChanger id: each list's as stored. */
export type HealthAnswers = { ageRight: string[]; realClubs: string[]; keptApart: string[] };

export type HealthSummaryAnswer = { summary: PoolHealthSummary; answers: HealthAnswers };

/**
 * What Pool health shows once asked to look harder. The clubs worth pulling are cut to the
 * `TO_PULL_DRAWN` the card draws, with the count of them all: every one of them was 7.5 of the
 * 7.9 MB the answer came to on the copy of 29 September (51,298 clubs), sent on every look for a
 * card that draws five and a file few ask for (`health.toPull`).
 */
export type HealthInspectAnswer = {
  health: PoolHealth;
  settleable: number;
  lists: PoolLists;
  toPullCount: number;
};

/** The file of every club worth pulling, as the card downloads it. */
export type HealthToPullAnswer = { csv: string };

export type AgesPlan = ReturnType<typeof planClubAges>;

export type AgelessQueueAnswer = {
  listed: number;
  waiting: number;
  batch: AgeUnknownTeam[];
  groups: AgelessGroup[];
};

export type AgelessSearchAnswer = {
  total: number;
  hits: { entry: AgeUnknownTeam; aside?: AgelessAside }[];
};

export type AgelessClearPlanAnswer = ReturnType<typeof agelessClearPlan>;

export type QueryAnswers = {
  "merge.preview": MergePreview;
  "rename.preview": RenamePreview;
  "health.summary": HealthSummaryAnswer;
  "health.inspect": HealthInspectAnswer;
  "health.toPull": HealthToPullAnswer;
  "ages.plan": AgesPlan;
  "ageless.queue": AgelessQueueAnswer;
  "ageless.search": AgelessSearchAnswer;
  "ageless.file": { csv: string };
  "ageless.clearPlan": AgelessClearPlanAnswer;
  "games.find": { gameId: string | null };
  "scouting.whatIf": { curve: WhatIfCurve | null };
};

export type QueryKind = PoolQuery["kind"];

/** An answer, with the kind of question it answers. */
export type QueryAnswer = { [K in QueryKind]: { kind: K } & QueryAnswers[K] }[QueryKind];

/** The question of kind `K`, and its answer. */
export type QueryOf<K extends QueryKind> = Extract<PoolQuery, { kind: K }>;
export type AnswerOf<K extends QueryKind> = { kind: K } & QueryAnswers[K];

export const foldCounts = (
  fromId: string,
  intoId: string,
  games: readonly ScoutGame[]
): FoldCounts => {
  let named = 0;
  let dropped = 0;
  for (const game of games) {
    const sideA = game.teamAId === fromId;
    if (!sideA && game.teamBId !== fromId) continue;
    named += 1;
    if ((sideA ? game.teamBId : game.teamAId) === intoId) dropped += 1;
  }
  return { games: named, dropped };
};

const NO_FOLD: FoldCounts = { games: 0, dropped: 0 };

/** The pool as the page holds it: every page, the roster, and every stored game. */
const storedState = (): GcImportState => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  games: loadScoutGames(),
});

/** The teams still waiting on a person, on `today`, from the process's store. */
const waitingOn = (today: string) =>
  agelessWaiting(loadAgeUnknown(), loadNamedAges(), loadDroppedClubs(), new Date(today)).map(
    (row) => row.entry
  );

/**
 * The game a club's card showed as `shown`, whose id is its place on the card, in the club's games
 * as the card lists them now (`cardGamesOf`): the game at that place while it still reads so on a
 * card (`panelGame`), or else the one game that does, the card having moved since it was
 * published; null when none does, or more than one and none at its place.
 */
export const cardFixture = (games: readonly ScoutGame[], shown: ScoutGame): ScoutGame | null => {
  const reads = (game: ScoutGame) => sameValue({ ...panelGame(game), id: shown.id }, shown);
  const at = /^\d+$/.test(shown.id) ? Number(shown.id) : -1;
  const there = games[at];
  if (there && reads(there)) return there;
  const like = games.filter(reads);
  return like.length === 1 && like[0] ? like[0] : null;
};

/** The questions answered with League Standings' games in the year, as the boards are built. */
const LEAGUE_ASKED: ReadonlySet<QueryKind> = new Set<QueryKind>(["scouting.whatIf"]);

/** Whether `query` is answered with the copy's League Standings seasons (`answerQuery`'s `seasons`). */
export const asksLeague = (query: PoolQuery): boolean => LEAGUE_ASKED.has(query.kind);

/**
 * Answers `query` from the process's store, as the page would have answered it from its own.
 * `seasons` reads the copy's League Standings seasons, which the boards are built with; a question
 * that refits a year (`asksLeague`) is answered with them, so it agrees with the board on screen.
 */
export const answerQuery = (query: PoolQuery, seasons?: SeasonReader): QueryAnswer => {
  switch (query.kind) {
    case "scouting.whatIf": {
      const ageGroups = loadAgeGroups();
      const page = ageGroups.find((group) => group.id === query.page);
      if (!page || !seasons) return { kind: "scouting.whatIf", curve: null };
      // The year as the page knows it, League Standings' games in it, and the page's rating pool.
      const known = deriveAllKnown({
        ageGroups,
        teams: loadScoutTeams(),
        yearGames: loadScoutGamesForYear(ageGroupYear(page)),
        readSeason: seasons,
      });
      const games = gamesOnPages(known.games, rankingPoolGroupIds(page.id, ageGroups));
      // Found among the club's games of the year, as its card lists them; fitted on the page's pool.
      const fixture = cardFixture(cardGamesOf(known.games, query.forTeamId), query.game);
      const curve = fixture
        ? whatIfCurve(
            fixture,
            query.forTeamId,
            page.id,
            known.teams,
            games,
            page.myTeamId,
            ageGroups,
            query.segment ?? undefined,
            query.today
          )
        : null;
      // Named as the device named it, its place on the card.
      return { kind: "scouting.whatIf", curve: curve && { ...curve, gameId: query.game.id } };
    }
    case "ageless.queue": {
      const sitting = agelessSitting(
        loadAgeUnknown(),
        loadNamedAges(),
        loadDroppedClubs(),
        new Date(query.today),
        query.pinned
      );
      return {
        kind: "ageless.queue",
        listed: sitting.listed,
        waiting: sitting.waiting,
        batch: sitting.batch.map((row) => row.entry),
        groups: sitting.groups,
      };
    }
    case "ageless.search": {
      const found = agelessSearch(
        loadAgeUnknown(),
        loadNamedAges(),
        loadDroppedClubs(),
        new Date(query.today),
        query.query
      );
      return {
        kind: "ageless.search",
        total: found.total,
        hits: found.hits.map(({ row, aside }) => ({
          entry: row.entry,
          ...(aside ? { aside } : {}),
        })),
      };
    }
    case "ageless.file":
      return { kind: "ageless.file", csv: agelessCsvParts(waitingOn(query.today)).join("") };
    case "ageless.clearPlan":
      return {
        kind: "ageless.clearPlan",
        ...agelessClearPlan(agelessClearable(waitingOn(query.today)), new Set(query.rules)),
      };
    case "health.summary":
      return {
        kind: "health.summary",
        summary: poolHealthSummary(storedState(), query.today, storedGamesByYear()),
        answers: {
          ageRight: [...loadAgeRightClubs()],
          realClubs: [...loadRealClubs()],
          keptApart: [...loadKeptApart()],
        },
      };
    case "health.inspect": {
      const state = storedState();
      const health = poolHealth(state, loadTidyStamp() ?? "", query.today);
      const lists = poolLists(state, loadKeptApart(), query.today);
      return {
        kind: "health.inspect",
        health,
        // Only worth asking when something could be settled, as the tidy worker asks it.
        settleable: health.standInPlayed === 0 ? 0 : settleableNow(state),
        lists: { ...lists, toPull: lists.toPull.slice(0, TO_PULL_DRAWN) },
        toPullCount: lists.toPull.length,
      };
    }
    case "health.toPull":
      return { kind: "health.toPull", csv: unpulledClubsCsv(unpulledClubs(storedState())) };
    case "games.find": {
      const listed = loggedGamesOn(loadScoutGamesForYear(query.year ?? undefined), query.page);
      return { kind: "games.find", gameId: findListed(listed, query.at, query.game) };
    }
    case "ages.plan":
      return {
        kind: "ages.plan",
        ...planClubAges(
          { teams: loadScoutTeams(), games: loadScoutGames(), ageGroups: loadAgeGroups() },
          query.clubs,
          query.at,
          query.base
        ),
      };
    case "merge.preview": {
      const held = new Set(loadScoutTeams().map((team) => team.id));
      query.adopt.forEach((team) => held.add(team.id));
      const found =
        query.fromId !== query.intoId && held.has(query.fromId) && held.has(query.intoId);
      return {
        kind: "merge.preview",
        found,
        ...(found ? foldCounts(query.fromId, query.intoId, loadScoutGames()) : NO_FOLD),
      };
    }
    case "rename.preview": {
      const name = cleanTeamName(query.name).trim();
      const key = teamNameKey(name);
      const into = name
        ? loadScoutTeams().find(
            (team) => team.id !== query.teamId && teamNameKey(team.name) === key
          )
        : undefined;
      return {
        kind: "rename.preview",
        name,
        into: into ? { id: into.id, name: into.name } : null,
        ...(into ? foldCounts(query.teamId, into.id, loadScoutGames()) : NO_FOLD),
      };
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/**
 * A day as the device's clock gives one, `YYYY-MM-DD`, and one the calendar has: the parser rolls
 * 30 February over into March rather than refusing it, so the day is read back to be sure.
 */
const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(value);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
};

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(isString) ? [...(value as string[])] : null;

const isTime = (value: unknown): value is string =>
  typeof value === "string" && value !== "" && !Number.isNaN(Date.parse(value));

/** A club to file at an age, as `ages.plan` takes one: a level the app ranks at, in a squad year. */
const ageAsked = (raw: unknown): AgeAsked | null =>
  isRecord(raw) &&
  isString(raw.teamId) &&
  Number.isInteger(raw.level) &&
  Number.isInteger(raw.year) &&
  Object.keys(raw).length === 3
    ? { teamId: raw.teamId, level: raw.level as number, year: raw.year as number }
    : null;

const isScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A game as a page's list shows it (`GameSeen`), every field one the list could have shown. */
const gameSeen = (raw: unknown): GameSeen | null => {
  if (!isRecord(raw) || !isString(raw.teamAId) || !isString(raw.teamBId)) return null;
  const { teamAScore, teamBScore, date, event, excluded } = raw;
  if (teamAScore !== undefined && !isScore(teamAScore)) return null;
  if (teamBScore !== undefined && !isScore(teamBScore)) return null;
  if ((date !== undefined && !isString(date)) || (event !== undefined && !isString(event)))
    return null;
  if (excluded !== undefined && excluded !== true) return null;
  const seen: GameSeen = {
    teamAId: raw.teamAId,
    teamBId: raw.teamBId,
    ...(teamAScore === undefined ? {} : { teamAScore }),
    ...(teamBScore === undefined ? {} : { teamBScore }),
    ...(date === undefined ? {} : { date }),
    ...(event === undefined ? {} : { event }),
    ...(excluded === undefined ? {} : { excluded }),
  };
  return keptWhole(raw, seen) ? seen : null;
};

/** Whether every key `raw` carries is one `read` kept: what a reader drops was never meant. */
const keptWhole = (raw: Record<string, unknown>, read: object): boolean =>
  Object.keys(raw).every((key) => Object.prototype.hasOwnProperty.call(read, key));

/**
 * A question read back exactly, as a command is (`coerceCommand`): one with a field this build does
 * not read, or one it would have to change to read, is refused rather than half answered.
 */
export const coerceQuery = (raw: unknown): PoolQuery | null => {
  if (!isRecord(raw)) return null;
  let query: PoolQuery | null = null;
  switch (raw.kind) {
    case "merge.preview": {
      const adopt = everyOne(raw.adopt, oneTeam);
      if (isString(raw.fromId) && isString(raw.intoId) && adopt)
        query = { kind: "merge.preview", fromId: raw.fromId, intoId: raw.intoId, adopt };
      break;
    }
    case "rename.preview":
      if (isString(raw.teamId) && typeof raw.name === "string")
        query = { kind: "rename.preview", teamId: raw.teamId, name: raw.name };
      break;
    case "health.summary":
    case "health.inspect":
      if (isDay(raw.today)) query = { kind: raw.kind, today: raw.today };
      break;
    case "health.toPull":
      query = { kind: "health.toPull" };
      break;
    case "ageless.queue": {
      const pinned = strings(raw.pinned);
      if (isDay(raw.today) && pinned) query = { kind: "ageless.queue", today: raw.today, pinned };
      break;
    }
    case "ageless.search":
      if (isDay(raw.today) && typeof raw.query === "string")
        query = { kind: "ageless.search", today: raw.today, query: raw.query };
      break;
    case "ageless.file":
      if (isDay(raw.today)) query = { kind: "ageless.file", today: raw.today };
      break;
    case "ageless.clearPlan": {
      const rules = strings(raw.rules);
      if (isDay(raw.today) && rules) query = { kind: "ageless.clearPlan", today: raw.today, rules };
      break;
    }
    case "games.find": {
      const game = gameSeen(raw.game);
      const year = raw.year;
      if (
        game &&
        (year === null || Number.isInteger(year)) &&
        isString(raw.page) &&
        isCount(raw.at)
      )
        query = {
          kind: "games.find",
          year: year as number | null,
          page: raw.page,
          at: raw.at,
          game,
        };
      break;
    }
    case "scouting.whatIf": {
      const segment = raw.segment;
      const game = oneGame(raw.game);
      if (
        isString(raw.page) &&
        (segment === null || segment === "fall" || segment === "spring") &&
        isString(raw.forTeamId) &&
        game &&
        isDay(raw.today)
      )
        query = {
          kind: "scouting.whatIf",
          page: raw.page,
          segment,
          forTeamId: raw.forTeamId,
          game,
          today: raw.today,
        };
      break;
    }
    case "ages.plan": {
      const clubs = everyOne(raw.clubs, ageAsked);
      if (clubs && isTime(raw.at) && isString(raw.base))
        query = { kind: "ages.plan", clubs, at: raw.at, base: raw.base };
      break;
    }
  }
  return query && keptWhole(raw, query) ? query : null;
};

const foldOf = (raw: Record<string, unknown>): FoldCounts | null =>
  isCount(raw.games) && isCount(raw.dropped) && raw.dropped <= raw.games
    ? { games: raw.games, dropped: raw.dropped }
    : null;

/** A game a Pool health list names (`HealthGame`). */
const HEALTH_GAME: Shape = {
  record: {
    id: "id",
    date: { optional: "string" },
    teamAId: "id",
    teamBId: "id",
    teamAScore: { optional: "count" },
    teamBScore: { optional: "count" },
    year: { nullable: "count" },
    filers: { list: "id" },
  },
};

/** A what-if's curve (`WhatIfCurve`): a club's place and rating at each margin of the fixture. */
const WHAT_IF_CURVE: Shape = {
  record: {
    gameId: "id",
    forTeamId: "id",
    points: { list: { record: { margin: "number", rank: "count", rating: "number" } } },
    winRecord: "string",
    lossRecord: "string",
    rankedCount: "count",
  },
};

/** What Pool health shows as it opens, and the answers its lists leave out. */
const HEALTH_SUMMARY: Shape = {
  record: {
    summary: {
      record: {
        holdings: {
          list: {
            record: {
              year: { optional: "count" },
              pages: "count",
              teams: "count",
              games: "count",
              emptied: "boolean",
            },
          },
        },
        datedAhead: { list: HEALTH_GAME },
        implausible: { list: { record: { game: HEALTH_GAME, margin: "number" } } },
        suspected: {
          list: {
            record: {
              teamId: "id",
              name: "string",
              city: { optional: "string" },
              state: { optional: "string" },
              ahead: "count",
              implausible: "count",
              played: "count",
              gcTeamIds: { list: "id" },
              gameIds: { list: "id" },
            },
          },
        },
        clubs: { dictionary: { record: { name: "string", gcId: { optional: "id" } } } },
      },
    },
    answers: {
      record: { ageRight: { list: "id" }, realClubs: { list: "id" }, keptApart: { list: "id" } },
    },
  },
};

const GC_RECORD: Shape = { record: { win: "count", loss: "count", tie: "count" } };

/** What Pool health shows once asked to look harder: its numbers and its lists. */
const HEALTH_INSPECT: Shape = {
  record: {
    health: {
      record: {
        games: "count",
        played: "count",
        teams: "count",
        clubs: "count",
        nameOnly: "count",
        placeholders: "count",
        standInGames: "count",
        standInPlayed: "count",
        undated: "count",
        futureDated: "count",
        tidied: "boolean",
      },
    },
    settleable: "count",
    toPullCount: "count",
    lists: {
      record: {
        toPull: {
          list: {
            record: {
              teamId: "id",
              name: "string",
              games: "count",
              played: "count",
              states: { list: "string" },
              levels: { list: "count" },
              years: { list: "count" },
              namedBy: { list: "string" },
            },
          },
        },
        duplicates: {
          list: {
            record: {
              fromTeamId: "id",
              fromTeamName: "string",
              fromSeason: "string",
              toTeamId: "id",
              toTeamName: "string",
              toSeason: "string",
              fromGcId: "id",
              toGcId: "id",
              evidence: { list: { oneOf: Object.keys(GC_PAIRING_EVIDENCE_LABEL) } },
              sameName: "boolean",
              confidence: { oneOf: ["strong", "likely"] },
              kind: { oneOf: ["next-season", "same-season"] },
            },
          },
        },
        twins: {
          list: {
            record: {
              fromTeamId: "id",
              fromTeamName: "string",
              toTeamId: "id",
              toTeamName: "string",
              fromGcId: "id",
              toGcId: "id",
              fromRecord: { optional: GC_RECORD },
              toRecord: { optional: GC_RECORD },
              fromPlayers: { optional: "count" },
              toPlayers: { optional: "count" },
              shared: {
                list: {
                  record: {
                    date: "string",
                    startTs: "string",
                    opponentName: "string",
                    ownScore: "count",
                    opponentScore: "count",
                  },
                },
              },
            },
          },
        },
        twice: {
          list: {
            record: {
              teamId: "id",
              teamName: "string",
              date: "string",
              own: "count",
              opponent: "count",
              games: {
                list: {
                  record: {
                    gameId: "id",
                    opponentId: "id",
                    opponentName: "string",
                    startTs: "string",
                  },
                },
              },
              minutesApart: "number",
              wide: { optional: "boolean" },
            },
          },
        },
        wrongAge: {
          list: {
            record: {
              teamId: "id",
              name: "string",
              state: { optional: "string" },
              year: "count",
              gcTeamIds: { list: "id" },
              filed: "count",
              suggested: "count",
              reason: { oneOf: ["name", "opponents"] },
              opponentsAtSuggested: "count",
              opponentsKnown: "count",
              weeks: "count",
            },
          },
        },
      },
    },
  },
};

/**
 * An answer of a kind whose every field the shape names, as sent once it fits: the shape is the
 * type said as data, which is what makes reading it as the type sound.
 */
const ofShape = <K extends QueryKind>(raw: Record<string, unknown>, shape: Shape) =>
  fits(raw, shape) ? (raw as unknown as AnswerOf<K>) : null;

/** What may stand between a team found by search and the queue (`AgelessAside`), every one. */
const ASIDES: Record<AgelessAside, true> = {
  dropped: true,
  named: true,
  "high-school": true,
  "short-roster": true,
  "left-alone": true,
};

const AGELESS_GROUPS: Shape = {
  list: {
    record: {
      rule: { record: { id: "id", label: "string", because: "string" } },
      count: "count",
      examples: { list: "string" },
    },
  },
};

/** The card at a sitting, every entry read back exactly as storage keeps one (`oneAgeless`). */
const agelessQueueOf = (raw: Record<string, unknown>): AnswerOf<"ageless.queue"> | null => {
  const batch = everyOne(raw.batch, oneAgeless);
  if (!batch || !isCount(raw.listed) || !isCount(raw.waiting) || !fits(raw.groups, AGELESS_GROUPS))
    return null;
  return {
    kind: "ageless.queue",
    listed: raw.listed,
    waiting: raw.waiting,
    batch,
    groups: raw.groups as AgelessGroup[],
  };
};

const agelessHit = (raw: unknown): AgelessSearchAnswer["hits"][number] | null => {
  if (!isRecord(raw)) return null;
  const entry = oneAgeless(raw.entry);
  const aside = raw.aside;
  if (!entry) return null;
  if (aside === undefined) return { entry };
  return typeof aside === "string" && Object.prototype.hasOwnProperty.call(ASIDES, aside)
    ? { entry, aside: aside as AgelessAside }
    : null;
};

const agelessSearchOf = (raw: Record<string, unknown>): AnswerOf<"ageless.search"> | null => {
  const hits = everyOne(raw.hits, agelessHit);
  return hits && isCount(raw.total) && raw.total >= hits.length
    ? { kind: "ageless.search", total: raw.total, hits }
    : null;
};

const agelessClearPlanOf = (raw: Record<string, unknown>): AnswerOf<"ageless.clearPlan"> | null =>
  fits(raw, {
    record: {
      teamIds: { list: "id" },
      byRule: { list: { record: { label: "string", count: "count" } } },
    },
  })
    ? {
        kind: "ageless.clearPlan",
        teamIds: [...(raw.teamIds as string[])],
        byRule: (raw.byRule as { label: string; count: number }[]).map(({ label, count }) => ({
          label,
          count,
        })),
      }
    : null;

/**
 * The commands an approval sends back as an edit, read as any command is (`coerceCommand`): all of
 * them, or none.
 */
const agesPlanOf = (raw: Record<string, unknown>): AnswerOf<"ages.plan"> | null => {
  const commands = everyOne(raw.commands, (one) => coerceCommand(one));
  const changed = raw.changedTeamIds;
  if (!commands || !fits(changed, { list: "id" }) || !isCount(raw.moved) || !isCount(raw.failed))
    return null;
  return {
    kind: "ages.plan",
    commands,
    changedTeamIds: [...(changed as string[])],
    moved: raw.moved,
    failed: raw.failed,
  };
};

/**
 * An answer as a device reads one the server sent, for the question it asked: of that kind and that
 * shape, or null. Nothing in it is taken on trust.
 */
export const coerceQueryAnswer = <K extends QueryKind>(
  raw: unknown,
  kind: K
): AnswerOf<K> | null => {
  if (!isRecord(raw) || raw.kind !== kind) return null;
  let answer: QueryAnswer | null = null;
  switch (kind) {
    case "health.summary":
      return ofShape<K>(raw, HEALTH_SUMMARY);
    case "health.inspect":
      return ofShape<K>(raw, HEALTH_INSPECT);
    case "health.toPull":
    case "ageless.file":
      return ofShape<K>(raw, { record: { csv: "string" } });
    case "ageless.queue":
      return agelessQueueOf(raw) as AnswerOf<K> | null;
    case "ageless.search":
      return agelessSearchOf(raw) as AnswerOf<K> | null;
    case "ageless.clearPlan":
      return agelessClearPlanOf(raw) as AnswerOf<K> | null;
    case "ages.plan":
      return agesPlanOf(raw) as AnswerOf<K> | null;
    case "games.find":
      return ofShape<K>(raw, { record: { gameId: { nullable: "id" } } });
    case "scouting.whatIf":
      return ofShape<K>(raw, { record: { curve: { nullable: WHAT_IF_CURVE } } });
    case "merge.preview": {
      const fold = foldOf(raw);
      if (fold && typeof raw.found === "boolean")
        answer = { kind: "merge.preview", found: raw.found, ...fold };
      break;
    }
    case "rename.preview": {
      const fold = foldOf(raw);
      const into = raw.into;
      if (!fold || typeof raw.name !== "string") break;
      if (into === null) {
        answer = { kind: "rename.preview", name: raw.name, into: null, ...fold };
      } else if (isRecord(into) && isString(into.id) && typeof into.name === "string") {
        answer = {
          kind: "rename.preview",
          name: raw.name,
          into: { id: into.id, name: into.name },
          ...fold,
        };
      }
      break;
    }
  }
  return answer as AnswerOf<K> | null;
};
