import { describe, expect, it } from "vitest";
import {
  ALARM_TITLES,
  alarmStep,
  coerceOpenIssues,
  ghArgsOf,
  GH_LIST_ARGS,
  nightlyVerdicts,
  republishVerdicts,
  runLinkOf,
  stampOf,
  type OpenIssue,
} from "../runAlarms";

/*
 * What a run on GitHub files on this repository when it fails (`runAlarms.ts`): which alarms a
 * nightly or a republish raises or settles, the one issue each keeps open, and every word put in
 * it, which is public. `scripts/alarm.ts` only runs the `gh` commands these name.
 */

const RUN = {
  at: "2026-10-10T03:52:41.123Z",
  link: "https://github.com/example/leagueforecast/actions/runs/123456789",
};
const BOT = { login: "app/github-actions" };
const issue = (number: number, title: string, author: OpenIssue["author"] = BOT): OpenIssue => ({
  number,
  title,
  author,
});

describe("which alarms a nightly raises or settles", () => {
  it("raises its own for a run that failed, stopped or never started, scheduled or by hand", () => {
    expect(nightlyVerdicts({ outcome: "failure", event: "schedule", mode: "live" })).toEqual([
      { kind: "nightly", failing: true, said: "failed", how: "scheduled" },
    ]);
    expect(
      nightlyVerdicts({ outcome: "cancelled", event: "workflow_dispatch", mode: "live" })
    ).toEqual([
      {
        kind: "nightly",
        failing: true,
        said: "was stopped before it finished",
        how: "by hand, live",
      },
    ]);
    expect(
      nightlyVerdicts({ outcome: "skipped", event: "workflow_dispatch", mode: "dry-run" })
    ).toEqual([{ kind: "nightly", failing: true, said: "did not start", how: "by hand, dry run" }]);
  });

  it("settles its own only after a live run that succeeded, which a dry run is not", () => {
    expect(nightlyVerdicts({ outcome: "success", event: "schedule", mode: "live" })).toEqual([
      { kind: "nightly", failing: false, how: "scheduled" },
    ]);
    expect(
      nightlyVerdicts({ outcome: "success", event: "workflow_dispatch", mode: "live" })
    ).toEqual([{ kind: "nightly", failing: false, how: "by hand, live" }]);
    // A dry run saves nothing, so its success says nothing of the night that failed saving.
    expect(
      nightlyVerdicts({ outcome: "success", event: "workflow_dispatch", mode: "dry-run" })
    ).toEqual([]);
    expect(nightlyVerdicts({ outcome: "", event: "schedule", mode: "live" })).toEqual([]);
  });

  it("raises or settles the rebuilds' own as the nightly read their ledger, whatever the run", () => {
    const dry = { outcome: "success", event: "workflow_dispatch", mode: "dry-run" };
    expect(nightlyVerdicts({ ...dry, rebuilds: "paused" })).toEqual([
      { kind: "rebuilds", failing: true, said: "paused" },
    ]);
    expect(nightlyVerdicts({ ...dry, rebuilds: "failing" })).toEqual([
      { kind: "rebuilds", failing: true, said: "failing in a row" },
    ]);
    expect(nightlyVerdicts({ ...dry, rebuilds: "none" })).toEqual([
      { kind: "rebuilds", failing: false },
    ]);
    // Switched off, nothing of theirs runs and their ledger stands still: an issue left open over
    // failures recorded before would be commented on every night with no end.
    expect(nightlyVerdicts({ ...dry, rebuilds: "off" })).toEqual([
      { kind: "rebuilds", failing: false, said: "off" },
    ]);
    // A ledger not read, or not readable, leaves the rebuilds' alarm as it is.
    expect(nightlyVerdicts({ ...dry, rebuilds: "" })).toEqual([]);
    expect(nightlyVerdicts({ ...dry, rebuilds: "maybe" })).toEqual([]);
    expect(
      nightlyVerdicts({ outcome: "failure", event: "schedule", mode: "live", rebuilds: "none" })
    ).toEqual([
      { kind: "nightly", failing: true, said: "failed", how: "scheduled" },
      { kind: "rebuilds", failing: false },
    ]);
  });
});

