import { describe, expect, it } from "vitest";
import { closedLevelLine, shortDay } from "../closedLevelWords";
import type { ClosedLevelCheck } from "../scoutBacktest";

/** Four weeks to Sunday 11 October 2026, with nothing read yet. */
const empty: ClosedLevelCheck = {
  held: -1.6,
  level: null,
  standardError: null,
  games: 0,
  clusters: 0,
  weeks: [
    { from: "2026-09-14", to: "2026-09-20", games: 0, level: null },
    { from: "2026-09-21", to: "2026-09-27", games: 0, level: null },
    { from: "2026-09-28", to: "2026-10-04", games: 0, level: null },
    { from: "2026-10-05", to: "2026-10-11", games: 0, level: null },
  ],
  paired: null,
  better: false,
};

describe("the Model check card's line on where a rating starts", () => {
  it("says the weeks could not read it when they hold no games between leagues", () => {
    expect(closedLevelLine(empty)).toBe(
      "Starting level for leagues with few outside games: held at −1.6; the four weeks to 11 Oct had too few games between leagues to read it again."
    );
  });

  it("gives no spread it could not measure, and no verdict on too few games", () => {
    const thin: ClosedLevelCheck = {
      ...empty,
      level: 0.004,
      games: 12,
      clusters: 1,
      paired: { by: 0.01, standardError: 0.02, samples: 12 },
    };
    expect(closedLevelLine(thin)).toBe(
      "Starting level for leagues with few outside games: held at −1.6; the four weeks to 11 Oct read 0.00 on 12 games; too few games to judge."
    );
  });

  it("reads a day as the card says it", () => {
    expect(shortDay("2026-10-11")).toBe("11 Oct");
    expect(shortDay("2027-01-04")).toBe("4 Jan");
    expect(shortDay("soon")).toBe("soon");
  });
});
