import type { ScoutGame, ScoutTeam } from "../teamRankings/types";
import { cleanTeamName, teamNameKey } from "../teamRankings/names";
import { loadScoutGames, loadScoutTeams } from "../teamRankingsStorage";
import { everyOne, oneTeam } from "./commands";

/**
 * Read-only questions a member's device asks of the pool the edit function keeps warm (1.5): what
 * a section has to say before it sends an edit, worked out on the copy rather than on a pool the
 * device no longer needs to hold. Each is answered from the process's store by the code the page
 * answers it with, so the device is told what its own copy would have said. Pure, as the commands
 * are, so it is tested without a server: `runQuery` (`editRun.ts`) brings the pool to the copy and
 * asks.
 */

/**
 * - `merge.preview`: folding `fromId` into `intoId`, as `teams.merge` does: whether both clubs are
 *   there to fold (the roster's, or one League Standings made, offered in `adopt` as the command
 *   takes it), and the counts `foldCounts` gives.
 * - `rename.preview`: renaming `teamId` to `name`, as the page does: the name as it would be kept,
 *   and the club already under it on the roster, which the rename folds the club into instead
 *   (`renameScoutTeam`), with the counts of that fold. A club League Standings made is not on the
 *   server's roster to be found by its name until it joins it.
 */
export type PoolQuery =
  | { kind: "merge.preview"; fromId: string; intoId: string; adopt: ScoutTeam[] }
  | { kind: "rename.preview"; teamId: string; name: string };

/**
 * What folding one club into another touches: the stored games that name the club folded away,
 * and of those the games between the two, which a fold drops since a club cannot play itself
 * (`mergeScoutTeams`). A club's game against its own name is not between the two, the two being
 * two clubs in every question that asks.
 */
export type FoldCounts = { games: number; dropped: number };

export type MergePreview = FoldCounts & { found: boolean };

export type RenamePreview = FoldCounts & {
  /** The name as it would be kept (`cleanTeamName`), empty where none would be. */
  name: string;
  into: { id: string; name: string } | null;
};

export type QueryAnswers = { "merge.preview": MergePreview; "rename.preview": RenamePreview };

export type QueryKind = PoolQuery["kind"];

/** An answer, with the kind of question it answers. */
export type QueryAnswer = { [K in QueryKind]: { kind: K } & QueryAnswers[K] }[QueryKind];

export const foldCounts = (
  fromId: string,
  intoId: string,
  games: readonly ScoutGame[]
): FoldCounts => {
  let named = 0;
  let dropped = 0;
  for (const game of games) {
    const sideA = game.teamAId === fromId;
    if (!sideA && game.teamBId !== fromId) continue;
    named += 1;
    if ((sideA ? game.teamBId : game.teamAId) === intoId) dropped += 1;
  }
  return { games: named, dropped };
};

const NO_FOLD: FoldCounts = { games: 0, dropped: 0 };

/** Answers `query` from the process's store, as the page would have answered it from its own. */
export const answerQuery = (query: PoolQuery): QueryAnswer => {
  switch (query.kind) {
    case "merge.preview": {
      const held = new Set(loadScoutTeams().map((team) => team.id));
      query.adopt.forEach((team) => held.add(team.id));
      const found =
        query.fromId !== query.intoId && held.has(query.fromId) && held.has(query.intoId);
      return {
        kind: "merge.preview",
        found,
        ...(found ? foldCounts(query.fromId, query.intoId, loadScoutGames()) : NO_FOLD),
      };
    }
    case "rename.preview": {
      const name = cleanTeamName(query.name).trim();
      const key = teamNameKey(name);
      const into = name
        ? loadScoutTeams().find(
            (team) => team.id !== query.teamId && teamNameKey(team.name) === key
          )
        : undefined;
      return {
        kind: "rename.preview",
        name,
        into: into ? { id: into.id, name: into.name } : null,
        ...(into ? foldCounts(query.teamId, into.id, loadScoutGames()) : NO_FOLD),
      };
    }
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string" && value !== "";

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** Whether every key `raw` carries is one `read` kept: what a reader drops was never meant. */
const keptWhole = (raw: Record<string, unknown>, read: object): boolean =>
  Object.keys(raw).every((key) => Object.prototype.hasOwnProperty.call(read, key));

/**
 * A question read back exactly, as a command is (`coerceCommand`): one with a field this build does
 * not read, or one it would have to change to read, is refused rather than half answered.
 */
export const coerceQuery = (raw: unknown): PoolQuery | null => {
  if (!isRecord(raw)) return null;
  let query: PoolQuery | null = null;
  switch (raw.kind) {
    case "merge.preview": {
      const adopt = everyOne(raw.adopt, oneTeam);
      if (isString(raw.fromId) && isString(raw.intoId) && adopt)
        query = { kind: "merge.preview", fromId: raw.fromId, intoId: raw.intoId, adopt };
      break;
    }
    case "rename.preview":
      if (isString(raw.teamId) && typeof raw.name === "string")
        query = { kind: "rename.preview", teamId: raw.teamId, name: raw.name };
      break;
  }
  return query && keptWhole(raw, query) ? query : null;
};

const foldOf = (raw: Record<string, unknown>): FoldCounts | null =>
  isCount(raw.games) && isCount(raw.dropped) && raw.dropped <= raw.games
    ? { games: raw.games, dropped: raw.dropped }
    : null;

/**
 * An answer as a device reads one the server sent, for the question it asked: of that kind and that
 * shape, or null. Nothing in it is taken on trust.
 */
export const coerceQueryAnswer = <K extends QueryKind>(
  raw: unknown,
  kind: K
): ({ kind: K } & QueryAnswers[K]) | null => {
  if (!isRecord(raw) || raw.kind !== kind) return null;
  const fold = foldOf(raw);
  if (!fold) return null;
  let answer: QueryAnswer | null = null;
  switch (kind) {
    case "merge.preview":
      if (typeof raw.found === "boolean")
        answer = { kind: "merge.preview", found: raw.found, ...fold };
      break;
    case "rename.preview": {
      const into = raw.into;
      if (typeof raw.name !== "string") break;
      if (into === null) {
        answer = { kind: "rename.preview", name: raw.name, into: null, ...fold };
      } else if (isRecord(into) && isString(into.id) && typeof into.name === "string") {
        answer = {
          kind: "rename.preview",
          name: raw.name,
          into: { id: into.id, name: into.name },
          ...fold,
        };
      }
      break;
    }
  }
  return answer as ({ kind: K } & QueryAnswers[K]) | null;
};
