import type { GcImportOutcome } from "../gameChangerImport";

/*
 * Whether a night's answers still read as schedules: the share of the games GameChanger listed that
 * the import could file at all. A game it cannot file (`gamesIgnored`) is a cancelled one, or one
 * missing the date a game is matched on; a change in how GameChanger writes a game reads as every
 * game missing it. The check of one known schedule (`verify-gc.yml`) catches a change in the score
 * fields; this catches one in the games themselves, across every answer of the night, read from
 * what the run already has.
 */

/** Fewer games listed than this say nothing either way: a night that asked about a handful. */
export const INGEST_MIN_LISTED = 500;

/**
 * Below this share read, the answers have stopped reading as schedules. A judgement, not a
 * measurement: cancelled games are a few in a hundred, and a format change takes nearly all of
 * them, so the line sits far from both.
 */
export const INGEST_READ_SHARE = 0.5;

export type IngestReading = { listed: number; read: number; drifted: boolean };

export const ingestReading = (
  outcomes: readonly Pick<
    GcImportOutcome,
    "gamesAdded" | "gamesUpdated" | "gamesUnchanged" | "gamesOutOfSeason" | "gamesIgnored"
  >[]
): IngestReading => {
  let read = 0;
  let ignored = 0;
  for (const outcome of outcomes) {
    read +=
      outcome.gamesAdded + outcome.gamesUpdated + outcome.gamesUnchanged + outcome.gamesOutOfSeason;
    ignored += outcome.gamesIgnored;
  }
  const listed = read + ignored;
  return {
    listed,
    read,
    drifted: listed >= INGEST_MIN_LISTED && read < listed * INGEST_READ_SHARE,
  };
};

/** The reading in words, for the run's log and the alarm issue. */
export const ingestWords = ({ listed, read }: IngestReading): string =>
  `${read} of ${listed} games GameChanger listed could be filed (${
    listed === 0 ? "0" : ((100 * read) / listed).toFixed(1)
  }%)`;

/** The reading as the nightly hands it to its alarm step: `drift` or `fine`, read of listed. */
export const ingestWord = ({ listed, read, drifted }: IngestReading): string =>
  `${drifted ? "drift" : "fine"} ${read}/${listed}`;
