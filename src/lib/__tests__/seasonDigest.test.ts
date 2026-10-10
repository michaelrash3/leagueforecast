import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFY,
  changeKey,
  coerceNotifyPrefs,
  coerceSeen,
  changesBetween,
  countLine,
  describeChange,
  digestOddsMove,
  foldLocal,
  raceOf,
  seenOf,
  worthNotifying,
  type Change,
  type RaceSeen,
} from "../seasonDigest";
import type { GameLog, Matchup, TeamBase } from "../types";

/*
 * What changed in a League season since this device last looked (2.6), worked out from the
 * season as it was seen and as it is: each kind of change, what this device did itself taken as
 * seen, and which changes are worth a notification. Placeholder teams.
 */

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];
const games: Matchup[] = [
  { id: "g1", date: "2026-05-02", away: "A", home: "B" },
  { id: "g2", date: "2026-05-09", away: "B", home: "C" },
  { id: "g3", date: "2026-05-16", away: "C", home: "A" },
];
const log = (
  away: string,
  home: string,
  isFinal = true,
  extra: Partial<GameLog> = {}
): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal,
  ...extra,
});

const season = (
  logs: Record<string, GameLog> = { g1: log("4", "2") },
  matchups: Matchup[] = games,
  roster: TeamBase[] = teams
) => ({ teams: roster, matchups, logs });

const names = (id: string) => teams.find((team) => team.id === id)?.name ?? id;
const kinds = (changes: Change[]) => changes.map((change) => change.kind);

