import { setClubAge, type ClubAgeState } from "../clubAge";
import type { PoolCommand } from "./commands";

/** A club to be filed at `level` in squad year `year`. */
export type AgeAsked = { teamId: string; level: number; year: number };

/**
 * Several clubs filed at the ages asked, as one change with one undo (`club.age` each, in a
 * batch). Walked first as the commands will make them, each on what the last left, to learn which
 * clubs can move and how many games go with them: a club that cannot (no GameChanger link in the
 * year, or a level this app does not rank) is left out and counted, since a batch is refused whole
 * and the rest should still go. Page ids are `${base}-0`, `${base}-1`, ... by the club's place in
 * `asked`, so two clubs moving to one new page make it once, under the first one's id.
 */
export const planClubAges = (
  state: ClubAgeState,
  asked: readonly AgeAsked[],
  at: string,
  base: string
): { commands: PoolCommand[]; changedTeamIds: string[]; moved: number; failed: number } => {
  let after = state;
  const commands: PoolCommand[] = [];
  const changedTeamIds: string[] = [];
  let moved = 0;
  let failed = 0;
  asked.forEach((club, index) => {
    const pageId = `${base}-${index}`;
    const change = setClubAge(after, club.teamId, club.level, club.year, "you", undefined, pageId);
    if (!change) {
      failed += 1;
      return;
    }
    after = change;
    moved += change.moved;
    changedTeamIds.push(club.teamId);
    commands.push({
      kind: "club.age",
      year: club.year,
      teamId: club.teamId,
      level: club.level,
      at,
      pageId,
    });
  });
  return { commands, changedTeamIds, moved, failed };
};
