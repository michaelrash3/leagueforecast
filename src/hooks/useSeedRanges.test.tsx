import { render, screen } from "@testing-library/react";
import { useEffect, useMemo } from "react";
import { describe, expect, it } from "vitest";
import { useSeedRanges } from "./useSeedRanges";
import { calculateTeams, rankTeams, rankOptionsFromSettings } from "../lib/sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../lib/types";

/**
 * The scenario walk, and the two ways its caches went stale.
 *
 * They are read *during* render — the model table asks for a team's range three times over while
 * it draws, and the drawer asks again — so anything that empties them after the render that read
 * them is too late, and emptying a ref schedules no re-render to put it right.
 */
const TEAMS: TeamBase[] = [
  { id: "aces", name: "Aces" },
  { id: "bears", name: "Bears" },
  { id: "cubs", name: "Cubs" },
  { id: "ducks", name: "Ducks" },
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

/** Four decided, two left — enough that a middle team's finish is genuinely still open. */
const SCHEDULE: Matchup[] = [
  { id: "g1", date: "2026-04-05", away: "aces", home: "bears" },
  { id: "g2", date: "2026-04-05", away: "cubs", home: "ducks" },
  { id: "g3", date: "2026-04-12", away: "aces", home: "cubs" },
  { id: "g4", date: "2026-04-12", away: "bears", home: "ducks" },
  { id: "g5", date: "2026-05-03", away: "aces", home: "bears" },
  { id: "g6", date: "2026-05-03", away: "cubs", home: "ducks" },
];

/**
 * The Bears are the team to ask about: third, and the last two games can still lift them to
 * second. With the walk on they read 2-3; with it off, 3-3.
 */
const SUBJECT = "bears";

const ONE_WAY: Record<string, GameLog> = {
  g1: played(7, 2),
  g2: played(6, 1),
  g3: played(1, 8),
  g4: played(9, 3),
};
/** The same six games, every result the other way, so the table is a different table. */
const THE_OTHER: Record<string, GameLog> = {
  g1: played(2, 7),
  g2: played(1, 6),
  g3: played(8, 1),
  g4: played(3, 9),
};

const seasonAt = (logs: Record<string, GameLog>) => {
  const liveTeams = calculateTeams(TEAMS, SCHEDULE, logs, DEFAULT_SETTINGS);
  const ranked = rankTeams(liveTeams, rankOptionsFromSettings(DEFAULT_SETTINGS));
  const remainingGames = SCHEDULE.filter((game) => !logs[game.id]);
  const projectedById = new Map(ranked.map((team) => [team.id, team]));
  return { liveTeams, ranked, remainingGames, projectedById };
};

/**
 * Asks for a range and a scenario seed while rendering, exactly as the model table does.
 *
 * The season is memoised on the results, as the app memoises it on its state, and that detail is
 * the whole reproduction: with fresh arrays every render, an effect keyed on them fires after
 * every render and the caches are empty again before anyone can read a stale answer out of them.
 * `tick` is the unrelated re-render every real app has — a tooltip, a tab, a clock — and it is
 * what lets an answer survive one render to be stale on the next.
 */
function Probe({
  logs,
  tick = 0,
  exact = true,
  teamId = SUBJECT,
}: {
  logs: Record<string, GameLog>;
  tick?: number;
  exact?: boolean;
  teamId?: string;
}) {
  void tick;
  const season = useMemo(() => seasonAt(logs), [logs]);
  const { seedForScenario, seedRangeForTeam } = useSeedRanges({
    exact,
    liveTeams: season.liveTeams,
    remainingGames: season.remainingGames,
    settings: DEFAULT_SETTINGS,
    projectedById: season.projectedById,
    ranked: season.ranked,
  });
  useEffect(() => {
    walks.push(seedRangeForTeam);
  });
  const range = seedRangeForTeam(teamId);
  const game = season.remainingGames.find((g) => g.away === teamId || g.home === teamId);
  const winSeed = game ? seedForScenario(teamId, game, teamId) : -1;
  return (
    <>
      <div data-testid="range">{`${range.best}-${range.worst}-${range.baseline}`}</div>
      <div data-testid="seed">{String(winSeed)}</div>
    </>
  );
}

/**
 * The identity of the walk itself, recorded after each render.
 *
 * Comparing the *answers* across renders cannot tell a cache from an identical recomputation —
 * both read the same. `seedRangeForTeam` is a callback over the caches, so it is a new function
 * exactly when the caches are new, and that is the thing to watch. Recorded from an effect
 * because a render may not touch a ref.
 */
const walks: unknown[] = [];

const rangeText = () => screen.getByTestId("range").textContent;
const seedText = () => screen.getByTestId("seed").textContent;

describe("the scenario caches and the season", () => {
  it("answers differently for two different seasons, so the fixture can tell them apart", () => {
    // Guards the test itself: if both tables read the same, nothing below proves anything.
    const { unmount } = render(<Probe logs={ONE_WAY} />);
    const oneWay = rangeText();
    unmount();
    render(<Probe logs={THE_OTHER} />);
    expect(rangeText()).not.toBe(oneWay);
  });

  it("answers for the season it is rendered with, on the render the change arrives", () => {
    /*
     * Emptied from an effect, this re-render read the answer worked out for the previous season —
     * and nothing scheduled another render to correct it, so the table moved and the range beside
     * it went on saying what it said before the score was typed.
     */
    const { rerender } = render(<Probe logs={ONE_WAY} tick={0} />);
    // An unrelated re-render, which is what leaves an answer sitting in the caches to go stale.
    rerender(<Probe logs={ONE_WAY} tick={1} />);
    const oneWay = rangeText();

    rerender(<Probe logs={THE_OTHER} tick={2} />);

    expect(rangeText()).not.toBe(oneWay);
  });

  it("holds the same answer while the season does not change", () => {
    const { rerender } = render(<Probe logs={ONE_WAY} tick={0} />);
    const first = rangeText();

    rerender(<Probe logs={ONE_WAY} tick={1} />);

    expect(rangeText()).toBe(first);
  });

  it("keeps one set of caches across a re-render, rather than rebuilding them", () => {
    /*
     * The answers being equal does not say this: a cache thrown away every render recomputes the
     * same numbers and reads identically. What says it is that the walk is the same walk, and it
     * matters — this exists because the model table asks for the same team's range three times
     * over while it draws, over a walk that is one projection per remaining game per team.
     */
    walks.length = 0;
    const { rerender } = render(<Probe logs={ONE_WAY} tick={0} />);
    rerender(<Probe logs={ONE_WAY} tick={1} />);

    expect(walks).toHaveLength(2);
    expect(walks[0]).toBe(walks[1]);
  });

  it("builds new caches when the season changes", () => {
    // The other half of the same rule, so "never rebuild" cannot pass the test above.
    walks.length = 0;
    const { rerender } = render(<Probe logs={ONE_WAY} tick={0} />);
    rerender(<Probe logs={THE_OTHER} tick={1} />);

    expect(walks).toHaveLength(2);
    expect(walks[0]).not.toBe(walks[1]);
  });

  it("gives a team with nothing left to play its baseline at both ends", () => {
    /*
     * And returns it rather than nothing, which is why the caller's
     * `?? { best: 99, worst: 99, baseline: 99 }` was a branch that could not be taken.
     */
    const everyGame = { ...ONE_WAY, g5: played(3, 2), g6: played(4, 1) };
    render(<Probe logs={everyGame} />);

    const [best, worst, baseline] = (rangeText() ?? "").split("-");
    expect(best).toBe(baseline);
    expect(worst).toBe(baseline);
    expect(Number(baseline)).toBeLessThan(99);
  });
});

describe("the scenario caches and the walk being switched off", () => {
  /*
   * `exact` is `activeView === "model"` and a games-remaining limit, so it flips without any of
   * the teams, the games or the settings changing — and the caches were keyed on those alone.
   *
   * With the walk off a range is the team's projection at both ends, and a scenario seed is the 99
   * that stands for "not worked out". Both were written into the caches anyway. So opening a team
   * from the standings and then going to the model table served every Range as #n–#n and every
   * win/loss seed as 99: answers to a question nobody had asked, sitting there waiting.
   */
  it("does not serve a range worked out with the walk off once it is on", () => {
    const { rerender } = render(<Probe logs={ONE_WAY} exact={false} tick={0} />);
    rerender(<Probe logs={ONE_WAY} exact={false} tick={1} />);
    const withoutWalk = rangeText();
    // Which is the projection at both ends — a finish it says is already settled.
    const [best, worst] = (withoutWalk ?? "").split("-");
    expect(best).toBe(worst);

    rerender(<Probe logs={ONE_WAY} exact={true} tick={2} />);

    expect(rangeText()).not.toBe(withoutWalk);
  });

  it("does not serve a scenario seed of 99 from when the walk was off", () => {
    const { rerender } = render(<Probe logs={ONE_WAY} exact={false} tick={0} />);
    rerender(<Probe logs={ONE_WAY} exact={false} tick={1} />);
    expect(seedText()).toBe("99");

    rerender(<Probe logs={ONE_WAY} exact={true} tick={2} />);

    expect(seedText()).not.toBe("99");
  });

  it("still keeps its answers while the walk stays on", () => {
    // Keyed on the question, not thrown away every render: it has to still be a cache.
    const { rerender } = render(<Probe logs={ONE_WAY} exact={true} tick={0} />);
    const first = rangeText();

    rerender(<Probe logs={ONE_WAY} exact={true} tick={1} />);

    expect(rangeText()).toBe(first);
  });
});
