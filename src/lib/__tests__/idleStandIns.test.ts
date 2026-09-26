import { describe, expect, it } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import {
  describeTidy,
  importGcSchedule,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";

/*
 * A stand-in is a name a schedule typed that nobody pulled. A step that empties one takes it out
 * as it goes; a game the user deletes, or a club, leaves it behind with nothing to stand for, and
 * nothing came back for it. The tidy takes those out once its passes are done.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const aces: GcTeamSchedule = {
  profile: { id: "gcA", name: "Aces 9U", ageLevel: 9, season: { season: "fall", year: 2026 } },
  games: [
    {
      id: "a1",
      date: "2026-09-05",
      startTs: "2026-09-05T18:00:00.000Z",
      opponentName: "Sharks",
      status: "completed",
      teamScore: 7,
      opponentScore: 3,
    },
    {
      id: "a2",
      date: "2026-09-12",
      startTs: "2026-09-12T18:00:00.000Z",
      opponentName: "Marlins",
      status: "completed",
      teamScore: 2,
      opponentScore: 4,
    },
  ],
  fetchedAt: "2026-09-13T00:00:00.000Z",
};
const pulled = importGcSchedule(aces, empty).state;
const idOf = (state: GcImportState, name: string) =>
  state.teams.find((team) => team.name === name)?.id;
/** The pool with the Aces' game against "Sharks" deleted by hand, as the user deletes one. */
const deleted = (state: GcImportState = pulled): GcImportState => ({
  ...state,
  games: state.games.filter((game) => game.teamBId !== idOf(state, "Sharks")),
});

describe("a stand-in left with nothing to stand for", () => {
  it("is taken out once the passes are done, in one pass", () => {
    const input = deleted();
    const tidy = tidyPool(input);
    expect(tidy.idle).toBe(1);
    expect(tidy.passes).toBe(1);
    expect(idOf(tidy.state, "Sharks")).toBeUndefined();
    expect(idOf(tidy.state, "Marlins")).toBeDefined();
    // The roster alone: the games are the very array the tidy was handed.
    expect(tidy.state.games).toBe(input.games);
    expect(tidyChangedAnything(tidy)).toBe(true);
    expect(describeTidy(tidy)).toContain("1 opponent no game names any more, taken off the list.");
    const again = tidyPool(tidy.state);
    expect(again.idle).toBe(0);
    expect(tidyChangedAnything(again)).toBe(false);
  });

  it("stays while a claimed row elsewhere goes back to it", () => {
    const state = deleted();
    const sharks = idOf(pulled, "Sharks")!;
    const holder = state.games[0]!;
    const withClaim: GcImportState = {
      ...state,
      games: [
        {
          ...holder,
          alsoRows: [{ teamId: "gcZ", gameId: "z1", filedAgainst: sharks }],
          alsoFrom: ["gcZ"],
        },
      ],
    };
    expect(tidyPool(withClaim).state.teams.some((team) => team.id === sharks)).toBe(true);
  });

  it("stays as a page's own team, or one marked as ours", () => {
    const sharks = idOf(pulled, "Sharks")!;
    const state = deleted();
    const mine: GcImportState = {
      ...state,
      ageGroups: state.ageGroups.map((group) => ({ ...group, myTeamId: sharks })),
    };
    expect(tidyPool(mine).idle).toBe(0);
    const marked: GcImportState = {
      ...state,
      teams: state.teams.map((team) => (team.id === sharks ? { ...team, isMine: true } : team)),
    };
    expect(tidyPool(marked).idle).toBe(0);
  });

  it("leaves a pulled club with no game in the pool", () => {
    const bears: GcTeamSchedule = {
      profile: { id: "gcB", name: "Bears 9U", ageLevel: 9, season: { season: "fall", year: 2026 } },
      games: [],
      fetchedAt: "2026-09-13T00:00:00.000Z",
    };
    const state = importGcSchedule(bears, pulled).state;
    const tidy = tidyPool(state);
    expect(tidy.idle).toBe(0);
    expect(idOf(tidy.state, "Bears")).toBeDefined();
    // Nor one a hand merge left flagged as a name only: its GameChanger link makes it a club.
    const flagged: GcImportState = {
      ...state,
      teams: state.teams.map((team) =>
        team.name === "Bears" ? { ...team, nameOnly: true } : team
      ),
    };
    expect(tidyPool(flagged).idle).toBe(0);
  });
});
