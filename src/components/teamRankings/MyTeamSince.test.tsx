import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MyTeamGlance } from "../../lib/myTeamGlance";
import { readMyTeamLook, saveMyTeamLook, type MyTeamLook } from "../../lib/myTeamLook";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import { MyTeamSince } from "./MyTeamSince";

/*
 * The club marked as yours, told on the My Team card what moved since this device last looked:
 * its places, record and rating then and now, until Got it. Placeholder names.
 */
const on = seasonDate(2027);
const HOUR = 3_600_000;

/** The Cows as the board has them: 3rd of 4 nationally, 2nd of 3 in OH, 1-1. */
const pool = (kept?: MyTeamLook) => ({
  ageGroups: [ageGroup(10, 2027, { myTeamId: "S-COW" })],
  teams: [
    team("S-ACE", "Aces", { state: "TX" }),
    team("S-BEE", "Bees", { state: "OH" }),
    team("S-COW", "Cows", { state: "OH" }),
    team("S-DOE", "Does", { state: "OH" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-ACE", "S-BEE", 9, 1, { date: on }),
    game("g2", "ag_10u_2027", "S-BEE", "S-COW", 6, 2, { date: on }),
    game("g3", "ag_10u_2027", "S-COW", "S-DOE", 5, 3, { date: on }),
    game("g4", "ag_10u_2027", "S-ACE", "S-DOE", 8, 0, { date: on }),
  ],
  ...(kept ? { kept: { [`lf_my_team_look_v1_${kept.teamId}`]: JSON.stringify(kept) } } : {}),
});

/** The Cows two days ago, before their last game: last nationally and in OH, 0-1. */
const twoDaysAgo = (over: Partial<MyTeamLook> = {}): MyTeamLook => ({
  v: 1,
  at: Date.now() - 48 * HOUR,
  teamId: "S-COW",
  board: "Fall 2026",
  national: 4,
  nationalOf: 4,
  state: "OH",
  stateRank: 3,
  record: "0-1",
  rating: -4,
  ...over,
});

describe("since you last looked, on the My Team card", () => {
  it("keeps where the club stands on a first visit and tells nothing", async () => {
    renderTeamRankings(pool());
    const card = await screen.findByRole("region", { name: "My team" });
    await waitFor(() => expect(readMyTeamLook("S-COW")).toMatchObject({ national: 3 }));
    expect(within(card).queryByRole("region", { name: "Since you last looked" })).toBeNull();
  });

  it("tells a later visit what moved, until it is put away", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool(twoDaysAgo()));
    const card = await screen.findByRole("region", { name: "My team" });
    const since = await within(card).findByRole("region", { name: "Since you last looked" });

    expect(since).toHaveTextContent("2 days ago");
    expect(since).toHaveTextContent("#4 nationally then, #3 now");
    expect(since).toHaveTextContent("#3 in OH then, #2 now");
    expect(since).toHaveTextContent("0-1 → 1-1");
    // Nothing is kept until it is put away, so leaving without reading it shows it again.
    expect(readMyTeamLook("S-COW")?.national).toBe(4);

    await user.click(within(since).getByRole("button", { name: "Got it" }));
    expect(within(card).queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readMyTeamLook("S-COW")).toMatchObject({ national: 3, stateRank: 2, record: "1-1" });
  });

  it("says nothing within the hour of the last look", async () => {
    renderTeamRankings(pool(twoDaysAgo({ at: Date.now() - HOUR / 2 })));
    const card = await screen.findByRole("region", { name: "My team" });
    await screen.findByText(/National top/i);
    expect(within(card).queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readMyTeamLook("S-COW")?.national).toBe(4);
  });

  it("starts afresh from a look at the other half of the season", async () => {
    renderTeamRankings(pool(twoDaysAgo({ board: "Spring 2026" })));
    const card = await screen.findByRole("region", { name: "My team" });
    await waitFor(() => expect(readMyTeamLook("S-COW")).toMatchObject({ board: "Fall 2026" }));
    expect(within(card).queryByRole("region", { name: "Since you last looked" })).toBeNull();
  });

  it("waits for the board to be fitted to the latest games before it looks", async () => {
    window.localStorage.clear();
    saveMyTeamLook(twoDaysAgo());
    const glance: MyTeamGlance = {
      teamId: "S-COW",
      teamName: "Cows",
      nationalRank: 3,
      nationalOf: 4,
      listedOf: 4,
      state: "OH",
      stateRank: 2,
      stateOf: 3,
      record: "1-1",
      rating: -2.9,
    };
    const { rerender } = render(<MyTeamSince glance={glance} board="Fall 2026" settled={false} />);
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readMyTeamLook("S-COW")?.national).toBe(4);

    rerender(<MyTeamSince glance={glance} board="Fall 2026" settled />);
    expect(
      await screen.findByRole("region", { name: "Since you last looked" })
    ).toBeInTheDocument();
  });
});
