import { GC_PAIRING_EVIDENCE_LABEL, type GcImportState } from "../gameChangerImport";
import { poolHealth, settleableNow, type PoolHealth } from "../poolHealth";
import { poolHealthSummary, type PoolHealthSummary } from "../poolHealthSummary";
import { poolLists, TO_PULL_DRAWN, type PoolLists } from "../poolLists";
import type { ScoutGame, ScoutTeam } from "../teamRankings/types";
import { cleanTeamName, teamNameKey } from "../teamRankings/names";
import { unpulledClubs, unpulledClubsCsv } from "../unpulledClubs";
import {
  loadAgeGroups,
  loadAgeRightClubs,
  loadKeptApart,
  loadRealClubs,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  storedGamesByYear,
} from "../teamRankingsStorage";
import { planClubAges, type AgeAsked } from "./agePlan";
import { coerceCommand, everyOne, oneTeam } from "./commands";
import { fits, type Shape } from "./shapes";

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
 */
export type PoolQuery =
  | { kind: "merge.preview"; fromId: string; intoId: string; adopt: ScoutTeam[] }
  | { kind: "rename.preview"; teamId: string; name: string }
  | { kind: "health.summary"; today: string }
  | { kind: "health.inspect"; today: string }
  | { kind: "health.toPull" }
  | { kind: "ages.plan"; clubs: AgeAsked[]; at: string; base: string };

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

export type QueryAnswers = {
  "merge.preview": MergePreview;
  "rename.preview": RenamePreview;
  "health.summary": HealthSummaryAnswer;
  "health.inspect": HealthInspectAnswer;
  "health.toPull": HealthToPullAnswer;
  "ages.plan": AgesPlan;
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

/** Answers `query` from the process's store, as the page would have answered it from its own. */
export const answerQuery = (query: PoolQuery): QueryAnswer => {
  switch (query.kind) {
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
      return ofShape<K>(raw, { record: { csv: "string" } });
    case "ages.plan":
      return agesPlanOf(raw) as AnswerOf<K> | null;
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
