import { describe, expect, it } from "vitest";
import {
  buildScoutingReport,
  buildTeamRankings,
  scheduleComponents,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../teamRankings";

describe("the connected pieces of a schedule", () => {
  it("joins clubs through a chain of opponents, not only direct ones", () => {
    const pieces = scheduleComponents(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["B", "C"],
      ]
    );
    // A never played C, but there is a path, so they are compared.
    expect(pieces.pieceOf("A")).toBe(pieces.pieceOf("C"));
    expect(pieces.sizeOf("A")).toBe(3);
    // D played nobody, so it is its own piece of one.
    expect(pieces.pieceOf("D")).not.toBe(pieces.pieceOf("A"));
    expect(pieces.sizeOf("D")).toBe(1);
    expect(pieces.largest).toBe(pieces.pieceOf("A"));
  });

  it("keeps two islands of the same size apart", () => {
    const pieces = scheduleComponents(
      ["A", "B", "C", "D"],
      [
        ["A", "B"],
        ["C", "D"],
      ]
    );
    // The error this exists to catch: equal size is not the same piece. Two islands of two are
    // still two different averages.
    expect(pieces.sizeOf("A")).toBe(pieces.sizeOf("C"));
    expect(pieces.pieceOf("A")).not.toBe(pieces.pieceOf("C"));
  });

  it("names the same largest piece whatever order the games came in", () => {
    const one = scheduleComponents(
      ["A", "B", "C", "D", "E"],
      [
        ["A", "B"],
        ["B", "C"],
        ["D", "E"],
      ]
    );
    const other = scheduleComponents(
      ["E", "D", "C", "B", "A"],
      [
        ["D", "E"],
        ["C", "B"],
        ["B", "A"],
      ]
    );
    expect(one.sizeOf("A")).toBe(3);
    expect(other.sizeOf("A")).toBe(3);
    expect(one.pieceOf("A")).toBe(one.largest);
    expect(other.pieceOf("A")).toBe(other.largest);
  });

  it("has no largest piece when there is nothing in it", () => {
    const pieces = scheduleComponents([], []);
    expect(pieces.largest).toBeNull();
    expect(pieces.sizeOf("A")).toBe(0);
  });

  it("ignores a game naming a club it was not given", () => {
    const pieces = scheduleComponents(["A", "B"], [["A", "GHOST"]]);
    expect(pieces.sizeOf("A")).toBe(1);
    expect(pieces.pieceOf("A")).not.toBe(pieces.pieceOf("B"));
  });
});

/*
 * The problem this names, and it is not the thin-record one. On the real pool `The Chill Dogs 17-5`
 * was seventh in the nation off an island of 21 clubs — 22 games, a well-determined rating, and
 * determined relative to twenty other clubs rather than to the country. Discounting for evidence
 * does nothing about it, because the evidence is real.
 */
describe("a club the rest of the table has never played", () => {
  const pool: AgeGroup[] = [{ id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] }];

  const built = () => {
    const teams: ScoutTeam[] = [];
    const games: ScoutGame[] = [];
    let at = 0;
    const add = (a: string, b: string, sa: number, sb: number) => {
      games.push({
        id: `g${at++}`,
        ageGroupId: "u9",
        teamAId: a,
        teamBId: b,
        teamAScore: sa,
        teamBScore: sb,
        date: "2026-09-12",
      });
    };
    // A main group of twelve that all play each other.
    for (let i = 0; i < 12; i += 1) teams.push({ id: `M-${i}`, name: `Main ${i}`, state: "KY" });
    for (let i = 0; i < 12; i += 1) {
      for (let j = i + 1; j < 12; j += 1)
        add(`M-${i}`, `M-${j}`, (i + j) % 2 ? 6 : 3, (i + j) % 2 ? 3 : 6);
    }
    // An island of three that play only each other, and one of them wins everything.
    ["I-A", "I-B", "I-C"].forEach((id, index) =>
      teams.push({ id, name: `Island ${index}`, state: "OH" })
    );
    add("I-A", "I-B", 12, 0);
    add("I-A", "I-C", 11, 1);
    add("I-B", "I-C", 6, 5);
    return { teams, games };
  };

  it("says how big the group each club is rated within is", () => {
    const { teams, games } = built();
    const rows = buildTeamRankings("u9", teams, games, undefined, pool);
    const main = rows.find((row) => row.teamId === "M-0")!;
    const island = rows.find((row) => row.teamId === "I-A")!;

    expect(main.componentSize).toBe(12);
    expect(main.comparable).toBe(true);
    expect(island.componentSize).toBe(3);
    expect(island.comparable).toBe(false);
  });

  it("still ranks the island club, because it played real games", () => {
    const { teams, games } = built();
    const rows = buildTeamRankings("u9", teams, games, undefined, pool);
    // Listed, not hidden: hiding a club that won its games would be worse than marking it.
    expect(rows.map((row) => row.teamId)).toContain("I-A");
    expect(rows.find((row) => row.teamId === "I-A")!.record).toBe("2-0");
  });

  it("marks a matchup across two pieces as never compared", () => {
    const { teams, games } = built();
    const rows = buildTeamRankings("u9", teams, games, undefined, pool);
    const report = buildScoutingReport("M-0", rows, teams, { nationalTop: 20 });

    const acrossPieces = report.national.find((one) => one.opponentId === "I-A");
    expect(acrossPieces?.unconnected).toBe(true);
    // The numbers are still there: they are the only answer the model has, and a reader who is
    // told what they are worth can weigh them.
    expect(acrossPieces?.projectedMargin).toBeTypeOf("number");

    const samePiece = report.national.find((one) => one.opponentId === "M-1");
    expect(samePiece?.unconnected).toBe(false);
  });

  it("does not call two clubs never compared when a chain joins them", () => {
    const { teams, games } = built();
    // Bridge the island to the main group with one game, and every comparison becomes real.
    const bridged = [
      ...games,
      {
        id: "bridge",
        ageGroupId: "u9",
        teamAId: "I-A",
        teamBId: "M-0",
        teamAScore: 4,
        teamBScore: 3,
        date: "2026-09-19",
      },
    ];
    const rows = buildTeamRankings("u9", teams, bridged, undefined, pool);
    expect(rows.find((row) => row.teamId === "I-B")!.comparable).toBe(true);
    expect(rows.find((row) => row.teamId === "I-B")!.componentSize).toBe(15);

    // I-B never played M-1 and is two opponents away from it, which is a comparison.
    const report = buildScoutingReport("I-B", rows, teams, { nationalTop: 20 });
    expect(report.national.find((one) => one.opponentId === "M-1")?.unconnected).toBe(false);
  });
});
