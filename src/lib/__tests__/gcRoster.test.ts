import { describe, expect, it } from "vitest";
import listCsv from "./fixtures/gc-team-list-rich.csv?raw";
import { parseGcTeamList } from "../gameChangerApi";
import {
  describeRoster,
  MIN_REAL_ROSTER,
  RECHECK_AFTER_DAYS,
  rosterChanges,
  rosterStanding,
  rosterWatchList,
} from "../gcRoster";

const DAY = 86_400_000;
const NOW = Date.parse("2026-09-16T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * DAY).toISOString();

describe("whether a page is a team", () => {
  it("counts nine as a team and eight as not one yet", () => {
    expect(rosterStanding(MIN_REAL_ROSTER)).toBe("full");
    expect(rosterStanding(MIN_REAL_ROSTER - 1)).toBe("short");
  });

  it("does not mistake an unknown count for an empty one", () => {
    // Most of the roster is not known: a team pulled by id says nothing about how many play for it.
    expect(rosterStanding(undefined)).toBe("unknown");
    expect(describeRoster(undefined)).toBeNull();
  });

  it("says nothing about a team with a full roster", () => {
    expect(describeRoster(14)).toBeNull();
  });

  it("says why a short roster is worth a second look", () => {
    expect(describeRoster(2)).toMatch(/takes 9 to field a side/);
  });

  it("reads the real export the same way", () => {
    const { entries } = parseGcTeamList(listCsv);
    const short = entries.filter((entry) => rosterStanding(entry.playerCount) === "short");
    // Two two-player and six-player pages among eight real rows; the rest are teams.
    expect(short.map((entry) => entry.playerCount).sort()).toEqual([2, 6, 6]);
  });
});

describe("the teams worth asking about again", () => {
  it("lists only the under-strength ones", () => {
    const watch = rosterWatchList(
      [
        { teamId: "full", playerCount: 12 },
        { teamId: "short", playerCount: 6 },
        { teamId: "unknown" },
      ],
      NOW
    );
    expect(watch.map((entry) => entry.teamId)).toEqual(["short"]);
  });

  it("leaves a team alone until enough time has passed", () => {
    const watch = rosterWatchList(
      [
        { teamId: "just-counted", playerCount: 6, countedAt: daysAgo(1) },
        { teamId: "long-ago", playerCount: 6, countedAt: daysAgo(RECHECK_AFTER_DAYS + 1) },
      ],
      NOW
    );
    // Asking again today about a count taken today is asking the same export the same question.
    expect(watch.find((entry) => entry.teamId === "just-counted")?.due).toBe(false);
    expect(watch.find((entry) => entry.teamId === "long-ago")?.due).toBe(true);
  });

  it("asks straight away about one never counted", () => {
    const [entry] = rosterWatchList([{ teamId: "new", playerCount: 4 }], NOW);
    expect(entry?.due).toBe(true);
  });

  it("treats an unreadable date as never counted", () => {
    const [entry] = rosterWatchList([{ teamId: "odd", playerCount: 4, countedAt: "soon" }], NOW);
    expect(entry?.due).toBe(true);
  });

  it("puts the due ones first and the emptiest of those first", () => {
    const watch = rosterWatchList(
      [
        { teamId: "due-6", playerCount: 6 },
        { teamId: "waiting", playerCount: 2, countedAt: daysAgo(1) },
        { teamId: "due-2", playerCount: 2 },
      ],
      NOW
    );
    // The two-player pages are the least likely ever to become teams, so they are asked about first.
    expect(watch.map((entry) => entry.teamId)).toEqual(["due-2", "due-6", "waiting"]);
  });

  it("honours a different waiting period", () => {
    const teams = [{ teamId: "a", playerCount: 5, countedAt: daysAgo(3) }];
    expect(rosterWatchList(teams, NOW, 2)[0]?.due).toBe(true);
    expect(rosterWatchList(teams, NOW, 30)[0]?.due).toBe(false);
  });
});

describe("what the next count says", () => {
  it("notices a squad that was being assembled", () => {
    // Six in September, twelve in October: it was a real team all along.
    const changes = rosterChanges(
      [{ teamId: "drillers", playerCount: 6 }],
      [{ teamId: "drillers", playerCount: 12 }]
    );
    expect(changes).toEqual([{ teamId: "drillers", was: 6, now: 12, becameReal: true }]);
  });

  it("reports a roster that grew but is still short", () => {
    const [change] = rosterChanges(
      [{ teamId: "a", playerCount: 4 }],
      [{ teamId: "a", playerCount: 7 }]
    );
    expect(change?.becameReal).toBe(false);
  });

  it("reports a page being emptied, which is its own answer", () => {
    const [change] = rosterChanges(
      [{ teamId: "a", playerCount: 12 }],
      [{ teamId: "a", playerCount: 3 }]
    );
    expect(change).toEqual({ teamId: "a", was: 12, now: 3, becameReal: false });
  });

  it("says nothing about a count that did not move", () => {
    expect(
      rosterChanges([{ teamId: "a", playerCount: 6 }], [{ teamId: "a", playerCount: 6 }])
    ).toEqual([]);
  });

  it("says nothing about a team it has no earlier count for", () => {
    expect(rosterChanges([], [{ teamId: "new", playerCount: 12 }])).toEqual([]);
  });

  it("says nothing when the later count is missing", () => {
    expect(rosterChanges([{ teamId: "a", playerCount: 6 }], [{ teamId: "a" }])).toEqual([]);
  });
});
