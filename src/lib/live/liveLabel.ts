import { formatIsoDayShort, shiftIsoDay } from "../date";
import type { BoardStanding } from "./liveClient";
import { BOARD_RULES } from "./views/boardShape";

/**
 * What the live board says it is, beside its rows, in place of the page's "Refitting…": the one
 * thing most worth knowing about it, first of these that holds.
 *
 * - Read from what this device kept, the network not having answered: offline, or still checking.
 * - Built before changes this device has not saved, or before the copy's latest.
 * - Built by rules other than this build's.
 * - Built for an earlier day than the reader's: yesterday's, or a date's.
 *
 * Whatever it says, the board is a stand-in until this device's own copy takes over: no label stops
 * it being drawn, which only a check it fails does.
 */
export const liveLabel = ({
  check,
  standing,
  rules,
  boardDay,
  today,
}: {
  /** `checked`: the network vouched for it; `checking`: not yet; `offline`: it could not. */
  check: "checked" | "checking" | "offline";
  standing: BoardStanding | null;
  /** The rules the boards were built under (`BuiltFrom.rules`), when the meta says. */
  rules: number | undefined;
  /** The members' day the board was built for (`LiveMeta.today`). */
  boardDay: string;
  /** The reader's own day. */
  today: string;
}): string => {
  if (check === "offline") return "The cloud's board as last read · offline";
  if (standing === "owed") return "The cloud's board, from before this device's changes";
  if (standing === "behind-copy") return "The cloud's board, from before the latest changes";
  if (rules !== undefined && rules !== BOARD_RULES)
    return "The cloud's board, built by another version of the app";
  if (check === "checking") return "The cloud's board · checking for a newer one…";
  if (boardDay < today)
    return shiftIsoDay(today, -1) === boardDay
      ? "Yesterday's board from the cloud"
      : `The cloud's board from ${formatIsoDayShort(boardDay)}`;
  return "The cloud's board";
};