describe("which alarm a republish raises or settles", () => {
  it("raises it for a republish that failed, stopped or never started, and settles it after one that did not", () => {
    expect(republishVerdicts({ outcome: "failure" })).toEqual([
      { kind: "republish", failing: true, said: "failed" },
    ]);
    expect(republishVerdicts({ outcome: "cancelled" })).toEqual([
      { kind: "republish", failing: true, said: "was stopped before it finished" },
    ]);
    expect(republishVerdicts({ outcome: "skipped" })).toEqual([
      { kind: "republish", failing: true, said: "did not start" },
    ]);
    expect(republishVerdicts({ outcome: "success" })).toEqual([
      { kind: "republish", failing: false },
    ]);
    expect(republishVerdicts({ outcome: "" })).toEqual([]);
  });
});

describe("the one issue an alarm keeps", () => {
  const failed = { kind: "nightly", failing: true, said: "failed", how: "scheduled" } as const;
  const fine = { kind: "nightly", failing: false, how: "scheduled" } as const;

  it("opens one when none of its own is open, saying when, what and where only", () => {
    expect(alarmStep(failed, [], RUN)).toEqual({
      do: "open",
      title: ALARM_TITLES.nightly,
      body: [
        "The nightly refresh failed (scheduled).",
        "",
        "When: 2026-10-10 03:52 UTC",
        `Run: ${RUN.link}`,
        "",
        "Each run that fails again comments here, and the next live run that succeeds closes this issue.",
      ].join("\n"),
    });
  });

  it("comments on the one already open rather than opening another, the oldest if two are", () => {
    const open = [
      issue(31, ALARM_TITLES.nightly),
      issue(12, "Some other issue"),
      issue(27, ALARM_TITLES.nightly),
      issue(29, ALARM_TITLES.rebuilds),
    ];
    expect(alarmStep(failed, open, RUN)).toEqual({
      do: "comment",
      issue: 27,
      body: [
        "Again: the nightly refresh failed (scheduled).",
        "",
        "When: 2026-10-10 03:52 UTC",
        `Run: ${RUN.link}`,
      ].join("\n"),
    });
  });

  it("takes for its own only an issue the workflows opened, not one anybody titled the same", () => {
    const open = [
      issue(5, ALARM_TITLES.nightly, { login: "somebody" }),
      issue(6, ALARM_TITLES.nightly, null),
    ];
    expect(alarmStep(failed, open, RUN)?.do).toBe("open");
    expect(alarmStep(fine, open, RUN)).toBeNull();
    for (const login of ["github-actions", "github-actions[bot]", "app/github-actions"]) {
      expect(alarmStep(failed, [issue(8, ALARM_TITLES.nightly, { login })], RUN)).toMatchObject({
        do: "comment",
        issue: 8,
      });
    }
  });

  it("closes its own with a comment once the run is fine, and does nothing when none is open", () => {
    expect(alarmStep(fine, [issue(27, ALARM_TITLES.nightly)], RUN)).toEqual({
      do: "close",
      issue: 27,
      body: [
        "The nightly refresh succeeded (scheduled), so this is closed.",
        "",
        "When: 2026-10-10 03:52 UTC",
        `Run: ${RUN.link}`,
      ].join("\n"),
    });
    expect(alarmStep(fine, [issue(29, ALARM_TITLES.rebuilds)], RUN)).toBeNull();
  });

  it("says the rebuilds' and the republish's in their own words", () => {
    expect(alarmStep({ kind: "rebuilds", failing: true, said: "paused" }, [], RUN)).toMatchObject({
      title: ALARM_TITLES.rebuilds,
      body: expect.stringMatching(
        /^The nightly found the rebuilds after saves paused in their ledger\.\n\nWhen: 2026-10-10 03:52 UTC\nRun: \S+\n\nEach nightly that finds them so again comments here, and the first to find no failures in a row and no pause, or them switched off, closes this issue\.$/
      ),
    });
    expect(
      alarmStep({ kind: "rebuilds", failing: false }, [issue(4, ALARM_TITLES.rebuilds)], RUN)
    ).toMatchObject({
      do: "close",
      body: expect.stringMatching(
        /^The nightly found no failures in a row and no pause in the rebuilds' ledger, so this is closed\.\n/
      ),
    });
    expect(
      alarmStep(
        { kind: "rebuilds", failing: false, said: "off" },
        [issue(4, ALARM_TITLES.rebuilds)],
        RUN
      )
    ).toMatchObject({
      do: "close",
      issue: 4,
      body: expect.stringMatching(
        /^The nightly found the rebuilds after saves switched off, so this is closed\.\n/
      ),
    });
    expect(alarmStep({ kind: "republish", failing: true, said: "failed" }, [], RUN)).toMatchObject({
      title: ALARM_TITLES.republish,
      body: expect.stringMatching(
        /^The republish after a deploy failed\.\n\nWhen: 2026-10-10 03:52 UTC\nRun: \S+\n\nEach republish that fails again comments here, and the next that succeeds closes this issue\.$/
      ),
    });
  });

  it("says no link rather than a made-up one where the run gave none", () => {
    expect(alarmStep(failed, [], { ...RUN, link: null })).toMatchObject({
      body: expect.stringContaining("\nRun: not known\n"),
    });
  });

  it("has a distinct title for each alarm", () => {
    expect(new Set(Object.values(ALARM_TITLES)).size).toBe(3);
  });
});

