import { describe, expect, it } from "vitest";
import type { MyTeamGlance } from "../myTeamGlance";
import { myTeamMoves, takeMyTeamLook } from "../myTeamLook";

/*
 * What moved for the club marked as yours between two visits: its places, record and rating, and
 * nothing when the club, the board or nothing at all changed. Placeholder names.
 */
const glance = (over: Partial<MyTeamGlance> = {}): MyTeamGlance => ({
  teamId: "S-ACE",
  teamName: "Aces",
  nationalRank: 120,
  nationalOf: 3000,
  listedOf: 2900,
  state: "OH",
  stateRank: 8,
  stateOf: 90,
  record: "12-3",
  rating: 1.2,
  ...over,
});

const DAY = 24 * 3_600_000;

describe("myTeamMoves", () => {
  it("tells the places, record and rating then and now", () => {
    const prev = takeMyTeamLook(0, glance(), "Fall");
    const now = takeMyTeamLook(
      2 * DAY,
      glance({ nationalRank: 98, stateRank: 6, record: "14-3", rating: 1.8 }),
      "Fall"
    );
    expect(myTeamMoves(prev, now)).toEqual({
      since: 0,
      national: { before: 120, now: 98 },
      state: { name: "OH", before: 8, now: 6 },
      record: { before: "12-3", now: "14-3" },
      rating: { before: 1.2, now: 1.8 },
    });
  });

  it("is nothing when nothing moved, a rating's jitter aside", () => {
    const prev = takeMyTeamLook(0, glance(), "Fall");
    expect(myTeamMoves(prev, takeMyTeamLook(DAY, glance({ rating: 1.23 }), "Fall"))).toBeNull();
    expect(myTeamMoves(prev, takeMyTeamLook(DAY, glance({ rating: 1.25 }), "Fall"))).not.toBeNull();
  });

  it("starts afresh on another board or another club", () => {
    const prev = takeMyTeamLook(0, glance(), "Fall");
    expect(
      myTeamMoves(prev, takeMyTeamLook(DAY, glance({ nationalRank: 5 }), "Spring"))
    ).toBeNull();
    expect(
      myTeamMoves(prev, takeMyTeamLook(DAY, glance({ teamId: "S-BEE", nationalRank: 5 }), "Fall"))
    ).toBeNull();
  });

  it("leaves the state out where it is not the same state both times", () => {
    const prev = takeMyTeamLook(0, glance({ state: "KY" }), undefined);
    const moves = myTeamMoves(prev, takeMyTeamLook(DAY, glance({ nationalRank: 99 }), undefined));
    expect(moves?.state).toBeUndefined();
    expect(moves?.national).toEqual({ before: 120, now: 99 });
  });
});
