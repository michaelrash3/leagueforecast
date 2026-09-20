import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/** The autumn of baseball year 2027, with the played games behind it and the fixtures ahead. */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-15T12:00:00"));
});
afterAll(() => vi.useRealTimers());

/**
 * A ladder of clubs, small enough to fit on the main thread so the answer lands without a worker —
 * jsdom has none, and the hook's inline path is the one a test can see.
 */
const pool = (): Pool => {
  const teams = Array.from({ length: 12 }, (_, i) => team(`S-${i}`, `Club ${i}`, { state: "KY" }));
  const games = [];
  for (let i = 0; i < 11; i += 1) {
    games.push(
      game(`p${i}`, "ag_10u_2027", `S-${i}`, `S-${i + 1}`, 7, 2, { date: "2026-09-12" }),
      game(`q${i}`, "ag_10u_2027", `S-${i + 1}`, `S-${i}`, 3, 5, { date: "2026-09-26" })
    );
  }
  return {
    // "Our" club, so the report opens on the one whose fixtures this file is about.
    ageGroups: [ageGroup(10, 2027, { myTeamId: "S-6" })],
    teams: [...teams, team("S-STRANGER", "Nobody has pulled them")],
    games: [
      ...games,
      { id: "u0", ageGroupId: "ag_10u_2027", teamAId: "S-6", teamBId: "S-2", date: "2026-11-07" },
      {
        id: "u1",
        ageGroupId: "ag_10u_2027",
        teamAId: "S-6",
        teamBId: "S-STRANGER",
        date: "2026-11-14",
      },
    ],
  };
};

const openScouting = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: /scouting/i }));
};

const nextUp = () => within(screen.getByRole("table", { name: "Next up" }));

describe("the what-if panel", () => {
  it("opens on a fixture and says where each margin would leave the club", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await openScouting(user);

    await user.click(nextUp().getAllByRole("button", { name: /^What if\?/ })[0]!);

    const answer = await screen.findByRole("table", {
      name: /What a win or a loss against Club 2/,
    });
    const rows = within(answer).getAllByRole("row").slice(1);
    // One rung per whole run up to the cap, which is what one game can carry.
    expect(rows).toHaveLength(8);
    expect(within(answer).getByText(/8 runs or more/)).toBeInTheDocument();
    expect(
      within(answer)
        .getAllByRole("columnheader")
        .map((c) => c.textContent)
    ).toEqual([
      "By",
      expect.stringContaining("If we win") as unknown as string,
      expect.stringContaining("If we lose") as unknown as string,
    ]);
  });

  it("says which way each result moves you in words, not in colour", async () => {
    // 2 of 40 wins at the projected margin move a club DOWN and 9 of 40 losses move it UP, so a
    // green win column above a fallen rank would teach the reader the feature is broken.
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await openScouting(user);
    await user.click(nextUp().getAllByRole("button", { name: /^What if\?/ })[0]!);

    const answer = await screen.findByRole("table", { name: /What a win or a loss against/ });
    const body = within(answer)
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.textContent ?? "");
    expect(
      body.every((text) =>
        /places better|place better|places worse|place worse|no change/.test(text)
      )
    ).toBe(true);
    expect(answer.className).not.toMatch(/emerald|red/);
    expect(answer.innerHTML).not.toMatch(/text-emerald|text-red/);
  });

  it("closes again when the same fixture is pressed a second time", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await openScouting(user);

    const trigger = () => nextUp().getAllByRole("button", { name: /^What if\?|^Hide/ })[0]!;
    await user.click(trigger());
    expect(await screen.findByRole("table", { name: /What a win or a loss/ })).toBeInTheDocument();

    await user.click(trigger());
    expect(screen.queryByRole("table", { name: /What a win or a loss/ })).toBeNull();
  });

  it("offers nothing on a fixture the board cannot rate", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool());
    await openScouting(user);

    const rows = nextUp().getAllByRole("row").slice(1);
    const stranger = rows.find((row) => row.textContent?.includes("Nobody has pulled them"))!;
    expect(within(stranger).getByText("Not rated here yet")).toBeInTheDocument();
    expect(within(stranger).queryByRole("button", { name: /What if/ })).toBeNull();
  });
});
