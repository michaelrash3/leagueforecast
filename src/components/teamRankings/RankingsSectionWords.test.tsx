import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { RankingsSection } from "./RankingsSection";

/*
 * How the board counts, drawn straight from its rows. A nationwide page holds thousands of clubs,
 * and its counts and places were printed bare ("of 1234 ranked", "Show all 1234 teams", "#1203"),
 * where every other count on the page has its comma; and a half nobody has played offered "Show
 * all 0 teams". Placeholder names.
 */
const row = (at: number, over: Partial<ScoutRankingRow> = {}): ScoutRankingRow => ({
  teamId: `S-${at}`,
  teamName: `Club ${at}`,
  isMine: false,
  rank: at,
  rating: 0,
  pointRating: 0,
  record: "1-1",
  wins: 1,
  losses: 1,
  ties: 0,
  games: 2,
  rawMargin: 0,
  strengthOfSchedule: 0,
  sosRank: at,
  crossAgeGames: 0,
  componentSize: BIG,
  componentId: "S-1",
  comparable: true,
  fromGameChanger: true,
  ...over,
});

const section = (
  rankings: ScoutRankingRow[],
  { showAll = false, visible = rankings, stateFilter = "", unknownStateCount = 0 } = {}
) =>
  render(
    <RankingsSection
      groupName="10U 2027"
      searchOptions={[]}
      onSearchTeam={() => {}}
      hasAgeGroups
      unrankedLevelNote={null}
      segment={null}
      rankings={rankings}
      rankingsStale={false}
      nationalTop={rankings.slice(0, 25)}
      stateTopRows={[]}
      visibleRankings={visible}
      availableStates={["KY"]}
      shownState="KY"
      onShownStateChange={() => {}}
      keptState={null}
      onKeepState={() => {}}
      unknownStateCount={unknownStateCount}
      stateFilter={stateFilter}
      onStateFilterChange={() => {}}
      showAll={showAll}
      onToggleShowAll={() => {}}
      placeOf={() => undefined}
      isLeagueTeam={() => false}
      hasGamesFiledHere={() => false}
      onOpenTeam={() => {}}
      onMarkMine={() => {}}
      onRemoveTeam={() => {}}
    />
  );

const BIG = 1_234;
const board = () => Array.from({ length: BIG }, (_, at) => row(at + 1));

beforeEach(() =>
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  )
);
afterEach(() => vi.unstubAllGlobals());

describe("the board's counts", () => {
  it("puts the comma in a count of a thousand or more", () => {
    section(board());
    expect(screen.getByText("of 1,234 ranked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show all 1,234 teams" })).toBeInTheDocument();
  });

  it("puts it in the full table's places and lines too", () => {
    // One state's clubs, renumbered, each with its place on the whole board beside it.
    const kentucky = board()
      .filter((one) => one.rank > 1_000)
      .map((one, at) => ({ ...one, overallRank: one.rank, rank: at + 1, sosRank: 0 }));
    section(board(), {
      showAll: true,
      visible: kentucky,
      stateFilter: "KY",
      unknownStateCount: 1_500,
    });
    expect(screen.getByText(/Showing 234 of 1,234 teams\./)).toBeInTheDocument();
    expect(screen.getByText("Showing 100 of 234")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "No state set (1,500)" })).toBeInTheDocument();
    const first = within(screen.getAllByRole("row")[1]!);
    expect(first.getByText("#1,001")).toBeInTheDocument();
  });

  it("puts it in a place on the whole board and a schedule's rank", () => {
    section([row(1), row(1_203, { rank: 1_203, sosRank: 2_048 })], { showAll: true });
    const last = within(screen.getAllByRole("row")[2]!);
    expect(last.getByText("#1,203")).toBeInTheDocument();
    expect(last.getByText("#2,048")).toBeInTheDocument();
  });

  it("offers one team as one", () => {
    section([row(1)]);
    expect(screen.getByRole("button", { name: "Show the 1 team" })).toBeInTheDocument();
  });

  it("offers nothing to show for none, opened or not", () => {
    const { unmount } = section([]);
    expect(screen.queryByRole("button", { name: /^Show/ })).toBeNull();
    expect(screen.queryByText(/\b0 teams\b/)).toBeNull();
    unmount();
    // Left open from a page that had teams: no table, and no second word that there are none.
    section([], { showAll: true });
    expect(screen.queryByRole("button", { name: "Hide the full table" })).toBeNull();
    expect(screen.queryByText("No teams yet for this age group.")).toBeNull();
    expect(screen.getByText(/Add a game in Games to start ranking teams/)).toBeInTheDocument();
  });
});
