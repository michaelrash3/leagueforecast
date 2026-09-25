import { describe, expect, it } from "vitest";
import { applyTidied, createTidyHandler, type WorkerResponse } from "./tidyProtocol";
import { packPool } from "./tidyProtocol";
import { TIDY_STEPS, type GcImportState } from "../lib/gameChangerImport";

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

    const steps = posted.flatMap((r) => (r.kind === "tidy-progress" ? [r] : []));
    expect(steps.length).toBeGreaterThan(0);
    /*
     * Each step reports twice — once going in, once coming out — because a step is where the time
     * goes, and a run reported only on the way out shows nothing moving while a slow one runs.
     */
    expect(steps.length % (TIDY_STEPS.length * 2)).toBe(0);
    expect(steps.slice(0, 4).map((r) => [r.step.step, r.step.done])).toEqual([
      ["notBaseball", false],
      ["notBaseball", true],
      ["highSchool", false],
      ["highSchool", true],
    ]);
    const firstPass = steps.filter((r) => r.step.pass === 1 && r.step.done);
    expect(firstPass.map((r) => r.step.step)).toEqual([
      "notBaseball",
      // Beside it: the two passes that delete a club that does not belong in the pool at all run
      // before anything levels, settles, folds or pairs it.
      "highSchool",
      "releveled",
      "pruned",
      "named",
      "joined",
      "reclaimed",
      "resettled",
      "refiled",
      "folded",
      "paired",
      "collapsed",
      // Reported beside the collapse that does it: the games whose folded rows moved, none gone.
      "regrouped",
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
    const named = steps.find((r) => r.step.step === "named" && r.step.pass === 1 && r.step.done);
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
    const lastPassSteps = steps.filter((r) => r.step.pass === lastPass && r.step.done);
    expect(lastPassSteps).toHaveLength(TIDY_STEPS.length);
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

  it("finishes Pair, begins Collapse, and then delivers the tidy response", () => {
    const { posted, handle } = harness();
    handle({ kind: "tidy", id: 9, state: packPool(withStandIn()) });

    const pairDone = posted.findIndex(
      (response) =>
        response.kind === "tidy-progress" && response.step.step === "paired" && response.step.done
    );
    const collapseStart = posted.findIndex(
      (response) =>
        response.kind === "tidy-progress" &&
        response.step.step === "collapsed" &&
        !response.step.done
    );
    const answer = posted.findIndex((response) => response.kind === "tidy" && response.id === 9);
    expect(pairDone).toBeGreaterThanOrEqual(0);
    expect(collapseStart).toBeGreaterThan(pairDone);
    expect(answer).toBeGreaterThan(collapseStart);
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

describe("saying a step has started, not only that it finished", () => {
  /*
   * A step is where the time goes: on a nationwide pool one of them is seconds of silence. A run
   * reported only on the way out of each step shows nothing moving for all of that, which is the
   * thing the progress view was built to stop.
   */
  it("reports each step going in, with no count and the pool as it found it", () => {
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 1, state: packPool(withStandIn()) });

    const steps = posted.flatMap((r) => (r.kind === "tidy-progress" ? [r] : []));
    const going = steps.filter((r) => !r.step.done);
    const coming = steps.filter((r) => r.step.done);
    expect(going).toHaveLength(coming.length);
    // Nothing has run yet, so there is nothing to have found.
    expect(going.every((r) => r.step.found === 0)).toBe(true);
  });

  it("reports the naming step going in before it reports it coming out", () => {
    const { posted, handle } = harness();

    handle({ kind: "tidy", id: 1, state: packPool(withStandIn()) });

    const steps = posted.flatMap((r) => (r.kind === "tidy-progress" ? [r] : []));
    const inAt = steps.findIndex((r) => r.step.step === "named" && !r.step.done);
    const outAt = steps.findIndex((r) => r.step.step === "named" && r.step.done);
    expect(inAt).toBeGreaterThanOrEqual(0);
    expect(inAt).toBeLessThan(outAt);
  });
});
