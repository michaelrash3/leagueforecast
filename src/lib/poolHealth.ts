import { resolveSlotGames, poolSignature, type GcImportState } from "./gameChangerImport";
import { isScoutGamePlayed, type ScoutGame, type ScoutTeam } from "./teamRankings";

/**
 * What state the pool is actually in.
 *
 * Written because a pool of two hundred thousand games had eleven and a half thousand results
 * still filed against "TBD" while the code that settles them worked perfectly — it had simply
 * never finished running. Nothing on screen said so. The counts below are the ones that would
 * have said it: how much of the pool is a stand-in rather than a club, and how much of that the
 * tidy could settle right now if it were allowed to run.
 *
 * The settleable figure comes from running the real pass rather than from a second implementation
 * of its rules. A diagnostic that computes its own answer is a diagnostic that can disagree with
 * the thing it is diagnosing, and then neither can be trusted.
 */

/**
 * Games above which the tidy is offered rather than run unasked.
 *
 * Measured: five passes over two hundred thousand games is about twenty-two seconds, and it ran on
 * the main thread. A tab frozen that long is closed or reloaded, the run is cancelled, the stamp is
 * never written, and nothing was tidied — which is exactly the state a real pool was found in. So
 * past this size the work is put behind a button that says what it will fix, and runs it off the
 * main thread. Twenty thousand games is roughly two seconds, which is a pause rather than a hang.
 */
export const TIDY_UNASKED_LIMIT = 20_000;

export type PoolHealth = {
  games: number;
  /** Games with a result. The rest are fixtures nobody has played yet. */
  played: number;
  teams: number;
  /** Teams that are a club: pulled, or named well enough to rank. */
  clubs: number;
  /** Known only from somebody else's schedule — in the fit as an opponent, never in a table. */
  nameOnly: number;
  /** A bracket slot, a "TBD": names nobody. */
  placeholders: number;
  /** Games where one side is a stand-in rather than a club. */
  standInGames: number;
  /** Of those, the ones with a result — the ones worth settling. */
  standInPlayed: number;
  /** Games with no date, which no squad year can hold and no stand-in can be settled from. */
  undated: number;
  /** Whether the pool is in the shape the tidy last left it in. */
  tidied: boolean;
};

const isStandIn = (team: ScoutTeam | undefined): boolean =>
  team?.placeholder === true || team?.nameOnly === true;

export const poolHealth = (state: GcImportState, tidyStamp: string): PoolHealth => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  let standInGames = 0;
  let standInPlayed = 0;
  let played = 0;
  let undated = 0;

  state.games.forEach((game: ScoutGame) => {
    const a = isStandIn(byId.get(game.teamAId));
    const b = isStandIn(byId.get(game.teamBId));
    const scored = isScoutGamePlayed(game);
    if (scored) played += 1;
    if (!game.date) undated += 1;
    if (a !== b) {
      standInGames += 1;
      if (scored) standInPlayed += 1;
    }
  });

  const placeholders = state.teams.filter((team) => team.placeholder).length;
  const nameOnly = state.teams.filter((team) => team.nameOnly && !team.placeholder).length;

  return {
    games: state.games.length,
    played,
    teams: state.teams.length,
    clubs: state.teams.length - placeholders - nameOnly,
    nameOnly,
    placeholders,
    standInGames,
    standInPlayed,
    undated,
    tidied: poolSignature(state) === tidyStamp,
  };
};

/**
 * How many stand-ins the settling pass would name if it ran now.
 *
 * Runs the pass and throws the result away, which is the point: it answers "is there work waiting"
 * without doing it, and it answers using the same rules that would do it. Costs about half a
 * second on a pool of two hundred thousand games, so it is asked for rather than computed on sight.
 */
export const settleableNow = (state: GcImportState): number => resolveSlotGames(state).resolved;
