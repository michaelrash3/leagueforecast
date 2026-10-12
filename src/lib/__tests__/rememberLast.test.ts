import { describe, expect, it, vi } from "vitest";
import { rememberLast } from "../rememberLast";

describe("a calculation that remembers its last answer", () => {
  it("answers the same arguments from memory, and new ones afresh", () => {
    const work = vi.fn((list: number[], by: number) => list.map((value) => value * by));
    const remembered = rememberLast(work);
    const season = [1, 2, 3];
    const first = remembered(season, 2);
    expect(remembered(season, 2)).toBe(first);
    expect(work).toHaveBeenCalledTimes(1);

    // An equal list that is a new one is a new season: its parts keep their identity until they
    // change, so a new one has changed.
    expect(remembered([1, 2, 3], 2)).toEqual(first);
    expect(work).toHaveBeenCalledTimes(2);
    remembered(season, 3);
    expect(work).toHaveBeenCalledTimes(3);
  });

  it("keeps one answer, the last", () => {
    const work = vi.fn((value: string) => value.toUpperCase());
    const remembered = rememberLast(work);
    remembered("a");
    remembered("b");
    remembered("a");
    expect(work).toHaveBeenCalledTimes(3);
  });
});
