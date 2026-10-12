import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ageGroup, game, renderTeamRankings, seasonDate, team } from "../test/teamRankingsHarness";
import type { GcTeamLink, ScoutTeam } from "../lib/teamRankings";

const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const linked = (
  id: string,
  name: string,
  link: Partial<GcTeamLink> & { teamId: string }
): ScoutTeam =>
  team(id, name, {
    gcTeams: [{ name: `GC ${link.teamId}`, ageGroupId: "ag_12u_2027", ...link }],
  });

const pool = (teams: ScoutTeam[]) => ({
  ageGroups: [ageGroup(12, 2027)],
  teams,
  games: [game("g1", "ag_12u_2027", teams[0]!.id, teams[1]!.id, 6, 2, { date: seasonDate(2027) })],
});

const openImport = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Import" }));
};

describe("pages that may not be teams yet", () => {
  it("says how many there are and why it matters", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool([
        linked("S-A", "Aces", { teamId: "gc-a", playerCount: 6 }),
        linked("S-B", "Badgers", { teamId: "gc-b", playerCount: 14 }),
      ])
    );
    await openImport(user);

    expect(screen.getByText(/1 page may not be a team yet/i)).toBeInTheDocument();
    expect(screen.getByText(/takes 9 players to field a side/i)).toBeInTheDocument();
  });

  it("says nothing at all when every roster is full", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool([
        linked("S-A", "Aces", { teamId: "gc-a", playerCount: 12 }),
        linked("S-B", "Badgers", { teamId: "gc-b", playerCount: 14 }),
      ])
    );
    await openImport(user);

    expect(screen.queryByText(/may not be a team yet/i)).toBeNull();
  });

  it("offers to ask again about the ones counted long ago", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool([
        linked("S-A", "Aces", { teamId: "gc-a", playerCount: 6, countedAt: daysAgo(30) }),
        linked("S-B", "Badgers", { teamId: "gc-b", playerCount: 14 }),
      ])
    );
    await openImport(user);

    expect(screen.getByRole("button", { name: /check them again/i })).toBeInTheDocument();
  });

  it("does not offer to ask again about one counted today", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool([
        linked("S-A", "Aces", { teamId: "gc-a", playerCount: 6, countedAt: daysAgo(1) }),
        linked("S-B", "Badgers", { teamId: "gc-b", playerCount: 14 }),
      ])
    );
    await openImport(user);

    // Asking again today about a count taken today is asking the same export the same question.
    expect(screen.queryByRole("button", { name: /check.*again/i })).toBeNull();
    expect(screen.getByText(/come round again in a fortnight/i)).toBeInTheDocument();
  });

  it("counts only the ones due when some are and some are not", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool([
        linked("S-A", "Aces", { teamId: "gc-a", playerCount: 6, countedAt: daysAgo(30) }),
        linked("S-B", "Badgers", { teamId: "gc-b", playerCount: 4, countedAt: daysAgo(1) }),
      ])
    );
    await openImport(user);

    expect(screen.getByText(/2 pages may not be a team yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check 1 of them again/i })).toBeInTheDocument();
  });

  it("says nothing about a team whose roster nobody counted", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool([
        linked("S-A", "Aces", { teamId: "gc-a" }),
        linked("S-B", "Badgers", { teamId: "gc-b" }),
      ])
    );
    await openImport(user);

    // An unknown count is not an empty one: most of a pool is pulled by id and never says.
    expect(screen.queryByText(/may not be a team yet/i)).toBeNull();
  });
});
