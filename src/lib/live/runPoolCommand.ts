import {
  loadAgeGroups,
  loadAgeUnknown,
  loadAgeRightClubs,
  loadDeletedGames,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadRealClubs,
  loadScoutGamesForYear,
  loadScoutTeams,
  saveAgeGroups,
  saveAgeRightClubs,
  saveAgeUnknown,
  saveDeletedGames,
  saveDroppedClubs,
  saveKeptApart,
  saveNamedAges,
  saveRealClubs,
  saveScoutGamesForYear,
  saveScoutTeams,
  storedGamesByYear,
  writePoolTogether,
} from "../teamRankingsStorage";
import {
  applyCommand,
  type AnswerList,
  type PoolCommand,
  type PoolRead,
  type PoolWrite,
} from "./commands";

/**
 * Commands run on this browser's own pool store, through the loaders and savers every part of the
 * page already uses, so the store, the other tabs and the cloud copy hear of a command's writes
 * as they hear of any other. The server runs the same `applyCommand` on its own store (1.4).
 */

const LOADERS: Record<AnswerList, () => ReadonlySet<string>> = {
  realClubs: loadRealClubs,
  ageRight: loadAgeRightClubs,
  keptApart: loadKeptApart,
  droppedClubs: loadDroppedClubs,
  deletedGames: loadDeletedGames,
};

const SAVERS: Record<AnswerList, (ids: ReadonlySet<string>) => boolean> = {
  realClubs: saveRealClubs,
  ageRight: saveAgeRightClubs,
  keptApart: saveKeptApart,
  droppedClubs: saveDroppedClubs,
  deletedGames: saveDeletedGames,
};

/** The pool as this browser's store holds it. */
export const storedPool: PoolRead = {
  teams: loadScoutTeams,
  groups: loadAgeGroups,
  years: () => storedGamesByYear().map((entry) => entry.year ?? null),
  games: (year) => loadScoutGamesForYear(year ?? undefined),
  answers: (list) => LOADERS[list](),
  namedAges: loadNamedAges,
  ageless: loadAgeUnknown,
};

const writePart = (write: PoolWrite): boolean => {
  switch (write.part) {
    case "teams":
      return saveScoutTeams(write.teams);
    case "groups":
      return saveAgeGroups(write.groups);
    case "games":
      return saveScoutGamesForYear(write.year ?? undefined, write.games);
    case "answers":
      return SAVERS[write.list](write.ids);
    case "namedAges":
      return saveNamedAges(write.named);
    case "ageless":
      return saveAgeUnknown(write.list);
  }
};

/**
 * Writes every part or none: the first part the store refuses ends the run, and the parts written
 * before it are put back (`writePoolTogether`), so a command is never left half-done in the store.
 *
 * The pages around the games, because storage files a game under its page's year: a page a change
 * makes is stored before the games filed on it, which would otherwise be filed under no year, and
 * a page it takes away is let go only after its games have left it, since storing the pages
 * without one refiles whatever is still on it (`saveAgeGroups`). So the pages are stored first
 * with every page the store has kept on, and then, once the games are written, as they are to be.
 */
export const writePool = (writes: readonly PoolWrite[]): boolean =>
  writePoolTogether(() => {
    const pages = writes.find((write) => write.part === "groups");
    const kept = pages?.part === "groups" ? new Set(pages.groups.map((group) => group.id)) : null;
    const leaving = kept ? loadAgeGroups().filter((group) => !kept.has(group.id)) : [];
    if (pages?.part === "groups" && !saveAgeGroups([...pages.groups, ...leaving])) return false;
    if (!writes.every((write) => write.part === "groups" || writePart(write))) return false;
    return pages?.part !== "groups" || leaving.length === 0 || saveAgeGroups(pages.groups);
  });

export type CommandRun =
  /** Applied and written: the parts as written, and what takes it back. */
  | { ok: true; writes: PoolWrite[]; inverse: PoolCommand }
  /**
   * Not done: what the command names is not in the pool, or the change is not one it takes
   * (`commands.ts`); or the store refused a write (`unsaved`), full or held by another tab.
   */
  | { ok: false; why: "missing" | "refused" | "unsaved" };

/**
 * Applies `command` to this browser's pool and writes the parts it changed, and only those. Its
 * caller shows a change once it has been written, not before: a change the store refused is a
 * change that is not there.
 */
export const runPoolCommand = (command: PoolCommand): CommandRun => {
  const result = applyCommand(storedPool, command);
  if (!result.ok) return result;
  if (!writePool(result.writes)) return { ok: false, why: "unsaved" };
  return result;
};

/** The roster a run wrote, if it wrote one. */
export const writtenTeams = (run: CommandRun) =>
  run.ok ? run.writes.find((write) => write.part === "teams")?.teams : undefined;

/** The named ages a run wrote, if it wrote them. */
export const writtenNamedAges = (run: CommandRun) =>
  run.ok ? run.writes.find((write) => write.part === "namedAges")?.named : undefined;

/** The pages a run wrote, if it wrote them. */
export const writtenGroups = (run: CommandRun) =>
  run.ok ? run.writes.find((write) => write.part === "groups")?.groups : undefined;

/** The answer list a run wrote, if it wrote that one. */
export const writtenAnswers = (run: CommandRun, list: AnswerList) =>
  run.ok
    ? run.writes.find(
        (write): write is Extract<PoolWrite, { part: "answers" }> =>
          write.part === "answers" && write.list === list
      )?.ids
    : undefined;
