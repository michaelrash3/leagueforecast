import { describe, expect, it } from "vitest";
import firebaseWorkflow from "../../../.github/workflows/firebase.yml?raw";
import nightlyWorkflow from "../../../.github/workflows/nightly.yml?raw";
import verifyGcWorkflow from "../../../.github/workflows/verify-gc.yml?raw";
import alarmScript from "../../../scripts/alarm.ts?raw";
import nightlyScript from "../../../scripts/nightly.ts?raw";
import upkeepScript from "../../../scripts/upkeep.ts?raw";
import verifyGcScript from "../../../scripts/verify-gc-pull.ts?raw";

/*
 * The alarm steps as the workflows run them (`scripts/alarm.ts`, README "When a run fails"). What an
 * alarm says and when is `runAlarms.ts`'s, tested beside it; this holds the YAML to the three
 * things that make it run at all and not do harm: it runs however the job's work ended
 * (`if: always()`), it reads the outcome of a step that is there, and a failure of its own leaves
 * the run as the work left it (`continue-on-error: true`). Without that last, a night that saved
 * turned red, and GitHub emailed that it failed, whenever `gh` could not reach the issues.
 *
 * Read as text, a job and a step at a time, by their indentation, as both workflows are laid out:
 * no YAML parser is installed for one test.
 */

/** Each job's steps, as the text of each step with its comment lines left out. */
const jobsOf = (workflow: string): Map<string, string[]> => {
  const uncommented = workflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  const body = uncommented.split(/^jobs:\s*$/m)[1] ?? "";
  const jobs = new Map<string, string[]>();
  for (const chunk of body.split(/^(?= {2}[A-Za-z0-9_-]+:\s*$)/m)) {
    const name = /^ {2}([A-Za-z0-9_-]+):/.exec(chunk)?.[1];
    if (name) jobs.set(name, chunk.split(/^(?= {6}- )/m).slice(1));
  }
  return jobs;
};

/** A step's own key, as written at its indentation (the first is on the dash's line). */
const keyOf = (step: string, key: string): string | undefined =>
  new RegExp(`^(?: {6}- | {8})${key}: (.*?)\\s*$`, "m").exec(step)?.[1];

const WORKFLOWS = [
  { file: "nightly.yml", text: nightlyWorkflow, job: "refresh", work: "refresh" },
  { file: "firebase.yml", text: firebaseWorkflow, job: "republish", work: "republish" },
  { file: "verify-gc.yml", text: verifyGcWorkflow, job: "verify", work: "verify" },
];

describe("the alarm step in each workflow", () => {
  it.each(WORKFLOWS)("is the last step of $file's $job job, run however it ended", (flow) => {
    const steps = jobsOf(flow.text).get(flow.job) ?? [];
    const alarms = steps.filter((step) => /npm run alarm\b/.test(step));
    expect(alarms).toHaveLength(1);
    expect(steps[steps.length - 1]).toBe(alarms[0]);
    expect(keyOf(alarms[0] ?? "", "if")).toBe("always()");
  });

  it.each(WORKFLOWS)(
    "in $file leaves the run as its work left it when the alarm itself fails",
    (flow) => {
      const steps = jobsOf(flow.text).get(flow.job) ?? [];
      const alarm = steps.find((step) => /npm run alarm\b/.test(step)) ?? "";
      expect(keyOf(alarm, "continue-on-error")).toBe("true");
      // Only the alarm: the work's own step failing is what turns a night red.
      const work = steps.find((step) => keyOf(step, "id") === flow.work) ?? "";
      expect(work).not.toBe("");
      expect(keyOf(work, "continue-on-error")).toBeUndefined();
    }
  );

  it.each(WORKFLOWS)(
    "in $file reads the outcome of the step before it that does the work",
    (flow) => {
      const steps = jobsOf(flow.text).get(flow.job) ?? [];
      const at = steps.findIndex((step) => /npm run alarm\b/.test(step));
      const alarm = steps[at] ?? "";
      const named = [
        ...alarm.matchAll(/\$\{\{ steps\.([A-Za-z0-9_-]+)\.(?:outcome|outputs\.\w+) \}\}/g),
      ];
      expect(named.length).toBeGreaterThan(0);
      const before = new Set(steps.slice(0, at).map((step) => keyOf(step, "id")));
      for (const [, id] of named) expect(before.has(id)).toBe(true);
      expect(alarm).toContain(`OUTCOME: \${{ steps.${flow.work}.outcome }}`);
    }
  );
});

