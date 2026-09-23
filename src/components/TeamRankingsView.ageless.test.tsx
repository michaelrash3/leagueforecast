import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";
import { loadAgelessCleared, loadAgeUnknown, loadDroppedClubs } from "../lib/teamRankingsStorage";
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

  /*
   * And the row goes with it. A row only ever left the waiting list when a later pull came back
   * with something other than "no age", so a thrown-out club sat there until it was fetched
   * again — two requests to learn what somebody had already said, on every catch-up day until
   * then. The answer takes the row with it now.
   */
  it("takes the row off the waiting list, rather than leaving it for a pull to clean up", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await openSetup(user);
    expect(loadAgeUnknown().map((entry) => entry.teamId)).toEqual(["GC-DUCKS"]);

    await user.click(screen.getByRole("button", { name: "Not a real team" }));
    expect(loadAgeUnknown()).toEqual([]);
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

/**
 * Clearing what a rule has settled, through the view.
 *
 * The one large action on the card, and the one a person cannot check by eye afterwards: so it
 * asks first, says how many each rule is clearing, stores the pass whole with the reason for each
 * row before anything goes, and the undo puts every row back.
 */
describe("clearing the rows a rule has settled", () => {
  const evidence = {
    games: 8,
    scored: 8,
    aheadOfToday: 0,
    shutoutBlowouts: 0,
    opponents: 6,
    namedAnAge: 0,
    tally: [],
  };
  const settled: AgeUnknownList = [
    {
      teamId: "GC-TBALL",
      name: "MTAA TBall White",
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastTried: "2026-09-10T00:00:00.000Z",
      tries: 1,
      evidence,
    },
    {
      teamId: "GC-LL",
      name: "Fire Chiefs",
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastTried: "2026-09-10T00:00:00.000Z",
      tries: 1,
      evidence: { ...evidence, ngb: ["little_league"] },
    },
    ...ageless,
  ];

  it("asks first, clears with the reason for each row, and undoes the lot", async () => {
    const user = userEvent.setup();
    const { requestConfirmation, showToast } = renderTeamRankings({ ...pool(), ageless: settled });
    await openSetup(user);
    await user.click(screen.getByRole("button", { name: "Clear the 2 ticked" }));

    const asked = requestConfirmation.mock.calls[0]?.[0] as { title: string; message: string };
    expect(asked.title).toBe("Clear 2 teams?");
    expect(asked.message).toMatch(/1: Tee ball and younger/);
    expect(asked.message).toMatch(/1: A Little League/);

    await waitFor(() => expect(loadDroppedClubs().has("GC-LL")).toBe(true));
    expect(loadDroppedClubs().has("GC-TBALL")).toBe(true);
    expect(loadAgeUnknown().map((entry) => entry.teamId)).toEqual(["GC-DUCKS"]);
    const pass = await loadAgelessCleared();
    expect(pass?.rows.map(({ entry, why }) => [entry.teamId, why])).toEqual([
      ["GC-TBALL", "too-young"],
      ["GC-LL", "rec"],
    ]);

    const calls = showToast.mock.calls;
    const [, options] = calls[calls.length - 1]!;
    options!.onAction!();
    await waitFor(() => expect(loadDroppedClubs().has("GC-LL")).toBe(false));
    expect(
      loadAgeUnknown()
        .map((entry) => entry.teamId)
        .sort()
    ).toEqual(["GC-DUCKS", "GC-LL", "GC-TBALL"].sort());
  });
});
