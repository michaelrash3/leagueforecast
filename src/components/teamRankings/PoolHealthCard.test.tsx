import { screen } from "@testing-library/react";
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

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
};

const look = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /check the pool/i }));
};

/**
 * One club's schedule names the opponent; the other posted the same game against a stand-in with
 * the mirrored score. That is the shape the settling pass exists for, and the shape a real pool
 * had eleven thousand of, unsettled.
 */
const withStandIn = () => {
  const teams: ScoutTeam[] = [
    team("S-HOME", "Home Club", { state: "KY" }),
    team("S-AWAY", "Away Club", { state: "KY" }),
    team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
  ];
  const games: ScoutGame[] = [
    game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
    }),
    game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
      date: seasonDate(2027),
      source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
    }),
  ];
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

describe("seeing what the pool is made of", () => {
  it("says nothing until it is asked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);

    // Walking every game is not something opening Setup should pay for.
    expect(screen.getByRole("button", { name: /check the pool/i })).toBeInTheDocument();
    expect(screen.queryByText(/stand-ins/i)).toBeNull();
  });

  it("counts the clubs apart from the stand-ins", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    expect(await screen.findByText(/results against a stand-in/i)).toBeInTheDocument();
    expect(screen.getByText("Stand-ins")).toBeInTheDocument();
  });

  it("says how many could be settled right now", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    // The other side's schedule names the club and the scores mirror.
    expect(await screen.findByRole("button", { name: /settle 1 of them/i })).toBeInTheDocument();
  });

  it("settles them when asked, and says what it did", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);
    await user.click(await screen.findByRole("button", { name: /settle 1 of them/i }));

    // Nothing left to settle, and the stand-in is gone from the roster.
    expect(await screen.findByText(/nothing is waiting/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /settle/i })).toBeNull();
  });

  it("is honest when nothing can be settled from what is here", async () => {
    const user = userEvent.setup();
    const alone = withStandIn();
    renderTeamRankings({
      ...alone,
      // Drop the other side's row, so nothing names the stand-in.
      games: alone.games.filter((g) => g.id === "slot"),
    });
    await openSetup(user);
    await look(user);

    expect(await screen.findByText(/nobody has pulled the other side/i)).toBeInTheDocument();
  });

  it("says whether the pool is in the shape the tidy left it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withStandIn());
    await openSetup(user);
    await look(user);

    // The harness stamps the pool as tidied, so this is the tidied branch; the other is covered in
    // the poolHealth tests, where the stamp can be set to something else.
    expect(await screen.findByText("Tidied")).toBeInTheDocument();
  });
});
