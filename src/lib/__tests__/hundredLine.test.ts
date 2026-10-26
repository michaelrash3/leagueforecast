import { describe, expect, it } from "vitest";
import { FIXTURE_TODAY, fingerprint, poolFixture } from "../../../scripts/poolFixture";
import { sweepMarks, sweepVerdicts, type SweepAnswers } from "../obviousFakes";
import { autoRemovalsList, HUNDRED_MARGIN, NO_REMOVALS } from "../autoRemoved";
import type { ScoutGame } from "../teamRankings";

/*
 * The sweep for clubs plainly made up (`sweepMarks`) on the seeded fixture, pinned before H's line
 * could be asked for, so the line left out is seen to move nothing; and the line asked for, which
 * the owner's 40 is measured with before it ships (`scripts/communityLevelSweep.ts`).
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 300 });
const NO_WORD: SweepAnswers = { realClubs: new Set(), keptApart: new Set(), namedAges: new Map() };
const pulled = fixture.teams.filter((team) => (team.gcTeams ?? []).length > 0);

/**
 * Three games planted on pulled clubs' own schedules, beside the fixture's own 45-1 routs: one won
 * by 120 off the winner's schedule, one lost by 100 off the loser's, and one won by 60 off the
 * winner's, which H at 100 never reads.
 */
const planted = (): ScoutGame[] => {
  const [a, b, c, d, e, f] = pulled.slice(40, 46);
  const filed = (
    id: string,
    winner: typeof a,
    loser: typeof a,
    filer: typeof a,
    runs: number
  ): ScoutGame => ({
    id,
    ageGroupId: winner!.gcTeams![0]!.ageGroupId,
    teamAId: winner!.id,
    teamBId: loser!.id,
    teamAScore: runs + 1,
    teamBScore: 1,
    date: "2026-09-20",
    source: { kind: "gamechanger", teamId: filer!.gcTeams![0]!.teamId, gameId: `r-${id}` },
  });
  return [filed("h120", a, b, a, 120), filed("h100", c, d, d, 100), filed("h60", e, f, e, 60)];
};
const pool = { ...fixture, games: [...fixture.games, ...planted()] };

describe("the sweep's H line", () => {
  it("holds still where the line is left out", () => {
    // The winner by 120 (B and H) and the loser by 100 off its own schedule (H), and nobody else:
    // the fixture's 45-1 routs come off no pulled club's schedule, so H charges nobody for them.
    const marks = sweepMarks(pool, NO_WORD, NO_REMOVALS, FIXTURE_TODAY);
    expect(marks.size).toBe(2);
    expect(fingerprint(autoRemovalsList(marks))).toBe("dacec6ef");
    // Asked for nothing, or for the line the nightly uses, it is the same sweep to the last mark.
    expect(sweepMarks(pool, NO_WORD, NO_REMOVALS, FIXTURE_TODAY, {})).toEqual(marks);
    expect(
      sweepMarks(pool, NO_WORD, NO_REMOVALS, FIXTURE_TODAY, { hundredLine: HUNDRED_MARGIN })
    ).toEqual(marks);
  });

  it("marks a club whose own schedule reports a game won by the line asked for, and not under it", () => {
    const winner60 = pulled[44]!.gcTeams![0]!.teamId;
    const at = (line: number) =>
      sweepMarks(pool, NO_WORD, NO_REMOVALS, FIXTURE_TODAY, { hundredLine: line });
    expect(at(60).get(winner60)).toEqual({
      gcTeamId: winner60,
      name: pulled[44]!.name,
      on: FIXTURE_TODAY,
      signs: ["hundred"],
      reported: [{ gameId: "h60", margin: 60, date: "2026-09-20" }],
    });
    expect(at(40).size).toBe(3);
    expect(at(61).has(winner60)).toBe(false);
    expect(at(61).size).toBe(2);
    // Past every game planted, only B's 120 is left to mark anybody.
    expect(signsOf(at(121))).toEqual({ [pulled[40]!.gcTeams![0]!.teamId]: ["rout"] });
  });

  it("reads the line asked for when it says why a club would be marked", () => {
    const winner60 = pulled[44]!.id;
    expect(sweepVerdicts(pool, NO_WORD, FIXTURE_TODAY).get(winner60)?.signs).toEqual([]);
    const at40 = sweepVerdicts(pool, NO_WORD, FIXTURE_TODAY, { hundredLine: 40 }).get(winner60);
    expect(at40?.signs).toEqual(["hundred"]);
    expect(at40?.reported).toEqual([{ gameId: "h60", margin: 60, date: "2026-09-20" }]);
  });
});

/** The signs each marked GameChanger id carries. */
const signsOf = (marks: ReturnType<typeof sweepMarks>) =>
  Object.fromEntries([...marks].map(([id, mark]) => [id, mark.signs]));
