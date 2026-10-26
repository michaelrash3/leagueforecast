import { describe, expect, it } from "vitest";
import { nextWeekendOpponents, weekEndingSunday } from "../nextWeekend";

/*
 * "Add our next opponents" on the Tournament field: the report team's next playing weekend, not
 * every game left on its schedule, which put the whole rest of the season in one weekend's field.
 */
const row = (opponentId: string, date: string) => ({
  gameId: `${opponentId}-${date}`,
  date,
  opponentId,
  opponentName: opponentId,
});

describe("a weekend", () => {
  it("is the week ending on its Sunday, so Friday to Sunday are one", () => {
    expect(weekEndingSunday("2026-10-30")).toBe("2026-11-01");
    expect(weekEndingSunday("2026-11-01")).toBe("2026-11-01");
    expect(weekEndingSunday("2026-11-02")).toBe("2026-11-08");
    expect(weekEndingSunday("")).toBeUndefined();
  });
});

describe("our next opponents", () => {
  it("are the clubs of the first weekend with a game on it, each once", () => {
    const upcoming = [
      row("Later", "2026-11-07"),
      row("Friday", "2026-10-30"),
      row("Sunday", "2026-11-01"),
      row("Friday", "2026-10-31"),
      row("Undated", ""),
    ];
    expect(nextWeekendOpponents(upcoming)).toEqual(["Friday", "Sunday"]);
  });

  it("are every undated club only where nothing is dated", () => {
    expect(nextWeekendOpponents([row("A", ""), row("B", ""), row("A", "")])).toEqual(["A", "B"]);
    expect(nextWeekendOpponents([])).toEqual([]);
  });
});
