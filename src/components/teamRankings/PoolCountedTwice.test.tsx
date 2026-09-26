import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import type { ScoutTeam } from "../../lib/teamRankings";

/**
 * Kentucky Athletics' 9-3 over Hit Dogs Evansville, and the same game again off the schedule of
 * "Hit Dogs", the Hit Dogs' second setup on GameChanger: two counted games at one start with one
 * result, the Athletics credited twice. Nothing matches two names that differ, so nothing tidies it.
 */
const group = ageGroup(10, 2027);
// Another page, so the club opens on its own rather than on whichever is on screen.
const younger = ageGroup(9, 2027);
const pulled = (id: string, name: string, gcId: string): ScoutTeam =>
  team(id, name, {
    state: "KY",
    gcTeams: [{ teamId: gcId, name: `${name} 10U`, ageGroupId: group.id, ageLevel: 10 }],
  });
const day = seasonDate(2027);
const at = `${day}T14:00:00.000Z`;
const pool = {
  ageGroups: [younger, group],
  teams: [
    pulled("ka", "Kentucky Athletics", "gcKA00000000"),
    pulled("hd", "Hit Dogs Evansville", "gcHD00000000"),
    pulled("hd2", "Hit Dogs", "gcHD20000000"),
    team("cubs", "Cubs"),
    team("reds", "Reds"),
  ],
  games: [
    game("y1", younger.id, "cubs", "reds", 4, 2, { date: day }),
    game("g1", group.id, "ka", "hd", 9, 3, {
      date: day,
      startTs: at,
      source: { kind: "gamechanger", teamId: "gcKA00000000", gameId: "g1" },
      alsoRows: [
        { teamId: "gcHD00000000", gameId: "h1", startTs: at, ownScore: 3, opponentScore: 9 },
      ],
      alsoFrom: ["gcHD00000000"],
    }),
    game("g2", group.id, "hd2", "ka", 3, 9, {
      date: day,
      startTs: at,
      source: { kind: "gamechanger", teamId: "gcHD20000000", gameId: "g2" },
    }),
  ],
};

describe("clubs credited twice with one game", () => {
  it("are listed with both opponents, and a club opens from the list", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool);
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: /check the pool/i }));

    const heading = await screen.findByText(/clubs credited twice with one game/i);
    const section = heading.closest("div")!;
    expect(
      within(section).getByText(/2026-09-12, 9-3 v Hit Dogs Evansville and v Hit Dogs/)
    ).toBeInTheDocument();
    expect(within(section).getByText(/at the same start/)).toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Kentucky Athletics" }));
    const panel = await screen.findByRole("region", { name: "Kentucky Athletics" });
    // On the club's own page, with both games: the record the list is about.
    expect(within(panel).getByText(/2-0 in 10U 2027, from 2 games/)).toBeInTheDocument();
  });
});
