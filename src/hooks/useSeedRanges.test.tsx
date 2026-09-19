import { render, screen } from "@testing-library/react";
import { useMemo } from "react";
import { describe, expect, it } from "vitest";
import { useSeedRanges } from "./useSeedRanges";
import { calculateTeams, rankTeams, rankOptionsFromSettings } from "../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../lib/types";

/**
 * The scenario caches are read *during* render — the model table asks for a team's range three
 * times over while it draws, and the drawer asks again — and they used to be emptied from an
 * effect on the same inputs.
 *
 * An effect runs after the render that read them. So the render that followed a score edit
 * answered from the previous standings, and emptying a ref schedules no re-render, so that stale
 * answer stayed on screen until something unrelated happened to draw again: the table moved and
 * the projected-seed range beside it went on saying what it said before the score was typed.
 *
 * This renders the hook the way the app does — ask for a range while rendering — and then changes
 * the season underneath it.
 */
const TEAMS: TeamBase[] = [
  { id: "aces", name: "Aces" },
  { id: "bears", name: "Bears" },
  { id: "cubs", name: "Cubs" },
];

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

const SCHEDULE: Matchup[] = [
  { id: "g1", date: "2026-04-05", away: "aces", home: "bears" },
  { id: "g2", date: "2026-04-12", away: "bears", home: "cubs" },
  { id: "g3", date: "2026-04-19", away: "cubs", home: "aces" },
  { id: "g4", date: "2026-05-03", away: "aces", home: "bears" },
];

const seasonAt = (logs: Record<string, GameLog>) => {
  const liveTeams = calculateTeams(TEAMS, SCHEDULE, logs, DEFAULT_SETTINGS);
  const ranked = rankTeams(liveTeams, rankOptionsFromSettings(DEFAULT_SETTINGS));
  const remainingGames = SCHEDULE.filter((game) => !logs[game.id]);
  const projectedById = new Map(ranked.map((team) => [team.id, team]));
  return { liveTeams, ranked, remainingGames, projectedById };
};

/**
 * Asks for the range while rendering, exactly as the model table does.
 *
 * The season is memoised on the results, as the app memoises it on its state, and that detail is
 * the whole reproduction: with fresh arrays every render, an effect keyed on them fires after
 * every render and the caches are empty again before anyone can read a stale answer out of them.
 * `tick` is the unrelated re-render that every real app has — a tooltip, a tab, a clock — and it
 * is what lets a cache survive from one render to the next and be stale on the one after.
 */
function Probe({
  logs,
  teamId,
  tick = 0,
}: {
  logs: Record<string, GameLog>;
  teamId: string;
  tick?: number;
}) {
  void tick;
  const season = useMemo(() => seasonAt(logs), [logs]);
  const { seedRangeForTeam } = useSeedRanges({
    exact: true,
    liveTeams: season.liveTeams,
    remainingGames: season.remainingGames,
    settings: DEFAULT_SETTINGS,
    projectedById: season.projectedById,
    ranked: season.ranked,
  });
  const range = seedRangeForTeam(teamId);
  return <div data-testid="range">{`${range.best}-${range.worst}-${range.baseline}`}</div>;
}

const rangeText = () => screen.getByTestId("range").textContent;

/** A set of results where the Aces are on top, and one where they are not. */
const ACES_ON_TOP: Record<string, GameLog> = {
  g1: played(12, 0), // aces win big
  g2: played(1, 9), // cubs win
  g3: played(0, 11), // aces win big
};
const ACES_AT_THE_BOTTOM: Record<string, GameLog> = {
  g1: played(0, 12), // bears win big
  g2: played(9, 1), // bears win
  g3: played(11, 0), // cubs win
};

describe("the scenario caches", () => {
  it("answers differently for two different seasons, so the fixture can tell them apart", () => {
    // Guards the test itself: if both seasons read the same, nothing below proves anything.
    const { unmount } = render(<Probe logs={ACES_ON_TOP} teamId="aces" />);
    const onTop = rangeText();
    unmount();
    render(<Probe logs={ACES_AT_THE_BOTTOM} teamId="aces" />);
    expect(rangeText()).not.toBe(onTop);
  });

  it("answers for the season it is rendered with, on the render the change arrives", () => {
    /*
     * The whole bug, in one assertion. Emptied from an effect, this re-render read the answer
     * worked out for the previous season — and nothing scheduled another render to correct it.
     */
    const { rerender } = render(<Probe logs={ACES_ON_TOP} teamId="aces" tick={0} />);
    // An unrelated re-render, which is what leaves an answer sitting in the caches to go stale.
    rerender(<Probe logs={ACES_ON_TOP} teamId="aces" tick={1} />);
    const onTop = rangeText();

    rerender(<Probe logs={ACES_AT_THE_BOTTOM} teamId="aces" tick={2} />);

    expect(rangeText()).not.toBe(onTop);
  });

  it("holds the same answer while the season does not change", () => {
    // The caches have to still be caches: a re-render with the same season keeps its answer.
    const { rerender } = render(<Probe logs={ACES_ON_TOP} teamId="aces" tick={0} />);
    const first = rangeText();

    rerender(<Probe logs={ACES_ON_TOP} teamId="aces" tick={1} />);

    expect(rangeText()).toBe(first);
  });

  it("gives a team with nothing left to play its baseline at both ends", () => {
    /*
     * And returns it rather than nothing, which is why the caller's
     * `?? { best: 99, worst: 99, baseline: 99 }` was a branch that could not be taken.
     */
    const everyGame = { ...ACES_ON_TOP, g4: played(3, 2) };
    render(<Probe logs={everyGame} teamId="aces" />);

    const [best, worst, baseline] = (rangeText() ?? "").split("-");
    expect(best).toBe(baseline);
    expect(worst).toBe(baseline);
    expect(Number(baseline)).toBeLessThan(99);
  });
});
