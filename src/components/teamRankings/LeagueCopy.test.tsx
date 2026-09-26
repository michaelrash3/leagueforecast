import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/*
 * A league game that a pull also brought in is one game on the board.
 *
 * The case that found it: a 9U league plays "Cincinnati Angels- Red", and the roster lists an 11U
 * "Cincinnati Angels Red" first. The league's copy of the game went to that club by name, the pull's
 * copy was against the 9U club, and the board counted the Trash Pandas' loss twice — 0-7 on the
 * phone against GameChanger's 0-6. Carried onto the club Settings links the league team to, the two
 * copies are one fixture and collapse.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-26T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const final = (away: number, home: number) => ({
  awayRuns: String(away),
  awayHits: "",
  awayK: "",
  homeRuns: String(home),
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const pool = (): Pool => ({
  ageGroups: [ageGroup(9, 2027, { seasonIds: ["default"] }), ageGroup(11, 2027)],
  teams: [
    team("S-ANG11", "Cincinnati Angels Red", { city: "Cincinnati", state: "OH" }),
    team("S-ELEV", "Elevens", { state: "OH" }),
    team("S-TP", "Trash Pandas Baseball Club", { city: "Hebron", state: "KY" }),
    team("S-ANG9", "Cincinnati Angels- Red", { city: "Harrison", state: "OH" }),
  ],
  games: [
    game("gc_tp_1", "ag_9u_2027", "S-TP", "S-ANG9", 13, 21, { date: "2026-09-18" }),
    game("gc_11_1", "ag_11u_2027", "S-ANG11", "S-ELEV", 5, 3, { date: "2026-09-19" }),
  ],
  league: {
    teams: [
      { id: "L-TP", name: "Trash Pandas Baseball Club" },
      { id: "L-ANG", name: "Cincinnati Angels- Red" },
    ],
    matchups: [{ id: "m1", date: "9/18", away: "L-TP", home: "L-ANG" }],
    logs: { m1: final(13, 21) },
  },
});

/*
 * The same game filed by the club's own schedule against a slot: 513 Force - Bouley's 0-13 on 25
 * September was "TBD- 09/25/26, 7:15 PM" on GameChanger and the Cincinnati Hornets in the league,
 * and the Hornets' own schedule is not in the pool. The team panel listed two 0-13 losses that day.
 */
const againstASlot = (): Pool => ({
  ageGroups: [ageGroup(9, 2027, { seasonIds: ["default"] })],
  teams: [
    team("S-513", "513 FORCE - BOULEY", {
      city: "Cincinnati",
      state: "OH",
      gcTeams: [{ teamId: "gc513", name: "513 FORCE - BOULEY 9U", ageGroupId: "ag_9u_2027" }],
    }),
    team("S-HORN", "Cincinnati Hornets", { city: "Cincinnati", state: "OH" }),
    team("S-TBD", "TBD- 09/25/26, 7:15 PM", { placeholder: true }),
  ],
  games: [
    game("gc_513_1", "ag_9u_2027", "S-513", "S-TBD", 0, 13, {
      date: "2026-09-25",
      source: { kind: "gamechanger", teamId: "gc513", gameId: "g1" },
    }),
  ],
  league: {
    teams: [
      { id: "L-513", name: "513 FORCE - BOULEY" },
      { id: "L-HORN", name: "Cincinnati Hornets" },
    ],
    matchups: [{ id: "m1", date: "9/25", away: "L-513", home: "L-HORN" }],
    logs: { m1: final(0, 13) },
  },
});

/** Record and games off a team's row in the full table. */
const recordOf = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
  const row = within(screen.getByRole("table")).getByRole("button", { name }).closest("tr")!;
  const cells = within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent?.trim());
  // Rank, Team, Record, Rating, Best guess, Games.
  return { record: cells[2], games: cells[5] };
};

describe("a league game the pull also has", () => {
  it("counts once on the board", async () => {
    renderTeamRankings(pool());
    expect(await recordOf("Trash Pandas Baseball Club")).toEqual({ record: "0-1", games: "1" });
  });

  it("counts once when the club's own schedule had it against TBD", async () => {
    renderTeamRankings(againstASlot());
    expect(await recordOf("513 FORCE - BOULEY")).toEqual({ record: "0-1", games: "1" });
  });
});
