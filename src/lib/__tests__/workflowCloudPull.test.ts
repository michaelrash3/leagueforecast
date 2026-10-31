import { describe, expect, it } from "vitest";
import cloudPullWorkflow from "../../../.github/workflows/cloud-pull.yml?raw";
import nightlyWorkflow from "../../../.github/workflows/nightly.yml?raw";

/*
 * The pulls' workflow on GitHub (`cloud-pull.yml`, README "Pulls on GitHub") held to GitHub's room:
 * its runner has the nightly's 16 GB, where the Google machines these jobs were sized for had 8 GiB,
 * so the boards' publish and a leg's worker get the nightly's heap (`legHeapMb` reads the leg's).
 * Read as text, as `workflowCatchUp.test.ts` reads the others: no YAML parser is installed.
 */

/** The workflow with its comment lines left out. */
const uncommented = (workflow: string): string =>
  workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/** The heap, in MB, of `--max-old-space-size` where `before` precedes it on a line. */
const heapOf = (workflow: string, before: RegExp): number | undefined => {
  const line = uncommented(workflow)
    .split("\n")
    .find((one) => before.test(one) && /--max-old-space-size=\d+/.test(one));
  const size = /--max-old-space-size=(\d+)/.exec(line ?? "")?.[1];
  return size === undefined ? undefined : Number(size);
};

describe("the pulls' workflow on GitHub", () => {
  const nightly = heapOf(nightlyWorkflow, /NODE_OPTIONS:/);

  it("gives the boards' publish the nightly's heap", () => {
    expect(nightly).toBe(12_288);
    expect(heapOf(cloudPullWorkflow, /node lib\/boardsPublish\.js/)).toBe(nightly);
  });

  it("gives a leg's worker the nightly's heap, by the value it reads", () => {
    const said = /^\s+PULL_LEG_HEAP_MB: "(\d+)"\s*$/m.exec(uncommented(cloudPullWorkflow))?.[1];
    expect(Number(said)).toBe(nightly);
  });
});
