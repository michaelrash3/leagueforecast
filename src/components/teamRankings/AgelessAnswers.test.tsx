import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { markTaken, resetCloudGuard } from "../../lib/cloud/cloudGuard";
import { loadAgeUnknown, loadDroppedClubs } from "../../lib/teamRankingsStorage";
import { ageGroup, renderTeamRankings, team } from "../../test/teamRankingsHarness";

/*
 * Throwing out a team nobody could age, as the page does it: the id goes on the list a pull
 * refuses (`answers`, droppedClubs) and comes off the waiting list. Placeholder names throughout.
 */
afterEach(() => resetCloudGuard());

const waiting = [
  {
    teamId: "gcWAITING01",
    name: "Waiting Club",
    firstSeen: "2026-09-01T12:00:00.000Z",
    lastTried: "2026-09-10T12:00:00.000Z",
    tries: 1,
    evidence: {
      games: 4,
      scored: 4,
      aheadOfToday: 0,
      shutoutBlowouts: 0,
      opponents: 4,
      namedAnAge: 0,
      tally: [],
    },
  },
];

const openCard = async (user: ReturnType<typeof userEvent.setup>) => {
  const harness = renderTeamRankings({
    ageGroups: [ageGroup(10, 2027)],
    teams: [team("S-RAYS", "Rays")],
    games: [],
    ageless: waiting,
  });
  await user.click(screen.getByRole("tab", { name: "Setup" }));
  await screen.findByText("Teams waiting on an age");
  return harness;
};

describe("a team thrown out from the waiting list", () => {
  it("goes on the list a pull refuses and comes off the waiting list", async () => {
    const user = userEvent.setup();
    await openCard(user);
    await user.click(await screen.findByRole("button", { name: /Not a real team/ }));
    await waitFor(() => expect([...loadDroppedClubs()]).toEqual(["gcWAITING01"]));
    expect(loadAgeUnknown()).toEqual([]);
  });

  it("stays on the waiting list when the store will not keep the answer", async () => {
    const user = userEvent.setup();
    const harness = await openCard(user);
    const throwOut = await screen.findByRole("button", { name: /Not a real team/ });
    // Another tab took a newer copy of the pool in: this one may not write over it.
    markTaken("pool", false);
    await user.click(throwOut);
    expect([...loadDroppedClubs()]).toEqual([]);
    expect(loadAgeUnknown().map((row) => row.teamId)).toEqual(["gcWAITING01"]);
    // Said to be refused, and not said to be done.
    expect(harness.toasts()).toContain("Could not save (storage full).");
    expect(harness.toasts()).not.toContain("Waiting Club thrown out.");
  });
});
