import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { emptyTeam, rankTeams } from "../../lib/sim";
import type { Team, TeamWithProjection } from "../../lib/types";
import { StandingsView } from "./StandingsView";

/*
 * The table ranks on points, and showed none, and never said which tiebreaker put one of two teams
 * level on points above the other. It shows each team's points now, and under the table names each
 * tie and the rule that broke it. Placeholder names.
 */
const team = (id: string, name: string, w: number, l: number, runDiff: number): Team => {
  const made = emptyTeam({ id, name });
  made.w = w;
  made.l = l;
  made.games = w + l;
  made.runDiff = runDiff;
  return made;
};

const options = { tiebreakerOrder: ["headToHead" as const, "runDifferential" as const] };
const ranked = rankTeams(
  [team("C", "Comets", 1, 4, -9), team("B", "Bears", 3, 2, 2), team("A", "Aces", 3, 2, 9)],
  options
).map(
  (one) =>
    ({
      ...one,
      goldPct: 0,
      goldTrend: [],
      projectedRank: one.rank,
    }) as unknown as TeamWithProjection
);

const view = () =>
  render(
    <StandingsView
      rankOptions={options}
      goldCutoff={1}
      latestCompletedDate=""
      lastImpact={null}
      dismissImpact={() => undefined}
      copyRecap={() => undefined}
      copyStory={() => undefined}
      dashboardRows={ranked}
      hasCutLine={false}
      storyText=""
      storySource="local"
      storyModel=""
      storyLoading={false}
      storyUnavailableReason={null}
      storyErrorMessage=""
      retryStory={() => undefined}
      storyWaiting={false}
      askStory={() => undefined}
      currentSosRanks={{}}
      statusClass={() => ""}
      statusLabel={() => ""}
      formatGoldPct={() => ""}
      formatGoldMargin={() => ""}
      onSelectTeam={() => undefined}
    />
  );

describe("the standings table's points and ties", () => {
  it("shows each team's points, which it ranks on", () => {
    view();
    expect(screen.getByRole("columnheader", { name: "Pts" })).toBeInTheDocument();
    const cells = screen.getAllByRole("row").map((row) => row.textContent ?? "");
    expect(cells.find((text) => text.includes("Aces"))).toContain("3");
    expect(screen.getAllByText(/3 pts/)).toHaveLength(2);
  });

  it("names each tie on points and the rule that broke it", () => {
    view();
    expect(
      screen.getByText("Level on points: Bears placed behind Aces on run differential.")
    ).toBeInTheDocument();
  });
});
