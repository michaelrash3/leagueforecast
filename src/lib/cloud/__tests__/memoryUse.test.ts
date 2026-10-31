import { describe, expect, it } from "vitest";
import { memoryFields, memoryUseOf, memoryWords } from "../memoryUse";

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
