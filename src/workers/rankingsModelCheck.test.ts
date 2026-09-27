import { describe, expect, it } from "vitest";
import { createRankingsHandler, type WorkerResponse } from "./rankingsProtocol";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../lib/teamRankingsCompact";
import {
  checkTheModel,
  MODEL_CHECK_RUNS,
  modelCheckAnswer,
  type ScoutBacktestResult,
} from "../lib/scoutBacktest";

/*
 * Setup's model check in the rankings worker, a run at a time.
 *
 * The check ran in the button's click handler, eleven fits of the page's year, and froze the tab
 * for 18 s on the 18:40 pool. The worker already holds that pool, so the page sends the runs there
 * one per request; a board refit asked for in the middle waits for one run, not eleven. What must
 * hold is that the answer is the one the card worked out itself.
 */
const groups: AgeGroup[] = [
  { id: "u9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const teams: ScoutTeam[] = Array.from({ length: 12 }, (_, index) => ({
  id: `S-${index}`,
  name: `Club ${index}`,
}));
const games: ScoutGame[] = [];
teams.forEach((a, i) =>
  teams.slice(i + 1).forEach((b, j) => {
    const day = new Date(Date.UTC(2026, 8, 1) + games.length * 86_400_000);
    games.push({
      id: `g${games.length}`,
      ageGroupId: i >= 9 ? "u10" : "u9",
      teamAId: a.id,
      teamBId: b.id,
      teamAScore: 4 + ((i * 7 + j * 3) % 9),
      teamBScore: 4 + (j % 5),
      date: day.toISOString().slice(0, 10),
    });
  })
);
const shipment = (revision: number) => ({
  revision,
  teams: encodeScoutTeams(teams),
  games: encodeScoutGames(games),
});

const harness = () => {
  const posted: WorkerResponse[] = [];
  const handle = createRankingsHandler(
    (response) => posted.push(response),
    () => 0
  );
  return { posted, handle };
};

describe("the model check in the rankings worker", () => {
  it("answers run by run what the card worked out in one go", () => {
    const { posted, handle } = harness();
    const results: ScoutBacktestResult[] = [];
    MODEL_CHECK_RUNS.forEach((run, index) => {
      handle({
        kind: "model-check",
        id: index + 1,
        ageGroupId: "u9",
        ageGroups: groups,
        run,
        pool: index === 0 ? shipment(1) : { revision: 1 },
      });
      const answer = posted[posted.length - 1];
      if (answer?.kind !== "model-check") throw new Error(`no answer to run ${index}`);
      expect(answer.id).toBe(index + 1);
      results.push(answer.result);
    });
    const answer = modelCheckAnswer(results);
    expect(answer).toEqual(checkTheModel("u9", teams, games, groups));
    // The fixture is worth something: the check found games to hold back.
    expect(answer.result.sampleSize).toBeGreaterThan(0);
  });

  it("asks for the pool when it does not hold the revision named", () => {
    const { posted, handle } = harness();
    handle({
      kind: "model-check",
      id: 7,
      ageGroupId: "u9",
      ageGroups: groups,
      run: MODEL_CHECK_RUNS[0]!,
      pool: { revision: 3 },
    });
    expect(posted).toEqual([{ kind: "pool-needed", id: 7, revision: 3 }]);
  });

  it("answers a board refit asked for between two runs, in its turn", () => {
    const { posted, handle } = harness();
    const check = (id: number, pool: { revision: number }) =>
      handle({
        kind: "model-check",
        id,
        ageGroupId: "u9",
        ageGroups: groups,
        run: MODEL_CHECK_RUNS[id - 1]!,
        pool,
      });
    check(1, shipment(1));
    handle({
      kind: "rankings",
      id: 50,
      ageGroupId: "u10",
      ageGroups: groups,
      pool: { revision: 1 },
    });
    check(2, { revision: 1 });
    expect(posted.map((answer) => `${answer.kind}:${answer.id}`)).toEqual([
      "model-check:1",
      "rankings:50",
      "model-check:2",
    ]);
  });
});
