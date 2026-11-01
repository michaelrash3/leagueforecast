import { describe, expect, it, vi } from "vitest";
import { rememberUpTo } from "../rememberUpTo";

describe("a calculation that remembers up to so many answers", () => {
  it("works each key out once while it is held", () => {
    const work = vi.fn((name: string) => name.toLowerCase());
    const remembered = rememberUpTo(3, work);
    expect(["Aces", "Bears", "Aces", "Aces", "Bears"].map(remembered)).toEqual([
      "aces",
      "bears",
      "aces",
      "aces",
      "bears",
    ]);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("lets go of every answer once it holds as many as it may, and starts again", () => {
    const work = vi.fn((name: string) => name.toLowerCase());
    const remembered = rememberUpTo(3, work);
    ["Aces", "Bears", "Comets"].forEach(remembered);
    expect(work).toHaveBeenCalledTimes(3);
    // Full: a fourth key empties it before it is kept, so what it holds never passes three.
    expect(remembered("Ducks")).toBe("ducks");
    expect(work).toHaveBeenCalledTimes(4);
    // The first three went with the rest and are worked out again; the fourth is still held.
    expect(remembered("Ducks")).toBe("ducks");
    expect(remembered("Aces")).toBe("aces");
    expect(work).toHaveBeenCalledTimes(5);
  });

  it("remembers an answer that is the empty string", () => {
    const work = vi.fn(() => "");
    const remembered = rememberUpTo(3, work);
    remembered(" ");
    remembered(" ");
    expect(work).toHaveBeenCalledTimes(1);
  });
});
