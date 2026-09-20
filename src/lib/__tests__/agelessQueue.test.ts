import { describe, expect, it } from "vitest";
import { AGELESS_BATCH, agelessBatch, agelessWaiting, batchIds } from "../agelessQueue";
import type { AgeUnknownList } from "../ageUnknown";
import { nameAge } from "../namedAges";
import { forgetClubs } from "../deletedGames";
import type { AgelessEvidence } from "../agelessEvidence";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 86_400_000;
const daysBefore = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

const evidence = (extra: Partial<AgelessEvidence> = {}): AgelessEvidence => ({
  games: 4,
  scored: 4,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 4,
  namedAnAge: 0,
  tally: [],
  ...extra,
});

const team = (id: string, extra: Partial<AgeUnknownList[number]> = {}) => ({
  teamId: id,
  firstSeen: daysBefore(20),
  lastTried: daysBefore(10),
  tries: 1,
  ...extra,
});

/** Twelve waiting teams, so the batch has to bite. */
const many = (): AgeUnknownList =>
  Array.from({ length: 12 }, (_, i) => team(`T${i}`, { evidence: evidence() }));

describe("the queue of teams waiting on an answer", () => {
  it("hands over ten at a time and no more", () => {
    const waiting = agelessWaiting(many(), new Map(), new Set(), NOW);
    expect(waiting).toHaveLength(12);
    expect(agelessBatch(waiting, [])).toHaveLength(AGELESS_BATCH);
  });

  it("puts the ones that look invented first", () => {
    const list: AgeUnknownList = [
      team("honest", { evidence: evidence() }),
      // Every game scored on a day that has not happened, all of them shutout blowouts.
      team("invented", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 2 }),
      }),
      team("also-honest", { evidence: evidence() }),
    ];
    expect(batchIds(agelessWaiting(list, new Map(), new Set(), NOW))[0]).toBe("invented");
  });

  it("breaks a tie on the stalest, so the same rows do not park at the top", () => {
    const list: AgeUnknownList = [
      team("fresh", { lastTried: daysBefore(1), evidence: evidence() }),
      team("stale", { lastTried: daysBefore(40), evidence: evidence() }),
    ];
    expect(batchIds(agelessWaiting(list, new Map(), new Set(), NOW))).toEqual(["stale", "fresh"]);
  });

  it("drops a team the moment somebody answers for it", () => {
    const list = many();
    const named = nameAge(new Map(), { teamId: "T0", level: 9, namedAt: NOW.toISOString() });
    const thrownOut = forgetClubs(new Set<string>(), ["T1"]);

    const waiting = agelessWaiting(list, named, thrownOut, NOW);
    expect(batchIds(waiting)).not.toContain("T0");
    expect(batchIds(waiting)).not.toContain("T1");
    expect(waiting).toHaveLength(10);
  });

  /*
   * The whole point of pinning. A list that reshuffles as each row is answered means looking away
   * and back to find everything somewhere else — so the ten stay the ten, shrinking as they are
   * worked, and the next ten arrive only once the last of them is done.
   */
  it("keeps the same ten while they are being worked", () => {
    const list = many();
    const first = agelessBatch(agelessWaiting(list, new Map(), new Set(), NOW), []);
    const pinned = batchIds(first);

    // Answer three of them. The other seven are unchanged and nothing slides in behind.
    const named = pinned
      .slice(0, 3)
      .reduce(
        (acc, id) => nameAge(acc, { teamId: id, level: 9, namedAt: NOW.toISOString() }),
        new Map()
      );
    const after = agelessBatch(agelessWaiting(list, named, new Set(), NOW), pinned);

    expect(batchIds(after)).toEqual(pinned.slice(3));
    expect(batchIds(after)).toHaveLength(7);
  });

  it("brings up the next ten once the last of the batch is answered", () => {
    const list = many();
    const pinned = batchIds(agelessBatch(agelessWaiting(list, new Map(), new Set(), NOW), []));
    const allAnswered = pinned.reduce(
      (acc, id) => nameAge(acc, { teamId: id, level: 9, namedAt: NOW.toISOString() }),
      new Map()
    );

    const next = agelessBatch(agelessWaiting(list, allAnswered, new Set(), NOW), pinned);
    expect(next).toHaveLength(2);
    expect(batchIds(next).some((id) => pinned.includes(id))).toBe(false);
  });

  it("leaves out a team nobody is being asked about any more", () => {
    // Spent both its asks and its weeks, so it is not somebody's to answer today.
    const list: AgeUnknownList = [
      team("spent", { tries: 8, firstSeen: daysBefore(90), evidence: evidence() }),
      team("live", { evidence: evidence() }),
    ];
    expect(batchIds(agelessWaiting(list, new Map(), new Set(), NOW))).toEqual(["live"]);
  });

  it("says something honest about a team nothing was kept for", () => {
    const [row] = agelessWaiting([team("bare")], new Map(), new Set(), NOW);
    expect(row?.why).toMatch(/Nothing was kept about this one/);
    expect(row?.invented).toBe(0);
  });
});
