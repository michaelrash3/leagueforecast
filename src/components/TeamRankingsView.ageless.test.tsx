import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";
import { loadDroppedClubs } from "../lib/teamRankingsStorage";
import type { AgeUnknownList } from "../lib/ageUnknown";

const ageless: AgeUnknownList = [
  {
    teamId: "GC-DUCKS",
    name: "Oregon Ducks 2055",
    firstSeen: "2026-09-01T00:00:00.000Z",
    lastTried: "2026-09-10T00:00:00.000Z",
    tries: 1,
  },
];

const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces", { state: "KY" }), team("S-B", "Badgers", { state: "KY" })],
  games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
  ageless,
});

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: /Setup/i }));
};

/**
 * Throwing out a team nobody could age.
 *
 * This is a queue worked ten at a time and mostly full of junk that takes a second to recognise,
 * so a dialog in front of every one puts a second click on the common case to guard against the
 * rare one. The guard belongs after the action instead, where it costs nothing unless it is
 * needed — and it can, because nothing is destroyed: the club was never filed, so this writes an
 * id to a list and the undo takes it straight back off.
 */
describe("throwing out a team from the review card", () => {
  it("does it at once, with no dialog in the way", async () => {
    const user = userEvent.setup();
    const { requestConfirmation } = renderTeamRankings(pool());
    await openSetup(user);
    await user.click(screen.getByRole("button", { name: "Not a real team" }));

    expect(requestConfirmation).not.toHaveBeenCalled();
    expect(loadDroppedClubs().has("GC-DUCKS")).toBe(true);
  });

  it("offers the way back on the toast, and takes it", async () => {
    const user = userEvent.setup();
    const { showToast } = renderTeamRankings(pool());
    await openSetup(user);
    await user.click(screen.getByRole("button", { name: "Not a real team" }));

    const calls = showToast.mock.calls;
    const [message, options] = calls[calls.length - 1]!;
    expect(message).toContain("Oregon Ducks 2055");
    expect(options?.actionLabel).toBe("Undo");

    // The undo is the whole guard now, so it has to actually put the club back.
    options!.onAction!();
    expect(loadDroppedClubs().has("GC-DUCKS")).toBe(false);
  });
});
