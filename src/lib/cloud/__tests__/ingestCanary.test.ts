import { describe, expect, it } from "vitest";
import { ingestReading, ingestWord, ingestWords } from "../ingestCanary";

/*
 * Whether a night's answers still read as schedules (`ingestCanary.ts`): the share of the games
 * GameChanger listed that the import could file.
 */
const outcome = (read: number, ignored: number) => ({
  gamesAdded: 0,
  gamesUpdated: 0,
  gamesUnchanged: read,
  gamesOutOfSeason: 0,
  gamesIgnored: ignored,
});

describe("the ingest canary", () => {
  it("is quiet on a night that reads as usual, a few cancelled games among many", () => {
    const night = Array.from({ length: 100 }, () => outcome(28, 2));
    expect(ingestReading(night)).toEqual({ listed: 3000, read: 2800, drifted: false });
  });

  it("speaks when most of the games listed could not be filed", () => {
    const night = Array.from({ length: 100 }, () => outcome(3, 27));
    expect(ingestReading(night).drifted).toBe(true);
    expect(ingestWords(ingestReading(night))).toBe(
      "300 of 3000 games GameChanger listed could be filed (10.0%)"
    );
  });

  it("says nothing of a night that asked about a handful", () => {
    expect(ingestReading([outcome(0, 40)]).drifted).toBe(false);
  });

  it("counts every game filed, out of season included, as read", () => {
    const one = { ...outcome(0, 100), gamesAdded: 200, gamesUpdated: 150, gamesOutOfSeason: 50 };
    expect(ingestReading([one])).toEqual({ listed: 500, read: 400, drifted: false });
  });

  it("counts what a schedule listed that the reader could not read at all", () => {
    // GameChanger writes the opponent another way, and no entry reaches the import: every
    // schedule's 30 rows are dropped before it, and the outcomes alone read "fine 0/0".
    const night = Array.from({ length: 100 }, () => outcome(0, 0));
    const rows = night.map(() => 30);
    expect(ingestReading(night)).toEqual({ listed: 0, read: 0, drifted: false });
    expect(ingestReading(night, rows)).toEqual({ listed: 3000, read: 0, drifted: true });
  });

  it("takes the more of the rows and the import's count for each team", () => {
    // A schedule kept without its rows counts as the import saw it; one whose rows say fewer
    // than the import counted counts the import's.
    const [kept, short] = [outcome(28, 2), outcome(10, 0)];
    const rows = [0, 4];
    expect(ingestReading([kept, short], rows)).toEqual({ listed: 40, read: 38, drifted: false });
  });

  it("hands the alarm step its word, drift or fine, with the numbers", () => {
    expect(ingestWord({ listed: 3000, read: 300, drifted: true })).toBe("drift 300/3000");
    expect(ingestWord({ listed: 3000, read: 2800, drifted: false })).toBe("fine 2800/3000");
  });
});
