import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MyTeamGlance } from "../myTeamGlance";
import { myTeamMoves, readMyTeamLook, saveMyTeamLook, takeMyTeamLook } from "../myTeamLook";

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

describe("the looks kept on this device", () => {
  // These tests run in Node, which has no browser storage: a map stands in for it.
  const kept = new Map<string, string>();
  beforeEach(() => {
    kept.clear();
    vi.stubGlobal("window", {
      localStorage: {
        get length() {
          return kept.size;
        },
        key: (at: number) => [...kept.keys()][at] ?? null,
        getItem: (key: string) => kept.get(key) ?? null,
        setItem: (key: string, value: string) => void kept.set(key, value),
        removeItem: (key: string) => void kept.delete(key),
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const looks = () => [...kept.keys()].filter((key) => key.startsWith("lf_my_team_look_v1_"));

  /*
   * One look a club, never removed, so a browser that marked a club its own each season for years
   * kept every one. Kept now for the clubs looked at last only.
   */
  it("keeps the clubs looked at last, a dozen of them, and lets the rest go", () => {
    kept.set("lf_other_key", "kept");
    for (let n = 1; n <= 13; n += 1)
      saveMyTeamLook(takeMyTeamLook(n * DAY, glance({ teamId: `S-${n}` }), "Fall"));
    expect(looks()).toHaveLength(12);
    expect(readMyTeamLook("S-1")).toBeNull();
    expect(readMyTeamLook("S-2")).toMatchObject({ at: 2 * DAY });
    expect(readMyTeamLook("S-13")).toMatchObject({ at: 13 * DAY });
    expect(kept.get("lf_other_key")).toBe("kept");

    // A club looked at again is still one look, and the one saved stays whatever its time.
    saveMyTeamLook(takeMyTeamLook(0, glance({ teamId: "S-5" }), "Fall"));
    expect(looks()).toHaveLength(12);
    expect(readMyTeamLook("S-5")).toMatchObject({ at: 0 });
    // An unreadable look goes before the oldest one that reads.
    kept.set("lf_my_team_look_v1_S-X", "{not json");
    saveMyTeamLook(takeMyTeamLook(5 * DAY, glance({ teamId: "S-5" }), "Fall"));
    expect(looks()).toHaveLength(12);
    expect(kept.has("lf_my_team_look_v1_S-X")).toBe(false);
    expect(readMyTeamLook("S-2")).toMatchObject({ at: 2 * DAY });
  });

  /*
   * A look is kept with a GameChanger id the club carried (`MyTeamGlance.gcIds`, the page's own
   * team first), and read by it (`readClub`): one kept under an id since given to another club is
   * none of this club's, and one kept under another id of a team the club carries now (a club
   * folded into it, or itself before Team Rankings started again) is its own.
   */
  it("keeps a GameChanger id the club carries with each look", () => {
    expect(takeMyTeamLook(0, glance({ gcIds: ["gcAces001", "gcAces002"] }), "Fall")).toMatchObject({
      teamId: "S-ACE",
      gc: "gcAces001",
    });
    expect(takeMyTeamLook(0, glance(), "Fall")).not.toHaveProperty("gc");
  });

  it("never reads another club's look as this club's, under an id since given to it", () => {
    saveMyTeamLook(takeMyTeamLook(DAY, glance({ gcIds: ["gcOldAces"] }), "Fall"));
    // The look kept reads as it is with nothing known of the club's ids, as every look did.
    expect(readMyTeamLook("S-ACE")).toMatchObject({ at: DAY, gc: "gcOldAces" });
    // S-ACE is another club now, carrying another team: it has no look yet.
    expect(readMyTeamLook("S-ACE", ["gcNewAces"])).toBeNull();
    expect(readMyTeamLook("S-ACE", ["gcOldAces", "gcNewAces"])).toMatchObject({ at: DAY });
  });

  it("follows a look kept under another id of a team the club carries now", () => {
    // Kept for a club since folded into S-ACE, or for S-ACE itself before a start again.
    saveMyTeamLook(
      takeMyTeamLook(
        DAY,
        glance({ teamId: "S-OLD", gcIds: ["gcAcesGld"], nationalRank: 140 }),
        "Fall"
      )
    );
    saveMyTeamLook(
      takeMyTeamLook(2 * DAY, glance({ teamId: "S-ZED", gcIds: ["gcZebras1"] }), "Fall")
    );
    const prev = readMyTeamLook("S-ACE", ["gcAces001", "gcAcesGld"]);
    expect(prev).toMatchObject({ teamId: "S-ACE", at: DAY, national: 140, gc: "gcAcesGld" });
    // So what moved is told of the club as it is now.
    const now = takeMyTeamLook(3 * DAY, glance({ gcIds: ["gcAces001", "gcAcesGld"] }), "Fall");
    expect(prev && myTeamMoves(prev, now)?.national).toEqual({ before: 140, now: 120 });
    // Of two clubs folded into it, the newer look is the one compared with.
    saveMyTeamLook(
      takeMyTeamLook(
        2 * DAY,
        glance({ teamId: "S-OLD2", gcIds: ["gcAces001"], nationalRank: 130 }),
        "Fall"
      )
    );
    expect(readMyTeamLook("S-ACE", ["gcAces001", "gcAcesGld"])).toMatchObject({
      at: 2 * DAY,
      national: 130,
    });
    // Its own look, where it has one, comes first.
    saveMyTeamLook(takeMyTeamLook(4 * DAY, glance({ gcIds: ["gcAces001"] }), "Fall"));
    expect(readMyTeamLook("S-ACE", ["gcAces001", "gcAcesGld"])).toMatchObject({ at: 4 * DAY });
  });

  it("reads a look kept with no GameChanger id as it always did, and follows none", () => {
    saveMyTeamLook(takeMyTeamLook(DAY, glance(), "Fall"));
    saveMyTeamLook(takeMyTeamLook(DAY, glance({ teamId: "S-OLD" }), "Fall"));
    expect(readMyTeamLook("S-ACE", ["gcAces001"])).toMatchObject({ teamId: "S-ACE", at: DAY });
    expect(readMyTeamLook("S-NEW", ["gcAces001"])).toBeNull();
    // One kept with a GameChanger id that is not text is not a look.
    kept.set(
      "lf_my_team_look_v1_S-ACE",
      JSON.stringify({ ...takeMyTeamLook(DAY, glance(), "Fall"), gc: 7 })
    );
    expect(readMyTeamLook("S-ACE")).toBeNull();
  });
});
