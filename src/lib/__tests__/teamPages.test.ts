import { describe, expect, it } from "vitest";
import { teamPages, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

const groups: AgeGroup[] = [
  { id: "ag_9_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag_10_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "ag_10_2028", name: "10U 2028", ageLevel: 10, year: 2028, seasonIds: [] },
  { id: "ag_11_2028", name: "11U 2028", ageLevel: 11, year: 2028, seasonIds: [] },
];

const team = (id: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name: `Team ${id}`,
  ...extra,
});

const game = (
  id: string,
  ageGroupId: string,
  a: string,
  b: string,
  date: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  ageGroupId,
  teamAId: a,
  teamBId: b,
  teamAScore: 5,
  teamBScore: 3,
  date,
  ...extra,
});

describe("where to find a team", () => {
  it("puts a team on the page for the level it plays", () => {
    const pages = teamPages(
      [team("A"), team("B")],
      [game("g1", "ag_9_2027", "A", "B", "2026-09-12")],
      groups
    );
    expect(pages.get("A")?.ageGroupId).toBe("ag_9_2027");
    expect(pages.get("A")).toMatchObject({ level: 9, year: 2027 });
  });

  it("follows a club to the most recent season it played", () => {
    const pages = teamPages(
      [team("A"), team("B")],
      [
        game("g1", "ag_10_2027", "A", "B", "2026-09-12"),
        game("g2", "ag_11_2028", "A", "B", "2027-09-12"),
      ],
      groups
    );
    // A club pulled across three seasons should be found where it is now, not where it started.
    expect(pages.get("A")).toMatchObject({ level: 11, year: 2028 });
  });

  it("keeps a team that played up on its own page, not the tournament's", () => {
    const pages = teamPages(
      [team("A"), team("B"), team("C")],
      [
        // Three games at 9U and one entered at 10U: still a 9U team with a game played up.
        game("g1", "ag_9_2027", "A", "B", "2026-09-12", { ageLevelA: 9, ageLevelB: 9 }),
        game("g2", "ag_9_2027", "A", "B", "2026-09-19", { ageLevelA: 9, ageLevelB: 9 }),
        game("g3", "ag_9_2027", "A", "C", "2026-09-26", { ageLevelA: 9, ageLevelB: 9 }),
        game("g4", "ag_10_2027", "A", "C", "2026-10-03", { ageLevelA: 9, ageLevelB: 10 }),
      ],
      groups
    );
    expect(pages.get("A")?.level).toBe(9);
  });

  it("has no page for a placeholder, which names nobody", () => {
    const pages = teamPages(
      [team("A"), team("TBD", { placeholder: true })],
      [game("g1", "ag_9_2027", "A", "TBD", "2026-09-12")],
      groups
    );
    expect(pages.has("TBD")).toBe(false);
    expect(pages.has("A")).toBe(true);
  });

  it("has no page for a club known only from somebody else's schedule", () => {
    const pages = teamPages(
      [team("A"), team("B", { nameOnly: true })],
      [game("g1", "ag_9_2027", "A", "B", "2026-09-12")],
      groups
    );
    expect(pages.has("B")).toBe(false);
  });

  it("has no page for a team with no games at all", () => {
    expect(teamPages([team("A")], [], groups).has("A")).toBe(false);
  });

  it("falls back to where the results actually are when no page fits the level", () => {
    // A game filed on the 9U page but recording both sides as 14U — no 14U page exists, so the
    // page carrying the results is the only place somebody would find them.
    const pages = teamPages(
      [team("A"), team("B")],
      [game("g1", "ag_9_2027", "A", "B", "2026-09-12", { ageLevelA: 14, ageLevelB: 14 })],
      groups
    );
    expect(pages.get("A")?.ageGroupId).toBe("ag_9_2027");
  });

  it("has nothing to say when there are no age groups", () => {
    expect(teamPages([team("A")], [game("g1", "ag_9_2027", "A", "B", "2026-09-12")], []).size).toBe(
      0
    );
  });

  it("answers for every team in the pool, not just one", () => {
    const pages = teamPages(
      [team("A"), team("B"), team("C")],
      [
        game("g1", "ag_9_2027", "A", "B", "2026-09-12"),
        game("g2", "ag_11_2028", "C", "A", "2027-09-12"),
      ],
      groups
    );
    expect([...pages.keys()].sort()).toEqual(["A", "B", "C"]);
  });

  it("costs one pass per season rather than one per team", () => {
    const teams = Array.from({ length: 4_000 }, (_, index) => team(`T${index}`));
    const games = Array.from({ length: 4_000 }, (_, index) =>
      game(`g${index}`, "ag_9_2027", `T${index}`, `T${(index + 1) % 4_000}`, "2026-09-12")
    );
    const started = Date.now();
    expect(teamPages(teams, games, groups).size).toBe(4_000);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
