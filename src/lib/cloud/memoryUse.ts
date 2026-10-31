/*
 * The memory a run says it held in its log: what the process holds now (`process.memoryUsage()`'s
 * `rss`) and the most it has held (`process.resourceUsage()`'s `maxRSS`), the whole process's, a
 * leg's worker thread included. The nightly said it once, at its end, and the boards' publish and a
 * pull's leg on GitHub never: the nightly peaked at 7,588.7 MB on 30 October 2026, its heap 12,288
 * MB, and nothing showed which step took it there.
 */

/** What a process holds, and the most it has held, in bytes. */
export type MemoryUse = { rss: number; peak: number };

/** As Node gives them: the resident set in bytes, and its peak in kibibytes. */
export const memoryUseOf = (rss: number, maxRssKiB: number): MemoryUse => ({
  rss,
  peak: maxRssKiB * 1024,
});

/** In megabytes to a tenth, as the nightly has said its memory: "4238.2 MB (at most 4595.8 MB)". */
export const memoryWords = ({ rss, peak }: MemoryUse): string =>
  `${(rss / 1_000_000).toFixed(1)} MB (at most ${(peak / 1_000_000).toFixed(1)} MB)`;

const tenths = (bytes: number): number => Math.round(bytes / 100_000) / 10;

/** The same numbers as fields of a JSON log line, as the functions' logs are written. */
export const memoryFields = ({ rss, peak }: MemoryUse): { rssMb: number; peakMb: number } => ({
  rssMb: tenths(rss),
  peakMb: tenths(peak),
});
