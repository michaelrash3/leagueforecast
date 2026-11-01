import { hashValue } from "../../cloud/cloudPack";
import type { LeagueFillPlan } from "../../leagueScoreFill";
import type { LeagueScoutBridge } from "../../teamRankings";
import { BRIDGE_RULES_NOW, FILL_RULES, fillPlanOf, leagueBridgeOf } from "../leagueAnswers";
import { seasonDocId } from "../leagueDocs";
import type { QueryOf } from "../queries";
import { fits, type Shape } from "../shapes";

/**
 * League Standings' answers for one season, published beside the boards (`views/league.ts`) so a
 * member's device opening the season reads them in place of asking the 8 GiB edit function: the
 * bridge `league.bridge` answers and the plan `league.fill` answers, each worked out by the code
 * the question is answered with, from the season as its document holds it, and each with a
 * fingerprint of what it was worked out from. This half is what a device reads them with, apart
 * from the publish, so it loads none of the pool's code; it sits behind `leagueAsk.ts`'s import of
 * the reader, which only a member's device makes.
 *
 * A device takes an answer only where it is the very answer its own question would get: its
 * season's teams and schedule as the view's (the bridge's `shape`), its finals the same wherever
 * the bridge can turn on one (`finals`, `finalsTheBridgeReads`) so a final entered since elsewhere
 * is taken exactly and one the bridge would pair with a pool row is asked about, never counted
 * twice; Fill's every team, game and score the same (`print`); each worked out under this build's
 * rules (`BRIDGE_RULES_NOW`, `FILL_RULES`); and the day it would be asked on one the answer holds
 * for (`from` the meta's day, `until` the first day a scored game the answer reads is dated). The
 * pool's side is the view's entry in the meta, the copy and version of the
 * publish that last vouched for it, which every publish stamps afresh at no cost: in the view it
 * would make every season's a new upload on every save. Anything else is asked as before.
 */

/** The family's prefix in the meta: `league:{season}`, the season's document id after it. */
export const LEAGUE_FAMILY = "league:";

/**
 * The view's own version, raised with any change to its shape: a device reads none of another.
 * Its own rather than `LIVE_SCHEMA`'s or `BOARD_RULES`', which the boards' readers and the
 * republish after a deploy turn on: a raise of either would put every device on a notice, or have
 * the deploy read the whole copy, for a family an older device leaves unread anyway.
 */
export const LEAGUE_VIEW_VERSION = 1;

/** Where season `seasonId`'s answers are published, by its document's id. */
export const leagueViewKey = (seasonId: string): string =>
  `${LEAGUE_FAMILY}${seasonDocId(seasonId)}`;

/** A fixture's final as the bridge was worked out with it, by its place in the schedule. */
export type LeagueViewFinal = { at: number; away?: number; home?: number };

export type LeagueView = {
  version: number;
  season: string;
  bridge: {
    /** The rules it was worked out under (`BRIDGE_RULES_NOW`), as a kept bridge's stamp says. */
    rules: string;
    /** SHA-256 of the question's season and teams and its schedule without the runs. */
    shape: string;
    /** The finals at the places the bridge can turn on, none or more. */
    finals: LeagueViewFinal[];
    /** The first New York day it may not hold on, where a scored game it reads is dated ahead. */
    until?: string;
    answer: LeagueScoutBridge;
  };
  fill: {
    /** The rules it was planned under (`FILL_RULES`), as the bridge carries its own. */
    rules: number;
    /** SHA-256 of the question's season, teams, games and their runs (`fillPrintOf`). */
    print: string;
    /** As the bridge's, over the games the plan reads. */
    until?: string;
    plan: LeagueFillPlan;
  };
};

const FINAL: Shape = {
  record: { at: "count", away: { optional: "number" }, home: { optional: "number" } },
};

