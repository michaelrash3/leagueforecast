import { GC_PAIRING_EVIDENCE_LABEL } from "../gcPairingEvidence";
import type { AgelessAside } from "../agelessQueue";
import type { AgelessGroup } from "../agelessSitting";
import type { ModelCheckAnswer, ScoutBacktestResult } from "../scoutBacktest";
import { coerceNamedCheck } from "../teamRankings/namedGames";
import { coerceCommand, everyOne, oneAgeless } from "./commands";
import type { AgelessSearchAnswer, AnswerOf, FoldCounts, QueryAnswer, QueryKind } from "./queries";
import { clubOptionsOf, fillPlanOf, leagueBridgeAnswerOf } from "./leagueAnswers";
import { fits, type Shape } from "./shapes";

/*
 * The device's reader of the answers the edit function sends to its questions (`queries.ts`):
 * apart from the questions' answerer, which is the server's and holds the pool's heavier code
 * (Pool health's lists, the model check, the import's), so the live page downloads only what reads
 * an answer back. Nothing in an answer is taken on trust.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (value: unknown): value is string =>
  typeof value === "string" && value !== "";

export const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

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
    // Any number, as the pool keeps them: a score typed by hand may be in halves.
    teamAScore: { optional: "number" },
    teamBScore: { optional: "number" },
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

/** The copy's refresh as the Import tab reads it (`ImportStatus`). */
const IMPORT_STATUS: Shape = {
  record: {
    due: {
      record: {
        ageLevels: { list: "count" },
        heldBack: "count",
        label: "string",
        catchUp: "boolean",
        cadence: { oneOf: ["daily", "rotation"] },
        agelessTotal: "count",
        teams: "count",
        agelessDue: "count",
      },
    },
    refreshed: { list: { record: { level: "count", day: "string" } } },
    orgs: { record: { orgs: "count", teams: "count", aged: "count", waitingAged: "count" } },
    agelessIds: { list: "string" },
    rosterIds: { list: "string" },
  },
};

/** What archiving a year would keep and take (`yearArchivePreview`). */
const YEAR_ARCHIVE_PREVIEW: Shape = {
  record: {
    preview: {
      record: {
        tables: { list: { record: { name: "string", rows: "count" } } },
        droppedGames: "count",
        droppedTeams: "count",
        archivedLeagueGames: "count",
        unranked: { list: { record: { name: "string", games: "count" } } },
      },
    },
  },
};

/** What deleting a year would take (`yearDeletePreview`). */
const YEAR_DELETE_PREVIEW: Shape = {
  record: {
    preview: {
      record: {
        pages: { list: "string" },
        droppedGames: "count",
        droppedTeams: "count",
        unlinkedTeams: "count",
        tables: "count",
        leagueSeasons: "count",
      },
    },
  },
};

/** A count or a number with no end: JSON writes `Infinity` as null, which is read back as it. */
const UNBOUNDED: Shape = { nullable: "number" };
const unbounded = (value: number | null): number => (value === null ? Infinity : value);

/** One run of the model check (`ScoutBacktestResult`), without the errors kept to compare runs. */
const BACKTEST_RESULT: Shape = {
  record: {
    sampleSize: "count",
    meanAbsoluteError: { nullable: "number" },
    baselineError: { nullable: "number" },
    winnerAccuracy: { nullable: "number" },
    crossAgeSamples: "count",
    crossAgeError: { nullable: "number" },
    fittedAgeGapRuns: "number",
    ageGapPrior: "number",
    recencyKey: "string",
    cap: UNBOUNDED,
    buckets: {
      list: {
        record: {
          fromDays: "number",
          toDays: UNBOUNDED,
          label: "string",
          sampleSize: "count",
          meanAbsoluteError: { nullable: "number" },
          baselineError: { nullable: "number" },
          winnerAccuracy: { nullable: "number" },
        },
      },
    },
    span: {
      nullable: {
        record: { trainFrom: "string", trainTo: "string", testFrom: "string", testTo: "string" },
      },
    },
    trainSize: "count",
    unratedSides: "count",
    ratedError: { nullable: "number" },
    ratedSamples: "count",
    meanAbsolutePrediction: { nullable: "number" },
    trainComponents: "count",
    largestComponent: "count",
    splitSamples: "count",
    residuals: {
      list: {
        record: {
          gameId: "id",
          daysAfter: "number",
          predicted: "number",
          actual: "number",
          error: "number",
          baseline: "number",
          connected: "boolean",
        },
      },
    },
  },
};
const IMPROVEMENT: Shape = {
  nullable: {
    record: { value: UNBOUNDED, by: "number", standardError: "number", samples: "count" },
  },
};
const MODEL_CHECK: Shape = {
  record: {
    answer: {
      nullable: {
        record: {
          result: BACKTEST_RESULT,
          gaps: { list: BACKTEST_RESULT },
          caps: { list: BACKTEST_RESULT },
          betterGap: IMPROVEMENT,
          betterCap: IMPROVEMENT,
        },
      },
    },
  },
};

