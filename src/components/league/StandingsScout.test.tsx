import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LeagueClubRank } from "../../lib/leagueClubRanks";
import type { TeamWithProjection } from "../../lib/types";
import { StandingsView } from "./StandingsView";

/** Two league teams with invented names; only what the table draws. */
const row = (id: string, name: string, rank: number) =>
  ({
    id,
    name,
    rank,
    wins: 3,
    losses: 1,
    ties: 0,
    runDiff: 7,
    runsFor: 30,
    runsAgainst: 23,
    gamesPlayed: 4,
    pct: 0.75,
    points: 6,
    goldPct: 50,
    goldTrend: [],
    sos: 0.5,
  }) as unknown as TeamWithProjection;

const hive: LeagueClubRank = {
  clubId: "S-HIVE",
  board: "9U 2027",
  rank: 12,
  of: 3947,
  at: "2026-10-11T00:00:00.000Z",
  ageLevel: 9,
  year: 2027,
};

const view = (
  onScout?: (rank: LeagueClubRank) => void,
  ranks: Record<string, LeagueClubRank> = { "L-HIVE": hive }
) =>
  render(
    <StandingsView
      nationalRank={(teamId) => ranks[teamId]}
      {...(onScout ? { onScout } : {})}
      goldCutoff={1}
      latestCompletedDate=""
      lastImpact={null}
      dismissImpact={() => undefined}
      copyRecap={() => undefined}
      copyStory={() => undefined}
      dashboardRows={[row("L-HIVE", "Hive Baseball", 1), row("L-OWLS", "Owls Baseball", 2)]}
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

describe("the Scout button beside a team's national place", () => {
  it("opens Team Rankings' report on the club whose place it is, from the table and the card", async () => {
    const onScout = vi.fn();
    view(onScout);
    // One in the table, one on the phone's card; a team with no place has neither.
    const buttons = screen.getAllByRole("button", { name: "Scout Hive Baseball in Team Rankings" });
    expect(buttons).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Scout Owls/ })).toBeNull();
    expect(screen.getAllByText("#12 of 3,947 nationally · top 1%")).toHaveLength(2);

    for (const button of buttons) await userEvent.click(button);
    expect(onScout).toHaveBeenCalledTimes(2);
    expect(onScout).toHaveBeenCalledWith(hive);
  });

  it("is not offered where nothing can open Team Rankings, and the place is still said", () => {
    view();
    expect(screen.queryByRole("button", { name: /^Scout / })).toBeNull();
    expect(screen.getAllByText("#12 of 3,947 nationally · top 1%")).toHaveLength(2);
  });

  it("is never inside the team's own link", () => {
    view(vi.fn());
    for (const button of screen.getAllByRole("button", { name: /^Scout / })) {
      expect(button.closest("a")).toBeNull();
    }
  });
});

describe("the league's strength above its standings", () => {
  const owls: LeagueClubRank = { ...hive, clubId: "S-OWLS", rank: 1204 };

  it("says how many of its teams Team Rankings places and how high", () => {
    view(undefined, {
      "L-HIVE": { ...hive, state: "KY", stateRank: 2, stateOf: 98 },
      "L-OWLS": { ...owls, state: "KY", stateRank: 30, stateOf: 98 },
    });
    // The median of #12 and #1,204 of 3,947; Kentucky's 2nd and 30th of 98 on average.
    expect(screen.getByText(/^League strength:/).parentElement!.textContent).toBe(
      "League strength: 2 of 2 teams on Team Rankings · the median team in the top 16% nationally · on average in the top 17% of KY's clubs"
    );
  });

  it("is not said for a league with fewer than two teams placed", () => {
    view();
    expect(screen.queryByText(/^League strength:/)).toBeNull();
  });
});
