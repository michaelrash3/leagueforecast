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

/**
 * The share of the memory a run may use past which its alarm opens (`memoryWord`, `runAlarms.ts`):
 * three quarters. The nightly holds the whole pool at once, so its peak grows with the pool: 7,588.7
 * MB on 30 October 2026 and 8,077.1 MB on 6 November. Its heap is set at 12,288 MiB, which Node 24
 * reads as a `heap_size_limit` of 13,086.2 MB with the young generation, so three quarters is 9,814.7
 * MB: about three and a half weeks off at that week's growth, with a quarter of the heap still to
 * grow into when the issue opens. Time to make room before a night stops with its heap exhausted,
 * and the spring season's games will come faster than the autumn's.
 */
export const MEMORY_WARN_SHARE = 0.75;

/**
 * What the nightly hands its alarm of the memory it held: `near` at or past `MEMORY_WARN_SHARE` of
 * the most it may use and `fine` under it, then the peak and that most, in whole megabytes as its
 * log says them: "fine 8077/12885". The most it may use is the heap Node was given
 * (`heap_size_limit`) or the machine's memory where that is less, since past either the run stops.
 * The peak is the whole process's (`maxRSS`), which holds the heap and more besides, so reading it
 * against the heap alone errs toward opening early. Nothing for a limit that is not a number.
 */
export const memoryWord = (use: MemoryUse, heapLimit: number, machine: number): string => {
  const limit = Math.min(heapLimit, machine);
  if (!(limit > 0) || !Number.isFinite(limit) || !Number.isFinite(use.peak)) return "";
  const near = use.peak >= MEMORY_WARN_SHARE * limit;
  return `${near ? "near" : "fine"} ${Math.round(use.peak / 1_000_000)}/${Math.round(limit / 1_000_000)}`;
};

/** The same numbers as fields of a JSON log line, as the functions' logs are written. */
export const memoryFields = ({ rss, peak }: MemoryUse): { rssMb: number; peakMb: number } => ({
  rssMb: tenths(rss),
  peakMb: tenths(peak),
});
