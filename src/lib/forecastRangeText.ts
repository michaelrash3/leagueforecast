import type { RunSpan } from "./forecastRange";

/*
 * A forecast's range in words (2.10), apart from the numbers (`forecastRange.ts`) so that only the
 * views that show it carry it: the engine that works it out is in the page's first download.
 */

/**
 * A margin span, team A's margin from its side, in words. Across zero it runs from the underdog's
 * end to the favorite's (the side with the longer reach), so the same game read from the other side
 * says the same thing; on one side of zero it is that side's two margins, the nearer first.
 */
export const marginSpanText = (
  { low, high }: RunSpan,
  { teamA, teamB }: { teamA: string; teamB: string }
): string => {
  if (low >= 0) return low === 0 ? `a tie to ${teamA} by ${high}` : `${teamA} by ${low} to ${high}`;
  if (high <= 0)
    return high === 0 ? `a tie to ${teamB} by ${-low}` : `${teamB} by ${-high} to ${-low}`;
  if (high === -low) return `either side by up to ${high}`;
  return high > -low
    ? `${teamB} by ${-low} to ${teamA} by ${high}`
    : `${teamA} by ${high} to ${teamB} by ${-low}`;
};

/** One side's runs: "0–13". */
export const runSpanText = ({ low, high }: RunSpan): string =>
  low === high ? `${low}` : `${low}–${high}`;
