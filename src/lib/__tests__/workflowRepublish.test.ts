import { describe, expect, it } from "vitest";
import firebaseWorkflow from "../../../.github/workflows/firebase.yml?raw";
import { REPUBLISH_REASONS } from "../live/viewStore";

/*
 * What the Firebase workflow's comments say of the republish after a deploy (`scripts/republish.ts`),
 * held to when it does publish (`republishWanted`). The comments are what someone reads when a
 * deploy's republish runs a full build, or turns the run red, and they once said it ran only over an
 * older schema or nothing published after a third case, boards of an older shape, had been added:
 * the first deploy of that build was to meet the case they said could not happen.
 *
 * Read as text, as `workflowAlarms.test.ts` reads it: no YAML parser is installed for one test.
 */

/** The comment lines at the head of the file, before its `name:`, as one paragraph. */
const header = (workflow: string): string => {
  const lines: string[] = [];
  for (const line of workflow.split("\n")) {
    if (!line.startsWith("#")) break;
    lines.push(line.replace(/^#\s?/, ""));
  }
  return lines.join(" ");
};

/** The comment lines straight above a job's key, as one paragraph. */
const aboveJob = (workflow: string, job: string): string => {
  const lines = workflow.split("\n");
  const at = lines.findIndex((line) => line === `  ${job}:`);
  const said: string[] = [];
  for (let back = at - 1; back >= 0 && /^\s*#/.test(lines[back] ?? ""); back -= 1) {
    said.unshift((lines[back] ?? "").replace(/^\s*#\s?/, ""));
  }
  return said.join(" ");
};

describe("the Firebase workflow's account of the republish after a deploy", () => {
  it.each([
    ["the file's head", header(firebaseWorkflow)],
    ["the republish job", aboveJob(firebaseWorkflow, "republish")],
  ])("names in %s every case republishWanted publishes over", (_where, said) => {
    expect(said).not.toBe("");
    expect(said).toContain("`republishWanted`");
    for (const reason of REPUBLISH_REASONS) expect(said).toContain(`\`${reason}\``);
  });
});
