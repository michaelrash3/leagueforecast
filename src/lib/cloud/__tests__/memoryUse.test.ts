import { describe, expect, it } from "vitest";
import {
  MEMORY_WARN_SHARE,
  memoryFields,
  memoryUseOf,
  memoryWord,
  memoryWords,
} from "../memoryUse";

/*
 * The memory a run on GitHub says it held (`memoryUse.ts`): what the process holds and the most it
 * has held, read as Node gives them, `rss` in bytes and `maxRSS` in kibibytes. The numbers are the
 * nightly's of 26 October 2026, "Memory at the end: 4238.2 MB (at most 4595.8 MB)".
 */
describe("the memory a run says it held", () => {
  const use = memoryUseOf(4_238_200_000, 4_488_086);

  it("reads the peak in kibibytes and says both in megabytes, as the nightly has", () => {
    expect(use).toEqual({ rss: 4_238_200_000, peak: 4_595_800_064 });
    expect(memoryWords(use)).toBe("4238.2 MB (at most 4595.8 MB)");
  });

  it("gives the same numbers for a JSON log line", () => {
    expect(memoryFields(use)).toEqual({ rssMb: 4238.2, peakMb: 4595.8 });
  });
});

/*
 * What the nightly hands its alarm (`memoryWord`): its peak against the most it may use, the heap
 * its NODE_OPTIONS give it (12,288 MiB, which Node 24 reads as a `heap_size_limit` of 13,086,228,480
 * bytes) or the machine's memory where that is less. The peak is the nightly's of 6 November 2026,
 * "at most 8077.1 MB", as maxRSS gives it in kibibytes.
 */
describe("the word the nightly hands its memory alarm", () => {
  const heap = 13_086_228_480;
  const runner = 16_000_000_000;

  it("is fine under three quarters of the heap, with the peak and the heap in megabytes", () => {
    expect(memoryWord(memoryUseOf(0, 7_887_793), heap, runner)).toBe("fine 8077/13086");
    expect(MEMORY_WARN_SHARE).toBe(0.75);
  });

  it("is near at three quarters to the byte and past it, and fine a byte under", () => {
    const line = MEMORY_WARN_SHARE * heap;
    expect(memoryWord({ rss: 0, peak: line }, heap, runner)).toBe("near 9815/13086");
    expect(memoryWord({ rss: 0, peak: line - 1 }, heap, runner)).toBe("fine 9815/13086");
    expect(memoryWord({ rss: 0, peak: 12_000_000_000 }, heap, runner)).toBe("near 12000/13086");
  });

  it("reads against the machine's memory where that is less than the heap", () => {
    expect(memoryWord({ rss: 0, peak: 6_500_000_000 }, heap, 8_000_000_000)).toBe("near 6500/8000");
    expect(memoryWord({ rss: 0, peak: 5_000_000_000 }, heap, 8_000_000_000)).toBe("fine 5000/8000");
  });

  it("says nothing where a limit or the peak is not a number", () => {
    expect(memoryWord({ rss: 0, peak: 1 }, 0, runner)).toBe("");
    expect(memoryWord({ rss: 0, peak: 1 }, Number.NaN, runner)).toBe("");
    expect(memoryWord({ rss: 0, peak: Number.NaN }, heap, runner)).toBe("");
  });
});