/*
 * The words the nightly hands the alarm (README, "When a run fails"): each is written by the
 * refresh as a step output (`output("name", …)` in `scripts/nightly.ts`), passed on by the alarm
 * step's env as `KEY: ${{ steps.refresh.outputs.name }}`, and read by `scripts/alarm.ts` as
 * `env.KEY`. On GitHub a step output nobody wrote reads as empty, which leaves an alarm as it is,
 * so a name changed on any one side would have stopped a "better" Monday ever opening its issue,
 * and a "held" one ever closing it, with every test green.
 */
describe("the words the nightly hands its alarm step", () => {
  const steps = jobsOf(nightlyWorkflow).get("refresh") ?? [];
  const alarm = steps.find((step) => /npm run alarm\b/.test(step)) ?? "";
  const handed = [
    ...alarm.matchAll(/^ {10}([A-Z_]+): \$\{\{ steps\.refresh\.outputs\.(\w+) \}\}\s*$/gm),
  ].map(([, key, name]) => ({ key: key ?? "", name: name ?? "" }));

  it("hands over the rebuilds' word and the starting level's", () => {
    expect(handed).toEqual([
      { key: "REBUILDS", name: "rebuilds" },
      { key: "CLOSED_LEVEL", name: "closedLevel" },
    ]);
  });

  it.each([
    { key: "REBUILDS", name: "rebuilds" },
    { key: "CLOSED_LEVEL", name: "closedLevel" },
  ])("writes $name in the refresh, and reads it as $key in the alarm", ({ key, name }) => {
    expect(handed).toContainEqual({ key, name });
    expect(nightlyScript).toContain(`output("${name}", `);
    expect(alarmScript).toContain(`env.${key} `);
  });
});

/*
 * The words read beside the refresh for the billing and the dispatch token's alarms
 * (`scripts/upkeep.ts`), and the GameChanger check's word for its own (`resultWord`): each written
 * as a step output, passed on by the alarm step's env and read by `scripts/alarm.ts`. A name
 * changed on any one side reads as empty on GitHub, which leaves the alarm as it is for good.
 */
describe("the words the upkeep and the GameChanger check hand their alarms", () => {
  const handedBy = (workflow: string, job: string, step: string) => {
    const steps = jobsOf(workflow).get(job) ?? [];
    const alarm = steps.find((one) => /npm run alarm\b/.test(one)) ?? "";
    return [
      ...alarm.matchAll(
        new RegExp(
          `^ {10}([A-Z_]+): \\$\\{\\{ steps\\.${step}\\.outputs\\.(\\w+) \\}\\}\\s*$`,
          "gm"
        )
      ),
    ].map(([, key, name]) => ({ key: key ?? "", name: name ?? "" }));
  };

  it("hands over the billing's word and the dispatch token's from the upkeep step", () => {
    const handed = handedBy(nightlyWorkflow, "refresh", "upkeep");
    expect(handed).toEqual([
      { key: "BILLING", name: "billing" },
      { key: "DISPATCH", name: "dispatch" },
    ]);
    for (const { key, name } of handed) {
      expect(upkeepScript).toContain(`output("${name}", `);
      expect(alarmScript).toContain(`env.${key} `);
    }
    // Read whatever became of the refresh, and never turning the night red itself.
    const upkeep =
      (jobsOf(nightlyWorkflow).get("refresh") ?? []).find((one) => keyOf(one, "id") === "upkeep") ??
      "";
    expect(keyOf(upkeep, "if")).toBe("always()");
    expect(keyOf(upkeep, "continue-on-error")).toBe("true");
  });

  it("hands over the GameChanger check's word from its verify step", () => {
    expect(handedBy(verifyGcWorkflow, "verify", "verify")).toEqual([
      { key: "RESULT", name: "result" },
    ]);
    expect(verifyGcScript).toContain("result=${resultWord(all)}");
    expect(alarmScript).toContain("env.RESULT ");
  });
});
