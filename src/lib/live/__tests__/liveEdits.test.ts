import { describe, expect, it } from "vitest";
import type { PoolCommand } from "../commands";
import type { EditRefusal, QueryRefusal } from "../editRun";
import {
  EDIT_LOCKS,
  EDIT_REFUSED,
  editLock,
  myTeamShown,
  overlayCard,
  pendingOf,
  QUERY_REFUSED,
  settledBy,
} from "../liveEdits";
import type { ClubCard } from "../views/clubShape";

/*
 * A member's edits on the device (`liveEdits.ts`): which ones the page draws over the views it
 * reads, until when, and how a club's card reads with them. Placeholder names throughout.
 */

const CARD: ClubCard = {
  team: {
    id: "S-1",
    name: "Placeholder S-1",
    state: "OH",
    gcTeams: [
      { teamId: "gc-1", name: "Placeholder S-1", ageGroupId: "ag_12u_2027" },
      { teamId: "gc-2", name: "Placeholder S-1", ageGroupId: "ag_12u_2027" },
    ],
  },
  games: [],
  names: {},
  age: { level: 12 },
};
const REPLY = {
  ok: true as const,
  copy: "c0ffee",
  version: 7,
  inverse: { kind: "none" as const },
  changed: ["league_forecast_scout_teams_v1"],
  ms: { load: 1, apply: 1, commit: 1 },
};

describe("an edit the page draws over the views", () => {
  it("is one whose save changed what the views are built from, until views of its version are out", () => {
    const edit = pendingOf({ kind: "team.state", teamId: "S-1", state: "KY" }, REPLY);
    expect(edit).toEqual({
      command: { kind: "team.state", teamId: "S-1", state: "KY" },
      copy: "c0ffee",
      version: 7,
    });
    if (!edit) throw new Error("not drawn");
    expect(settledBy(edit, { id: "c0ffee", version: 6 })).toBe(false);
    expect(settledBy(edit, { id: "c0ffee", version: 7 })).toBe(true);
    expect(settledBy(edit, { id: "c0ffee", version: 9 })).toBe(true);
    // Views of another copy, one started again since, will never show it.
    expect(settledBy(edit, { id: "f00d", version: 1 })).toBe(true);
  });

  it("is none for a save that changed nothing the views read, since no rebuild follows it", () => {
    expect(
      pendingOf(
        { kind: "answers", list: "realClubs", add: ["gc-1"], remove: [] },
        { ...REPLY, changed: ["league_forecast_gc_real_clubs_v1"] }
      )
    ).toBeNull();
    expect(pendingOf({ kind: "none" }, { ...REPLY, changed: [] })).toBeNull();
  });
});

