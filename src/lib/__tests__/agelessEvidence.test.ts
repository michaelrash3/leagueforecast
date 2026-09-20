import { describe, expect, it } from "vitest";
import {
  agelessEvidence,
  coerceAgelessEvidence,
  looksInvented,
  whyNoAge,
} from "../agelessEvidence";
import type { GcGame, GcTeamProfile, GcTeamSchedule } from "../gameChangerApi";
import { createGcImporter, type GcImportState } from "../gameChangerImport";

const TODAY = "2026-09-20";

const profile = (extra: Partial<GcTeamProfile> = {}): GcTeamProfile => ({
  id: "T1",
  name: "Warriors Spring 2027",
  ...extra,
});

const game = (opponentName: string, extra: Partial<GcGame> = {}): GcGame => ({
  id: `g${opponentName}`,
  opponentName,
  status: "completed",
  ...extra,
});

describe("what was known about a team nobody could age", () => {
  /*
   * The bulk of this list, by the file's own account: a rec league where nobody writes an age in a
   * team name. Nothing here will ever settle it, and the evidence is what says so.
   */
  it("separates a rec league from a near miss from a blank schedule", () => {
    const recLeague = agelessEvidence(
      profile(),
      [
        game("Mears 1 - 2026", { date: "2026-09-05", teamScore: 4, opponentScore: 3 }),
        game("Mirror Lake 2 2026", { date: "2026-09-12", teamScore: 2, opponentScore: 8 }),
        game("Sandpoint Red", { date: "2026-09-19", teamScore: 5, opponentScore: 5 }),
      ],
      TODAY
    );
    expect(recLeague.opponents).toBe(3);
    expect(recLeague.namedAnAge).toBe(0);
    expect(recLeague.tally).toEqual([]);
    expect(recLeague.sampleOpponents).toEqual([
      "Mears 1 - 2026",
      "Mirror Lake 2 2026",
      "Sandpoint Red",
    ]);
    expect(whyNoAge(recLeague, 3)).toMatch(/None of its 3 opponents writes an age/);

    // Two of three said 9U. It needed three — which the reader settles in one look.
    const nearMiss = agelessEvidence(
      profile(),
      [game("Prosper Bulls 9U"), game("Frisco Heat 9U"), game("Sandpoint Red")],
      TODAY
    );
    expect(nearMiss.tally).toEqual([[9, 2]]);
    expect(whyNoAge(nearMiss, 3)).toBe("2 of its opponents say 9U — it needs 3.");

    const blank = agelessEvidence(profile(), [], TODAY);
    expect(blank.games).toBe(0);
    expect(whyNoAge(blank, 3)).toBe("GameChanger lists no games for this team at all.");
  });

  it("counts an opponent once however many times it is played", () => {
    // A tournament against the same club four times is one club's opinion, not four.
    const evidence = agelessEvidence(
      profile(),
      [game("Prosper Bulls 9U"), game("prosper bulls 9u"), game("Prosper Bulls 9U ")],
      TODAY
    );
    expect(evidence.opponents).toBe(1);
    expect(evidence.tally).toEqual([[9, 1]]);
  });

  it("says when the opponents disagree rather than pretending they did not", () => {
    const tied = agelessEvidence(
      profile(),
      [game("A 10U"), game("B 10U"), game("C 12U"), game("D 12U")],
      TODAY
    );
    expect(whyNoAge(tied, 3)).toBe("Its opponents are split: 2 say 10U and 2 say 12U.");
  });

  /*
   * You cannot score a game early. The pool where this was first seen held a club called
   * "Test team" with 68 of 68 games on days that had not happened.
   */
  it("tells an invention from a real club", () => {
    const real = agelessEvidence(
      profile({ record: { win: 4, loss: 6, tie: 0 }, playerCount: 11 }),
      [
        game("Mears 1 - 2026", { date: "2026-09-05", teamScore: 4, opponentScore: 3 }),
        game("Mirror Lake 2 2026", { date: "2026-09-12", teamScore: 2, opponentScore: 8 }),
        game("Sandpoint Red", { date: "2026-09-19", teamScore: 5, opponentScore: 6 }),
      ],
      TODAY
    );
    const invented = agelessEvidence(
      profile({ record: { win: 106, loss: 13, tie: 0 }, playerCount: 2 }),
      [
        game("X", { date: "2026-12-01", teamScore: 20, opponentScore: 0 }),
        game("Y", { date: "2026-12-08", teamScore: 17, opponentScore: 0 }),
        game("Z", { date: "2026-12-15", teamScore: 22, opponentScore: 0 }),
      ],
      TODAY
    );

    expect(real.aheadOfToday).toBe(0);
    expect(real.shutoutBlowouts).toBe(0);
    expect(invented.aheadOfToday).toBe(3);
    expect(invented.shutoutBlowouts).toBe(3);
    expect(looksInvented(invented)).toBeGreaterThan(looksInvented(real));
    expect(looksInvented(real)).toBe(0);
  });

  it("reads back what it stored, and drops what it cannot", () => {
    const stored = coerceAgelessEvidence({
      games: 3,
      scored: "nope",
      tally: [[9, 2], [99, 4], "x", [10]],
      sampleOpponents: ["A", 7, ""],
      record: { win: 4, loss: "x", tie: 0 },
      playerCount: 11,
    });
    expect(stored.games).toBe(3);
    expect(stored.scored).toBe(0);
    // 99U is not a level this app ranks, so it is not evidence about anything.
    expect(stored.tally).toEqual([[9, 2]]);
    expect(stored.sampleOpponents).toEqual(["A"]);
    expect(stored.record).toEqual({ win: 4, loss: 0, tie: 0 });
    expect(coerceAgelessEvidence(null).games).toBe(0);
  });

  /*
   * The wiring. A team nobody could age is filed nowhere and the pool comes back untouched, so
   * this outcome is the only route out for any of the above. If it is not attached here, every
   * fact about the team is read once and thrown away, and a list of these teams can only ever
   * show an id and a name.
   */
  it("rides out on the outcome of a team that could not be filed", () => {
    const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
    const unageable: GcTeamSchedule = {
      // No age field, a name that says nothing, and opponents that name nothing either.
      profile: {
        id: "bKpjvY5AVqOV",
        name: "Warriors Spring 2027",
        season: { season: "fall", year: 2026 },
      },
      games: [
        game("Mears 1 - 2026", { date: "2026-09-05", teamScore: 4, opponentScore: 3 }),
        game("Mirror Lake 2 2026", { date: "2026-09-12", teamScore: 2, opponentScore: 8 }),
      ],
      fetchedAt: "2026-09-20T12:00:00.000Z",
    };

    const importer = createGcImporter(empty, { today: TODAY });
    const outcome = importer.add(unageable);

    expect(outcome.skip).toBe("no-age");
    // The pool holds nothing about it, which is exactly why the outcome has to.
    expect(importer.state.teams).toEqual([]);
    expect(outcome.noAgeEvidence?.opponents).toBe(2);
    expect(outcome.noAgeEvidence?.namedAnAge).toBe(0);
    expect(outcome.noAgeEvidence?.sampleOpponents).toEqual([
      "Mears 1 - 2026",
      "Mirror Lake 2 2026",
    ]);
  });
});
