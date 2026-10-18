import { describe, expect, it } from "vitest";
import {
  AGELESS_BATCH,
  agelessBatch,
  agelessQueue,
  agelessRowFor,
  agelessSearch,
  agelessWaiting,
  asideBecause,
  batchIds,
  refusedAsSchool,
  refusedByName,
} from "../agelessQueue";
import {
  ageUnknownAsking,
  ageUnknownDue,
  updateAgeUnknown,
  type AgeUnknownList,
} from "../ageUnknown";
import { nameAge } from "../namedAges";
import { forgetClubs } from "../deletedGames";
import type { AgelessEvidence } from "../agelessEvidence";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 86_400_000;
const daysBefore = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

/**
 * A schedule a person can work from: four games, one opponent writing an age, too few to file it
 * by. A row with no opponent writing one is set aside since 18 October 2026, so a row meant to be
 * on the queue says so here, and a row meant to be off it says what keeps it off.
 */
const evidence = (extra: Partial<AgelessEvidence> = {}): AgelessEvidence => ({
  games: 4,
  scored: 4,
  aheadOfToday: 0,
  shutoutBlowouts: 0,
  opponents: 4,
  namedAnAge: 1,
  tally: [[10, 1]],
  ...extra,
});

/** The same four games with nobody writing an age: set aside as "no-age-named". */
const unnamed = (extra: Partial<AgelessEvidence> = {}): AgelessEvidence =>
  evidence({ namedAnAge: 0, tally: [], ...extra });

