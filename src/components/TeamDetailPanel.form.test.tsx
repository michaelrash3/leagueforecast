import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScoutGame, ScoutRankingRow, SeasonSegment } from "../lib/teamRankings";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";
import { TeamDetailPanel } from "./TeamDetailPanel";

/*
 * A club's form on its panel: its last games, newest first, against the margins its ratings
 * expected of them, over the half its record is counted on.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-20T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const PAGE = "ag_12u_2027";

const pool = () => ({
  ageGroups: [ageGroup(12, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Bears"), team("S-C", "Cubs"), team("S-D", "Dukes")],
  games: [
    game("g1", PAGE, "S-A", "S-B", 6, 2, { date: "2026-09-12" }),
    game("g2", PAGE, "S-B", "S-C", 5, 4, { date: "2026-09-19" }),
    game("g3", PAGE, "S-C", "S-D", 7, 1, { date: "2026-09-26" }),
    game("g4", PAGE, "S-A", "S-C", 3, 4, { date: "2026-10-03" }),
    game("g5", PAGE, "S-D", "S-A", 0, 9, { date: "2026-10-10" }),
    // The season before, still filed under this year's page: outside the half, as in the record.
    game("old", PAGE, "S-A", "S-B", 2, 1, { date: "2026-05-02" }),
  ],
});

describe("a club's form on its panel", () => {
  it("says its last games, newest first, against the margins its ratings expected", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings({ ...pool(), search: "?age=12&year=2027" });
    await user.click(await screen.findByRole("button", { name: /show all/i }));
    const table = screen.getByRole("table");
    await user.click(within(table).getByRole("button", { name: "Aces" }));
    const panel = await screen.findByRole("region", { name: "Aces" });
    expect(panel.textContent).toMatch(
      /Form, last 3: W L W · beat the margin its ratings expected in [0-3] of 3, \d+\.\d runs a game (better|worse) on average/
    );
  });
});

describe("the form's games", () => {
  const row = (teamId: string, rating: number) =>
    ({
      teamId,
      teamName: teamId,
      rank: 1,
      rating,
      ageLevel: 12,
      componentId: "c1",
      comparable: true,
    }) as ScoutRankingRow;
  const rows = new Map([
    ["S-A", row("S-A", 1)],
    ["S-B", row("S-B", -1)],
  ]);
  const played = (id: string, a: string, b: string, runs: [number, number], more = {}) =>
    ({
      id,
      teamAId: a,
      teamBId: b,
      ageGroupId: PAGE,
      teamAScore: runs[0],
      teamBScore: runs[1],
      ...more,
    }) as ScoutGame;
  // A card names the club's games of every year; two of another year's page, one dated in this
  // half and one undated, are not this pool's games, as its record says.
  const games = [
    played("1", "S-A", "S-B", [6, 2], { date: "2026-09-12" }),
    played("2", "S-B", "S-A", [5, 4], { date: "2026-10-03" }),
    played("3", "S-B", "S-A", [9, 0], { date: "2026-10-10", ageGroupId: "ag_12u_2026" }),
    played("4", "S-B", "S-A", [9, 0], { ageGroupId: "ag_12u_2026" }),
  ];
  const panel = (segment?: SeasonSegment) =>
    render(
      <TeamDetailPanel
        team={{ id: "S-A", name: "Aces" }}
        allGames={games}
        ageGroupId={PAGE}
        ageGroupName="12U 2027"
        ageGroups={[ageGroup(12, 2027), ageGroup(12, 2026)]}
        {...(segment ? { segment } : {})}
        teamNameById={new Map([["S-B", "Bears"]])}
        onRename={() => undefined}
        onSetState={() => true}
        onUnlinkGc={() => undefined}
        onMergeInto={() => undefined}
        mergeCandidates={[]}
        onClose={() => undefined}
        readOnly
        ratingRowOf={(teamId) => rows.get(teamId)}
      />
    );

  it("reads the games of its rating pool alone, as its record does, over a half or the year", () => {
    for (const segment of ["fall", undefined] as const) {
      const { container, unmount } = panel(segment);
      expect(container.textContent).toMatch(/Form, last 2: L W ·/);
      unmount();
    }
  });
});
