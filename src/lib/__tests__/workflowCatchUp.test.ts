import { describe, expect, it } from "vitest";
import catchUpWorkflow from "../../../.github/workflows/catch-up.yml?raw";
import nightlyWorkflow from "../../../.github/workflows/nightly.yml?raw";

/*
 * The catch-up's workflow (`scripts/catchUp.ts`, README "Boards caught up on GitHub") held to what
 * makes it safe to run every half hour: it builds the boards as the nightly does, under the same
 * day, collation, heap and Node; it never shares the nightly's concurrency group, where joining
 * every half hour would cancel a night waiting behind it; it may write nothing on GitHub; and the
 * word it waits on the nightly by comes from a step before it.
 *
 * Read as text, a step at a time by its indentation, as `workflowAlarms.test.ts` reads the others:
 * no YAML parser is installed for one test.
 */

/** The lines of a workflow with its comments left out. */
const uncommented = (workflow: string): string =>
  workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/** The steps of a workflow's jobs, each as its text. */
const stepsOf = (workflow: string): string[] =>
  (uncommented(workflow).split(/^jobs:\s*$/m)[1] ?? "").split(/^(?= {6}- )/m).slice(1);

/** The step that runs `command`, or the empty string. */
const stepRunning = (workflow: string, command: string): string =>
  stepsOf(workflow).find((step) => new RegExp(`run: ${command}\\b`).test(step)) ?? "";

/** A step's own key, as written at its indentation (the first is on the dash's line). */
const keyOf = (step: string, key: string): string | undefined =>
  new RegExp(`^(?: {6}- | {8}| {10})${key}: (.*?)\\s*$`, "m").exec(step)?.[1];

/** A top-level block's text, up to the next top-level key. */
const blockOf = (workflow: string, key: string): string =>
  new RegExp(`^${key}:\\s*\\n((?:[ ].*\\n?)*)`, "m").exec(uncommented(workflow))?.[1] ?? "";

describe("the catch-up's workflow", () => {
  const catchUp = stepRunning(catchUpWorkflow, "npm run catch-up");
  const nightly = stepsOf(nightlyWorkflow).find((step) => keyOf(step, "id") === "refresh") ?? "";

  it("builds the boards under the nightly's day, collation and heap", () => {
    expect(catchUp).not.toBe("");
    expect(nightly).toContain("npm run nightly");
    for (const name of ["TZ", "LANG", "NODE_OPTIONS"]) {
      expect(keyOf(catchUp, name)).toBeDefined();
      expect(keyOf(catchUp, name)).toBe(keyOf(nightly, name));
    }
    expect(keyOf(catchUp, "FIREBASE_SERVICE_ACCOUNT")).toBe(
      keyOf(nightly, "FIREBASE_SERVICE_ACCOUNT")
    );
  });

  it("runs on the nightly's Node, checked out and set up as the nightly's is", () => {
    const setup = (workflow: string) =>
      stepsOf(workflow).filter((step) => /uses: actions\/(checkout|setup-node)@/.test(step));
    expect(setup(catchUpWorkflow)).toEqual(setup(nightlyWorkflow));
    expect(setup(catchUpWorkflow)).toHaveLength(2);
  });

  it("runs one at a time in a group of its own, never the nightly's", () => {
    const own = blockOf(catchUpWorkflow, "concurrency");
    const theirs = blockOf(nightlyWorkflow, "concurrency");
    const group = (block: string) => /^\s+group: (.+?)\s*$/m.exec(block)?.[1];
    expect(group(own)).toBeDefined();
    expect(group(theirs)).toBeDefined();
    expect(group(own)).not.toBe(group(theirs));
    expect(own).toMatch(/^\s+cancel-in-progress: false\s*$/m);
  });

  it("may write nothing on GitHub, and only read its runs", () => {
    const permissions = blockOf(catchUpWorkflow, "permissions")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    expect(permissions.sort()).toEqual(["actions: read", "contents: read"]);
  });

  it("waits on the nightly by a word a step before it hands over", () => {
    const steps = stepsOf(catchUpWorkflow);
    const at = steps.indexOf(catchUp);
    const said = /^\s+NIGHTLY_RUNS: \$\{\{ steps\.([A-Za-z0-9_-]+)\.outputs\.runs \}\}\s*$/m.exec(
      catchUp
    )?.[1];
    expect(said).toBeDefined();
    const asker = steps.slice(0, at).find((step) => keyOf(step, "id") === said) ?? "";
    expect(asker).toContain("actions/workflows/nightly.yml/runs");
    // A GitHub that does not answer hands over nothing, rather than failing the run.
    expect(asker).toContain('|| runs=""');
  });
});