describe("what the run tells the alarm", () => {
  it("links the run from the runner's own variables, and nothing else", () => {
    const env = {
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "example/leagueforecast",
      GITHUB_RUN_ID: "123456789",
    };
    expect(runLinkOf(env)).toBe("https://github.com/example/leagueforecast/actions/runs/123456789");
    expect(runLinkOf({ ...env, GITHUB_RUN_ID: undefined })).toBeNull();
    expect(runLinkOf({ ...env, GITHUB_RUN_ID: "12 and more" })).toBeNull();
    expect(runLinkOf({ ...env, GITHUB_REPOSITORY: "example/league forecast" })).toBeNull();
    expect(runLinkOf({ ...env, GITHUB_SERVER_URL: "http://github.com" })).toBeNull();
    expect(runLinkOf({ ...env, GITHUB_SERVER_URL: "https://github.com/x?y" })).toBeNull();
  });

  it("stamps the time in UTC to the minute", () => {
    expect(stampOf("2026-10-10T03:52:41.123Z")).toBe("2026-10-10 03:52 UTC");
    expect(stampOf("not a time")).toBe("not known");
  });

  it("reads the open issues as gh lists them, leaving out anything else", () => {
    expect(
      coerceOpenIssues([
        {
          number: 27,
          title: "The nightly refresh failed",
          author: { login: "app/github-actions", is_bot: true },
        },
        { number: 28, title: "A person's", author: { login: "somebody" } },
        { number: 29, title: "Ghost's", author: null },
        { number: 33, title: "No login", author: { name: "" } },
        { number: "30", title: "No number" },
        { number: 31 },
        "not an issue",
      ])
    ).toEqual([
      { number: 27, title: "The nightly refresh failed", author: { login: "app/github-actions" } },
      { number: 28, title: "A person's", author: { login: "somebody" } },
      { number: 29, title: "Ghost's", author: null },
      { number: 33, title: "No login", author: null },
    ]);
    expect(coerceOpenIssues({ issues: [] })).toBeNull();
  });

  it("names the gh commands for each step, on the repository given", () => {
    const repo = "example/leagueforecast";
    expect(GH_LIST_ARGS(repo)).toEqual([
      "issue",
      "list",
      "--repo",
      repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,author",
    ]);
    expect(ghArgsOf({ do: "open", title: "T", body: "B" }, repo)).toEqual([
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      "T",
      "--body",
      "B",
    ]);
    expect(ghArgsOf({ do: "comment", issue: 27, body: "B" }, repo)).toEqual([
      "issue",
      "comment",
      "27",
      "--repo",
      repo,
      "--body",
      "B",
    ]);
    expect(ghArgsOf({ do: "close", issue: 27, body: "B" }, repo)).toEqual([
      "issue",
      "close",
      "27",
      "--repo",
      repo,
      "--comment",
      "B",
    ]);
  });
});
