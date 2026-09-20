import { describe, expect, it } from "vitest";
import { createRankingsHandler, type WorkerRequest, type WorkerResponse } from "./rankingsProtocol";
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../lib/teamRankingsCompact";
import { whatIfCurve } from "../lib/scoutWhatIf";

const groups: AgeGroup[] = [
  { id: "u10", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
];
const teams: ScoutTeam[] = ["A", "B", "C", "D", "E", "F"].map((id) => ({
  id: `S-${id}`,
  name: `Club ${id}`,
  state: "KY",
}));
const games: ScoutGame[] = [];
const play = (a: string, b: string, sa: number, sb: number, day: string) =>
  games.push({
    id: `g${games.length}`,
    teamAId: `S-${a}`,
    teamBId: `S-${b}`,
    ageGroupId: "u10",
    teamAScore: sa,
    teamBScore: sb,
    date: `2026-09-${day}`,
  });
play("A", "B", 7, 3, "05");
play("B", "C", 5, 4, "05");
play("C", "D", 6, 2, "06");
play("D", "E", 3, 8, "06");
play("E", "F", 4, 4, "12");
play("F", "A", 2, 9, "12");
play("A", "C", 5, 1, "13");
play("B", "D", 6, 6, "13");
play("C", "E", 3, 7, "19");
play("D", "F", 8, 1, "19");

/** The pool as the page ships it: compact, under a revision. */
const shipment = (revision: number) => ({
  revision,
  teams: encodeScoutTeams(teams),
  games: encodeScoutGames(games),
});
const base = { kind: "rankings" as const, ageGroupId: "u10", ageGroups: groups };

const harness = () => {
  const posted: WorkerResponse[] = [];
  const handle = createRankingsHandler(
    (response) => posted.push(response),
    () => 0
  );
  return { posted, handle };
};

describe("the rankings worker's side of the protocol", () => {
  it("asks for the pool when it has never been sent one", () => {
    const { posted, handle } = harness();
    handle({ ...base, id: 1, pool: { revision: 1 } });
    expect(posted).toEqual([{ kind: "pool-needed", id: 1, revision: 1 }]);
  });

  it("fits the pool it was shipped exactly as the page would have inline", () => {
    const { posted, handle } = harness();
    handle({ ...base, id: 1, pool: shipment(1) });
    const answer = posted[0];
    expect(answer?.kind).toBe("rankings");
    if (answer?.kind !== "rankings") return;
    // Through the codec and back is the same fit: nothing the rating reads is lost on the wire.
    expect(answer.rows).toEqual(buildTeamRankings("u10", teams, games, undefined, groups));
    expect(answer.rows.length).toBeGreaterThan(0);
  });

  it("keeps the pool between requests, so a request from another seat ships nothing", () => {
    const { posted, handle } = harness();
    handle({ ...base, id: 1, pool: shipment(1) });
    handle({ ...base, id: 2, myTeamId: "S-A", pool: { revision: 1 } });
    const second = posted[1];
    expect(second?.kind).toBe("rankings");
    if (second?.kind !== "rankings") return;
    expect(second.id).toBe(2);
    expect(second.rows.find((row) => row.teamId === "S-A")?.isMine).toBe(true);
  });

  it("asks again when the page names a revision it does not hold", () => {
    const { posted, handle } = harness();
    handle({ ...base, id: 1, pool: shipment(1) });
    handle({ ...base, id: 2, pool: { revision: 2 } });
    expect(posted[1]).toEqual({ kind: "pool-needed", id: 2, revision: 2 });
  });

  it("takes the pool off a cancelled request rather than making the next one ship it again", () => {
    const { posted, handle } = harness();
    handle({ kind: "cancel", id: 1 } satisfies WorkerRequest);
    handle({ ...base, id: 1, pool: shipment(1) });
    expect(posted).toEqual([]);
    handle({ ...base, id: 2, pool: { revision: 1 } });
    expect(posted[0]?.kind).toBe("rankings");
  });
});

/*
 * The what-if rides the same protocol as the board, and these are the three ways that could go
 * wrong: it could be answered against a pool the worker does not hold, it could be answered
 * against a different day than the page asked about, and it could leave its hypothetical behind
 * in the pool every later fit reads.
 */
describe("the what-if branch", () => {
  /** An upcoming fixture between two clubs that have played, so only the date makes it upcoming. */
  const fixture: ScoutGame = {
    id: "upcoming",
    teamAId: "S-A",
    teamBId: "S-D",
    ageGroupId: "u10",
    date: "2026-10-31",
  };
  const withFixture = [...games, fixture];
  const poolWithFixture = (revision: number) => ({
    revision,
    teams: encodeScoutTeams(teams),
    games: encodeScoutGames(withFixture),
  });
  const askBase = {
    kind: "what-if" as const,
    ageGroupId: "u10",
    ageGroups: groups,
    forTeamId: "S-A",
    gameId: "upcoming",
    today: "2026-09-20",
  };

  it("asks for the pool rather than answering about one it does not hold", () => {
    const { posted, handle } = harness();
    handle({ ...askBase, id: 1, pool: { revision: 7 } } satisfies WorkerRequest);

    expect(posted).toEqual([{ kind: "pool-needed", id: 1, revision: 7 }]);
  });

  it("answers for the day the page named, not for the day the worker is having", () => {
    const { posted, handle } = harness();
    handle({ ...askBase, id: 1, pool: poolWithFixture(1) } satisfies WorkerRequest);

    const answer = posted[0];
    expect(answer?.kind).toBe("what-if");
    const direct = whatIfCurve(
      fixture,
      "S-A",
      "u10",
      teams,
      withFixture,
      undefined,
      groups,
      undefined,
      "2026-09-20"
    );
    expect(answer?.kind === "what-if" && answer.curve).toEqual(direct);
  });

  it("says so when the held pool no longer carries the fixture", () => {
    const { posted, handle } = harness();
    handle({ ...askBase, id: 1, pool: shipment(1) } satisfies WorkerRequest);

    expect(posted[0]).toMatchObject({ kind: "what-if", id: 1, curve: null });
  });

  it("leaves the held pool exactly as it found it", () => {
    // The hypothetical is a game nobody played. If it were written into the pool the worker holds,
    // every later fit at this revision would count it, and the board would quietly be wrong.
    const { posted, handle } = harness();
    handle({ ...base, id: 1, pool: poolWithFixture(1) } satisfies WorkerRequest);
    const before = posted[0];

    handle({ ...askBase, id: 2, pool: { revision: 1 } } satisfies WorkerRequest);
    handle({ ...base, id: 3, pool: { revision: 1 } } satisfies WorkerRequest);
    const after = posted[2];

    expect(before?.kind === "rankings" && before.rows).toEqual(
      after?.kind === "rankings" && after.rows
    );
  });
});