describe("a club's card with the edits made since it was published", () => {
  it("has the state, name and links each edit gave it, in the order made", () => {
    const shown = overlayCard(CARD, [
      { kind: "team.state", teamId: "S-1", state: "ky" },
      { kind: "team.rename", teamId: "S-1", name: "  Placeholder Q 12U " },
      { kind: "team.unlinkGc", teamId: "S-1", gcTeamId: "gc-1" },
      // Another club's edits leave it as it is.
      { kind: "team.rename", teamId: "S-9", name: "Elsewhere" },
    ]);
    expect(shown).toEqual({
      ...CARD,
      team: {
        id: "S-1",
        name: "Placeholder Q",
        state: "KY",
        gcTeams: [{ teamId: "gc-2", name: "Placeholder S-1", ageGroupId: "ag_12u_2027" }],
      },
    });
    expect(overlayCard(CARD, [{ kind: "team.state", teamId: "S-1", state: null }])).toMatchObject({
      team: { id: "S-1", name: "Placeholder S-1" },
    });
    const cleared = overlayCard(CARD, [{ kind: "team.state", teamId: "S-1", state: null }]);
    expect("team" in cleared && "state" in cleared.team).toBe(false);
  });

  it("has the level an age set gave it, held there, and the one it had once taken back", () => {
    const aged = overlayCard(CARD, [
      {
        kind: "club.age",
        year: 2027,
        teamId: "S-1",
        level: 13,
        at: "2027-04-15T12:00:00.000Z",
        pageId: "ag_new",
      },
    ]);
    expect(aged).toMatchObject({ age: { level: 13, pinned: { level: 13, was: 12 } } });
    if ("foldedInto" in aged) throw new Error("folded");
    expect(
      overlayCard(aged, [{ kind: "club.ageClear", year: 2027, teamId: "S-1", pageId: "ag_x" }])
    ).toMatchObject({ age: { level: 12 } });
    // Nothing to take back on a club with no age set by hand.
    expect(
      overlayCard(CARD, [{ kind: "club.ageClear", year: 2027, teamId: "S-1", pageId: "ag_x" }])
    ).toEqual(CARD);
  });

  it("has the age its Undo puts back: none set by hand, or the one set before", () => {
    const setAge: PoolCommand = {
      kind: "club.age",
      year: 2027,
      teamId: "S-1",
      level: 13,
      at: "2027-04-15T12:00:00.000Z",
      pageId: "ag_new",
    };
    // A first age set by hand, taken back: its teams' names forgotten, among the Undo's steps.
    const firstBack: PoolCommand = {
      kind: "batch",
      commands: [
        { kind: "team.put", team: CARD.team },
        { kind: "namedAges", put: [], forget: ["gc-1", "gc-2"] },
      ],
    };
    expect(overlayCard(CARD, [setAge, firstBack])).toEqual(CARD);
    // One set over another set before: that one put back, pinned as it was.
    const pinned: ClubCard = { ...CARD, age: { level: 11, pinned: { level: 11, was: 12 } } };
    const againBack: PoolCommand = {
      kind: "namedAges",
      put: [
        { teamId: "gc-1", level: 11, namedAt: "2027-04-01T00:00:00.000Z", pinned: true, was: 12 },
      ],
      forget: [],
    };
    expect(overlayCard(pinned, [setAge, againBack])).toMatchObject({
      age: { level: 11, pinned: { level: 11, was: 12 } },
    });
    // Another club's names leave this one as it is.
    const elsewhere: PoolCommand = { kind: "namedAges", put: [], forget: ["gc-9"] };
    expect(overlayCard(CARD, [setAge, elsewhere])).toMatchObject({
      age: { level: 13, pinned: { level: 13, was: 12 } },
    });
  });

  it("is the club it was folded into once folded, and itself when another was folded into it", () => {
    expect(
      overlayCard(CARD, [{ kind: "teams.merge", fromId: "S-1", intoId: "S-2", adopt: [] }])
    ).toEqual({ foldedInto: "S-2" });
    expect(
      overlayCard(CARD, [{ kind: "teams.merge", fromId: "S-3", intoId: "S-1", adopt: [] }])
    ).toEqual(CARD);
    // An edit in a batch is as an edit on its own.
    expect(
      overlayCard(CARD, [
        {
          kind: "batch",
          commands: [{ kind: "teams.merge", fromId: "S-1", intoId: "S-2", adopt: [] }],
        },
      ])
    ).toEqual({ foldedInto: "S-2" });
  });
});

