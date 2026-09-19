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

/**
 * One club sitting in the pool as two entries of the same season.
 *
 * GameChanger gives a team a new id every season, so a club that makes one, leaves it and makes
 * another ends up with two ids for one roster in one season. One holds every game it listed; the
 * other holds only what other clubs' schedules named it in — which still reads as a record, so
 * the pool shows the same club twice, each ranked on part of the same season.
 *
 * Nothing offered them. The test for a pairing was that the two seasons were consecutive, and
 * these are the same season, so this was only ever findable by noticing it on the page. And even
 * the pairings that were offered were offered on the screen that comes up when a pull finishes and
 * nowhere else, so a club split in two was actionable for about a minute after a pull.
 */
const group = ageGroup(9, 2027);

const entry = (id: string, gcId: string, extra: Partial<ScoutTeam> = {}): ScoutTeam =>
  team(id, "Ambush 9U", {
    city: "Prestonsburg",
    state: "KY",
    gcTeams: [
      {
        teamId: gcId,
        name: "Ambush 9U",
        ageGroupId: group.id,
        ageLevel: 9,
        season: "fall",
        seasonYear: 2026,
      },
    ],
    ...extra,
  });

/** A game the named GameChanger schedule listed itself, which is what a real squad has. */
const listed = (by: string, id: string, a: string, b: string): ScoutGame =>
  game(id, group.id, a, b, 2, 12, {
    date: seasonDate(2027),
    source: { kind: "gamechanger", teamId: by, gameId: id },
  });

const pool = {
  ageGroups: [group],
  teams: [
    entry("shell", "gcShell00000"),
    entry("real", "gcReal000000"),
    entry("other", "gcOther00000", { name: "NV Stars 9U", city: "Ashland" }),
  ],
  games: [
    // Every game on the real entry's own schedule; the shell's record comes off other people's.
    listed("gcReal000000", "g1", "real", "other"),
    listed("gcReal000000", "g2", "real", "other"),
    listed("gcOther00000", "g3", "other", "shell"),
  ],
};

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
  await user.click(await screen.findByRole("button", { name: /check the pool/i }));
};

describe("a club in the pool twice over", () => {
  it("is named, with what says the two are one", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool);
    await openSetup(user);

    const section = (await screen.findByText(/one club, listed twice/i)).closest("div")!;
    expect(within(section).getByText(/club is here as two entries/i)).toBeInTheDocument();
    // The evidence, not just the verdict: somebody has to be able to disagree with it.
    expect(within(section).getByText(/one has no schedule of its own/i)).toBeInTheDocument();
  });

  it("offers to fold the empty entry into the one with the schedule", async () => {
    /*
     * The direction matters and is not arbitrary. The entry with no schedule of its own is the
     * abandoned id; folding the real one into it would keep the wrong name and lose the link the
     * pull refreshes by.
     */
    const user = userEvent.setup();
    const { requestConfirmation, showToast } = renderTeamRankings(pool);
    await openSetup(user);

    await user.click(await screen.findByRole("button", { name: /^fold in$/i }));

    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    // Both entries are called "Ambush 9U", so the title is the only thing saying which way it went.
    expect(requestConfirmation.mock.calls[0]?.[0]?.title).toMatch(/fold .* into /i);
    expect(showToast).toHaveBeenCalledWith("Folded into Ambush 9U.", { tone: "success" });
    // And the pair comes off the list, rather than sitting there offering to fold it again.
    await waitFor(() => expect(screen.queryByText(/one club, listed twice/i)).toBeNull());
  });

  it("keeps the pair on the list when the user says no", async () => {
    const user = userEvent.setup();
    const { requestConfirmation } = renderTeamRankings(pool);
    requestConfirmation.mockResolvedValue(false);
    await openSetup(user);

    await user.click(await screen.findByRole("button", { name: /^fold in$/i }));

    // Still offered, and nothing was written: a no is an answer about this pair, not about the list.
    expect(await screen.findByRole("button", { name: /^fold in$/i })).toBeInTheDocument();
    expect(screen.getByText(/one club, listed twice/i)).toBeInTheDocument();
  });

  it("says nothing of two squads that each have a schedule of their own", async () => {
    /*
     * A club running an A and a B squad at 9U names them the same thing, in the same town, in the
     * same state. Folding those together costs the club half its history, so a real schedule on
     * both sides is the end of the question.
     */
    const user = userEvent.setup();
    renderTeamRankings({
      ...pool,
      games: [
        listed("gcReal000000", "g1", "real", "other"),
        listed("gcShell00000", "g2", "shell", "other"),
      ],
    });
    await openSetup(user);

    await screen.findByText(/clubs/i);
    expect(screen.queryByText(/one club, listed twice/i)).toBeNull();
  });
});
