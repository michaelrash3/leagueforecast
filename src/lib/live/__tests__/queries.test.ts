import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { memoryIo } from "../../cloud/cloudRunner";
import {
  mergeScoutTeams,
  renameScoutTeam,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../../teamRankings";
import {
  initTeamRankingsStore,
  loadScoutGames,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../../teamRankingsStorage";
import {
  answerQuery,
  coerceQuery,
  coerceQueryAnswer,
  foldCounts,
  type PoolQuery,
} from "../queries";

/*
 * The questions a member's device asks of the server's pool (`queries.ts`): each answered as the
 * page answers it from its own pool, and read exactly both ways. Placeholder names throughout.
 */

const GROUPS: AgeGroup[] = [
  { id: "ag_10u_2026", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] },
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const TEAMS: ScoutTeam[] = [
  { id: "A", name: "Club A" },
  { id: "B", name: "Club B" },
  { id: "C", name: "Club C" },
];
const game = (id: string, ageGroupId: string, teamAId: string, teamBId: string): ScoutGame => ({
  id,
  ageGroupId,
  teamAId,
  teamBId,
  teamAScore: 3,
  teamBScore: 2,
});
// Club A's games in two years: two against B (one each way), one against C, and one against its
// own name, which no fold of A drops.
const GAMES: ScoutGame[] = [
  game("g1", "ag_10u_2026", "A", "B"),
  game("g2", "ag_10u_2027", "B", "A"),
  game("g3", "ag_10u_2027", "A", "C"),
  game("g4", "ag_10u_2027", "A", "A"),
  game("g5", "ag_10u_2027", "B", "C"),
];

beforeEach(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(GROUPS);
  saveScoutTeams(TEAMS);
  saveScoutGames(GAMES);
});
afterEach(() => resetTeamRankingsStore());

describe("a fold's counts", () => {
  it("are the games naming the club folded away, and the ones between the two the page's fold drops", () => {
    for (const [from, into] of [
      ["A", "B"],
      ["B", "A"],
      ["A", "C"],
      ["C", "B"],
    ] as const) {
      const counts = foldCounts(from, into, loadScoutGames());
      const folded = mergeScoutTeams(from, into, TEAMS, loadScoutGames(), GROUPS);
      expect([from, into, counts.dropped]).toEqual([from, into, folded.droppedGames]);
      expect([from, into, counts.games]).toEqual([
        from,
        into,
        GAMES.filter((one) => one.teamAId === from || one.teamBId === from).length,
      ]);
    }
    expect(foldCounts("A", "B", GAMES)).toEqual({ games: 4, dropped: 2 });
  });
});

describe("a merge preview", () => {
  it("says what folding one club into another touches, as the page's own fold", () => {
    expect(answerQuery({ kind: "merge.preview", fromId: "A", intoId: "B", adopt: [] })).toEqual({
      kind: "merge.preview",
      found: true,
      games: 4,
      dropped: 2,
    });
  });

  it("finds a club League Standings made only where it is offered, as the command takes it", () => {
    const made: ScoutTeam = { id: "L1", name: "League Club" };
    expect(answerQuery({ kind: "merge.preview", fromId: "L1", intoId: "A", adopt: [] })).toEqual({
      kind: "merge.preview",
      found: false,
      games: 0,
      dropped: 0,
    });
    expect(
      answerQuery({ kind: "merge.preview", fromId: "L1", intoId: "A", adopt: [made] })
    ).toEqual({ kind: "merge.preview", found: true, games: 0, dropped: 0 });
    // A club folded into itself is nothing to fold.
    expect(answerQuery({ kind: "merge.preview", fromId: "A", intoId: "A", adopt: [] })).toEqual({
      kind: "merge.preview",
      found: false,
      games: 0,
      dropped: 0,
    });
  });
});

describe("a rename preview", () => {
  it("names the club already under the new name, and what folding into it touches, as the page's rename", () => {
    for (const name of ["Club B", "  club b ", "Club B 10U", "Club D", "   "]) {
      const page = renameScoutTeam("A", name, TEAMS, GAMES, GROUPS);
      const answer = answerQuery({ kind: "rename.preview", teamId: "A", name });
      expect([name, answer.kind === "rename.preview" ? answer.into?.id : "?"]).toEqual([
        name,
        page.mergedInto?.id,
      ]);
      expect([name, answer]).toMatchObject([
        name,
        { dropped: page.droppedGames, games: page.mergedInto ? 4 : 0 },
      ]);
    }
    expect(answerQuery({ kind: "rename.preview", teamId: "A", name: "Club D 10U" })).toEqual({
      kind: "rename.preview",
      name: "Club D",
      into: null,
      games: 0,
      dropped: 0,
    });
    // Its own name is no other club's.
    expect(answerQuery({ kind: "rename.preview", teamId: "A", name: "club a" })).toMatchObject({
      into: null,
    });
  });
});

describe("a question as the server reads one", () => {
  const MERGE: PoolQuery = {
    kind: "merge.preview",
    fromId: "A",
    intoId: "B",
    adopt: [{ id: "B", name: "Club B" }],
  };
  const RENAME: PoolQuery = { kind: "rename.preview", teamId: "A", name: "Club B" };

  it("is the question exactly as sent", () => {
    expect(coerceQuery(JSON.parse(JSON.stringify(MERGE)))).toEqual(MERGE);
    expect(coerceQuery(RENAME)).toEqual(RENAME);
  });

  it("is refused with a field it does not read, a field of the wrong kind, or a kind it does not know", () => {
    for (const raw of [
      { ...RENAME, extra: 1 },
      { ...MERGE, adopt: [{ id: "B", name: "Club B", state: 5 }] },
      { ...MERGE, adopt: "B" },
      { ...MERGE, fromId: "" },
      { ...RENAME, name: 7 },
      { kind: "health" },
      { kind: "constructor" },
      null,
      [RENAME],
      "rename.preview",
    ]) {
      expect(coerceQuery(raw)).toBeNull();
    }
  });
});

describe("an answer as a device reads one", () => {
  it("is the answer exactly, of the kind it asked", () => {
    const merged = { kind: "merge.preview", found: true, games: 4, dropped: 2 };
    expect(coerceQueryAnswer(merged, "merge.preview")).toEqual(merged);
    const renamed = {
      kind: "rename.preview",
      name: "Club B",
      into: { id: "B", name: "Club B" },
      games: 4,
      dropped: 2,
    };
    expect(coerceQueryAnswer(renamed, "rename.preview")).toEqual(renamed);
    expect(coerceQueryAnswer({ ...renamed, into: null }, "rename.preview")).toEqual({
      ...renamed,
      into: null,
    });
  });

  it("is refused when it answers another question, or is not an answer's shape", () => {
    const merged = { kind: "merge.preview", found: true, games: 4, dropped: 2 };
    for (const [raw, kind] of [
      [merged, "rename.preview"],
      [{ ...merged, found: "yes" }, "merge.preview"],
      [{ ...merged, games: -1 }, "merge.preview"],
      [{ ...merged, dropped: 5 }, "merge.preview"],
      [{ ...merged, games: 1.5 }, "merge.preview"],
      [
        { kind: "rename.preview", name: "X", into: { id: "" }, games: 0, dropped: 0 },
        "rename.preview",
      ],
      [{ kind: "rename.preview", into: null, games: 0, dropped: 0 }, "rename.preview"],
      [null, "merge.preview"],
    ] as const) {
      expect(coerceQueryAnswer(raw, kind)).toBeNull();
    }
  });
});
