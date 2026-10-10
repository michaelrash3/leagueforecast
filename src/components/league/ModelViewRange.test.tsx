import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSeedRanges } from "../../hooks/useSeedRanges";
import { backtestPredictions } from "../../lib/backtest";
import { buildBracketProjection } from "../../lib/bracket";
import { goldCutLineSnapshot } from "../../lib/clinchingPaths";
import {
  calculateTeams,
  projectStandings,
  rankOptionsFromSettings,
  rankTeams,
} from "../../lib/sim";
import {
  DEFAULT_SETTINGS,
  type GameLog,
  type Matchup,
  type TeamBase,
  type TeamWithProjection,
} from "../../lib/types";
import { ModelView } from "./ModelView";

/*
 * The Projected Standings' Range on the Forecast tab: the best and worst seed one remaining result
 * can move each team to, worked out by the scenario walk (`useSeedRanges`). With more games left
 * than the walk is run for, every range would be the projection at both ends, which reads as a
 * seed nothing left can move; the tab has to say the walk is waiting instead. Placeholder teams.
 */

const played = (away: number, home: number): GameLog => ({
  awayRuns: String(away),
  homeRuns: String(home),
  awayHits: "5",
  homeHits: "5",
  awayK: "4",
  homeK: "4",
  innings: "6",
  isFinal: true,
});

const TEAMS: TeamBase[] = [
  { id: "aces", name: "Aces" },
  { id: "bears", name: "Bears" },
  { id: "cubs", name: "Cubs" },
  { id: "ducks", name: "Ducks" },
];
// Four decided and two left, enough that the Bears' finish is still open (`useSeedRanges.test`).
const SCHEDULE: Matchup[] = [
  { id: "g1", date: "2026-04-05", away: "aces", home: "bears" },
  { id: "g2", date: "2026-04-05", away: "cubs", home: "ducks" },
  { id: "g3", date: "2026-04-12", away: "aces", home: "cubs" },
  { id: "g4", date: "2026-04-12", away: "bears", home: "ducks" },
  { id: "g5", date: "2026-05-03", away: "aces", home: "bears" },
  { id: "g6", date: "2026-05-03", away: "cubs", home: "ducks" },
];
const LOGS: Record<string, GameLog> = {
  g1: played(7, 2),
  g2: played(6, 1),
  g3: played(1, 8),
  g4: played(9, 3),
};

const settings = DEFAULT_SETTINGS;
const liveTeams = calculateTeams(TEAMS, SCHEDULE, LOGS, settings);
const ranked = rankTeams(liveTeams, rankOptionsFromSettings(settings));
const remainingGames = SCHEDULE.filter((game) => !LOGS[game.id]);
const projected = projectStandings(liveTeams, remainingGames, settings);
const projectedById = new Map(
  projected.map((team) => [team.id, { ...team, rank: team.rank ?? 99 }])
);
const rankById = new Map(ranked.map((team) => [team.id, team.rank]));
const modelRows: TeamWithProjection[] = projected.map((team) => ({
  ...team,
  rank: rankById.get(team.id) ?? 99,
  projectedRank: team.rank ?? 99,
  projectedRecord: `${team.w}-${team.l}`,
  projectedRunDiff: 0,
  goldPct: 50,
  goldTrend: [],
  goldStatus: "Alive",
  maxPoints: 0,
  blockersAhead: 0,
  maxPct: 1,
  minPct: 0,
}));

/** The Forecast tab, its ranges from the walk switched on or off as App switches it. */
function Forecast({ walk }: { walk: boolean }) {
  const { seedRangeForTeam } = useSeedRanges({
    exact: walk,
    liveTeams,
    remainingGames,
    settings,
    projectedById,
    ranked,
  });
  const bracket = buildBracketProjection({ teams: liveTeams, cutoff: 2, logs: {}, settings });
  return (
    <ModelView
      goldCutoff={2}
      modelRows={modelRows}
      bracketProjection={bracket}
      silverBracketProjection={bracket}
      updateBracketLog={vi.fn()}
      toggleBracketFinal={vi.fn()}
      clearBracketScores={vi.fn()}
      seedRangeForTeam={seedRangeForTeam}
      seedRangesPausedUntil={walk ? null : 60}
      gamesThatMatterMost={[]}
      bubbleMovementRows={modelRows.map((team) => ({
        team,
        tier: "Bubble",
        sos: { label: "Medium", opponents: "" },
        control: "Needs Help",
      }))}
      scheduleDifficultyForTeam={() => ({ label: "Medium", rating: 0, opponents: "" })}
      formatGoldPct={() => "50%"}
      formatGoldMargin={() => "±5%"}
      projectedCutLineTeams={[]}
      nextTwoSwingGames={() => []}
      gameForecasts={[]}
      byId={new Map(liveTeams.map((team) => [team.id, team]))}
      gameStatusClasses={() => ""}
      teams={TEAMS}
      matchups={SCHEDULE}
      logs={LOGS}
      settings={settings}
      cutoff={2}
      onSelectTeam={vi.fn()}
      liveTeams={liveTeams}
      remainingGames={remainingGames}
      backtestResult={backtestPredictions([], [], {}, settings)}
      bracketOdds={{ seedDistribution: {}, championOdds: {}, finalsOdds: {}, iterations: 0 }}
      clinchingPaths={[]}
      cutLineSnapshot={goldCutLineSnapshot(modelRows, 2, settings)}
      timelineEntries={[]}
      hasCutLine
      hasPostseason={false}
      forecastStoryText=""
      forecastStoryModel=""
      forecastStoryLoading={false}
      forecastStoryUnavailableReason={null}
      forecastStoryErrorMessage=""
      retryForecastStory={vi.fn()}
      forecastStoryWaiting={false}
      askForecastStory={vi.fn()}
    />
  );
}

const SEED_SPAN = /#\d+–#\d+/;

/** The Range cell of each row of the Projected Standings table, in order. */
const rangeCells = () => {
  const table = screen.getByRole("table");
  const header = within(table).getAllByRole("columnheader");
  const column = header.findIndex((cell) => cell.textContent === "Range");
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[column]?.textContent);
};

describe("the Projected Standings' Range", () => {
  it("says what it is, from the walk, once few enough games remain for it", () => {
    render(<Forecast walk />);
    expect(
      screen.getByText(
        "Range is the best and worst seed one remaining result can move a team's projection to."
      )
    ).toBeInTheDocument();
    const cells = rangeCells();
    expect(cells.every((cell) => SEED_SPAN.test(cell ?? ""))).toBe(true);
    // The fixture's Bears can still move, so the walk is seen to have run.
    expect(cells.some((cell) => /^#(\d+)–#(?!\1$)\d+$/.test(cell ?? ""))).toBe(true);
  });

  it("says the walk is waiting, and shows no seed it has not worked out, before then", () => {
    render(<Forecast walk={false} />);
    expect(
      screen.getByText(
        "Range, the best and worst seed one remaining result can move a team's projection to, is paused until 60 or fewer games remain to keep this page responsive."
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Range is the best and worst seed one remaining result can move a team's projection to."
      )
    ).toBeNull();
    expect(rangeCells()).toEqual(modelRows.map(() => "—"));
    // Nor on a phone's rows or in the Bubble Watch, which show the same range.
    expect(document.body.textContent).not.toMatch(SEED_SPAN);
  });
});
