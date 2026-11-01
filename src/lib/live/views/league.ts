import { hashValue } from "../../cloud/cloudPack";
import { isDatedAhead } from "../../deletedGames";
import { finalScoresKey, leagueFixturesOf, type ScoutGame } from "../../teamRankings";
import { finalsTheBridgeReads } from "../../teamRankings/leagueBridge";
import { ageGroupYear } from "../../teamRankings/seasons";
import { loadAgeGroups, loadScoutGamesForSeason, loadScoutTeams } from "../../teamRankingsStorage";
import type { SeasonReader } from "../allKnown";
import { BRIDGE_RULES_NOW, bridgeQuestionOf, FILL_RULES, fillQuestionOf } from "../leagueAnswers";
import { leagueBridgeFor, leagueFillFor } from "../queries";
import type { PublishedView } from "../viewStore";
import {
  bridgeShapeOf,
  fillPrintOf,
  LEAGUE_VIEW_VERSION,
  leagueViewKey,
  type LeagueView,
} from "./leagueShape";

/**
 * Each League Standings season's answers, published beside the boards by the publish that builds
 * them (`publishCopyViews`): the bridge `league.bridge` gives the season and the plan `league.fill`
 * gives it, worked out by the very functions the edit function answers those questions with
 * (`leagueBridgeFor`, `leagueFillFor`), from the questions a device holding the season as its
 * document holds it asks (`bridgeQuestionOf`, `fillQuestionOf`), on the members' day the boards are
 * built for. Every publish already reads every season and holds the pool, so this costs no read;
 * a view the same as the one published costs no write (`publishViews`), so a season's answers go
 * up again only when they change; and a device whose season is as the view's asks nothing on
 * opening (`views/leagueShape.ts`). The clubs each team could be stay a question, asked as the link
 * panel opens, as do edits, previews, what-ifs and a league start.
 */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The first day after `today` that a scored game of `games` is dated (`isDatedAhead`), or none:
 * until then every game counts or waits on the same day it did, so an answer worked out on `today`
 * is the one asked on any day before it. The answers read no other day (`countsTowardRating`,
 * `planLeagueScoreFill`), and these are all the games either reads, and more.
 */
const firstDayAhead = (games: Iterable<ScoutGame>, today: string): string | undefined => {
  let first: string | undefined;
  for (const game of games) {
    if (!isDatedAhead(game, today) || game.date === undefined) continue;
    if (first === undefined || game.date < first) first = game.date;
  }
  return first;
};

/** A value as JSON writes it, as every device reads one: no field left undefined. */
const asWritten = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Every season `seasonIds` names, from `readSeason` (the seasons' documents, `cloudLeague.ts`), with
 * the pool in the process's store, for the members' day `today`. None for a day that is not one,
 * which the answers could not be held to.
 */
export const leagueViews = async ({
  seasonIds,
  readSeason,
  today,
}: {
  seasonIds: readonly string[];
  readSeason: SeasonReader;
  today: string;
}): Promise<PublishedView[]> => {
  if (!ISO_DAY.test(today)) return [];
  const ageGroups = loadAgeGroups();
  const teams = loadScoutTeams();
  const views: PublishedView[] = [];
  for (const season of seasonIds) {
    const held = readSeason(season);
    const fixtures = leagueFixturesOf(
      held.teams,
      held.matchups,
      finalScoresKey(held.matchups, held.logs)
    );
    const bridgeAsked = bridgeQuestionOf(season, held.teams, fixtures);
    const fillAsked = fillQuestionOf(season, held.teams, held.matchups, held.logs, today);
    const games = loadScoutGamesForSeason(season);
    // The pages the season is on, which the bridge reads, and those of their squad years, which
    // Fill reads too, for a club a team was picked as that GameChanger lists at another age.
    const linked = new Set(
      ageGroups.filter((group) => group.seasonIds.includes(season)).map((group) => group.id)
    );
    const years = new Set(
      ageGroups.filter((group) => linked.has(group.id)).map((group) => ageGroupYear(group))
    );
    const ofYears = new Set(
      ageGroups
        .filter((group) => {
          const year = ageGroupYear(group);
          return linked.has(group.id) || (year !== undefined && years.has(year));
        })
        .map((group) => group.id)
    );
    const bridgeUntil = firstDayAhead(
      games.filter((game) => linked.has(game.ageGroupId)),
      today
    );
    const fillUntil = firstDayAhead(
      games.filter((game) => ofYears.has(game.ageGroupId)),
      today
    );
    const finals = finalsTheBridgeReads(
      season,
      ageGroups,
      teams,
      games,
      bridgeAsked.teams,
      fixtures
    ).map((at) => {
      const { awayRuns, homeRuns } = fixtures[at] ?? {};
      return {
        at,
        ...(awayRuns === undefined ? {} : { away: awayRuns }),
        ...(homeRuns === undefined ? {} : { home: homeRuns }),
      };
    });
    const value: LeagueView = {
      version: LEAGUE_VIEW_VERSION,
      season,
      bridge: {
        rules: BRIDGE_RULES_NOW,
        shape: await hashValue(bridgeShapeOf(bridgeAsked)),
        finals,
        ...(bridgeUntil === undefined ? {} : { until: bridgeUntil }),
        answer: leagueBridgeFor(bridgeAsked, today),
      },
      fill: {
        rules: FILL_RULES,
        print: await hashValue(fillPrintOf(fillAsked)),
        ...(fillUntil === undefined ? {} : { until: fillUntil }),
        plan: leagueFillFor(fillAsked),
      },
    };
    views.push({ key: leagueViewKey(season), value: asWritten(value) });
  }
  return views;
};
