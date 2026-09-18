import { describe, expect, it } from "vitest";
import { applyTidied, createTidyHandler, type WorkerResponse } from "./tidyProtocol";
import { packPool } from "./tidyProtocol";
import type { GcImportState } from "../lib/gameChangerImport";

/**
 * One club's schedule names the opponent; the other posted the same game against a stand-in with
 * the mirrored score. The tidy settles that, so a run that did anything is one that found this.
 */
const withStandIn = (): GcImportState => ({
  ageGroups: [{ id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }],
  teams: [
    { id: "S-HOME", name: "Home Club", state: "KY" },
    { id: "S-AWAY", name: "Away Club", state: "KY" },
    { id: "S-TBD", name: "TBD- 3:00 PM", placeholder: true },
  ],
  games: [
    {
      id: "named",
      ageGroupId: "ag_10u_2027",
      teamAId: "S-HOME",
      teamBId: "S-AWAY",
      teamAScore: 6,
      teamBScore: 2,
      date: "2026-09-12",
      source: { kind: "gamechanger", teamId: "gcHOME", gameId: "n1" },
    },
    {
      id: "slot",
      ageGroupId: "ag_10u_2027",
      teamAId: "S-AWAY",
      teamBId: "S-TBD",
      teamAScore: 2,
      teamBScore: 6,
      date: "2026-09-12",
      source: { kind: "gamechanger", teamId: "gcAWAY", gameId: "s1" },
    },
  ],
});

const harness = () => {
  const posted: WorkerResponse[] = [];
  const handle = createTidyHandler((response) => posted.push(response));
  return { posted, handle };
};

describe("the tidy worker's side of the protocol", () => {
  it("hands back only the parts of the pool it changed", () => {
    const { posted, handle } = harness();
    const before = withStandIn();
    handle({ kind: "tidy", id: 1, state: packPool(before) });
    const answer = posted[0];
    expect(answer?.kind).toBe("tidy");
    if (answer?.kind !== "tidy") return;
    expect(answer.tidy.named).toBe(1);
    expect(answer.changed.games).toBeDefined();
    // Nothing happened to the age groups, so they are not in the answer at all.
    expect(answer.changed.ageGroups).toBeUndefined();
  });

  it("hands back nothing for a pool with nothing to do, so nothing is re-saved", () => {
    const { posted, handle } = harness();
    const before = withStandIn();
    handle({ kind: "tidy", id: 1, state: packPool(before) });
    const first = posted[0];
    if (first?.kind !== "tidy") throw new Error("expected a tidy answer");
    const tidied = applyTidied(before, first.changed);

    handle({ kind: "tidy", id: 2, state: packPool(tidied) });
    const second = posted[1];
    if (second?.kind !== "tidy") throw new Error("expected a tidy answer");
    expect(second.changed).toEqual({});
    // And laying nothing over the pool gives back the very arrays the caller holds.
    const kept = applyTidied(tidied, second.changed);
    expect(kept.ageGroups).toBe(tidied.ageGroups);
    expect(kept.teams).toBe(tidied.teams);
    expect(kept.games).toBe(tidied.games);
  });

  it("inspects the pool it was shipped without tidying it", () => {
    const { posted, handle } = harness();
    handle({
      kind: "inspect",
      id: 1,
      state: packPool(withStandIn()),
      stamp: "",
      today: "2026-09-18",
    });
    const answer = posted[0];
    expect(answer?.kind).toBe("inspect");
    if (answer?.kind !== "inspect") return;
    expect(answer.health.games).toBe(2);
    expect(answer.settleable).toBe(1);
  });
});