/** What the search says stands between each of `ids` and the queue. */
const asidesOf = (list: AgeUnknownList, ids: string[]) =>
  Object.fromEntries(
    ids.map((id) => [id, agelessSearch(list, new Map(), new Set(), NOW, id).hits[0]?.aside ?? null])
  );

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

  /**
   * The user's order, from 27 September 2026: the teams least likely to be real first. Since 18
   * October 2026 the ones past the cut are not on the queue at all, being nothing a person can
   * answer, and what is left keeps that order.
   */
  it("puts the teams least likely to be real first, and sets aside one whose schedule is made up", () => {
    const list: AgeUnknownList = [
      team("honest", { evidence: evidence(), lastTried: daysBefore(11) }),
      // Half its games on days that have not happened: less likely than honest, not past the cut.
      team("iffy", { evidence: evidence({ aheadOfToday: 2 }) }),
      // Every game scored on a day that has not happened, all of them shutout blowouts.
      team("invented", {
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4, playerCount: 12 }),
      }),
    ];
    const waiting = agelessWaiting(list, new Map(), new Set(), NOW);
    expect(batchIds(waiting)).toEqual(["iffy", "honest"]);
    expect(waiting[0]!.standing).toBeUndefined();
    expect(asidesOf(list, ["invented"])).toEqual({ invented: "made-up" });
    // And the search's row says why, as the queue's would have.
    expect(
      agelessSearch(list, new Map(), new Set(), NOW, "invented").hits[0]?.row.standing
    ).toEqual({ group: "unlikely", because: "you cannot score a game early" });
  });

  it("sets aside a name nobody gives a team that plays, and the search says why", () => {
    const list: AgeUnknownList = [
      team("real", { name: "Mears 1 - 2026", evidence: evidence() }),
      team("test", { name: "Test", evidence: evidence({ games: 0, scored: 0 }) }),
      team("practice", { name: "Practice GC", evidence: evidence() }),
      team("default", { name: "Team 1", evidence: evidence() }),
      team("digits", { name: "12345", evidence: evidence() }),
      team("delete", { name: "Delete Me!!", evidence: evidence() }),
      team("short-name", { name: "AB", evidence: evidence() }),
      // Letters of any script: a club in Taipei is a club.
      team("taipei", { name: "統一獅隊 2025", evidence: evidence() }),
    ];
    const waiting = agelessWaiting(list, new Map(), new Set(), NOW);

    expect(batchIds(waiting).sort()).toEqual(["real", "taipei"]);
    expect(
      asidesOf(list, ["test", "practice", "default", "digits", "delete", "short-name"])
    ).toEqual({
      test: "no-team-name",
      practice: "no-team-name",
      default: "no-team-name",
      digits: "no-team-name",
      delete: "no-team-name",
      "short-name": "no-team-name",
    });
    const why = (query: string) =>
      agelessSearch(list, new Map(), new Set(), NOW, query).hits[0]?.row.standing?.because;
    expect(why("practice gc")).toBe("the name reads as a test, practice or placeholder account");
    expect(why("default")).toBe(
      "the name is only “Team”, with nothing more than a number, a letter or an age"
    );
  });

  it("sets aside the high school sides, by label, by who they play, and by name", () => {
    const list: AgeUnknownList = [
      team("real", { name: "Mears 1 - 2026", evidence: evidence() }),
      team("label", {
        name: "Pimbleton 2 - 2026",
        evidence: evidence({ ageLabel: "high_varsity" }),
      }),
      team("initials", {
        name: "PXHS Fall Ball 2026",
        evidence: evidence({ ageLabel: "Between 13 - 18" }),
      }),
      team("hyphen", { name: "Tigers High-school", evidence: evidence() }),
      team("freshman", { name: "Waunakee Freshman Fall Ball", evidence: evidence() }),
      // Nobody it plays writes an age, and two of them are school sides: it reads as one.
      team("plays", {
        name: "Quillmoor Fall Ball",
        evidence: unnamed({ sampleOpponents: ["Lincoln HS Varsity", "Round Rock JV"] }),
      }),
    ];
    expect(batchIds(agelessWaiting(list, new Map(), new Set(), NOW))).toEqual(["real"]);
    expect(asidesOf(list, ["label", "initials", "hyphen", "freshman", "plays"])).toEqual({
      label: "high-school",
      initials: "high-school",
      hyphen: "high-school",
      freshman: "high-school",
      plays: "high-school",
    });
    expect(
      agelessSearch(list, new Map(), new Set(), NOW, "quillmoor").hits[0]?.row.standing
    ).toEqual({ group: "school", because: "it plays varsity and JV sides" });
  });

  it("does not call a side GameChanger bands under thirteen a high school one", () => {
    const list: AgeUnknownList = [
      team("young", { name: "DHS Trailblazers", evidence: evidence({ ageLabel: "Under 13" }) }),
    ];
    expect(agelessWaiting(list, new Map(), new Set(), NOW)[0]!.standing).toBeUndefined();
  });

  it("sets aside a team with no games yet, one nothing was kept for, and one nobody it plays ages", () => {
    const list: AgeUnknownList = [
      team("played", { name: "Mears 1 - 2026", evidence: evidence() }),
      team("empty", { name: "Mears 2 - 2026", evidence: evidence({ games: 0, scored: 0 }) }),
      team("bare", { name: "Pimbleton 3 - 2026" }),
      team("unnamed", { name: "Pimbleton 4 - 2026", evidence: unnamed() }),
    ];
    expect(batchIds(agelessWaiting(list, new Map(), new Set(), NOW))).toEqual(["played"]);
    expect(asidesOf(list, ["empty", "bare", "unnamed"])).toEqual({
      empty: "no-games",
      bare: "no-games",
      unnamed: "no-age-named",
    });
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

  it("puts a lone V ahead of a row nothing else separates it from, and says what to look for", () => {
    /*
     * The opposite case to the one above, and the reason it is not folded into it. A lone "V"
     * really is a question a person has to settle: on a school schedule it is the varsity side,
     * and it is equally a squad number, a colour or an initial. So it stays on the queue and
     * carries the reason — and among rows that look equally real it goes first, because opening
     * one page settles it.
     *
     * The plain row here is the staler of the two, so only the lead can put the V in front.
     */
    const list: AgeUnknownList = [
      team("plain", { name: "Madison Reds", lastTried: daysBefore(40), evidence: evidence() }),
      team("loneV", { name: "Madison V", lastTried: daysBefore(1), evidence: evidence() }),
    ];
    const waiting = agelessWaiting(list, new Map(), new Set(), NOW);
    expect(batchIds(waiting)).toEqual(["loneV", "plain"]);
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
    const row = agelessRowFor(team("bare"));
    expect(row.why).toMatch(/Nothing was kept about this one/);
    expect(row.invented).toBe(0);
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

  /*
   * The user's rule of 28 September 2026: a team without nine players is not on this list. Nine
   * is on it, and so is a team nobody gave a count for — an unknown roster is not a short one.
   */
  it("keeps a team with fewer than nine players off the queue", () => {
    const list: AgeUnknownList = [
      team("eight", { evidence: evidence({ playerCount: 8 }) }),
      team("nobody", { evidence: evidence({ playerCount: 0 }) }),
      team("nine", { evidence: evidence({ playerCount: 9 }) }),
      team("uncounted", { evidence: evidence() }),
      team("no-evidence"),
    ];
    const waiting = agelessWaiting(list, new Map(), new Set(), NOW);
    expect(batchIds(waiting).sort()).toEqual(["nine", "uncounted"]);
    // A row nothing was kept for is no short roster: it is aside for having no games to show.
    expect(asidesOf(list, ["eight", "nobody", "no-evidence"])).toEqual({
      eight: "short-roster",
      nobody: "short-roster",
      "no-evidence": "no-games",
    });
  });

  it("still finds a short-roster team by name, and says why it is off the queue", () => {
    const short = team("ID-SHORT", {
      name: "Riverdogs 10U",
      evidence: evidence({ playerCount: 6 }),
    });
    // A team the rota has stopped asking about cannot come back when its roster fills, so it says so.
    const shortAndSpent = team("ID-SPENT", {
      name: "Riverdogs 11U",
      tries: 99,
      firstSeen: daysBefore(400),
      evidence: evidence({ playerCount: 6 }),
    });
    const all: AgeUnknownList = [short, shortAndSpent];

    const found = agelessSearch(all, new Map(), new Set(), NOW, "riverdogs");
    expect(found.total).toBe(2);
    expect(found.hits.find((hit) => hit.row.entry.teamId === "ID-SHORT")?.aside).toBe(
      "short-roster"
    );
    expect(found.hits.find((hit) => hit.row.entry.teamId === "ID-SPENT")?.aside).toBe("left-alone");
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

/*
 * The whole queue's order over one row of every kind, pinned before the queue set rows aside by
 * rule, so the change can be seen to take rows off it and to leave the order of the rest alone.
 */
describe("the queue's order, pinned", () => {
  const named = (n: number, tally: AgelessEvidence["tally"] = [[10, n]]) =>
    evidence({ namedAnAge: n, tally });
  const LIST: AgeUnknownList = [
    team("plain-named", { name: "Pimbleton 1 - 2026", evidence: named(1) }),
    team("plain-stale", {
      name: "Pimbleton 2 - 2026",
      lastTried: daysBefore(30),
      evidence: named(1),
    }),
    team("iffy", {
      name: "Pimbleton 3 - 2026",
      evidence: named(2, [
        [10, 1],
        [11, 1],
      ]),
    }),
    team("iffy-ahead", { name: "Pimbleton 4 - 2026", evidence: { ...named(1), aheadOfToday: 2 } }),
    team("lone-v", { name: "Pimbleton V", evidence: named(1) }),
    team("no-age-named", { name: "Pimbleton 5 - 2026", evidence: unnamed() }),
    team("no-games", { name: "Pimbleton 6 - 2026", evidence: unnamed({ games: 0, scored: 0 }) }),
    team("bare", { name: "Pimbleton 7 - 2026" }),
    team("test", { name: "Test", evidence: named(1) }),
    team("team-number", { name: "Team 6", evidence: named(1) }),
    team("digits", { name: "12345", evidence: named(1) }),
    team("scored-ahead", {
      name: "Pimbleton 8 - 2026",
      evidence: { ...named(1), aheadOfToday: 4, shutoutBlowouts: 4 },
    }),
    team("school-label", {
      name: "Pimbleton 9 - 2026",
      evidence: { ...named(1), ageLabel: "high_varsity" },
    }),
    team("plays-schools", {
      name: "Quillmoor Fall Ball",
      evidence: unnamed({ sampleOpponents: ["Lincoln HS Varsity", "Round Rock JV"] }),
    }),
    team("school-initials", { name: "PXHS Fall Ball 2026", evidence: named(1) }),
    team("short", { name: "Pimbleton 10 - 2026", evidence: { ...named(1), playerCount: 6 } }),
  ];

  /** The order this list was worked in before rows were set aside by rule, as pinned then. */
  const ORDER_BEFORE = [
    "scored-ahead",
    "test",
    "team-number",
    "digits",
    "school-label",
    "plays-schools",
    "school-initials",
    "iffy-ahead",
    "no-games",
    "bare",
    "lone-v",
    "plain-stale",
    "plain-named",
    "iffy",
    "no-age-named",
  ];

  it("takes off only what it sets aside, and leaves the rest in the order they had", () => {
    const kept = batchIds(agelessWaiting(LIST, new Map(), new Set(), NOW));
    const aside = asidesOf(
      LIST,
      LIST.map((entry) => entry.teamId)
    );
    expect(kept).toEqual(ORDER_BEFORE.filter((id) => aside[id] === null));
    expect(Object.values(aside).filter((one) => one !== null)).toHaveLength(
      LIST.length - kept.length
    );
  });

  it("lists every row on the queue in the order it is worked, the rest in the order they had", () => {
    expect(
      agelessWaiting(LIST, new Map(), new Set(), NOW).map(
        (row) => `${row.entry.teamId}: ${row.standing?.because ?? "-"}`
      )
    ).toMatchInlineSnapshot(`
      [
        "iffy-ahead: -",
        "lone-v: -",
        "plain-stale: -",
        "plain-named: -",
        "iffy: -",
      ]
    `);
  });
});

/*
 * Set aside by rule, the owner's word of 18 October 2026: only a team a person can answer is on the
 * queue. Read off the row each time and never stored, so the rota still asks, a re-ask that brings
 * new evidence puts the row back, and the search finds every one.
 */
describe("the rows the queue sets aside by rule", () => {
  const list = (): AgeUnknownList => [
    team("open-1", { name: "Pimbleton 1 - 2026", evidence: evidence() }),
    team("open-2", { name: "Pimbleton 2 - 2026", evidence: evidence() }),
    team("unnamed-1", { name: "Pimbleton 3 - 2026", evidence: unnamed() }),
    team("unnamed-2", { name: "Pimbleton 4 - 2026", evidence: unnamed() }),
    team("unnamed-3", { name: "Pimbleton 5 - 2026", evidence: unnamed() }),
    team("empty", { name: "Pimbleton 6 - 2026", evidence: evidence({ games: 0, scored: 0 }) }),
    team("short", { name: "Pimbleton 7 - 2026", evidence: evidence({ playerCount: 6 }) }),
    team("team-number", { name: "Team 6", evidence: evidence() }),
    team("ahead", { name: "Pimbleton 0 - 2026", evidence: evidence({ aheadOfToday: 4 }) }),
    team("school", {
      name: "Pimbleton 8 - 2026",
      evidence: evidence({ ageLabel: "high_varsity" }),
    }),
    team("school-name", { name: "Pimbleton HS Varsity", evidence: evidence() }),
    // Answered, or no longer asked about: none of these is a rule's, and none is counted.
    team("named"),
    team("dropped"),
    team("spent", { tries: 99, firstSeen: daysBefore(400), evidence: unnamed() }),
  ];
  const NAMED = nameAge(new Map(), { teamId: "named", level: 9, namedAt: NOW.toISOString() });
  const DROPPED = forgetClubs(new Set<string>(), ["dropped"]);

  it("counts how many each rule set aside, in the card's order, leaving out the answered", () => {
    const { waiting, setAside } = agelessQueue(list(), NAMED, DROPPED, NOW);
    expect(batchIds(waiting).sort()).toEqual(["open-1", "open-2"]);
    expect(setAside).toEqual([
      { aside: "no-age-named", count: 3 },
      { aside: "no-games", count: 1 },
      { aside: "short-roster", count: 1 },
      { aside: "no-team-name", count: 1 },
      { aside: "made-up", count: 1 },
      { aside: "high-school", count: 2 },
    ]);
  });

  it("counts nothing for a list it sets nothing aside from", () => {
    expect(agelessQueue(list().slice(0, 2), new Map(), new Set(), NOW).setAside).toEqual([]);
  });

  it("still finds every one by search, and says why each is aside", () => {
    const found = agelessSearch(list(), NAMED, DROPPED, NOW, "pimbleton");
    expect(
      Object.fromEntries(found.hits.map((hit) => [hit.row.entry.teamId, hit.aside ?? null]))
    ).toEqual({
      "open-1": null,
      "open-2": null,
      "unnamed-1": "no-age-named",
      "unnamed-2": "no-age-named",
      "unnamed-3": "no-age-named",
      empty: "no-games",
      short: "short-roster",
      ahead: "made-up",
      school: "high-school",
      "school-name": "high-school",
    });
    // What a person can act on comes first.
    expect(found.hits.slice(0, 2).map((hit) => hit.row.entry.teamId)).toEqual(["open-1", "open-2"]);
  });

  it("says first what the owner answered, and the rota's budget, over what a rule reads", () => {
    // Two have no games kept, which alone would set them aside, and the spent one has nobody it
    // plays writing an age; the answer and the spent budget are what is worth being told, and what
    // no later check undoes by itself.
    expect(asidesOf(list(), ["named", "dropped"])).toEqual({
      named: "no-games",
      dropped: "no-games",
    });
    const say = (id: string) => agelessSearch(list(), NAMED, DROPPED, NOW, id).hits[0]?.aside;
    expect([say("named"), say("dropped"), say("spent")]).toEqual([
      "named",
      "dropped",
      "left-alone",
    ]);
  });

  /*
   * The rota is the other half of "comes back by itself": a row set aside has to go on being asked
   * about, or a team whose next game is against somebody who writes an age would never be asked
   * the question that settles it.
   */
  it("goes on being asked about by the rota, which never reads the queue", () => {
    const all = list();
    const asked = ageUnknownDue(all, 100, NOW, NAMED, DROPPED);
    expect(asked).toEqual(
      expect.arrayContaining(["unnamed-1", "empty", "short", "team-number", "ahead", "school"])
    );
    expect(asked).not.toContain("spent");
    // Every row but the one thrown out and the one past its budget, as before.
    expect(ageUnknownAsking(all, NOW, NAMED, DROPPED)).toBe(all.length - 2);
  });

  it("comes back to the queue by itself when a re-ask brings an opponent who writes an age", () => {
    const before = list();
    expect(batchIds(agelessWaiting(before, new Map(), new Set(), NOW))).not.toContain("unnamed-1");
    const after = updateAgeUnknown(
      before,
      [
        {
          gcTeamId: "unnamed-1",
          teamName: "Pimbleton 3 - 2026",
          skip: "no-age",
          noAgeEvidence: evidence({ games: 5, scored: 5, opponents: 5 }),
        } as Parameters<typeof updateAgeUnknown>[1][number],
      ],
      NOW.toISOString()
    );
    expect(batchIds(agelessWaiting(after, new Map(), new Set(), NOW))).toContain("unnamed-1");
  });

  it("keeps the rows it sets aside among those a pass of the rules may clear", () => {
    // The groups the card offers to clear read every row still asked about, as before.
    const { open } = agelessQueue(list(), NAMED, DROPPED, NOW);
    expect(open.map((entry) => entry.teamId).sort()).toEqual(
      [
        "open-1",
        "open-2",
        "unnamed-1",
        "unnamed-2",
        "unnamed-3",
        "empty",
        "team-number",
        "ahead",
        "school",
      ].sort()
    );
  });

  it("refuses an age as a school's only where the import would refuse it", () => {
    const [label, , plays] = [
      team("label", {
        name: "Pimbleton 9 - 2026",
        evidence: evidence({ ageLabel: "high_varsity" }),
      }),
      team("name", { name: "Pimbleton HS Varsity" }),
      team("plays", {
        name: "Quillmoor Fall Ball",
        evidence: unnamed({ sampleOpponents: ["Lincoln HS Varsity", "Round Rock JV"] }),
      }),
    ];
    expect(refusedAsSchool(label)).toBe(true);
    expect(refusedAsSchool(team("name", { name: "Pimbleton HS Varsity" }))).toBe(true);
    expect(refusedAsSchool(plays)).toBe(false);
  });
});

/*
 * What the card can say and offer for a row set aside, read off the row as the queue reads it: the
 * reason that set it aside and no other, and an age only where the import would file one.
 */
describe("a row set aside, as the card draws it", () => {
  it("sets aside a team whose opponents write only ages this app does not rank", () => {
    const list: AgeUnknownList = [
      team("open", { name: "Pimbleton 1 - 2026", evidence: evidence() }),
      // Read back from storage: the 6U opponent counted, the tally emptied of it.
      team("stored", {
        name: "Pimbleton 2 - 2026",
        evidence: evidence({ namedAnAge: 1, tally: [] }),
      }),
      // Fresh from a pull, the 6U still in the tally.
      team("fresh", {
        name: "Pimbleton 3 - 2026",
        evidence: evidence({ namedAnAge: 1, tally: [[6, 1]] }),
      }),
    ];
    const { waiting, setAside } = agelessQueue(list, new Map(), new Set(), NOW);
    expect(batchIds(waiting)).toEqual(["open"]);
    expect(setAside).toEqual([{ aside: "no-age-named", count: 2 }]);
    expect(asidesOf(list, ["stored", "fresh"])).toEqual({
      stored: "no-age-named",
      fresh: "no-age-named",
    });
  });

  it("knows the pages the import refuses by their name, whatever age is named for them", () => {
    const refused = (name?: string) => refusedByName(team("x", name === undefined ? {} : { name }));
    expect(
      ["Team 7", "Team 7 12U", "My Team", "Alder Comets Practice", "Alder Comets Wiffle"].map(
        refused
      )
    ).toEqual([true, true, true, true, true]);
    // No letters, two characters, "old team": set aside by the queue, and still filed by the
    // import, so an age named for one lands.
    expect(
      ["12345", "AB", "Alder Comets Old Team", "Pimbleton 1 - 2026", undefined].map(refused)
    ).toEqual([false, false, false, false, false]);
  });

  it("says under a row what set it aside, and nothing it was not set aside by", () => {
    const list: AgeUnknownList = [
      // A school's name with a practice word in it: aside as a school, by the name.
      team("school-practice", { name: "Pimbleton High School Practice", evidence: evidence() }),
      // A school's name on a schedule scored ahead of today: aside as a school, by the name.
      team("school-ahead", {
        name: "Quillfern HS",
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4 }),
      }),
      team("plays", {
        name: "Quillmoor Fall Ball",
        evidence: unnamed({ sampleOpponents: ["Lincoln HS Varsity", "Round Rock JV"] }),
      }),
      team("label", {
        name: "Pimbleton 9 - 2026",
        evidence: evidence({ ageLabel: "high_varsity" }),
      }),
      team("number", { name: "Team 6", evidence: evidence() }),
      team("ahead", {
        name: "Pimbleton 0 - 2026",
        evidence: evidence({ aheadOfToday: 4, shutoutBlowouts: 4 }),
      }),
      team("unnamed", { name: "Pimbleton 5 - 2026", evidence: unnamed() }),
    ];
    const because = (id: string) => {
      const hit = agelessSearch(list, new Map(), new Set(), NOW, id).hits[0]!;
      return [hit.aside, hit.aside && asideBecause(hit.row, hit.aside)];
    };
    expect(Object.fromEntries(list.map(({ teamId }) => [teamId, because(teamId)]))).toEqual({
      "school-practice": ["high-school", "the name reads as a high school squad"],
      "school-ahead": ["high-school", "the name reads as a high school squad"],
      plays: ["high-school", "it plays varsity and JV sides"],
      label: ["high-school", "GameChanger files it as a school team"],
      number: [
        "no-team-name",
        "the name is only “Team”, with nothing more than a number, a letter or an age",
      ],
      ahead: ["made-up", "you cannot score a game early"],
      unnamed: ["no-age-named", undefined],
    });
  });
});