describe("what the person is told", () => {
  it("says edits are off offline, and until the network has answered for the board", () => {
    expect(editLock({ offline: true, heard: true })).toBe(EDIT_LOCKS.offline);
    expect(editLock({ offline: false, heard: false })).toBe(EDIT_LOCKS.waiting);
    expect(editLock({ offline: false, heard: true })).toBeNull();
  });

  it("says edits are off over boards a newer version published, until the page is reloaded", () => {
    expect(editLock({ offline: false, heard: true, newer: true })).toBe(EDIT_LOCKS.newer);
    expect(EDIT_LOCKS.newer).toMatch(/reload/i);
    // Offline is said first: reloading would not bring the connection back.
    expect(editLock({ offline: true, heard: true, newer: true })).toBe(EDIT_LOCKS.offline);
    expect(editLock({ offline: false, heard: true, newer: false })).toBeNull();
  });

  it("says edits are off once the cloud has answered and no copy is known to make them on", () => {
    expect(editLock({ offline: false, heard: true, noCopy: true })).toBe(EDIT_LOCKS.noCopy);
    expect(EDIT_LOCKS.noCopy).toMatch(/reload/i);
    // Before the cloud answers the copy is not yet looked for; over a newer version's boards a
    // reload is what is wanted either way.
    expect(editLock({ offline: false, heard: false, noCopy: true })).toBe(EDIT_LOCKS.waiting);
    expect(editLock({ offline: false, heard: true, newer: true, noCopy: true })).toBe(
      EDIT_LOCKS.newer
    );
    expect(editLock({ offline: false, heard: true, noCopy: false })).toBeNull();
  });

  it("says edits are off once the page hands over, and with no reader of the cloud, whatever else holds", () => {
    for (const offline of [true, false])
      for (const heard of [true, false]) {
        expect(editLock({ handedOver: true, unlinked: true, offline, heard })).toBe(
          EDIT_LOCKS.handedOver
        );
        expect(editLock({ handedOver: false, unlinked: true, offline, heard })).toBe(
          EDIT_LOCKS.unlinked
        );
      }
  });

  it("names every reason an edit or a question is refused, and never says a refused edit may have been made but the one that may", () => {
    const refusals: EditRefusal[] = [
      "missing",
      "refused",
      "unsaved",
      "copy-replaced",
      "unsure",
      "kept-moving",
      "no-copy",
      "newer-schema",
      "newer-rules",
      "unknown-key",
      "damaged",
      "league-unreadable",
      "newer-league",
      "league-kept-live",
      "logged",
      "too-many",
      "store-refused",
    ];
    expect(Object.keys(EDIT_REFUSED).sort()).toEqual([...refusals].sort());
    for (const why of refusals) {
      expect([why, /may or may not/.test(EDIT_REFUSED[why])]).toEqual([why, why === "unsure"]);
    }
    const unanswered: QueryRefusal[] = [
      "copy-replaced",
      "no-copy",
      "newer-schema",
      "newer-rules",
      "unknown-key",
      "damaged",
      "league-unreadable",
      "newer-league",
      "store-refused",
      "kept-moving",
      "day-spent",
      "month-spent",
    ];
    expect(Object.keys(QUERY_REFUSED).sort()).toEqual([...unanswered].sort());
  });
});

describe("the page's own club as the edits not yet published leave it", () => {
  const PAGE = "ag_12u_2027";
  const pending = (...commands: PoolCommand[]) =>
    commands.map((command, at) => ({ command, copy: "c1", version: 5 + at }));
  const mark = (teamId: string | null, ageGroupId = PAGE): PoolCommand => ({
    kind: "page.myTeam",
    ageGroupId,
    teamId,
  });

  it("is the last mark made for the page, or the page's own as published", () => {
    expect(myTeamShown([], PAGE, "S-1")).toBe("S-1");
    expect(myTeamShown(pending(mark("S-2"), mark("S-3")), PAGE, "S-1")).toBe("S-3");
    expect(myTeamShown(pending(mark(null)), PAGE, "S-1")).toBeUndefined();
    // Another page's mark leaves this one's as it is.
    expect(myTeamShown(pending(mark("S-2", "ag_11u_2027")), PAGE, "S-1")).toBe("S-1");
  });

  it("is the page put back by the mark's Undo, inside a batch as an Undo sends it", () => {
    const back: PoolCommand = {
      kind: "batch",
      commands: [
        {
          kind: "group.put",
          group: {
            id: PAGE,
            name: "12U 2027",
            ageLevel: 12,
            year: 2027,
            seasonIds: [],
            myTeamId: "S-1",
          },
        },
      ],
    };
    expect(myTeamShown(pending(mark("S-2"), back), PAGE, "S-1")).toBe("S-1");
    const without: PoolCommand = {
      kind: "group.put",
      group: { id: PAGE, name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
    };
    expect(myTeamShown(pending(mark("S-2"), without), PAGE, "S-1")).toBeUndefined();
  });
});
