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
 * The name box on a club League Standings reaches.
 *
 * Since a league team's games go onto the club Settings links it to, a pulled club picked for the
 * league's "Trash Pandas" was locked like a team the league made, over a line saying its name was
 * set there. The name is GameChanger's, and a pick holds by id, so a new name keeps the league's
 * games where they are. A club the league reaches by its name stays locked: renaming that one is
 * how the league's copy of a game comes loose from the pull's and counts twice.
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

const LOCKED = /comes from a League Standings season/i;

/** The Trash Pandas' pull has the league's 9/18 game; the league's roster is the case's own. */
const pool = (league: NonNullable<Pool["league"]>): Pool => ({
  ageGroups: [ageGroup(9, 2027, { seasonIds: ["default"] })],
  teams: [
    team("S-TP", "Trash Pandas Baseball Club", {
      state: "KY",
      gcTeams: [
        { teamId: "gcTP", name: "Trash Pandas Baseball Club 9U", ageGroupId: "ag_9u_2027" },
      ],
    }),
    team("S-ANG", "Cincinnati Angels- Red", {
      state: "OH",
      gcTeams: [{ teamId: "gcANG", name: "Cincinnati Angels- Red", ageGroupId: "ag_9u_2027" }],
    }),
    team("S-GEN", "The Generals", {
      state: "KY",
      gcTeams: [{ teamId: "gcGEN", name: "The Generals 9U", ageGroupId: "ag_9u_2027" }],
    }),
  ],
  games: [
    game("gc_tp_1", "ag_9u_2027", "S-TP", "S-ANG", 13, 21, {
      date: "2026-09-18",
      source: { kind: "gamechanger", teamId: "gcTP", gameId: "g1" },
    }),
  ],
  league,
});

const TRASH_PANDAS_GAME = {
  matchups: [{ id: "m1", date: "9/18", away: "L-TP", home: "L-ANG" }],
  logs: { m1: final(13, 21) },
};

/** Opens a club's panel from the full table. */
const openPanel = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name }));
  return { user, input: (await screen.findByLabelText("Team name")) as HTMLInputElement };
};

/** Record and games off a team's row in the table, already opened to every team. */
const recordOf = async (name: string) => {
  const table = screen.getByRole("table");
  const row = (await within(table).findByRole("button", { name })).closest("tr")!;
  const cells = within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent?.trim());
  // Rank, Team, Record, Rating, Best guess, Games.
  return { record: cells[2], games: cells[5] };
};

describe("the name of a club League Standings reaches", () => {
  it("can be changed when a pick is the link, and the league's game stays one game", async () => {
    renderTeamRankings(
      pool({
        teams: [
          { id: "L-TP", name: "Trash Pandas", scoutTeamId: "S-TP" },
          { id: "L-ANG", name: "Cincinnati Angels- Red" },
        ],
        ...TRASH_PANDAS_GAME,
      })
    );
    const { user, input } = await openPanel("Trash Pandas Baseball Club");
    expect(input).not.toBeDisabled();
    expect(screen.queryByText(LOCKED)).toBeNull();
    expect(screen.getByText(/linked to this club by your pick in Settings/i)).toBeInTheDocument();

    // Onto a name already taken the rename is a merge, which removes the club the pick is of.
    await user.clear(input);
    await user.type(input, "The Generals");
    expect(screen.getByRole("button", { name: "Merge" })).toBeEnabled();
    expect(screen.getByText(/pick of this club is left pointing at nothing/i)).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "Hebron Trash Pandas");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    // Still the one game: the league's copy followed the pick, not the old name.
    expect(await recordOf("Hebron Trash Pandas")).toEqual({ record: "0-1", games: "1" });
    expect(await recordOf("Cincinnati Angels- Red")).toEqual({ record: "1-0", games: "1" });
  });

  it("stays locked when the league reaches it by its name", async () => {
    renderTeamRankings(
      pool({
        teams: [
          { id: "L-TP", name: "Trash Pandas Baseball Club" },
          { id: "L-ANG", name: "Cincinnati Angels- Red" },
        ],
        ...TRASH_PANDAS_GAME,
      })
    );
    const { input } = await openPanel("Trash Pandas Baseball Club");
    expect(input).toBeDisabled();
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
  });

  it("stays locked when two league teams picked it, since neither pick counts", async () => {
    renderTeamRankings(
      pool({
        teams: [
          { id: "L-TP", name: "Trash Pandas Baseball Club", scoutTeamId: "S-TP" },
          { id: "L-ANG", name: "Cincinnati Angels- Red" },
          // A slip in Settings: the Generals picked as the Trash Pandas' club too.
          { id: "L-GEN", name: "The Generals", scoutTeamId: "S-TP" },
        ],
        ...TRASH_PANDAS_GAME,
      })
    );
    const { input } = await openPanel("Trash Pandas Baseball Club");
    expect(input).toBeDisabled();
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
  });

  it("stays locked when one league team picked it and another reaches it by name", async () => {
    renderTeamRankings(
      pool({
        teams: [
          { id: "L-TP", name: "Trash Pandas", scoutTeamId: "S-TP" },
          { id: "L-ANG", name: "Cincinnati Angels- Red" },
          { id: "L-TP2", name: "Trash Pandas Baseball Club" },
        ],
        matchups: [
          ...TRASH_PANDAS_GAME.matchups,
          { id: "m2", date: "9/20", away: "L-TP2", home: "L-ANG" },
        ],
        logs: { ...TRASH_PANDAS_GAME.logs, m2: final(4, 6) },
      })
    );
    const { input } = await openPanel("Trash Pandas Baseball Club");
    expect(input).toBeDisabled();
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
  });
});
