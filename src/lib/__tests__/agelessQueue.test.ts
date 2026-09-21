import { describe, expect, it } from "vitest";
import {
  AGELESS_BATCH,
  agelessBatch,
  agelessSearch,
  agelessWaiting,
  batchIds,
} from "../agelessQueue";
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

  it("stops asking a person about a team whose name says a high school squad", () => {
    // These went on the list before a school squad was refused outright. There is nothing to
    // investigate — the name settles it — so they cost none of the ten. They stay on the list, so
    // the next ask comes back "high school" and retires the entry on its own.
    const list: AgeUnknownList = [
      team("varsity", { name: "Lincoln HS Varsity", evidence: evidence() }),
      team("jv", { name: "Oak Grove JV", evidence: evidence() }),
      team("hs", { name: "Northside High School", evidence: evidence() }),
      team("real", { name: "Mears 1 - 2026", evidence: evidence() }),
    ];
    expect(batchIds(agelessWaiting(list, new Map(), new Set(), NOW))).toEqual(["real"]);
  });

  it("keeps a lone V in front of a person, first, and says what to look for", () => {
    /*
     * The opposite case, and the reason it is not folded into the one above. A lone "V" really is
     * a question a person has to settle: on a school schedule it is the varsity side, and it is
     * equally a squad number, a colour or an initial. So it stays on the queue, it comes first
     * because it is answerable by opening one page, and it carries the reason.
     */
    const list: AgeUnknownList = [
      // Ranked above it on looksInvented alone: every game scored on a day that has not happened.
      team("junk", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 2 }),
      }),
      team("loneV", { name: "Madison V", evidence: evidence() }),
    ];
    const waiting = agelessWaiting(list, new Map(), new Set(), NOW);
    expect(batchIds(waiting)).toEqual(["loneV", "junk"]);
    expect(waiting[0]?.hint).toContain("varsity");
    expect(waiting[1]?.hint).toBeUndefined();
  });

  it("does not call a JV/V a question, because the JV says what the V is", () => {
    const list: AgeUnknownList = [team("pair", { name: "Madison JV/V", evidence: evidence() })];
    expect(agelessWaiting(list, new Map(), new Set(), NOW)).toEqual([]);
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

/**
 * Hunting one club among thirty thousand.
 *
 * The queue is the small end of the list, and "I know this club is in here" is very often a team
 * the queue is deliberately not showing: answered months ago, refused, or left alone. A search
 * that read only the queue would answer "no such team" to the one question it exists for, so
 * these guard the whole-list reading rather than the filtering.
 */
describe("finding one team by name or id", () => {
  const list = (): AgeUnknownList => [
    team("ID-AAA", { name: "Mears 1 - 2026", evidence: evidence() }),
    team("ID-BBB", { name: "Northside Nationals", evidence: evidence() }),
    team("ID-CCC", { name: "Mirror Lake 2 2026", evidence: evidence() }),
  ];

  it("matches on the name, however it is cased", () => {
    expect(agelessSearch(list(), new Map(), new Set(), NOW, "mears").total).toBe(1);
    expect(agelessSearch(list(), new Map(), new Set(), NOW, "MEARS").total).toBe(1);
    // Part of a word is enough: nobody types a club's whole name to find it.
    expect(agelessSearch(list(), new Map(), new Set(), NOW, "2026").total).toBe(2);
  });

  it("matches on the GameChanger id, which is what somebody pastes", () => {
    const { hits } = agelessSearch(list(), new Map(), new Set(), NOW, "id-bbb");
    expect(hits.map((hit) => hit.row.entry.teamId)).toEqual(["ID-BBB"]);
  });

  it("finds nothing for an empty search rather than everything", () => {
    expect(agelessSearch(list(), new Map(), new Set(), NOW, "   ").total).toBe(0);
  });

  it("finds a team the queue is hiding, and says what is holding it", () => {
    /*
     * The whole reason the search reads the raw list. Each of these is invisible on the queue and
     * every one of them is a team somebody might go looking for.
     */
    const named = nameAge(new Map(), {
      teamId: "ID-BBB",
      level: 12,
      namedAt: daysBefore(3),
    });
    const spent = team("ID-DDD", {
      name: "Mears 9 - 2026",
      tries: 99,
      firstSeen: daysBefore(400),
      evidence: evidence(),
    });
    const all: AgeUnknownList = [...list(), spent];
    const dropped = forgetClubs(new Set(), ["ID-CCC"]);

    expect(agelessSearch(all, named, dropped, NOW, "northside").hits[0]?.aside).toBe("named");
    expect(agelessSearch(all, named, dropped, NOW, "mirror").hits[0]?.aside).toBe("dropped");
    expect(agelessSearch(all, named, dropped, NOW, "ID-DDD").hits[0]?.aside).toBe("left-alone");
    // And one that is simply on the queue carries no aside at all.
    expect(agelessSearch(all, named, dropped, NOW, "ID-AAA").hits[0]?.aside).toBeUndefined();
  });

  it("puts the ones somebody can act on first", () => {
    // A queue row is answerable now; the rest need an explanation before anything can be done.
    const dropped = forgetClubs(new Set(), ["ID-AAA"]);
    const found = agelessSearch(list(), new Map(), dropped, NOW, "2026");
    expect(found.hits.map((hit) => hit.row.entry.teamId)).toEqual(["ID-CCC", "ID-AAA"]);
  });

  it("caps what it hands back and still says how many there are", () => {
    // Otherwise a search for "a" is the wall the ten-at-a-time queue exists to avoid.
    const many: AgeUnknownList = Array.from({ length: 40 }, (_, i) =>
      team(`ID${i}`, { name: `Mears ${i}`, evidence: evidence() })
    );
    const found = agelessSearch(many, new Map(), new Set(), NOW, "mears", 25);
    expect(found.total).toBe(40);
    expect(found.hits).toHaveLength(25);
  });
});

/**
 * What somebody types, against the names this list is actually full of.
 */
describe("matching the way a person types", () => {
  const real = (): AgeUnknownList => [
    team("ID-1", { name: "Mears 1 - 2026", evidence: evidence({ city: "Tacoma", state: "WA" }) }),
    team("ID-2", {
      name: "Mears 9 - 2026",
      evidence: evidence({ city: "Covington", state: "KY" }),
    }),
    team("ID-3", {
      name: "Riverdogs",
      evidence: evidence({ sampleOpponents: ["Northside 12U", "Eastview 11U"] }),
    }),
  ];

  it("takes the words in any order, with anything between them", () => {
    /*
     * The whole reason this is not a substring test. A real name carries a squad number and a
     * year between the words anybody remembers, so "mears 2026" — the obvious way to narrow a
     * long list — found nothing at all, which made the card's own "type more to narrow it" the
     * way to turn a long answer into no answer.
     */
    expect(agelessSearch(real(), new Map(), new Set(), NOW, "mears 2026").total).toBe(2);
    expect(agelessSearch(real(), new Map(), new Set(), NOW, "2026 mears").total).toBe(2);
    expect(agelessSearch(real(), new Map(), new Set(), NOW, "mears 9").total).toBe(1);
  });

  it("finds a team by where it is from, or by who it played", () => {
    // The card already shows both, so a search that could not match them would be hiding what it
    // had just displayed — and a town is how somebody remembers a club whose name they cannot.
    expect(
      agelessSearch(real(), new Map(), new Set(), NOW, "tacoma").hits[0]?.row.entry.teamId
    ).toBe("ID-1");
    expect(
      agelessSearch(real(), new Map(), new Set(), NOW, "northside").hits[0]?.row.entry.teamId
    ).toBe("ID-3");
  });

  it("puts the best match first, ahead of the order it would otherwise fall in", () => {
    /*
     * The tie-break below this is alphabetical, so the two have to disagree for the ranking to be
     * doing anything: "Avalanche" sorts first and "Zephyrs" is the team somebody typed. On a real
     * list the loose matches are the many and the exact one is the needle, so without this the
     * wanted team is pushed past the cut and out of the answer entirely.
     *
     * The first version of this test used "Mears" against "Mears Valley Thunder", which sorts the
     * right way round on its own and passed with the ranking deleted.
     */
    const list: AgeUnknownList = [
      team("ID-LOOSE", { name: "Avalanche Zephyrs Club", evidence: evidence() }),
      team("ID-EXACT", { name: "Zephyrs", evidence: evidence() }),
    ];
    const order = agelessSearch(list, new Map(), new Set(), NOW, "zephyrs").hits.map(
      (hit) => hit.row.entry.teamId
    );
    expect(order).toEqual(["ID-EXACT", "ID-LOOSE"]);
  });
});
