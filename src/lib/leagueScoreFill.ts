import { normalizeDateInput } from "./date";
import {
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
 * What it will not do is guess. Every row is shown before anything is written, a score that
 * disagrees with one already entered is never quietly replaced, and a game the evidence cannot
 * single out is reported rather than resolved — because the cost of a wrong score here is a wrong
 * standings table, and the person reading it has no way to tell.
 */

/** What filling one league game from the pool would do. */
export type LeagueFillAction =
  /** Nothing recorded here yet; the pool's result goes in. */
  | "fill"
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

export type LeagueScoreFillInput = {
  seasonId: string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  ageGroups: AgeGroup[];
  scoutTeams: ScoutTeam[];
  scoutGames: ScoutGame[];
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
  const scoutKeyById = new Map(scoutTeams.map((team) => [team.id, teamNameKey(team.name)]));

  /**
   * Results that could fill a league game: played, filed under an age group that claims this
   * season, and not derived from this very schedule in the first place. That last exclusion is the
   * important one — the pool carries the league's own games, and letting those flow back would be
   * the app confirming its own scores.
   */
  const poolByKey = new Map<string, ScoutGame[]>();
  let usableResults = 0;
  scoutGames.forEach((game) => {
    if (!linkedGroups.has(game.ageGroupId)) return;
    if (game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    if (!isScoutGamePlayed(game)) return;
    const date = normalizeDateInput(game.date ?? "");
    if (!date) return;
    const keyA = scoutKeyById.get(game.teamAId);
    const keyB = scoutKeyById.get(game.teamBId);
    if (!keyA || !keyB || keyA === keyB) return;
    const key = matchKey(keyA, keyB, date);
    const bucket = poolByKey.get(key);
    if (bucket) bucket.push(game);
    else poolByKey.set(key, [game]);
    usableResults += 1;
  });
  // Stable order, so a doubleheader is zipped the same way every time this runs.
  poolByKey.forEach((bucket) => bucket.sort((a, b) => a.id.localeCompare(b.id)));

  /** League games grouped the same way, so both sides of a doubleheader can be counted. */
  const leagueByKey = new Map<string, Matchup[]>();
  matchups.forEach((matchup) => {
    const date = normalizeDateInput(matchup.date ?? "");
    if (!date) return;
    const awayName = leagueNameById.get(matchup.away);
    const homeName = leagueNameById.get(matchup.home);
    if (!awayName || !homeName) return;
    const key = matchKey(teamNameKey(awayName), teamNameKey(homeName), date);
    const bucket = leagueByKey.get(key);
    if (bucket) bucket.push(matchup);
    else leagueByKey.set(key, [matchup]);
  });

  const rows: LeagueFillRow[] = [];
  const claimed = new Set<string>();
  let unmatched = 0;

  leagueByKey.forEach((leagueGames, key) => {
    const results = poolByKey.get(key) ?? [];
    if (results.length === 0) {
      unmatched += leagueGames.length;
      return;
    }

    /**
     * A pair can meet twice on one day, and youth baseball schedules doubleheaders constantly.
     * When both sides count the same, the games are paired in order — the only ordering either
     * side offers. When they do not, nothing here can say which result belongs to which game, and
     * a fifty-fifty guess about a score is not worth making.
     */
    const zipped = results.length === leagueGames.length;

    leagueGames.forEach((matchup, index) => {
      const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
      const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
      const log = logs[matchup.id];
      const base = {
        matchupId: matchup.id,
        date: matchup.date,
        awayTeamId: matchup.away,
        awayName,
        homeTeamId: matchup.home,
        homeName,
      };

      if (!zipped) {
        rows.push({
          ...base,
          awayRuns: 0,
          homeRuns: 0,
          action: "ambiguous",
          detail:
            results.length > leagueGames.length
              ? `${results.length} results for this pairing on this date, but ${leagueGames.length} game${leagueGames.length === 1 ? "" : "s"} on the schedule.`
              : `${leagueGames.length} games for this pairing on this date, but only ${results.length} result${results.length === 1 ? "" : "s"}.`,
        });
        return;
      }

      const result = results[index]!;
      claimed.add(result.id);

      // The pool stores the pulled team first, not the home team, so the sides are read by
      // identity rather than position.
      const resultKeyA = scoutKeyById.get(result.teamAId);
      const awayIsA = resultKeyA === teamNameKey(awayName);
      const awayRuns = (awayIsA ? result.teamAScore : result.teamBScore)!;
      const homeRuns = (awayIsA ? result.teamBScore : result.teamAScore)!;

      const currentAway = runsText(log, "away");
      const currentHome = runsText(log, "home");
      const recorded = hasRecordedRuns(log);
      const same = recorded && Number(currentAway) === awayRuns && Number(currentHome) === homeRuns;

      const row: LeagueFillRow = {
        ...base,
        awayRuns,
        homeRuns,
        action: same ? "unchanged" : recorded ? "overwrite" : "fill",
        scoutGameId: result.id,
        ...(result.source
          ? { gcTeamId: result.source.teamId, gcGameId: result.source.gameId }
          : {}),
        ...(recorded ? { currentAwayRuns: currentAway, currentHomeRuns: currentHome } : {}),
        ...(result.event ? { event: result.event } : {}),
      };
      if (row.action === "overwrite") {
        row.detail = `Already recorded as ${currentAway}–${currentHome}${isFinal(log) ? " and marked final" : ""}.`;
      }
      if (row.action === "unchanged" && !isFinal(log)) {
        // The score agrees but the game was never verified, which is worth one more click.
        row.detail = "Same score, not yet marked final.";
      }
      rows.push(row);
    });
  });

  // Schedule order, so the review reads the way the season does.
  const orderOf = new Map(matchups.map((matchup, index) => [matchup.id, index]));
  rows.sort((a, b) => (orderOf.get(a.matchupId) ?? 0) - (orderOf.get(b.matchupId) ?? 0));

  return {
    rows,
    unmatched,
    unusedResults: usableResults - claimed.size,
    seasonLinked,
  };
};

/** The rows this would act on without being asked: a plain fill, and nothing else. */
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
  const byId = new Map(plan.rows.map((row) => [row.matchupId, row]));
  const next = { ...logs };
  let filled = 0;

  wanted.forEach((matchupId) => {
    const row = byId.get(matchupId);
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
  const unclear = plan.rows.filter((row) => row.action === "ambiguous").length;
  const parts = [`Filled ${plural(filled, "game")}`];
  if (left > 0) parts.push(`${left} left as entered`);
  if (unclear > 0) parts.push(`${unclear} could not be told apart`);
  if (plan.unmatched > 0) parts.push(`${plan.unmatched} with no result yet`);
  return `${parts.join(" · ")}.`;
};
