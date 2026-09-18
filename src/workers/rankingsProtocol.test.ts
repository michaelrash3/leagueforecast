import { describe, expect, it } from "vitest";
import { createRankingsHandler, type WorkerRequest, type WorkerResponse } from "./rankingsProtocol";
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../lib/teamRankingsCompact";

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
