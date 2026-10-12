import type { AgeGroup, ScoutGame } from "../teamRankings";
import { applyCommand, NO_ANSWERS, type PoolCommand } from "./commands";
import { stepsOf } from "./groupsOverlay";

/**
 * A game's score, its counting, or the game itself taken out or put back, as the live Games tab
 * shows it before the publish that carries it is out (1.5): the page's published list worked out
 * as the server works out the year's, from the list and the pages alone. Apart from the other
 * edits drawn over the views (`liveEdits.ts`), since it runs a command, and the command module
 * loads only with the area that sends one.
 */

/** The edits to one year's games that read nothing but its games and the pages they are on. */
type GameStep = Extract<
  PoolCommand,
  {
    kind:
      "game.score" | "game.exclude" | "game.confirm" | "game.remove" | "game.insert" | "game.put";
  }
>;
const GAME_STEPS: ReadonlySet<PoolCommand["kind"]> = new Set([
  "game.score",
  "game.exclude",
  "game.confirm",
  "game.remove",
  "game.insert",
  "game.put",
]);
const isGameStep = (command: PoolCommand): command is GameStep => GAME_STEPS.has(command.kind);

/**
 * The page's games after one edit to its year's (`applyCommand`, on a pool of this list and the
 * pages, which is all these edits read); null where the command is refused, as one about a game
 * the list does not hold is, and the very list where it changes none of it. An edit to another
 * year's games reads none of these, so it is one or the other.
 */
export const gamesAfter = (
  games: readonly ScoutGame[],
  groups: readonly AgeGroup[],
  year: number | null,
  command: GameStep
): readonly ScoutGame[] | null => {
  const result = applyCommand(
    {
      teams: () => [],
      groups: () => groups,
      years: () => [year],
      games: (asked) => (asked === year ? games : []),
      ...NO_ANSWERS,
    },
    command
  );
  if (!result.ok) return null;
  const written = result.writes.find((write) => write.part === "games" && write.year === year);
  return written?.part === "games" ? written.games : games;
};

/**
 * The page's games of `year` with the edits to them not yet in a publish drawn over them, in the
 * order made: the very list when none touches them, so what is worked out from it stays put.
 */
export const overlayGames = (
  games: readonly ScoutGame[],
  groups: readonly AgeGroup[],
  year: number | null,
  edits: readonly PoolCommand[]
): readonly ScoutGame[] => {
  let shown = games;
  for (const step of edits.flatMap(stepsOf)) {
    if (!isGameStep(step)) continue;
    shown = gamesAfter(shown, groups, year, step) ?? shown;
  }
  return shown;
};
