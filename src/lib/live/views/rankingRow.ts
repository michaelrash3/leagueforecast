/**
 * Whether a stored ranking row is one a board can draw whole, apart from the rest of what a
 * published board is (`boardShape.ts`, which re-exports it): the board kept from the last visit is
 * checked with it as the page starts (`savedBoard.ts`), and only Team Rankings reads the rest.
 */
import type { ScoutRankingRow } from "../../teamRankings";

type FieldKind = "string" | "number" | "boolean" | "number?" | "true?";

/**
 * What each field of a ranking row must be. Every field of `ScoutRankingRow`, whether or not the
 * board draws it today, so a row this check passes is a row the board can read whole: the compiler
 * holds the list to the type, and a field added to the row fails the build here until it is
 * listed.
 *
 * The first check of a saved board asked only for the id, name, rank and rating, and Codex's
 * review of #340 found the hole: a row cut short in storage, or kept by a build whose rows lacked
 * `pointRating`, passed, and the board's `formatRating(row.pointRating)` threw on it.
 */
export const ROW_FIELDS: { [K in keyof ScoutRankingRow]-?: FieldKind } = {
  overallRank: "number?",
  teamId: "string",
  teamName: "string",
  isMine: "boolean",
  rank: "number",
  rating: "number",
  pointRating: "number",
  levelPrior: "number?",
  outsideGames: "number?",
  record: "string",
  wins: "number",
  losses: "number",
  ties: "number",
  games: "number",
  rawMargin: "number",
  strengthOfSchedule: "number",
  sosRank: "number",
  ageLevel: "number?",
  crossAgeGames: "number",
  componentSize: "number",
  componentId: "string",
  comparable: "boolean",
  fromGameChanger: "boolean",
  listedLast: "true?",
};

export const holds = (record: Record<string, unknown>, field: string, kind: FieldKind): boolean => {
  const value = record[field];
  if (kind === "true?") return value === undefined || value === true;
  return kind === "number?"
    ? value === undefined || typeof value === "number"
    : typeof value === kind;
};

export const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/** Whether `raw` is a ranking row a board can draw whole, star and all (`ROW_FIELDS`). */
export const isRankingRow = (raw: unknown): raw is ScoutRankingRow =>
  isRecord(raw) && Object.entries(ROW_FIELDS).every(([field, kind]) => holds(raw, field, kind));
