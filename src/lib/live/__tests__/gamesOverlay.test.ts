import { describe, expect, it } from "vitest";
import type { AgeGroup, ScoutGame } from "../../teamRankings";
import type { PoolCommand } from "../commands";
import { gamesAfter, overlayGames } from "../gamesOverlay";

/*
 * A page's games with the edits to them drawn over the published list (`gamesOverlay.ts`): worked
 * out by the command the server runs, on the list and the pages alone. Placeholder ids throughout.
 */

const PAGES: AgeGroup[] = [
  { id: "ag_12u_2027", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
];
const game = (id: string, more: Partial<ScoutGame> = {}): ScoutGame => ({
  id,
  teamAId: "S-1",
  teamBId: "S-2",
  ageGroupId: "ag_12u_2027",
  date: "2027-04-15",
  ...more,
});
const LIST: ScoutGame[] = [
  game("g1", { teamAScore: 7, teamBScore: 2 }),
  game("g2"),
  game("g3", { teamAScore: 3, teamBScore: 1 }),
];

const look = (games: readonly ScoutGame[]) =>
  games.map(({ id, teamAScore, teamBScore, excluded }) => [
    id,
    teamAScore ?? null,
    teamBScore ?? null,
    excluded === true,
  ]);

describe("a page's games after one edit to them", () => {
  it("takes a score typed for a game still owed one", () => {
    const after = gamesAfter(LIST, PAGES, 2027, {
      kind: "game.score",
      year: 2027,
      gameId: "g2",
      teamAScore: 4,
      teamBScore: 5,
    });
    expect(look(after ?? [])).toEqual([
      ["g1", 7, 2, false],
      ["g2", 4, 5, false],
      ["g3", 3, 1, false],
    ]);
  });

  it("keeps a game out of the maths", () => {
    const after = gamesAfter(LIST, PAGES, 2027, {
      kind: "game.exclude",
      year: 2027,
      gameId: "g1",
      excluded: true,
    });
    expect(look(after ?? [])[0]).toEqual(["g1", 7, 2, true]);
  });

  it("takes a game out, and puts it back where it stood", () => {
    const out = gamesAfter(LIST, PAGES, 2027, { kind: "game.remove", year: 2027, gameIds: ["g2"] });
    expect(out?.map(({ id }) => id)).toEqual(["g1", "g3"]);
    const back = gamesAfter(out ?? [], PAGES, 2027, {
      kind: "game.insert",
      year: 2027,
      games: [{ game: game("g2"), at: 1 }],
    });
    expect(back?.map(({ id }) => id)).toEqual(["g1", "g2", "g3"]);
  });

  it("is null for a game the list does not hold, which the server refuses too", () => {
    expect(
      gamesAfter(LIST, PAGES, 2027, {
        kind: "game.exclude",
        year: 2027,
        gameId: "g9",
        excluded: true,
      })
    ).toBe(null);
  });

  it("leaves the list it was given as it was", () => {
    const before = structuredClone(LIST);
    gamesAfter(LIST, PAGES, 2027, { kind: "game.remove", year: 2027, gameIds: ["g1"] });
    expect(LIST).toEqual(before);
  });
});

describe("a page's games with the edits not yet published drawn over them", () => {
  it("is the very list published when no edit since is to its year's games", () => {
    const edits: PoolCommand[] = [
      // An edit to more than games: the server's, worked out on its whole pool, is not guessed at.
      { kind: "club.leavePage", ageGroupId: "ag_12u_2027", teamId: "S-1" },
      { kind: "club.drop", teamId: "S-1" },
      // Edits to another year's games, the one taking out a game this list holds by its id.
      { kind: "game.exclude", year: 2026, gameId: "g1", excluded: true },
      { kind: "game.remove", year: 2026, gameIds: ["g1"] },
    ];
    expect(overlayGames(LIST, PAGES, 2027, [])).toBe(LIST);
    expect(overlayGames(LIST, PAGES, 2027, edits)).toBe(LIST);
  });

  it("runs each in the order made, a batch's steps among them, and skips one refused", () => {
    const shown = overlayGames(LIST, PAGES, 2027, [
      { kind: "game.exclude", year: 2027, gameId: "g1", excluded: true },
      {
        kind: "batch",
        commands: [
          { kind: "game.score", year: 2027, gameId: "g2", teamAScore: 1, teamBScore: 0 },
          { kind: "club.drop", teamId: "S-2" },
        ],
      },
      // Refused: a game the list does not hold.
      { kind: "game.exclude", year: 2027, gameId: "g9", excluded: true },
      { kind: "game.remove", year: 2027, gameIds: ["g3"] },
      { kind: "game.exclude", year: 2027, gameId: "g1", excluded: false },
    ]);
    expect(look(shown)).toEqual([
      ["g1", 7, 2, false],
      ["g2", 1, 0, false],
    ]);
  });
});