type Wire<T> = { [K in keyof T]: T[K] extends number ? number | null : T[K] };

/**
 * The model check as a device reads it: of its shape, and with every number that has no end (the
 * uncapped run's cap, the last bucket's end, a better cap that is no cap) its own again, where JSON
 * had written it as null.
 */
const modelCheckOf = (raw: Record<string, unknown>): AnswerOf<"model.check"> | null => {
  if (!fits(raw, MODEL_CHECK)) return null;
  const sent = (raw as { answer: Wire<ModelCheckAnswer> | null }).answer;
  if (!sent) return { kind: "model.check", answer: null };
  const run = (one: Wire<ScoutBacktestResult>): ScoutBacktestResult => ({
    ...(one as ScoutBacktestResult),
    cap: unbounded(one.cap),
    buckets: one.buckets.map((bucket) => ({
      ...bucket,
      toDays: unbounded(bucket.toDays as number | null),
    })),
  });
  const better = (one: ModelCheckAnswer["betterCap"]) =>
    one && { ...one, value: unbounded(one.value as number | null) };
  return {
    kind: "model.check",
    answer: {
      result: run(sent.result as Wire<ScoutBacktestResult>),
      gaps: sent.gaps.map((one) => run(one as Wire<ScoutBacktestResult>)),
      caps: sent.caps.map((one) => run(one as Wire<ScoutBacktestResult>)),
      betterGap: better(sent.betterGap),
      betterCap: better(sent.betterCap),
    },
  };
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

/** The server's checks of named games, each read back (`coerceNamedCheck`), or none. */
const namedChecksOf = (raw: Record<string, unknown>): AnswerOf<"games.check"> | null => {
  if (raw.checks === null) return { kind: "games.check", checks: null };
  const checks = everyOne(raw.checks, coerceNamedCheck);
  return checks ? { kind: "games.check", checks } : null;
};

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
    case "games.check":
      return namedChecksOf(raw) as AnswerOf<K> | null;
    case "league.bridge": {
      const read = leagueBridgeAnswerOf({ bridge: raw.bridge, candidates: raw.candidates });
      if (read) answer = { kind: "league.bridge", ...read };
      break;
    }
    case "league.clubs": {
      const clubs = clubOptionsOf(raw.clubs);
      if (clubs) answer = { kind: "league.clubs", clubs };
      break;
    }
    case "league.fill": {
      const plan = fillPlanOf(raw.plan);
      if (plan) answer = { kind: "league.fill", plan };
      break;
    }
    case "scouting.whatIf":
      return ofShape<K>(raw, { record: { curve: { nullable: WHAT_IF_CURVE } } });
    case "model.check":
      return modelCheckOf(raw) as AnswerOf<K> | null;
    case "import.status":
      return ofShape<K>(raw, IMPORT_STATUS);
    case "year.archivePreview":
      return ofShape<K>(raw, YEAR_ARCHIVE_PREVIEW);
    case "year.deletePreview":
      return ofShape<K>(raw, YEAR_DELETE_PREVIEW);
    case "year.list":
      return ofShape<K>(raw, {
        record: {
          years: {
            list: {
              record: {
                year: "count",
                pages: "count",
                games: "count",
                teams: "count",
                archives: "count",
              },
            },
          },
        },
      });
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
