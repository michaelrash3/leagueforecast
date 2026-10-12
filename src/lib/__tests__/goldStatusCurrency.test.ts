import { describe, expect, it } from "vitest";
import { getMathGoldStatus, rankTeams, simulateGoldOdds, standingsPoints } from "../sim";
import { DEFAULT_SETTINGS, type Settings, type Team } from "../types";
import { winPct } from "../format";

/**
 * The Clinched/Eliminated badge and the odds printed beside it have to be about the same race.
 *
 * Every consumer uses the same league-points currency. Fewer losses separates teams on equal
 * points before the configured score tiebreakers do.
 */
const team = (id: string, w: number, l: number, t = 0): Team =>
  ({
    id,
    name: id,
    w,
    l,
    t,
    rs: w * 6,
    ra: l * 6,
    games: w + l + t,
    pct: (w + t * 0.5) / Math.max(1, w + l + t),
    runDiff: (w - l) * 6,
    rank: 0,
    headToHead: {},
  }) as unknown as Team;

const settings: Settings = { ...DEFAULT_SETTINGS, goldCutoff: 1, winPoints: 2, tiePoints: 1 };
const ranked = (teams: Team[]) =>
  rankTeams(teams, {
    tiebreakerOrder: settings.tiebreakerOrder,
    winPoints: settings.winPoints,
    tiePoints: settings.tiePoints,
  });

describe("the badge and the odds beside it", () => {
  /*
   * Nothing left to play, so the club with the most league points takes the only Gold place and
   * the table, odds, and status badge must agree.
   */
  const table = ranked([team("Aces", 2, 0), team("Bears", 8, 8), team("Cubs", 1, 9)]);
  const counts = { Aces: 0, Bears: 0, Cubs: 0 };

  it("puts the team the odds give every season in, and the others out", () => {
    const odds = simulateGoldOdds(table, [], 200, "pin", settings.goldCutoff, settings);
    const status = (id: string) =>
      getMathGoldStatus(
        table.find((row) => row.id === id)!,
        table,
        counts,
        1,
        settings
      ).goldStatus;

    expect(odds).toEqual({ Aces: 0, Bears: 100, Cubs: 0 });
    expect(status("Aces")).toBe("Eliminated");
    expect(status("Bears")).toBe("Clinched");
    expect(status("Cubs")).toBe("Eliminated");
  });

  it("orders the table by the same points used by the postseason race", () => {
    expect(table.map((row) => row.id)).toEqual(["Bears", "Aces", "Cubs"]);
    expect(table.map((row) => standingsPoints(row, settings))).toEqual([16, 4, 2]);
  });
});

describe("the PCT a team can still finish on", () => {
  it("narrows from both ends as the games are played", () => {
    const side = team("Aces", 4, 2);
    const four = getMathGoldStatus(side, [side], { Aces: 4 }, 1, settings);
    // Best case 8-2 of ten, worst case 4-6 of ten.
    expect(four.maxPct).toBeCloseTo(0.8, 10);
    expect(four.minPct).toBeCloseTo(0.4, 10);

    const none = getMathGoldStatus(side, [side], { Aces: 0 }, 1, settings);
    // Nothing left: the two ends meet at the PCT the table already shows.
    expect(none.maxPct).toBeCloseTo(side.pct, 10);
    expect(none.minPct).toBeCloseTo(side.pct, 10);
  });

  it("counts a tie as half a win, exactly as the PCT it is bounding does", () => {
    // 4-2-4 of ten: credited 6 of 10, and the table already shows .600 with nothing left.
    const tied = team("Aces", 4, 2, 4);
    const bounds = getMathGoldStatus(tied, [tied], { Aces: 0 }, 1, settings);

    expect(tied.pct).toBeCloseTo(0.6, 10);
    expect(bounds.maxPct).toBeCloseTo(0.6, 10);
    expect(bounds.minPct).toBeCloseTo(0.6, 10);

    // And with four still to play: best 8-2-4 of fourteen, worst 4-6-4 of fourteen.
    const live = getMathGoldStatus(tied, [tied], { Aces: 4 }, 1, settings);
    expect(live.maxPct).toBeCloseTo(10 / 14, 10);
    expect(live.minPct).toBeCloseTo(6 / 14, 10);
  });

  it("is a whole season for a team that has not played", () => {
    const fresh = team("Aces", 0, 0);
    const bounds = getMathGoldStatus(fresh, [fresh], { Aces: 10 }, 1, settings);

    expect(bounds.maxPct).toBe(1);
    expect(bounds.minPct).toBe(0);
  });

  it("is nothing at all for a team with no season", () => {
    const fresh = team("Aces", 0, 0);
    const bounds = getMathGoldStatus(fresh, [fresh], { Aces: 0 }, 1, settings);

    expect(bounds.maxPct).toBe(0);
    expect(bounds.minPct).toBe(0);
  });
});

describe("mid-season, with the games played unequal", () => {
  /*
   * The ordinary shape: one team has played ten and another six. Earned league points determine
   * their current order while remaining games determine what can still change.
   */
  const table = ranked([team("Aces", 6, 4), team("Bears", 5, 1), team("Cubs", 1, 7)]);
  const counts = { Aces: 0, Bears: 4, Cubs: 2 };
  const status = (id: string) =>
    getMathGoldStatus(
      table.find((row) => row.id === id)!,
      table,
      counts,
      2,
      settings
    );

  it("does not call a team eliminated that the table has inside the cut", () => {
    expect(table.slice(0, 2).map((row) => row.id)).toEqual(["Aces", "Bears"]);
    expect(status("Bears").goldStatus).not.toBe("Eliminated");
    expect(status("Aces").goldStatus).not.toBe("Eliminated");
  });

  it("counts a blocker only when it cannot finish below", () => {
    // Bears' floor is 5/10 = .500; Aces' ceiling is 6/10 = .600. Bears cannot block Aces.
    expect(status("Aces").blockersAhead).toBe(0);
    // Cubs can reach 3/10 = .300 at best, which is below Aces' floor of .600.
    expect(status("Cubs").blockersAhead).toBe(2);
    expect(status("Cubs").goldStatus).toBe("Eliminated");
  });
});

describe("winPct", () => {
  it("writes a percentage the way a standings table does", () => {
    expect(winPct(0.8333)).toBe(".833");
    expect(winPct(0.5)).toBe(".500");
    expect(winPct(0)).toBe(".000");
    expect(winPct(1)).toBe("1.000");
  });
});
