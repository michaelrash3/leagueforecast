/**
 * Shared contract for reading a schedule screenshot into games.
 *
 * A phone screenshot of a team's schedule (GameChanger and friends) is a month header plus rows
 * like `SAT 22 · vs. Velocirabbits 9U · W 6-5`. The browser posts the image to
 * `/api/parse-schedule-image`, which asks Gemini to return structured rows; the caller then reviews
 * and edits them before anything is saved.
 *
 * Types, limits, the prompt, and the sanitizer live here — as with `leagueSummary.ts` — so both
 * sides agree on the shape and the parsing is unit-testable without a network call. Everything the
 * model returns is treated as untrusted: `sanitizeScheduleImageResponse` is the only way in.
 */

import type { LeagueSummaryErrorReason } from "./leagueSummary";

export const SCHEDULE_IMAGE_ENDPOINT = "/api/parse-schedule-image";

/** One row read off the screenshot, from the subject team's point of view. */
export type ParsedScheduleGame = {
  /** ISO `YYYY-MM-DD`, resolved against the screenshot's month/year header when present. */
  date?: string;
  opponent: string;
  /** `vs.` in these apps means home, `@` means away. Recorded, but ratings stay neutral-site. */
  isHome?: boolean;
  /** The subject team's runs. Absent together with `opponentScore` means "not played yet". */
  teamScore?: number;
  opponentScore?: number;
};

export type ScheduleImageRequest = {
  /** Base64 payload only — no `data:` prefix. */
  imageBase64: string;
  mimeType: string;
};

export type ScheduleImageResponse = {
  /** The team whose schedule this is, if the header was legible. Often truncated, so a hint only. */
  subjectTeam?: string;
  games: ParsedScheduleGame[];
  model: string;
};

/** Same vocabulary as the league write-up endpoint, so the UI can reuse its wording. */
export type ScheduleImageError = {
  error: string;
  reason: LeagueSummaryErrorReason;
};

export const SCHEDULE_IMAGE_LIMITS = {
  /** ~3 MB of image once decoded; Vercel caps the whole request body at 4.5 MB. */
  imageBase64Length: 4_000_000,
  games: 80,
  nameLength: 80,
  /** Runs in a youth game; anything past this is a misread, not a blowout. */
  maxScore: 99,
} as const;

export const SCHEDULE_IMAGE_SYSTEM_INSTRUCTION = [
  "You read a screenshot of a youth sports team's schedule and return the games it lists.",
  "",
  "How these screens are laid out:",
  "- A header names the team whose schedule it is. It is often truncated with an ellipsis.",
  "- Section headers give the month and year, e.g. 'August 2026'.",
  "- Each row has a day, an opponent, and sometimes a result.",
  "- 'vs. Rockets' means the subject team was home; '@ Rockets' means it was away.",
  "- A result reads like 'W 6-5' or 'L 3-10'. THE FIRST NUMBER IS ALWAYS THE SUBJECT TEAM'S SCORE,",
  "  whether the row is a win or a loss. In 'L 3-10' the subject team scored 3 and the opponent 10.",
  "- A row with no result has not been played yet: return it with no scores at all.",
  "",
  "Rules:",
  "- Return every game row you can see, in the order they appear.",
  "- Give each date as YYYY-MM-DD, combining the row's day with the month/year section header.",
  "  Omit the date entirely if you cannot determine it; never guess a year.",
  "- Copy opponent names exactly as shown, including any age level in the name.",
  "- Never invent a game, a score, or a date. Omit anything you cannot read.",
  "- Return only the JSON described by the schema.",
].join("\n");

/** Gemini `responseSchema`: structured output beats re-parsing prose. */
export const SCHEDULE_IMAGE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    subjectTeam: { type: "string" },
    games: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string" },
          opponent: { type: "string" },
          isHome: { type: "boolean" },
          teamScore: { type: "integer" },
          opponentScore: { type: "integer" },
        },
        required: ["opponent"],
      },
    },
  },
  required: ["games"],
} as const;

export const SCHEDULE_IMAGE_PROMPT =
  "Read every game from this schedule screenshot and return them as JSON.";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const clampText = (value: unknown, max: number): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** A score is only kept when it is a whole, non-negative, plausible number of runs. */
const score = (value: unknown): number | undefined => {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  const rounded = Math.round(numeric);
  if (rounded < 0 || rounded > SCHEDULE_IMAGE_LIMITS.maxScore) return undefined;
  return rounded;
};

/**
 * Coerces the model's reply into rows we can show. Drops anything unusable rather than guessing:
 * a row with no opponent is dropped entirely, a malformed date is dropped to "no date", and a
 * half-read score (one side only) is dropped to "not played yet" so it can't skew a rating.
 */
export const sanitizeScheduleImageResponse = (
  raw: unknown
): { subjectTeam?: string; games: ParsedScheduleGame[] } => {
  const body = (raw ?? {}) as Record<string, unknown>;
  const subjectTeam = clampText(body.subjectTeam, SCHEDULE_IMAGE_LIMITS.nameLength);
  const rows = Array.isArray(body.games) ? body.games : [];

  const games = rows
    .slice(0, SCHEDULE_IMAGE_LIMITS.games)
    .map((item): ParsedScheduleGame | null => {
      const row = (item ?? {}) as Record<string, unknown>;
      const opponent = clampText(row.opponent, SCHEDULE_IMAGE_LIMITS.nameLength);
      if (!opponent) return null;

      const date = clampText(row.date, 10);
      const teamScore = score(row.teamScore);
      const opponentScore = score(row.opponentScore);
      // Both sides or neither: a lone score would be a phantom result.
      const played = teamScore !== undefined && opponentScore !== undefined;

      return {
        opponent,
        ...(ISO_DATE.test(date) ? { date } : {}),
        ...(typeof row.isHome === "boolean" ? { isHome: row.isHome } : {}),
        ...(played ? { teamScore, opponentScore } : {}),
      };
    })
    .filter((game): game is ParsedScheduleGame => game !== null);

  return { ...(subjectTeam ? { subjectTeam } : {}), games };
};
