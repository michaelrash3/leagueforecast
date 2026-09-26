import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import type { ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { apartKey } from "../../lib/keptApart";
import { loadKeptApart } from "../../lib/teamRankingsStorage";

/**
 * One squad on GameChanger twice under two names — a coach's own team, "Cubs Fall 2026", and a
 * parent's, "EB GRN" — posting the same games. Nothing matched their names, so nothing offered
 * them, and every opponent was credited with each of those games twice.
 */
const group = ageGroup(9, 2027);
const pulled = (id: string, name: string, gcId: string, win: number, loss: number): ScoutTeam =>
  team(id, name, {
    state: "NJ",
    gcTeams: [
      {
        teamId: gcId,
        name: `${name} 9U`,
        ageGroupId: group.id,
        ageLevel: 9,
        record: { win, loss, tie: 0 },
        playerCount: 11,
      },
    ],
  });
/** A game the named schedule listed itself, at a clock time on the squad year's day. */
const listed = (
  by: string,
  id: string,
  a: string,
  b: string,
  clock: string,
  score: [number, number]
) =>
  game(id, group.id, a, b, score[0], score[1], {
    date: seasonDate(2027),
    startTs: `${seasonDate(2027)}T${clock}:00.000Z`,
    source: { kind: "gamechanger", teamId: by, gameId: id },
  });

const games: ScoutGame[] = [
  listed("gcGRN0000000", "g1", "grn", "bull", "14:00", [4, 7]),
  listed("gcCUBS000000", "c1", "cubs", "bull", "14:00", [4, 7]),
  listed("gcGRN0000000", "g2", "grn", "hawk", "17:00", [9, 1]),
  listed("gcCUBS000000", "c2", "cubs", "hawk", "17:00", [9, 1]),
  listed("gcCUBS000000", "c3", "cubs", "hawk", "19:30", [3, 3]),
];
const pool = {
  ageGroups: [group],
  teams: [
    pulled("grn", "EB GRN", "gcGRN0000000", 1, 1),
    pulled("cubs", "Cubs Fall 2026", "gcCUBS000000", 1, 1),
    pulled("bull", "Brick American Bulldogs", "gcBULL000000", 5, 2),
    pulled("hawk", "Hawks", "gcHAWK000000", 2, 4),
  ],
  games,
};

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
  await user.click(await screen.findByRole("button", { name: /check the pool/i }));
};
const section = async () =>
  (await screen.findByText(/one squad on gamechanger twice/i)).closest("div")!;

describe("one squad on GameChanger twice", () => {
  it("is offered with the games the two have in common and what GameChanger says of each", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool);
    await openSetup(user);

    const found = await section();
    expect(within(found).getByText("2 games in common")).toBeInTheDocument();
    expect(within(found).getByText(/EB GRN 1-1, 11 players/)).toBeInTheDocument();
    expect(within(found).getByText(/v Brick American Bulldogs, 4-7/)).toBeInTheDocument();
  });

  it("folds into the one the user keeps, whichever it is", async () => {
    const user = userEvent.setup();
    const { requestConfirmation, showToast } = renderTeamRankings(pool);
    await openSetup(user);

    await user.click(await screen.findByRole("button", { name: "Keep EB GRN" }));
    expect(requestConfirmation.mock.calls[0]?.[0]?.title).toBe("Fold Cubs Fall 2026 into EB GRN?");
    expect(showToast).toHaveBeenCalledWith("Folded into EB GRN.", { tone: "success" });
    await waitFor(() => expect(screen.queryByText(/one squad on gamechanger twice/i)).toBeNull());
  });

  it("offers the club with fewer games of its own as the one folded away", async () => {
    const user = userEvent.setup();
    const { requestConfirmation } = renderTeamRankings(pool);
    await openSetup(user);

    await user.click(await screen.findByRole("button", { name: "Keep Cubs Fall 2026" }));
    expect(requestConfirmation.mock.calls[0]?.[0]?.title).toBe("Fold EB GRN into Cubs Fall 2026?");
  });

  it("remembers a pair the user says is two squads, against the GameChanger ids", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool);
    await openSetup(user);

    await user.click(within(await section()).getByRole("button", { name: /not the same/i }));
    expect(loadKeptApart().has(apartKey("gcGRN0000000", "gcCUBS000000"))).toBe(true);
    expect(screen.queryByText(/one squad on gamechanger twice/i)).toBeNull();
  });
});
