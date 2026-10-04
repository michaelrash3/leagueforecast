import {
  loadAgeGroups,
  loadAgeRightClubs,
  loadKeptApart,
  loadRealClubs,
  loadScoutGamesForYear,
  loadScoutTeams,
  saveAgeGroups,
  saveAgeRightClubs,
  saveKeptApart,
  saveRealClubs,
  saveScoutGamesForYear,
  saveScoutTeams,
  storedGamesByYear,
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
};

const SAVERS: Record<AnswerList, (ids: ReadonlySet<string>) => boolean> = {
  realClubs: saveRealClubs,
  ageRight: saveAgeRightClubs,
  keptApart: saveKeptApart,
};

/** The pool as this browser's store holds it. */
export const storedPool: PoolRead = {
  teams: loadScoutTeams,
  groups: loadAgeGroups,
  years: () => storedGamesByYear().map((entry) => entry.year ?? null),
  games: (year) => loadScoutGamesForYear(year ?? undefined),
  answers: (list) => LOADERS[list](),
};

/** Writes each part, every one tried; false when any was refused. */
export const writePool = (writes: readonly PoolWrite[]): boolean =>
  writes
    .map((write) => {
      switch (write.part) {
        case "teams":
          return saveScoutTeams(write.teams);
        case "groups":
          return saveAgeGroups(write.groups);
        case "games":
          return saveScoutGamesForYear(write.year ?? undefined, write.games);
        case "answers":
          return SAVERS[write.list](write.ids);
      }
    })
    .every(Boolean);

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
