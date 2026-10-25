import type { LeagueFillPlan } from "../leagueScoreFill";
import type { ClubPickOption } from "../leagueLinkOptions";
import type { StartAnswer } from "../leagueStart";
import type { LeagueScoutBridge, ScoutLinkCandidate } from "../teamRankings";
import { fits, type Shape } from "./shapes";
import { BOARD_RULES } from "./views/boardShape";

/**
 * Which rules a bridge was worked out under, as a device keeps it with the copy it came from
 * (`useScoutBridge`): a kept bridge stands for a question only under the rules it was worked out by.
 * Raised whenever `leagueScoutBridge`, `scoutLinkCandidates` or `leagueCandidates` would answer a
 * question differently; read beside the boards' own (`BOARD_RULES`), since which games count, and so
 * the bridge's results, are theirs too.
 *
 * 1: the bridge kept with its copy, version and day (#446's successor).
 */
export const BRIDGE_RULES = 1;

/** The bridge's rules and the boards' together, as a kept bridge's stamp names them. */
export const BRIDGE_RULES_NOW = `${BRIDGE_RULES}.${BOARD_RULES}`;

/*
 * What League Standings asks the server of Team Rankings, for a member whose device holds no pool
 * (1.6e): the season's bridge, the clubs a team could be picked as, and the scores the pool could
 * fill in (`league.bridge`, `league.clubs`, `league.fill`, answered in `queries.ts`). Their shapes
 * live here, apart from the questions' answerer and the live page's reader of answers, so League
 * Standings, which every visit loads, reads an answer, or one it kept, without either.
 */

/**
 * The clubs each league team could be, by the team's name, best evidence first: the best few the
 * picker draws, and the team's picked club (`leagueCandidates`), held in memory and never kept.
 */
export type LeagueCandidates = { name: string; clubs: ScoutLinkCandidate[] }[];

export type LeagueBridgeAnswer = { bridge: LeagueScoutBridge; candidates: LeagueCandidates };

const RESULT: Shape = {
  record: {
    home: "string",
    away: "string",
    homeMargin: "number",
    date: { optional: "string" },
    neutral: "boolean",
  },
};

const LINK_ROW: Shape = {
  record: {
    leagueTeamId: "id",
    leagueTeamName: "string",
    how: { oneOf: ["picked", "guessed", "off", "none"] },
    scoutTeamId: { optional: "id" },
    suggestedName: { optional: "string" },
    staleScoutTeamId: { optional: "id" },
    conflictWith: { optional: { list: "id" } },
    ambiguousCount: { optional: "count" },
    sharedOpponents: { optional: "count" },
  },
};

const BRIDGE: Shape = {
  record: {
    results: { list: RESULT },
    seasonLinked: "boolean",
    rows: { list: LINK_ROW },
    linkedCount: "count",
    countedResults: "count",
    squadYear: { optional: "count" },
  },
};

const CANDIDATE: Shape = {
  record: {
    scoutTeamId: "id",
    name: "string",
    city: { optional: "string" },
    state: { optional: "string" },
    sharedOpponents: { list: "string" },
    games: "count",
    ageLevel: { optional: "count" },
    coaches: { optional: { list: "string" } },
    gcIds: { optional: { list: "string" } },
  },
};

const BRIDGE_ANSWER: Shape = {
  record: {
    bridge: BRIDGE,
    candidates: { list: { record: { name: "string", clubs: { list: CANDIDATE } } } },
  },
};

const CLUB_OPTION: Shape = {
  record: {
    id: "id",
    label: "string",
    detail: { optional: "string" },
    coaches: { optional: { list: "string" } },
    gcIds: { optional: { list: "string" } },
  },
};

const RUNS: Shape = { record: { awayRuns: "number", homeRuns: "number", reportedBy: "string" } };

const FILL_ROW: Shape = {
  record: {
    matchupId: "id",
    date: "string",
    awayTeamId: "id",
    awayName: "string",
    homeTeamId: "id",
    homeName: "string",
    awayRuns: "number",
    homeRuns: "number",
    reportedBy: { optional: "string" },
    alternative: { optional: RUNS },
    action: {
      oneOf: ["fill", "suggested", "slot", "disputed", "overwrite", "unchanged", "ambiguous"],
    },
    detail: { optional: "string" },
    poolAwayName: { optional: "string" },
    poolHomeName: { optional: "string" },
    scoutGameId: { optional: "id" },
    gcTeamId: { optional: "string" },
    gcGameId: { optional: "string" },
    currentAwayRuns: { optional: "string" },
    currentHomeRuns: { optional: "string" },
    event: { optional: "string" },
  },
};

const FILL_MISSING: Shape = {
  record: {
    scoutGameId: "id",
    date: "string",
    awayTeamId: "id",
    homeTeamId: "id",
    awayName: "string",
    homeName: "string",
    awayRuns: "number",
    homeRuns: "number",
    tournament: { optional: "string" },
  },
};

const FILL_PLAN: Shape = {
  record: {
    rows: { list: FILL_ROW },
    missing: { optional: { list: FILL_MISSING } },
    unmatched: "count",
    unusedResults: "count",
    seasonLinked: "boolean",
  },
};

/**
 * A season's bridge as this device kept it, read back whole, or null. Every result is a neutral
 * one, which is all the forecast is ever given.
 */
export const leagueBridgeOf = (raw: unknown): LeagueScoutBridge | null => {
  if (!fits(raw, BRIDGE)) return null;
  const bridge = raw as LeagueScoutBridge;
  return bridge.results.every((result) => result.neutral === true) ? bridge : null;
};

/** The bridge and the candidates as the server sends them, read back whole, or null. */
export const leagueBridgeAnswerOf = (raw: unknown): LeagueBridgeAnswer | null =>
  fits(raw, BRIDGE_ANSWER) && leagueBridgeOf((raw as LeagueBridgeAnswer).bridge)
    ? (raw as LeagueBridgeAnswer)
    : null;

/** The wide picker's clubs, read back whole, or null. */
export const clubOptionsOf = (raw: unknown): ClubPickOption[] | null =>
  fits(raw, { list: CLUB_OPTION }) ? (raw as ClubPickOption[]) : null;

/** A plan of the scores the pool could fill in, read back whole, or null. */
export const fillPlanOf = (raw: unknown): LeagueFillPlan | null =>
  fits(raw, FILL_PLAN) ? (raw as LeagueFillPlan) : null;

const START_RUNS: Shape = { record: { awayRuns: "count", homeRuns: "count" } };

/** A start's answer (`answerStart`): the pages, a page's clubs, and the draft of games. */
const START_ANSWER: Shape = {
  record: {
    pages: {
      list: { record: { id: "id", name: "string", ageLevel: "count", year: "count" } },
    },
    clubs: { nullable: { list: CLUB_OPTION } },
    draft: {
      nullable: {
        record: {
          games: {
            list: {
              record: {
                gameId: "id",
                date: "string",
                away: "id",
                home: "id",
                awayRuns: { optional: "count" },
                homeRuns: { optional: "count" },
                tournament: { optional: "string" },
                otherRuns: { optional: START_RUNS },
              },
            },
          },
          outside: "count",
        },
      },
    },
  },
};

/** A start's answer read back whole, or null. */
export const startAnswerOf = (raw: unknown): StartAnswer | null =>
  fits(raw, START_ANSWER) ? (raw as StartAnswer) : null;
