import { normalizeDateInput } from "./date";
import {
  findSimilarTeam,
  isScoutGamePlayed,
  LEAGUE_GAME_PREFIX,
  teamNameKey,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import type { GameLog, Matchup, TeamBase } from "./types";
import { blankLog, isFinal } from "./util";

/**
 * Filling a League Standings schedule from results already in the Team Rankings pool — in
 * practice, from a GameChanger pull.
 *
 * League Standings has always fed Team Rankings: a season assigned to an age group brings its
 * whole schedule across. This is the return trip for scores, and it exists because the two halves
 * now describe the same games from opposite ends. A club that pulls its own GameChanger team has
 * every result of its league season sitting in the pool, and typing those same scores a second
 * time into the league schedule is work the app can do.
 *
 * Two teams and a day is what makes a league game and a pool result the same game. The day is the
 * part that matters: the same two clubs meeting on another date played each other outside league
 * play, and that game belongs to the pool alone.
 *
 * What this will not do is guess silently. Every row is shown before anything is written, a score
 * that disagrees with one already entered is never quietly replaced, and a game the evidence
 * cannot single out is reported rather than resolved — because the cost of a wrong score here is a
 * wrong standings table, and the person reading it has no way to tell.
 */

/** What filling one league game from the pool would do. */
export type LeagueFillAction =
  /** Nothing recorded here yet, and the two sides are named the same; the result goes in. */
  | "fill"
  /**
   * The same, except a club is spelled differently on the two sides — "Trash Pandas" here,
   * "Trash Pandas Baseball Club" on GameChanger. Offered, never applied unasked, because the
   * difference between a longer name and a different team is a judgement only the reader can make.
   */
  | "suggested"
  /** A different score is already recorded. Never applied unless it is asked for by name. */
  | "overwrite"
  /** The same score is already recorded, so there is nothing to do. */
  | "unchanged"
  /** More than one result could be this game, and nothing distinguishes them. */
  | "ambiguous";

export type LeagueFillRow = {
  matchupId: string;
  /** The league's own date for the game, as it stores it. */
  date: string;
  awayTeamId: string;
  awayName: string;
  homeTeamId: string;
  homeName: string;
  /** The pool's runs, already turned around to the league's away/home order. */
  awayRuns: number;
  homeRuns: number;
  action: LeagueFillAction;
  /** Why, whenever the action is not a plain fill. */
  detail?: string;
  /** What the pool calls each side, given only when it differs from the league's own name. */
  poolAwayName?: string;
  poolHomeName?: string;
  /** The pool game the runs came from. Absent when nothing could be singled out. */
  scoutGameId?: string;
  /** GameChanger's own ids, when the result came from a pull rather than something typed. */
  gcTeamId?: string;
  gcGameId?: string;
  /** What the league already has, so a disagreement can be shown rather than asserted. */
  currentAwayRuns?: string;
  currentHomeRuns?: string;
  event?: string;
};

export type LeagueFillPlan = {
  rows: LeagueFillRow[];
  /** League games with nothing in the pool to fill them — the normal case mid-season. */
  unmatched: number;
  /** Results in the pool that no league game claimed. */
  unusedResults: number;
  /**
   * Whether any age group claims this season. Nothing can match when none does, and that is a
   * setup problem rather than an empty result, so the panel says which it is.
   */
  seasonLinked: boolean;
};

/** The two teams of a game, in an order that is the same whichever end you look from. */
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/**
 * The key a league game and a pool result have to agree on to be the same game: both teams and the
 * day. The league stores a date as month and day with no year, so that is the common ground —
 * `normalizeDateInput` reduces an ISO date to the same shape. Two seasons of one age group can
 * therefore collide on a date, which is exactly what the doubleheader handling below is for.
 */
const matchKey = (teamKeyA: string, teamKeyB: string, date: string) =>
  `${pairKey(teamKeyA, teamKeyB)}@${date}`;

const runsText = (log: GameLog | undefined, side: "away" | "home") =>
  (side === "away" ? log?.awayRuns : log?.homeRuns) ?? "";

/** A league game already carries a result when both run boxes hold a number. */
const hasRecordedRuns = (log: GameLog | undefined) =>
  runsText(log, "away").trim() !== "" && runsText(log, "home").trim() !== "";

/**
 * Whether a league team and a pool team are the same club.
 *
 * "exact" is the same name once age labels and case are set aside, which is what the pool already
 * does to every name it stores. "similar" is the case this whole second pass exists for: a league
 * typed as "Trash Pandas" against a GameChanger team called "Trash Pandas Baseball Club". That is
 * `findSimilarTeam`'s judgement, reused rather than re-derived so both halves of the app agree
 * about what counts as close — and it is deliberately stricter than it looks, stopping short of
 * "South Lexington Red" against "…Blue".
 */
const clubMatch = (leagueName: string, poolTeam: ScoutTeam): "exact" | "similar" | null => {
  if (teamNameKey(leagueName) === teamNameKey(poolTeam.name)) return "exact";
  return findSimilarTeam(leagueName, [poolTeam]) ? "similar" : null;
};

export type LeagueScoreFillInput = {
  seasonId: string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  ageGroups: AgeGroup[];
  scoutTeams: ScoutTeam[];
  scoutGames: ScoutGame[];
};

/** The two sides of a pool result, lined up with a league game's away and home teams. */
type Alignment = {
  awayRuns: number;
  homeRuns: number;
  /** "similar" when either side needed the looser name rule to line up. */
  strength: "exact" | "similar";
  poolAwayName: string;
  poolHomeName: string;
};

/**
 * Works out what could be filled in, and says so for every league game it can speak to. Pure: it
 * reads both halves and writes nothing, so the panel can show the whole plan before a decision.
 */
export const planLeagueScoreFill = ({
  seasonId,
  teams,
  matchups,
  logs,
  ageGroups,
  scoutTeams,
  scoutGames,
}: LeagueScoreFillInput): LeagueFillPlan => {
  // The link already exists: an age group names the League Standings seasons that belong to it.
  // Reusing it means the two halves cannot disagree about which games are the same season's.
  const linkedGroups = new Set(
    ageGroups.filter((group) => group.seasonIds.includes(seasonId)).map((group) => group.id)
  );
  const seasonLinked = linkedGroups.size > 0;

  const leagueNameById = new Map(teams.map((team) => [team.id, team.name]));
  const scoutTeamById = new Map(scoutTeams.map((team) => [team.id, team]));

  /**
   * Results that could fill a league game: played, filed under an age group that claims this
   * season, and not derived from this very schedule in the first place. That last exclusion is the
   * important one — the pool carries the league's own games, and letting those flow back would be
   * the app confirming its own scores.
   */
  const usable: ScoutGame[] = [];
  const poolByKey = new Map<string, ScoutGame[]>();
  const poolByDate = new Map<string, ScoutGame[]>();
  scoutGames.forEach((game) => {
    if (!linkedGroups.has(game.ageGroupId)) return;
    if (game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    if (!isScoutGamePlayed(game)) return;
    const date = normalizeDateInput(game.date ?? "");
    if (!date) return;
    const teamA = scoutTeamById.get(game.teamAId);
    const teamB = scoutTeamById.get(game.teamBId);
    if (!teamA || !teamB || teamA.id === teamB.id) return;

    usable.push(game);
    const key = matchKey(teamNameKey(teamA.name), teamNameKey(teamB.name), date);
    const keyed = poolByKey.get(key);
    if (keyed) keyed.push(game);
    else poolByKey.set(key, [game]);
    // The same results indexed by day alone, for the second pass over the names that did not
    // line up exactly.
    const dated = poolByDate.get(date);
    if (dated) dated.push(game);
    else poolByDate.set(date, [game]);
  });
  // Stable order, so a doubleheader is zipped the same way every time this runs.
  const byId = (a: ScoutGame, b: ScoutGame) => a.id.localeCompare(b.id);
  poolByKey.forEach((bucket) => bucket.sort(byId));
  poolByDate.forEach((bucket) => bucket.sort(byId));

  /** League games grouped the same way, so both sides of a doubleheader can be counted. */
  const leagueByKey = new Map<string, Matchup[]>();
  const leagueDates = new Map<string, string>();
  matchups.forEach((matchup) => {
    const date = normalizeDateInput(matchup.date ?? "");
    if (!date) return;
    const awayName = leagueNameById.get(matchup.away);
    const homeName = leagueNameById.get(matchup.home);
    if (!awayName || !homeName) return;
    const key = matchKey(teamNameKey(awayName), teamNameKey(homeName), date);
    leagueDates.set(matchup.id, date);
    const bucket = leagueByKey.get(key);
    if (bucket) bucket.push(matchup);
    else leagueByKey.set(key, [matchup]);
  });

  const rows: LeagueFillRow[] = [];
  const claimed = new Set<string>();
  /** League games the exact pass could not speak to; the name pass gets a turn at these. */
  const leftovers: Matchup[] = [];
  /** And the ones neither pass could reach — nothing in the pool is this game. */
  const unmatchedLeagueGames: Matchup[] = [];

  /** Lines a pool result up with a league game, or says it is not that game. */
  const align = (game: ScoutGame, awayName: string, homeName: string): Alignment | null => {
    const teamA = scoutTeamById.get(game.teamAId);
    const teamB = scoutTeamById.get(game.teamBId);
    if (!teamA || !teamB) return null;

    // The pool stores the pulled team first, not the home team, so both orders are tried and the
    // sides are decided by who each team is rather than by where it sits.
    const asListed = { away: clubMatch(awayName, teamA), home: clubMatch(homeName, teamB) };
    const reversed = { away: clubMatch(awayName, teamB), home: clubMatch(homeName, teamA) };
    const awayIsA = Boolean(asListed.away && asListed.home);
    const fit = awayIsA ? asListed : reversed;
    if (!fit.away || !fit.home) return null;

    return {
      awayRuns: (awayIsA ? game.teamAScore : game.teamBScore)!,
      homeRuns: (awayIsA ? game.teamBScore : game.teamAScore)!,
      strength: fit.away === "exact" && fit.home === "exact" ? "exact" : "similar",
      poolAwayName: (awayIsA ? teamA : teamB).name,
      poolHomeName: (awayIsA ? teamB : teamA).name,
    };
  };

  /** Turns one aligned result into the row the panel shows. */
  const rowFor = (matchup: Matchup, game: ScoutGame, fit: Alignment): LeagueFillRow => {
    const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
    const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
    const log = logs[matchup.id];
    const currentAway = runsText(log, "away");
    const currentHome = runsText(log, "home");
    const recorded = hasRecordedRuns(log);
    const same =
      recorded && Number(currentAway) === fit.awayRuns && Number(currentHome) === fit.homeRuns;

    // A looser name match only ever holds back a fill. A game already scored still reads as a
    // disagreement or as nothing to do, because that judgement is about the runs, not the names.
    const action: LeagueFillAction = same
      ? "unchanged"
      : recorded
        ? "overwrite"
        : fit.strength === "exact"
          ? "fill"
          : "suggested";

    const differing: string[] = [];
    if (teamNameKey(fit.poolAwayName) !== teamNameKey(awayName)) {
      differing.push(`${awayName} is “${fit.poolAwayName}” in the pool`);
    }
    if (teamNameKey(fit.poolHomeName) !== teamNameKey(homeName)) {
      differing.push(`${homeName} is “${fit.poolHomeName}” in the pool`);
    }

    const detail =
      action === "overwrite"
        ? `Already recorded as ${currentAway}–${currentHome}${isFinal(log) ? " and marked final" : ""}.`
        : action === "unchanged" && !isFinal(log)
          ? "Same score, not yet marked final."
          : differing.length > 0
            ? `${differing.join("; ")}. Check this is the same club before filling it.`
            : undefined;

    return {
      matchupId: matchup.id,
      date: matchup.date,
      awayTeamId: matchup.away,
      awayName,
      homeTeamId: matchup.home,
      homeName,
      awayRuns: fit.awayRuns,
      homeRuns: fit.homeRuns,
      action,
      ...(detail ? { detail } : {}),
      ...(teamNameKey(fit.poolAwayName) === teamNameKey(awayName)
        ? {}
        : { poolAwayName: fit.poolAwayName }),
      ...(teamNameKey(fit.poolHomeName) === teamNameKey(homeName)
        ? {}
        : { poolHomeName: fit.poolHomeName }),
      scoutGameId: game.id,
      ...(game.source ? { gcTeamId: game.source.teamId, gcGameId: game.source.gameId } : {}),
      ...(recorded ? { currentAwayRuns: currentAway, currentHomeRuns: currentHome } : {}),
      ...(game.event ? { event: game.event } : {}),
    };
  };

  // ---------- First pass: the names agree ----------

  leagueByKey.forEach((leagueGames, key) => {
    const results = poolByKey.get(key) ?? [];
    if (results.length === 0) {
      leftovers.push(...leagueGames);
      return;
    }

    /**
     * A pair can meet twice on one day, and youth baseball schedules doubleheaders constantly.
     * When both sides count the same, the games are paired in order — the only ordering either
     * side offers. When they do not, nothing here can say which result belongs to which game, and
     * a fifty-fifty guess about a score is not worth making.
     */
    if (results.length !== leagueGames.length) {
      leagueGames.forEach((matchup) => {
        rows.push({
          matchupId: matchup.id,
          date: matchup.date,
          awayTeamId: matchup.away,
          awayName: leagueNameById.get(matchup.away) ?? matchup.away,
          homeTeamId: matchup.home,
          homeName: leagueNameById.get(matchup.home) ?? matchup.home,
          awayRuns: 0,
          homeRuns: 0,
          action: "ambiguous",
          detail:
            results.length > leagueGames.length
              ? `${results.length} results for this pairing on this date, but ${leagueGames.length} game${leagueGames.length === 1 ? "" : "s"} on the schedule.`
              : `${leagueGames.length} games for this pairing on this date, but only ${results.length} result${results.length === 1 ? "" : "s"}.`,
        });
      });
      return;
    }

    leagueGames.forEach((matchup, index) => {
      const result = results[index]!;
      const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
      const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
      const fit = align(result, awayName, homeName);
      if (!fit) {
        leftovers.push(matchup);
        return;
      }
      claimed.add(result.id);
      rows.push(rowFor(matchup, result, fit));
    });
  });

  // ---------- Second pass: the same club, spelled differently ----------

  /**
   * The league and GameChanger rarely agree on how long a club's name is, and a league game left
   * unmatched is indistinguishable from one that simply has not been played — which is what makes
   * the silence dangerous. So every leftover gets a second look against the results on its own
   * day, under the looser name rule, and anything that lines up is offered rather than applied.
   */
  leftovers.forEach((matchup) => {
    const date = leagueDates.get(matchup.id);
    const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
    const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
    const sameDay = (date ? (poolByDate.get(date) ?? []) : []).filter(
      (game) => !claimed.has(game.id)
    );

    const candidates = sameDay
      .map((game) => ({ game, fit: align(game, awayName, homeName) }))
      .filter((candidate): candidate is { game: ScoutGame; fit: Alignment } =>
        Boolean(candidate.fit)
      );

    if (candidates.length === 0) {
      unmatchedLeagueGames.push(matchup);
      return;
    }
    if (candidates.length > 1) {
      // Two clubs close enough to this game's names played on this day. Naming which is which is
      // the reader's call, and there is nothing here to make it with.
      rows.push({
        matchupId: matchup.id,
        date: matchup.date,
        awayTeamId: matchup.away,
        awayName,
        homeTeamId: matchup.home,
        homeName,
        awayRuns: 0,
        homeRuns: 0,
        action: "ambiguous",
        detail: `${candidates.length} results on this date could be this game, under names close to these.`,
      });
      return;
    }

    const only = candidates[0]!;
    claimed.add(only.game.id);
    rows.push(rowFor(matchup, only.game, only.fit));
  });

  // Schedule order, so the review reads the way the season does.
  const orderOf = new Map(matchups.map((matchup, index) => [matchup.id, index]));
  rows.sort((a, b) => (orderOf.get(a.matchupId) ?? 0) - (orderOf.get(b.matchupId) ?? 0));

  return {
    rows,
    unmatched: unmatchedLeagueGames.length,
    unusedResults: usable.length - claimed.size,
    seasonLinked,
  };
};

/**
 * The rows this would act on without being asked: a plain fill, and nothing else. A suggestion
 * rests on two names that are not the same string, so it waits to be ticked.
 */
export const defaultFillSelection = (plan: LeagueFillPlan): string[] =>
  plan.rows.filter((row) => row.action === "fill").map((row) => row.matchupId);

/**
 * Writes the chosen rows into the league's logs and returns a new map. Runs and the final flag are
 * all it sets: everything else a log can hold is left exactly as it was, so a game that already
 * had hits or strikeouts typed against it keeps them.
 */
export const applyLeagueScoreFill = (
  plan: LeagueFillPlan,
  selected: Iterable<string>,
  logs: Record<string, GameLog>,
  defaultInnings: number
): { logs: Record<string, GameLog>; filled: number } => {
  const wanted = new Set(selected);
  const byMatchup = new Map(plan.rows.map((row) => [row.matchupId, row]));
  const next = { ...logs };
  let filled = 0;

  wanted.forEach((matchupId) => {
    const row = byMatchup.get(matchupId);
    // Ambiguous rows carry no result, so there is nothing to write even if one is asked for.
    if (!row || row.action === "ambiguous") return;
    const current = next[matchupId] ?? blankLog(String(defaultInnings));
    next[matchupId] = {
      ...current,
      awayRuns: String(row.awayRuns),
      homeRuns: String(row.homeRuns),
      isFinal: true,
    };
    filled += 1;
  });

  return { logs: next, filled };
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One line for the toast, saying what was written and what was deliberately left alone. */
export const summarizeLeagueFill = (plan: LeagueFillPlan, filled: number): string => {
  const left = plan.rows.filter((row) => row.action === "overwrite").length;
  const offered = plan.rows.filter((row) => row.action === "suggested").length;
  const unclear = plan.rows.filter((row) => row.action === "ambiguous").length;
  const parts = [`Filled ${plural(filled, "game")}`];
  if (offered > 0) parts.push(`${offered} still to confirm`);
  if (left > 0) parts.push(`${left} left as entered`);
  if (unclear > 0) parts.push(`${unclear} could not be told apart`);
  if (plan.unmatched > 0) parts.push(`${plan.unmatched} with no result yet`);
  return `${parts.join(" · ")}.`;
};