describe("changesBetween", () => {
  const before = seenOf(season());

  it("finds nothing when nothing changed", () => {
    expect(changesBetween(before, seenOf(season()))).toEqual([]);
  });

  it("does not count runs typed into a game not yet final", () => {
    expect(
      changesBetween(before, seenOf(season({ g1: log("4", "2"), g2: log("3", "", false) })))
    ).toEqual([]);
  });

  it("tells a new final, a corrected one and a reopened one apart", () => {
    const after = seenOf(season({ g1: log("4", "3"), g2: log("1", "0") }));
    expect(kinds(changesBetween(before, after))).toEqual(["corrected", "final"]);
    const reopened = seenOf(season({ g1: log("4", "2", false) }));
    expect(kinds(changesBetween(before, reopened))).toEqual(["reopened"]);
  });

  it("tells games added, removed, moved and given new opponents apart", () => {
    const added: Matchup = { id: "g4", date: "2026-05-23", away: "A", home: "C" };
    const after = seenOf(
      season({ g1: log("4", "2") }, [
        { ...games[0]!, date: "2026-05-03" },
        { ...games[1]!, away: "C", home: "B" },
        added,
      ])
    );
    expect(
      changesBetween(before, after).map((change) => [
        change.kind,
        "gameId" in change && change.gameId,
      ])
    ).toEqual([
      ["rescheduled", "g1"],
      ["opponents", "g2"],
      ["removed", "g3"],
      ["scheduled", "g4"],
    ]);
  });

  it("counts a new home team alone as a change of opponent", () => {
    const after = seenOf(season(undefined, [games[0]!, games[1]!, { ...games[2]!, home: "B" }]));
    expect(kinds(changesBetween(before, after))).toEqual(["opponents"]);
  });

  it("lists every way one game changed, and a box score alone only when nothing else did", () => {
    const moved = { ...games[1]!, date: "2026-05-10" };
    const after = seenOf(
      season({ g1: log("4", "2"), g2: log("1", "0") }, [games[0]!, moved, games[2]!])
    );
    expect(kinds(changesBetween(before, after))).toEqual(["final", "rescheduled"]);
    const hits = seenOf(season({ g1: log("4", "2", true, { awayHits: "7" }) }));
    expect(kinds(changesBetween(before, hits))).toEqual(["detail"]);
  });

  it("tells teams added, removed and renamed", () => {
    const after = seenOf(
      season(undefined, games, [
        { id: "A", name: "Aces" },
        { id: "B", name: "Bruins" },
        { id: "D", name: "Dukes" },
      ])
    );
    expect(changesBetween(before, after)).toEqual([
      { kind: "teamRenamed", teamId: "B", teamIds: ["B"], before: "Bears", after: "Bruins" },
      { kind: "teamRemoved", teamId: "C", teamIds: ["C"], before: "Comets" },
      { kind: "teamAdded", teamId: "D", teamIds: ["D"], after: "Dukes" },
    ]);
  });

  it("names the teams a game change is about, before and after, once each", () => {
    const after = seenOf(season(undefined, [games[0]!, { ...games[1]!, away: "A" }, games[2]!]));
    const [change] = changesBetween(before, after);
    expect(change?.teamIds).toEqual(["B", "C", "A"]);
  });

  describe("the race", () => {
    const race = (entries: [string, RaceSeen][]) => Object.fromEntries(entries);
    const was = {
      ...before,
      race: race([
        ["A", { status: "In", gold: 60 }],
        ["B", { status: "Alive", gold: 30 }],
        ["C", { status: "Alive", gold: 10 }],
      ]),
    };

    it("reports a clinch and an elimination for any team", () => {
      const now = {
        ...before,
        race: race([
          ["A", { status: "Clinched", gold: 100 }],
          ["B", { status: "Alive", gold: 30 }],
          ["C", { status: "Eliminated", gold: 0 }],
        ]),
      };
      expect(kinds(changesBetween(was, now))).toEqual(["clinched", "eliminated"]);
    });

    it("reports a move in the Gold chance for the team followed alone, from the threshold up", () => {
      const now = {
        ...before,
        race: race([
          ["A", { status: "In", gold: 70 }],
          ["B", { status: "Alive", gold: 45 }],
          ["C", { status: "Alive", gold: 10 }],
        ]),
      };
      expect(changesBetween(was, now, { followed: "B", oddsMove: 15 })).toEqual([
        { kind: "odds", teamId: "B", teamIds: ["B"], from: 30, to: 45 },
      ]);
      expect(changesBetween(was, now, { followed: "B", oddsMove: 16 })).toEqual([]);
      expect(changesBetween(was, now, { followed: null, oddsMove: 5 })).toEqual([]);
    });

    it("says nothing of a team that had already clinched or was already out", () => {
      const settled = {
        ...before,
        race: race([
          ["A", { status: "Clinched", gold: 100 }],
          ["B", { status: "Eliminated", gold: 0 }],
        ]),
      };
      expect(changesBetween(settled, { ...settled })).toEqual([]);
    });

    it("says nothing of the race until both sides have a forecast", () => {
      const now = { ...before, race: race([["A", { status: "Clinched", gold: 100 }]]) };
      expect(changesBetween(before, now)).toEqual([]);
      expect(changesBetween(was, before)).toEqual([]);
    });

    it("reads the forecast's rows", () => {
      expect(raceOf([{ id: "A", goldStatus: "In", goldPct: 61.5 }])).toEqual({
        A: { status: "In", gold: 61.5 },
      });
    });
  });

  it("finds the same changes however often the same news arrives", () => {
    const after = seenOf(season({ g1: log("4", "3"), g2: log("1", "0") }));
    expect(changesBetween(before, after)).toEqual(
      changesBetween(before, seenOf(season({ g1: log("4", "3"), g2: log("1", "0") })))
    );
  });
});

