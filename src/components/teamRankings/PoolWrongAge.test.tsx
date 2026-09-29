import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadAgeRightClubs,
  loadNamedAges,
  loadScoutGamesForYear,
  loadScoutTeams,
} from "../../lib/teamRankingsStorage";
import type { ScoutTeam } from "../../lib/teamRankings";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";

/*
 * Pool health's list of clubs filed at the wrong age, and its two answers: file the club at the
 * age the evidence points to, or say the age it has is right. Placeholder names throughout.
 *
 * The board opens on 2026, the first page, while the list is read in 2027, the squad year being
 * played on 28 September 2026: setting an age from the list has to move that year's games, not
 * the ones on screen.
 */
const last9 = ageGroup(9, 2026);
const now8 = ageGroup(8, 2027);
const now9 = ageGroup(9, 2027);
const groups = [last9, now8, now9];

const linked = (id: string, squadName: string, page: string): ScoutTeam =>
  team(id, squadName.replace(/\s*\d+U$/, ""), {
    gcTeams: [{ teamId: `gc${id}`, name: squadName, ageGroupId: page }],
  });

const teams = [
  linked("horn", "Hornets 9U", now8.id),
  linked("n1", "Nine One 9U", now9.id),
  linked("n2", "Nine Two 9U", now9.id),
  linked("old", "Last Year 9U", last9.id),
];

const own = (gameId: string) => ({
  source: { kind: "gamechanger" as const, teamId: "gchorn", gameId },
});
const games = [
  game("h1", now8.id, "horn", "n1", 3, 5, { date: "2026-09-12", ...own("1") }),
  game("h2", now8.id, "horn", "n2", 4, 4, { date: "2026-09-26", ...own("2") }),
  game("o1", last9.id, "old", "n1", 2, 1, { date: "2026-04-11" }),
];

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const checkThePool = async () => {
  const user = userEvent.setup();
  const harness = renderTeamRankings({ ageGroups: groups, teams, games });
  await user.click(screen.getByRole("tab", { name: "Setup" }));
  await user.click(await screen.findByRole("button", { name: "Check the pool" }));
  const list = await screen.findByTestId("pool-wrong-age");
  return { user, harness, list };
};

describe("clubs filed at the wrong age", () => {
  it("are listed with what they are filed at, what they play, and why", async () => {
    const { list } = await checkThePool();
    expect(list).toHaveTextContent("1 pulled club is filed at one age in 2027 and plays another");
    const row = within(list).getByRole("listitem");
    expect(row).toHaveTextContent("Hornets");
    expect(row).toHaveTextContent("filed 8U, plays 9U");
    expect(row).toHaveTextContent("its name says 9U; 2 of 2 opponents at 9U");
  });

  it("are filed at the suggested age in the year they were read in, games and all", async () => {
    const { user, harness, list } = await checkThePool();
    await user.click(within(list).getByRole("button", { name: "Set 9U" }));

    const hornets = loadScoutTeams().find((entry) => entry.id === "horn");
    expect(hornets?.gcTeams?.[0]).toMatchObject({
      ageGroupId: now9.id,
      ageLevel: 9,
      ageFrom: "you",
    });
    expect(loadNamedAges().get("gchorn")).toMatchObject({ level: 9, pinned: true, was: 8 });
    // The squad year being played, though the board is showing 2026.
    const moved = loadScoutGamesForYear(2027).filter((entry) => entry.id.startsWith("h"));
    expect(moved.map((entry) => entry.ageGroupId)).toEqual([now9.id, now9.id]);
    expect(loadScoutGamesForYear(2026).map((entry) => entry.ageGroupId)).toEqual([last9.id]);
    expect(harness.toasts()).toContain("Hornets is 9U now: 2 of its games moved to 9U 2027.");
    expect(screen.queryByTestId("pool-wrong-age")).toBeNull();
  });

  it("are left alone, and not asked about again, once their age is said to be right", async () => {
    const { user, list } = await checkThePool();
    await user.click(within(list).getByRole("button", { name: "It plays up" }));

    const kept = () => screen.getByTestId("pool-wrong-age");
    expect(within(kept()).queryByRole("button", { name: "It plays up" })).toBeNull();
    expect(kept()).toHaveTextContent(
      "1 club you said plays at the age it is filed at is kept off this list."
    );
    expect([...loadAgeRightClubs()]).toEqual(["gchorn"]);
    expect(loadScoutTeams().find((entry) => entry.id === "horn")?.gcTeams?.[0]?.ageGroupId).toBe(
      now8.id
    );

    await user.click(screen.getByRole("button", { name: "Look again" }));
    await screen.findByRole("button", { name: "Look again" });
    expect(within(kept()).queryByRole("button", { name: "It plays up" })).toBeNull();
  });

  it("are asked about again once the answer is taken back", async () => {
    const { user, list } = await checkThePool();
    await user.click(within(list).getByRole("button", { name: "It plays up" }));

    await user.click(
      within(screen.getByTestId("pool-wrong-age")).getByRole("button", { name: "Show them" })
    );
    const said = screen.getByRole("list", { name: "Clubs you said are at the right age" });
    expect(said).toHaveTextContent("Hornets");
    await user.click(within(said).getByRole("button", { name: "Put it back" }));

    expect([...loadAgeRightClubs()]).toEqual([]);
    expect(
      within(screen.getByTestId("pool-wrong-age")).getByRole("button", { name: "It plays up" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/kept off this list/)).toBeNull();
  });
});
