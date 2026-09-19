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
  /*
   * The answer, wherever it sits. It used to be the only thing posted, so the tests took the first
   * message; a tidy now reports each step as it finishes, and the answer is the last of many.
   */
  const answersOf = (kind: "tidy" | "inspect") =>
    posted.filter((response) => response.kind === kind);
  return { posted, handle, answersOf };
};

describe("the tidy worker's side of the protocol", () => {
  it("hands back only the parts of the pool it changed", () => {
    const { handle, answersOf } = harness();
    const before = withStandIn();
    handle({ kind: "tidy", id: 1, state: packPool(before) });
    const answer = answersOf("tidy")[0];
    expect(answer?.kind).toBe("tidy");
    if (answer?.kind !== "tidy") return;
    expect(answer.tidy.named).toBe(1);
    expect(answer.changed.games).toBeDefined();
    // Nothing happened to the age groups, so they are not in the answer at all.
    expect(answer.changed.ageGroups).toBeUndefined();
  });

  it("hands back nothing for a pool with nothing to do, so nothing is re-saved", () => {
    const { handle, answersOf } = harness();
    const before = withStandIn();
    handle({ kind: "tidy", id: 1, state: packPool(before) });
    const first = answersOf("tidy")[0];
    if (first?.kind !== "tidy") throw new Error("expected a tidy answer");
    const tidied = applyTidied(before, first.changed);

    handle({ kind: "tidy", id: 2, state: packPool(tidied) });
    const second = answersOf("tidy")[1];
    if (second?.kind !== "tidy") throw new Error("expected a tidy answer");
    expect(second.changed).toEqual({});
    // And laying nothing over the pool gives back the very arrays the caller holds.
    const kept = applyTidied(tidied, second.changed);
    expect(kept.ageGroups).toBe(tidied.ageGroups);
    expect(kept.teams).toBe(tidied.teams);
    expect(kept.games).toBe(tidied.games);
  });

  it("inspects the pool it was shipped without tidying it", () => {
    const { handle, answersOf } = harness();
    handle({
      kind: "inspect",
      id: 1,
      state: packPool(withStandIn()),
      stamp: "",
      today: "2026-09-18",
    });
    const answer = answersOf("inspect")[0];
    expect(answer?.kind).toBe("inspect");
    if (answer?.kind !== "inspect") return;
    expect(answer.health.games).toBe(2);
    expect(answer.settleable).toBe(1);
  });
});

describe("what the tidy says while it runs", () => {
  /*
   * The tidy is the longest thing this app does, and it used to say nothing at all until it was
   * finished. On a pool where that is half a minute, silence and a hang look the same — which is
   * how a tidy came to be interrupted often enough to leave eleven thousand results filed against
   * "TBD" while the code to settle them worked perfectly.
   */
  it("reports every step of every pass, in the order it does them", () => {
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 7, state: packPool(withStandIn()) });

    const steps = posted.filter((response) => response.kind === "tidy-progress");
    expect(steps.length).toBeGreaterThan(0);
    // Nine steps a pass, and the tidy runs at least twice: once to do the work, once to find
    // nothing and stop.
    expect(steps.length % 9).toBe(0);
    const firstPass = steps.slice(0, 9);
    expect(firstPass.map((s) => s.kind === "tidy-progress" && s.step.step)).toEqual([
      "notBaseball",
      "releveled",
      "pruned",
      "named",
      "reclaimed",
      "refiled",
      "folded",
      "paired",
      "collapsed",
    ]);
  });

  it("carries the id of the tidy it belongs to", () => {
    // Two tidies can be in flight across a remount; a step with nobody's id is a step nobody can
    // place, and the page would draw the wrong run's progress.
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 42, state: packPool(withStandIn()) });

    expect(posted.filter((r) => r.kind === "tidy-progress").every((r) => r.id === 42)).toBe(true);
  });

  it("counts the pass and the pool as each step leaves it", () => {
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 1, state: packPool(withStandIn()) });

    const steps = posted.flatMap((r) => (r.kind === "tidy-progress" ? [r] : []));
    const named = steps.find((r) => r.step.step === "named" && r.step.pass === 1);
    // The stand-in in the fixture is exactly one settleable row, found on the first pass.
    expect(named?.step.found).toBe(1);
    expect(named?.step.pass).toBe(1);
    // And the pool it reports is the pool after that step, not before it.
    expect(named?.step.games).toBeGreaterThan(0);
    expect(named?.step.teams).toBeGreaterThan(0);
  });

  it("finds nothing on its last pass, which is how it knows to stop", () => {
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 1, state: packPool(withStandIn()) });

    const steps = posted.flatMap((r) => (r.kind === "tidy-progress" ? [r] : []));
    const lastPass = Math.max(...steps.map((r) => r.step.pass));
    const lastPassSteps = steps.filter((r) => r.step.pass === lastPass);
    expect(lastPassSteps).toHaveLength(9);
    expect(lastPassSteps.reduce((sum, r) => sum + r.step.found, 0)).toBe(0);
  });

  it("still answers, after all of that", () => {
    // The progress must not become the reply: the caller is waiting on a "tidy" message.
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 3, state: packPool(withStandIn()) });

    const answers = posted.filter((response) => response.kind === "tidy");
    expect(answers).toHaveLength(1);
    expect(posted[posted.length - 1]).toBe(answers[0]);
  });

  it("says nothing at all while inspecting", () => {
    // Inspect does not tidy; a progress message from it would draw a run that is not happening.
    const { posted, handle } = harness();

    handle({
      kind: "inspect",
      id: 1,
      state: packPool(withStandIn()),
      stamp: "",
      today: "2026-09-19",
    });

    expect(posted.filter((response) => response.kind === "tidy-progress")).toEqual([]);
  });
});