describe("foldLocal", () => {
  const start = season();
  const seen = seenOf(start);

  it("takes what this device changed as seen, and leaves news from elsewhere unseen", () => {
    // Another device finals game 2; then this one corrects game 1.
    const arrived = season({ g1: log("4", "2"), g2: log("1", "0") });
    const edited = season({ g1: log("5", "2"), g2: log("1", "0") });
    const folded = foldLocal(seen, arrived, edited);
    expect(kinds(changesBetween(folded, seenOf(edited)))).toEqual(["final"]);
    expect(folded.games.g1?.final).toBe("5-2");
  });

  it("takes a game this device removed, and a team it renamed, as seen", () => {
    const edited = season(
      undefined,
      [games[0]!, games[1]!],
      [teams[0]!, { id: "B", name: "Bruins" }, teams[2]!]
    );
    const folded = foldLocal(seen, start, edited);
    expect(changesBetween(folded, seenOf(edited))).toEqual([]);
  });

  it("is the same object when the edit changed nothing the digest compares", () => {
    const typed = season({ g1: log("4", "2"), g2: log("3", "", false) });
    expect(foldLocal(seen, start, typed)).toBe(seen);
  });
});

describe("in words", () => {
  const change = (kind: Change["kind"]): Change =>
    ({ kind, gameId: "g1", teamIds: ["A"] }) as Change;

  it("counts each kind, in the order a digest lists them", () => {
    expect(countLine([change("final")])).toBe("1 new final");
    expect(countLine([change("final"), change("final"), change("corrected")])).toBe(
      "2 new finals and 1 corrected score"
    );
    expect(
      countLine([
        change("removed"),
        change("final"),
        { kind: "clinched", teamId: "A", teamIds: ["A"] },
      ])
    ).toBe("1 clinch, 1 new final and 1 game removed");
    expect(countLine([])).toBe("");
  });

  it("says what happened to each game and team", () => {
    const before = seenOf(season());
    const after = seenOf(
      season({ g1: log("4", "3"), g2: log("1", "0") }, [
        games[0]!,
        games[1]!,
        { ...games[2]!, date: "2026-05-17" },
      ])
    );
    expect(changesBetween(before, after).map((one) => describeChange(one, names))).toEqual([
      "Aces at Bears: corrected from 4–2 to 4–3.",
      "Bears at Comets: final, 1–0.",
      "Comets at Aces moved from 5/16 to 5/17.",
    ]);
    expect(
      describeChange({ kind: "odds", teamId: "A", teamIds: ["A"], from: 41.6, to: 63.2 }, names)
    ).toBe("Aces's Gold chance went from 42% to 63%.");
  });
});

