import { closedLevelLine, shortDay } from "../closedLevelWords";
import type { ClosedLevelCheck } from "../scoutBacktest";
import { fits, type Shape } from "./shapes";
import type { LiveReader } from "./viewStore";

/**
 * The last weekly re-measure of where a rating starts, as the nightly keeps it for the Model check
 * card (`closedLevelWeekly.ts`, README "Where a rating starts"): one small document beside the
 * views a server publishes, `live/closedLevel`, which the rules let the list read as they let it
 * read `live/meta` and which only the nightly's live run writes. The card reads it as it opens, so
 * the last Monday's answer is there without the check run again. It holds numbers and days only.
 */

/** The starting level's re-measure (`ClosedLevelCheck`): numbers and days, no name of anybody. */
export const CLOSED_LEVEL_CHECK: Shape = {
  record: {
    held: "number",
    level: { nullable: "number" },
    standardError: { nullable: "number" },
    games: "count",
    clusters: "count",
    weeks: {
      list: {
        record: { from: "string", to: "string", games: "count", level: { nullable: "number" } },
      },
    },
    paired: {
      nullable: { record: { by: "number", standardError: "number", samples: "count" } },
    },
    better: "boolean",
  },
};

/** Where the record is kept. */
export const CLOSED_LEVEL_PATH = "live/closedLevel";

/** The layout of the record; a reader refuses any other. */
export const CLOSED_LEVEL_FORMAT = 1;

/** The record: when it was measured, on which squad year, and what it found. */
export type ClosedLevelRecord = {
  format: number;
  /** The members' day it was measured on, an ISO day: a Monday, by the nightly's rule. */
  measuredOn: string;
  /** When, as an ISO time. */
  measuredAt: string;
  /** The squad year re-measured: the one with the most games in the four weeks. */
  year: number | null;
  check: ClosedLevelCheck;
};

const RECORD: Shape = {
  record: {
    format: "count",
    measuredOn: "string",
    measuredAt: "string",
    year: { nullable: "count" },
    check: CLOSED_LEVEL_CHECK,
  },
};

/** The record as read, checked: one of this layout and shape, or null. */
export const coerceClosedLevelRecord = (raw: unknown): ClosedLevelRecord | null => {
  if (!fits(raw, RECORD)) return null;
  const record = raw as ClosedLevelRecord;
  return record.format === CLOSED_LEVEL_FORMAT ? record : null;
};

/**
 * The last weekly re-measure, through the signed-in member's reader of `live/`, or null: none
 * kept yet, none this build reads, no reader, or the read failed. The card only says less for it.
 */
export const readLastClosedLevel = async (
  reader: () => Promise<LiveReader | null>
): Promise<ClosedLevelRecord | null> => {
  try {
    const live = await reader();
    if (!live?.readClosedLevel) return null;
    return coerceClosedLevelRecord(await live.readClosedLevel());
  } catch {
    return null;
  }
};

/** The card's line for the record: the day it was measured, then the line as the check says it. */
export const lastClosedLevelLine = (record: ClosedLevelRecord): string =>
  `Last weekly re-measure, ${shortDay(record.measuredOn)}. ${closedLevelLine(record.check)}`;
