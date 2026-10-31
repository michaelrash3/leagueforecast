import { describe, expect, it } from "vitest";
import {
  ALARM_TITLES,
  alarmStep,
  billingWord,
  coerceOpenIssues,
  dispatchWord,
  ghArgsOf,
  GH_LIST_ARGS,
  nightlyVerdicts,
  republishVerdicts,
  runLinkOf,
  stampOf,
  verifyGcVerdicts,
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

describe("which alarm the Monday re-measure of where a rating starts raises or settles", () => {
  const live = { outcome: "success", event: "schedule", mode: "live" };
  const BETTER = "better -1.6 -1.92 0.00120 0.00040 79981";

  it("raises it for a level read clearly better, and settles it for one held", () => {
    expect(nightlyVerdicts({ ...live, closedLevel: BETTER })).toEqual([
      { kind: "nightly", failing: false, how: "scheduled" },
      {
        kind: "closedLevel",
        failing: true,
        said: 'the starting level for leagues with few outside games clearly better at -1.92 than the -1.6 held: each of the last four weeks scored with the level the other three read, 0.00120 runs a game lower, give or take 0.00040, over 79,981 games. The level changes only by a commit that raises BOARD_RULES (README, "Where a rating starts")',
      },
    ]);
    expect(nightlyVerdicts({ ...live, closedLevel: "held" })).toContainEqual({
      kind: "closedLevel",
      failing: false,
    });
  });

  it("leaves it as it is on a night that did not re-measure, a thin Monday, a dry run, or a word it cannot read", () => {
    const has = (verdicts: ReturnType<typeof nightlyVerdicts>) =>
      verdicts.some((verdict) => verdict.kind === "closedLevel");
    expect(has(nightlyVerdicts({ ...live, closedLevel: "" }))).toBe(false);
    expect(has(nightlyVerdicts(live))).toBe(false);
    // A dry run measures a pool that was never saved.
    expect(
      has(
        nightlyVerdicts({
          outcome: "success",
          event: "workflow_dispatch",
          mode: "dry-run",
          closedLevel: BETTER,
        })
      )
    ).toBe(false);
    // A Monday too thin to judge measured nothing that could close an issue saying a change is
    // ready (`closedLevelWord`).
    expect(has(nightlyVerdicts({ ...live, closedLevel: "unjudged" }))).toBe(false);
    for (const word of [
      "better",
      "better -1.6 x 0.1 0.1 9",
      `${BETTER} Team`,
      "Held",
      "better -1.6 -1.92 0.0012 0.0004 7.5",
    ]) {
      expect(has(nightlyVerdicts({ ...live, closedLevel: word }))).toBe(false);
    }
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

  it("says a change to where a rating starts is ready in its own words, and closes once it is not", () => {
    const [, raised] = nightlyVerdicts({
      outcome: "success",
      event: "schedule",
      mode: "live",
      closedLevel: "better -1.6 -1.92 0.00120 0.00040 79981",
    });
    expect(alarmStep(raised!, [], RUN)).toMatchObject({
      do: "open",
      title: ALARM_TITLES.closedLevel,
      body: expect.stringMatching(
        /^The weekly re-measure found the starting level for leagues with few outside games clearly better at -1\.92 than the -1\.6 held: .* over 79,981 games\. The level changes only by a commit that raises BOARD_RULES \(README, "Where a rating starts"\)\.\n\nWhen: 2026-10-10 03:52 UTC\nRun: \S+\n\nEach Monday that finds one so again comments here, and the first that does not closes this issue\.$/
      ),
    });
    expect(alarmStep(raised!, [issue(41, ALARM_TITLES.closedLevel)], RUN)).toMatchObject({
      do: "comment",
      issue: 41,
      body: expect.stringMatching(/^Again: the weekly re-measure found /),
    });
    expect(
      alarmStep({ kind: "closedLevel", failing: false }, [issue(41, ALARM_TITLES.closedLevel)], RUN)
    ).toMatchObject({
      do: "close",
      issue: 41,
      body: expect.stringMatching(
        /^The weekly re-measure no longer finds a starting level clearly better than the one held, so this is closed\.\n/
      ),
    });
  });

  it("says no link rather than a made-up one where the run gave none", () => {
    expect(alarmStep(failed, [], { ...RUN, link: null })).toMatchObject({
      body: expect.stringContaining("\nRun: not known\n"),
    });
  });

  it("has a distinct title for each alarm", () => {
    expect(new Set(Object.values(ALARM_TITLES)).size).toBe(Object.keys(ALARM_TITLES).length);
    expect(Object.keys(ALARM_TITLES)).toHaveLength(10);
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

/*
 * Three more of the owner's alarms (26 October 2026): the weekly check of the GameChanger pull,
 * the project's billing turned off by its cap, and the token the pulls on GitHub are started with
 * running out. Each keeps one issue, as the others do.
 */
describe("which alarm the GameChanger pull check raises or settles", () => {
  it("raises it for a check that failed, after a merge or on the week's clock", () => {
    expect(verifyGcVerdicts({ outcome: "failure", event: "schedule", result: "" })).toEqual([
      { kind: "verifyGc", failing: true, said: "failed", how: "weekly" },
    ]);
    expect(verifyGcVerdicts({ outcome: "failure", event: "push", result: "" })).toEqual([
      { kind: "verifyGc", failing: true, said: "failed", how: "after a merge" },
    ]);
  });

  it("raises it for a check that passed but found no score on a game played, which is drift", () => {
    expect(verifyGcVerdicts({ outcome: "success", event: "schedule", result: "drift" })).toEqual([
      {
        kind: "verifyGc",
        failing: true,
        said: "found no score on games already played, so GameChanger's score fields may have moved",
        how: "weekly",
      },
    ]);
  });

  it("settles it after a clean check, and leaves it for a run stopped or started by hand", () => {
    expect(verifyGcVerdicts({ outcome: "success", event: "push", result: "pass" })).toEqual([
      { kind: "verifyGc", failing: false, how: "after a merge" },
    ]);
    // A push cancels the run before it, which says nothing of GameChanger.
    expect(verifyGcVerdicts({ outcome: "cancelled", event: "push", result: "" })).toEqual([]);
    // A run by hand may ask other teams or another proxy than the deployed one.
    expect(
      verifyGcVerdicts({ outcome: "failure", event: "workflow_dispatch", result: "" })
    ).toEqual([]);
  });
});

describe("what the nightly reads of the project's billing", () => {
  it("is on or off as Cloud Billing says, and nothing for an answer it cannot read", () => {
    expect(billingWord({ name: "projects/p/billingInfo", billingEnabled: true })).toBe("on");
    expect(billingWord({ name: "projects/p/billingInfo", billingEnabled: false })).toBe("off");
    // Cloud Billing leaves the field out when billing is off.
    expect(billingWord({ name: "projects/p/billingInfo", billingAccountName: "" })).toBe("off");
    expect(billingWord(null)).toBe("");
    expect(billingWord({ error: { code: 403 } })).toBe("");
  });

  it("raises the billing alarm when it is off, settles it when it is on, and leaves it otherwise", () => {
    const night = { outcome: "success", event: "schedule", mode: "live" };
    expect(nightlyVerdicts({ ...night, billing: "off" })).toContainEqual({
      kind: "billing",
      failing: true,
      said: "off",
    });
    expect(nightlyVerdicts({ ...night, billing: "on" })).toContainEqual({
      kind: "billing",
      failing: false,
    });
    expect(nightlyVerdicts({ ...night, billing: "" }).map((one) => one.kind)).not.toContain(
      "billing"
    );
  });
});

describe("what the nightly reads of the pull dispatch token", () => {
  const now = Date.parse("2026-10-26T04:30:00Z");

  it("is fine with more than two weeks left, or no end at all", () => {
    expect(dispatchWord({ status: 200, expires: "2026-12-01 05:00:00 UTC" }, now)).toBe("fine");
    expect(dispatchWord({ status: 200, expires: null }, now)).toBe("fine");
  });

  it("says the day it ends, and the days left, within two weeks of it", () => {
    expect(dispatchWord({ status: 200, expires: "2026-11-02 05:00:00 UTC" }, now)).toBe(
      "expires 2026-11-02 7"
    );
    expect(dispatchWord({ status: 200, expires: "2026-11-01 21:00:00 -0800" }, now)).toBe(
      "expires 2026-11-02 7"
    );
  });

  it("says refused when GitHub would not take it, and nothing for any other answer", () => {
    expect(dispatchWord({ status: 401, expires: null }, now)).toBe("refused");
    expect(dispatchWord({ status: 503, expires: null }, now)).toBe("");
    expect(dispatchWord({ status: 200, expires: "next Tuesday" }, now)).toBe("");
  });

  it("raises the token's alarm for an end near or past, and settles it for a token good for longer", () => {
    const night = { outcome: "success", event: "schedule", mode: "live" };
    expect(nightlyVerdicts({ ...night, dispatch: "expires 2026-11-02 7" })).toContainEqual({
      kind: "dispatchToken",
      failing: true,
      said: "ends on 2026-11-02, in 7 days",
    });
    expect(nightlyVerdicts({ ...night, dispatch: "refused" })).toContainEqual({
      kind: "dispatchToken",
      failing: true,
      said: "was refused by GitHub: it has ended or been revoked",
    });
    expect(nightlyVerdicts({ ...night, dispatch: "fine" })).toContainEqual({
      kind: "dispatchToken",
      failing: false,
    });
    expect(nightlyVerdicts({ ...night, dispatch: "" }).map((one) => one.kind)).not.toContain(
      "dispatchToken"
    );
  });
});

describe("the new alarms' issues", () => {
  it("say what failed and what to do, in their own words", () => {
    const pull = alarmStep(
      { kind: "verifyGc", failing: true, said: "failed", how: "weekly" },
      [],
      RUN
    );
    expect(pull).toMatchObject({ do: "open", title: "The GameChanger pull check failed" });
    expect(pull?.do === "open" && pull.body).toMatch(
      /^The GameChanger pull check failed \(weekly\)\./
    );

    const billing = alarmStep({ kind: "billing", failing: true, said: "off" }, [], RUN);
    expect(billing).toMatchObject({ do: "open", title: "The project's billing is off" });
    expect(billing?.do === "open" && billing.body).toMatch(/cost cap/);

    const token = alarmStep(
      { kind: "dispatchToken", failing: true, said: "ends on 2026-11-02, in 7 days" },
      [],
      RUN
    );
    expect(token).toMatchObject({ do: "open", title: "The pull dispatch token is running out" });
    expect(token?.do === "open" && token.body).toMatch(/PULL_DISPATCH_TOKEN/);
  });
});

/*
 * The nightly's cap on what one save takes away (`blastRadius.ts`, the owner's rule: more than 5% of
 * a year's games or 2% of its clubs is held) and its canary on what it could read of GameChanger's
 * answers (`ingestCanary.ts`), each an alarm of its own, raised and settled by a live run only.
 */
describe("the nightly's held save and its reading of the answers", () => {
  const live = { outcome: "success", event: "schedule", mode: "live" };
  const kinds = (verdicts: ReturnType<typeof nightlyVerdicts>) => verdicts.map((one) => one.kind);

  it("raises the held save's alarm with the years' numbers, and settles it once a night saves", () => {
    expect(nightlyVerdicts({ ...live, held: "held 2027:19400/386146:12/51000" })).toContainEqual({
      kind: "heldSave",
      failing: true,
      said: "19,400 of 2027's 386,146 games (5.0%) and 12 of its 51,000 clubs (0.0%)",
    });
    expect(nightlyVerdicts({ ...live, held: "none" })).toContainEqual({
      kind: "heldSave",
      failing: false,
    });
  });

  it("raises the reading's alarm on drift, and settles it on a night that reads as usual", () => {
    expect(nightlyVerdicts({ ...live, ingest: "drift 300/3000" })).toContainEqual({
      kind: "ingest",
      failing: true,
      said: "300 of the 3,000 games GameChanger listed could be filed",
    });
    expect(nightlyVerdicts({ ...live, ingest: "fine 2800/3000" })).toContainEqual({
      kind: "ingest",
      failing: false,
    });
  });

  it("leaves both as they are for a dry run, a night that never reached its save, or a word it cannot read", () => {
    const dry = { ...live, mode: "dry-run" };
    expect(
      kinds(nightlyVerdicts({ ...dry, held: "held 2027:60/1000:3/100", ingest: "drift 1/900" }))
    ).not.toContain("heldSave");
    expect(kinds(nightlyVerdicts({ ...dry, ingest: "drift 1/900" }))).not.toContain("ingest");
    for (const held of [
      "",
      "held",
      "held 2027:60/1000",
      "held 27:1/2:3/4",
      "held 2027:6x/1000:3/100",
    ])
      expect(kinds(nightlyVerdicts({ ...live, held }))).not.toContain("heldSave");
    for (const ingest of ["", "drift", "drift 3/x", "worse 1/2"])
      expect(kinds(nightlyVerdicts({ ...live, ingest }))).not.toContain("ingest");
  });

  it("says each in its own words, from the numbers alone", () => {
    const [held] = nightlyVerdicts({ ...live, held: "held 2027:600/10000:3/100" }).filter(
      (one) => one.kind === "heldSave"
    );
    expect(alarmStep(held!, [], RUN)).toMatchObject({
      do: "open",
      title: ALARM_TITLES.heldSave,
      body: expect.stringMatching(
        /^The nightly held its save, the copy left as it was, because it would have removed 600 of 2027's 10,000 games \(6\.0%\) and 3 of its 100 clubs \(3\.0%\), past the line of 5% of a year's games or 2% of its clubs/
      ),
    });
    const [ingest] = nightlyVerdicts({ ...live, ingest: "drift 30/3000" }).filter(
      (one) => one.kind === "ingest"
    );
    expect(alarmStep(ingest!, [], RUN)).toMatchObject({
      do: "open",
      title: ALARM_TITLES.ingest,
      body: expect.stringMatching(
        /^The nightly found that only 30 of the 3,000 games GameChanger listed could be filed, under half: GameChanger may have changed how it writes a game/
      ),
    });
  });
});

/*
 * The questions the cloud spent compute on and could not answer, counted in the edits' ledger and
 * handed over by the nightly as `over <day> <count>` past 20 in a day, or `fine`
 * (`unansweredWord`). Read whatever the run, as the rebuilds' are: the ledger is none of the
 * refresh's work.
 */
describe("which alarm the questions left unanswered raise or settle", () => {
  const dry = { outcome: "success", event: "workflow_dispatch", mode: "dry-run" };

  it("raises it for a day past 20, dry run or live, and settles it once the nightly finds none", () => {
    expect(nightlyVerdicts({ ...dry, unanswered: "over 2026-10-30 47" })).toEqual([
      { kind: "unanswered", failing: true, said: "47 questions went unanswered on 2026-10-30" },
    ]);
    expect(
      nightlyVerdicts({
        outcome: "success",
        event: "schedule",
        mode: "live",
        unanswered: "over 2026-10-31 21",
      })
    ).toContainEqual({
      kind: "unanswered",
      failing: true,
      said: "21 questions went unanswered on 2026-10-31",
    });
    expect(nightlyVerdicts({ ...dry, unanswered: "fine" })).toEqual([
      { kind: "unanswered", failing: false },
    ]);
  });

  it("leaves it as it is for a ledger not read, or a word it cannot read", () => {
    for (const unanswered of [
      "",
      "over",
      "over 2026-10-30",
      "over 2026-10-30 x",
      "over 26-10-30 47",
      "over 2026-10-30 -4",
      "under 2026-10-30 47",
    ]) {
      expect(nightlyVerdicts({ ...dry, unanswered }), unanswered).toEqual([]);
    }
  });

  it("says it in its own words, from the day and the count alone, and closes in them", () => {
    const [verdict] = nightlyVerdicts({ ...dry, unanswered: "over 2026-10-30 1234" });
    expect(alarmStep(verdict!, [], RUN)).toMatchObject({
      do: "open",
      title: ALARM_TITLES.unanswered,
      body: expect.stringMatching(
        /^The nightly found that 1,234 questions went unanswered on 2026-10-30, past the 20 a day that open this issue: /
      ),
    });
    expect(
      alarmStep({ kind: "unanswered", failing: false }, [issue(7, ALARM_TITLES.unanswered)], RUN)
    ).toMatchObject({
      do: "close",
      issue: 7,
      body: expect.stringMatching(
        /^The nightly found no day past 20 questions unanswered, so this is closed\./
      ),
    });
  });
});