describe("notifications", () => {
  const followed = "B";
  const before = seenOf(season());
  const after = {
    ...seenOf(
      season({ g1: log("4", "2"), g2: log("1", "0"), g3: log("6", "1") }, [
        games[0]!,
        games[1]!,
        { ...games[2]!, date: "2026-05-17" },
      ])
    ),
    race: null,
  };
  const all = [
    ...changesBetween(before, after),
    { kind: "clinched", teamId: "A", teamIds: ["A"] } as Change,
    { kind: "odds", teamId: "B", teamIds: ["B"], from: 40, to: 60 } as Change,
  ];

  it("are off until opted into", () => {
    expect(DEFAULT_NOTIFY.on).toBe(false);
    expect(worthNotifying(all, DEFAULT_NOTIFY, followed)).toEqual([]);
  });

  it("carry the followed team's results and schedule, clinches and eliminations, and big moves", () => {
    const on = { ...DEFAULT_NOTIFY, on: true };
    // Game 2 is the followed team's; game 3, moved and final, is not.
    expect(worthNotifying(all, on, followed).map((change) => change.kind)).toEqual([
      "final",
      "clinched",
      "odds",
    ]);
    expect(
      worthNotifying(all, { ...on, finals: false }, followed).map((change) => change.kind)
    ).toEqual(["clinched", "odds"]);
    expect(
      worthNotifying(all, { ...on, clinches: false, oddsMove: 25 }, followed).map(
        (change) => change.kind
      )
    ).toEqual(["final"]);
    expect(
      worthNotifying(all, { ...on, oddsMove: null }, null).map((change) => change.kind)
    ).toEqual(["clinched"]);
  });

  it("know the same news when they see it again, and a new score or date as new", () => {
    const final = all[0]!;
    expect(changeKey(final)).toBe(changeKey({ ...final }));
    const corrected = changesBetween(before, seenOf(season({ g1: log("4", "3") })))[0]!;
    const correctedAgain = changesBetween(before, seenOf(season({ g1: log("4", "5") })))[0]!;
    expect(changeKey(corrected)).not.toBe(changeKey(correctedAgain));
  });

  it("know a second change of opponent for the same game as news of its own", () => {
    const roster = [...teams, { id: "D", name: "Dodgers" }];
    const against = (home: string) =>
      changesBetween(
        seenOf(season({}, games, roster)),
        seenOf(season({}, [{ ...games[0]!, home }, games[1]!, games[2]!], roster))
      )[0]!;
    expect(against("C").kind).toBe("opponents");
    expect(changeKey(against("C"))).not.toBe(changeKey(against("D")));
  });

  it("know a move in the odds by the steps it crossed, not by the forecast's last point", () => {
    const move = (to: number): Change => ({
      kind: "odds",
      teamId: "B",
      teamIds: ["B"],
      from: 30,
      to,
    });
    // Every final in the league seeds the forecast again, so one move reads a point apart.
    expect(changeKey(move(50.7), 15)).toBe(changeKey(move(50.2), 15));
    expect(changeKey(move(51.6), 15)).toBe(changeKey(move(50.2), 15));
    // A move another whole step on, or the other way, is news of its own.
    expect(changeKey(move(61), 15)).not.toBe(changeKey(move(50.2), 15));
    expect(changeKey(move(10), 15)).not.toBe(changeKey(move(50.2), 15));
  });

  it("leave the digest counting odds by 10 points while they are off", () => {
    expect(digestOddsMove(DEFAULT_NOTIFY)).toBe(10);
    expect(digestOddsMove({ ...DEFAULT_NOTIFY, oddsMove: 5 })).toBe(10);
    expect(digestOddsMove({ ...DEFAULT_NOTIFY, on: true })).toBe(DEFAULT_NOTIFY.oddsMove);
    expect(digestOddsMove({ ...DEFAULT_NOTIFY, on: true, oddsMove: 20 })).toBe(20);
    expect(digestOddsMove({ ...DEFAULT_NOTIFY, on: true, oddsMove: null })).toBe(10);
  });
});

describe("stored", () => {
  it("reads a last look back as it was written, and nothing that is not one", () => {
    const seen = {
      ...seenOf(season({ g1: log("4", "2") })),
      race: { A: { status: "In" as const, gold: 61.5 } },
    };
    expect(coerceSeen(JSON.parse(JSON.stringify(seen)))).toEqual(seen);
    expect(coerceSeen({ ...seen, race: null })).toEqual({ ...seen, race: null });
    expect(coerceSeen(null)).toBeNull();
    expect(coerceSeen({ games: [], teams: {} })).toBeNull();
    expect(coerceSeen({ ...seen, games: { g1: { date: 1 } } })).toBeNull();
    expect(coerceSeen({ ...seen, teams: { A: 3 } })).toBeNull();
    expect(coerceSeen({ ...seen, race: { A: { status: "Winning", gold: 50 } } })).toBeNull();
    expect(coerceSeen({ ...seen, race: { A: { status: "In", gold: Number.NaN } } })).toBeNull();
  });

  it("reads notification choices over the defaults, a bad value falling back to its own", () => {
    expect(coerceNotifyPrefs(undefined)).toEqual(DEFAULT_NOTIFY);
    const chosen = { ...DEFAULT_NOTIFY, on: true, clinches: false, oddsMove: null };
    expect(coerceNotifyPrefs(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen);
    expect(coerceNotifyPrefs({ on: "yes", oddsMove: 400, finals: false })).toEqual({
      ...DEFAULT_NOTIFY,
      finals: false,
    });
    expect(coerceNotifyPrefs({ oddsMove: 0 }).oddsMove).toBe(DEFAULT_NOTIFY.oddsMove);
  });
});
