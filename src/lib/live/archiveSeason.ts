import { isArchived } from "../seasonArchive";
import type { SeasonSnapshot } from "../storage";
import type { BaseKeeper, Known } from "./leagueBase";
import {
  createdApart,
  docToSeason,
  LEAGUE_DOC_SCHEMA,
  seasonDocId,
  type LeagueDocChange,
} from "./leagueDocs";
import type { LeagueStore } from "./leagueStore";

/**
 * How an archive mark (`seasonArchive.ts`) travels for a season that is not open. The open season
 * needs nothing of its own here: the mark is a setting, and the live store sends a setting changed
 * on screen as it sends any (`leagueSync.ts`). A season that is not open has no live store, and is
 * otherwise sent only when next opened, which an archived season seldom is: so its mark is sent at
 * once, in one transaction, and carried down to the other devices at their next meeting.
 */

const ARCHIVED_PATH = ["settings", "archived"] as const;

const isArchivedPath = (path: readonly string[]): boolean =>
  path.length === 2 && path[0] === ARCHIVED_PATH[0] && path[1] === ARCHIVED_PATH[1];

/**
 * The mark as this device knows the season's document to hold it at write `upTo`: its base, then
 * each of its own writes of the mark that had landed by then (`Landed`). A version the cloud gives
 * at or past one of them holds it, so the write is not taken for another device's change; one
 * before it does not.
 */
export const archivedAsKnown = (known: Known, upTo: number): boolean => {
  let archived = isArchived(known.season.settings);
  for (const one of known.landed) {
    if (one.rev > upTo) continue;
    for (const change of one.changes) {
      if (isArchivedPath(change.path) && "value" in change) archived = change.value === true;
    }
  }
  return archived;
};

export type ArchiveSent = "sent" | "none" | "absent" | "apart" | "unreadable" | "newer";

/**
 * Writes `archived` into the cloud's copy of `season`, a season not open here: that one setting,
 * the layout raised where the document's is older (the mark is a field of the newer one), when it
 * was saved and the next write's number, which the rules hold every write to. Nothing else of the
 * season is sent: whatever else changed here since goes as it always has, when the season is next
 * opened. Nothing is written where the cloud already says so, where the cloud has no such season
 * (it is not made from here, which could bring back one deleted elsewhere), or where the cloud's is
 * a season made at another moment under the same id. A write that lands is kept as this device's
 * own (`Landed`), as the live store keeps its writes.
 */
export const sendArchiveMark = async ({
  store,
  bases,
  season,
  archived,
  now,
}: {
  store: LeagueStore;
  bases: BaseKeeper;
  season: SeasonSnapshot;
  archived: boolean;
  now: string;
}): Promise<ArchiveSent> => {
  const docId = seasonDocId(season.id);
  const outcome = await store.update<
    | { kind: Exclude<ArchiveSent, "sent"> }
    | { kind: "sent"; changes: LeagueDocChange[]; rev: number }
  >(docId, (remote) => {
    if (!remote.exists) return { write: null, result: { kind: "absent" } };
    const read = docToSeason(remote.data, docId);
    if (!read.ok) return { write: null, result: { kind: read.reason } };
    if (createdApart(read.season.createdAt, season.createdAt)) {
      return { write: null, result: { kind: "apart" } };
    }
    if (isArchived(read.season.settings) === archived) {
      return { write: null, result: { kind: "none" } };
    }
    const changes: LeagueDocChange[] = [
      { path: [...ARCHIVED_PATH], value: archived },
      ...(read.schema < LEAGUE_DOC_SCHEMA ? [{ path: ["schema"], value: LEAGUE_DOC_SCHEMA }] : []),
      { path: ["updatedAt"], value: now },
      { path: ["rev"], value: read.rev + 1 },
    ];
    return { write: { changes }, result: { kind: "sent", changes, rev: read.rev + 1 } };
  });
  if (outcome.kind !== "sent") return outcome.kind;
  const known = bases.read(docId);
  if (known && !createdApart(known.season.createdAt, season.createdAt) && outcome.rev > known.rev) {
    bases.write(docId, {
      ...known,
      landed: [...known.landed, { rev: outcome.rev, changes: outcome.changes }],
    });
  }
  return "sent";
};
