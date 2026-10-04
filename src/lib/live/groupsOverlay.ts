import type { AgeGroup } from "../teamRankings";
import { applyCommand, type PoolCommand } from "./commands";

/**
 * A league season put on a page, or taken off, as the live page shows it before the publish that
 * carries it is out (1.5): the pages worked out as the server works them out, from the pages
 * alone. Apart from the other edits drawn over the views (`liveEdits.ts`), since it runs a command,
 * and the command module loads only with the area that sends one.
 */

/** A command and every step a batch of them holds, in the order they run. */
export const stepsOf = (command: PoolCommand): PoolCommand[] =>
  command.kind === "batch" ? command.commands.flatMap(stepsOf) : [command];
/**
 * The pages as a league season put on one, or taken off, leaves them (`season.assign`), worked out
 * as the server works it out (`applyCommand`), which reads the pages alone; null where the command
 * is refused.
 */
export const groupsAfter = (
  groups: readonly AgeGroup[],
  command: Extract<PoolCommand, { kind: "season.assign" }>
): readonly AgeGroup[] | null => {
  const result = applyCommand(
    {
      teams: () => [],
      groups: () => groups,
      years: () => [],
      games: () => [],
      answers: () => new Set(),
      namedAges: () => new Map(),
      ageless: () => [],
    },
    command
  );
  if (!result.ok) return null;
  const written = result.writes.find((write) => write.part === "groups");
  return written?.part === "groups" ? written.groups : groups;
};

/**
 * The pages with the league seasons put on them, or taken off, since they were published, for a
 * card that reads which page holds a season: the edits not yet in a publish, in the order made.
 */
export const overlayGroups = (
  groups: readonly AgeGroup[],
  edits: readonly PoolCommand[]
): readonly AgeGroup[] => {
  let shown = groups;
  for (const step of edits.flatMap(stepsOf)) {
    if (step.kind !== "season.assign") continue;
    shown = groupsAfter(shown, step) ?? shown;
  }
  return shown;
};

/**
 * What the person is told once a league season is put on a page, or taken off: the device's own
 * card's words, worked out from the pages the season was put on as they are drawn, which is what
 * the server puts it on unless another device moved them meanwhile.
 */
export const seasonAssignedSaid = (
  shown: readonly AgeGroup[],
  command: Extract<PoolCommand, { kind: "season.assign" }>
): string => {
  const group = command.season
    ? groupsAfter(shown, command)?.find((page) => page.seasonIds.includes(command.seasonId))
    : undefined;
  if (!group) return "League season taken off Team Rankings.";
  return group.id === command.pageId
    ? `${group.name} created, with your league season on it.`
    : `League season added to ${group.name}.`;
};