const HASH = /^[0-9a-f]{64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const VIEW: Shape = {
  record: {
    version: "count",
    season: "id",
    bridge: {
      record: {
        rules: "string",
        shape: "string",
        finals: { list: FINAL },
        until: { optional: "string" },
      },
    },
    fill: { record: { rules: "count", print: "string", until: { optional: "string" } } },
  },
};

/**
 * A published view read back whole, of this build's version, or null: its answers through the very
 * checks a question's are read with (`leagueBridgeOf`, `fillPlanOf`), so nothing reaches a forecast
 * or a Fill panel that an answer from the network would not.
 */
export const coerceLeagueView = (raw: unknown): LeagueView | null => {
  if (!fits(raw, VIEW)) return null;
  const view = raw as LeagueView;
  if (view.version !== LEAGUE_VIEW_VERSION) return null;
  if (!HASH.test(view.bridge.shape) || !HASH.test(view.fill.print)) return null;
  for (const until of [view.bridge.until, view.fill.until]) {
    if (until !== undefined && !ISO_DAY.test(until)) return null;
  }
  const answer = leagueBridgeOf(view.bridge.answer);
  const plan = fillPlanOf(view.fill.plan);
  return answer && plan ? view : null;
};

/** The bridge question's season, teams and schedule, its finals left out. */
export const bridgeShapeOf = (question: QueryOf<"league.bridge">) => ({
  season: question.season,
  teams: question.teams,
  fixtures: question.fixtures.map(({ away, home, date }) => [away, home, date]),
});

/**
 * Fill's question as the plan reads it: the season, its teams, its games in order, and the runs
 * of those games alone, in their order, since the plan reads a game's runs by its id and no others
 * (`planLeagueScoreFill`). A score a device keeps for a game no longer on the schedule asks nothing.
 */
export const fillPrintOf = (question: QueryOf<"league.fill">) => {
  const runs = new Map(question.runs.map((run) => [run.id, run]));
  return {
    season: question.season,
    teams: question.teams,
    games: question.matchups.map(({ id, date, away, home }) => [id, date, away, home]),
    runs: question.matchups.flatMap(({ id }) => {
      const run = runs.get(id);
      return run ? [[id, run.awayRuns, run.homeRuns, run.isFinal === true]] : [];
    }),
  };
};

/** The day in New York, the zone the edit function works its answers out in. */
const NEW_YORK_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const newYorkDay = (ms: number): string => NEW_YORK_DAY.format(ms);

/** A view as a device read it: the view, and the meta's day and copy it was read under. */
export type PublishedLeague = {
  view: LeagueView;
  /** The members' day of the meta the view was read under, which no view in it was built after. */
  today: string;
  /** The copy and version the view's entry was last vouched for at: the pool's side. */
  at: { copy: string; version: number };
  /** When the publish that last changed the meta ran, as the page says the answers' time. */
  builtAt: string;
};

/** Whether `day` is one an answer worked out on or before `from` holds on, up to `until`. */
const holdsOn = (day: string, from: string, until: string | undefined): boolean =>
  ISO_DAY.test(day) && day >= from && (until === undefined || day < until);

/**
 * The published bridge where it is the very answer `question` would get asked at `now`, or null:
 * the server works the bridge out on New York's day, so that is the day it must hold on.
 */
export const bridgeFromView = async (
  published: PublishedLeague,
  question: QueryOf<"league.bridge">,
  now: number
): Promise<LeagueScoutBridge | null> => {
  const { view } = published;
  const part = view.bridge;
  if (view.season !== question.season || part.rules !== BRIDGE_RULES_NOW) return null;
  if (!holdsOn(newYorkDay(now), published.today, part.until)) return null;
  for (const { at, away, home } of part.finals) {
    const fixture = question.fixtures[at];
    if (!fixture || fixture.awayRuns !== away || fixture.homeRuns !== home) return null;
  }
  return (await hashValue(bridgeShapeOf(question))) === part.shape ? part.answer : null;
};

/** The published Fill plan where it is the very answer `question` would get, or null. */
export const fillFromView = async (
  published: PublishedLeague,
  question: QueryOf<"league.fill">
): Promise<LeagueFillPlan | null> => {
  const { view } = published;
  if (view.season !== question.season || view.fill.rules !== FILL_RULES) return null;
  if (!holdsOn(question.today, published.today, view.fill.until)) return null;
  return (await hashValue(fillPrintOf(question))) === view.fill.print ? view.fill.plan : null;
};
