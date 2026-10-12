import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginPull,
  beginTidy,
  endPull,
  endTidy,
  isPoolBusy,
  isPullLive,
  livePull,
  noteTidyStep,
  resetPullSession,
  stopLivePull,
  tidyWatchNow,
  watchPull,
} from "../pullSession";
import type { TidyStep } from "../gameChangerImport";

afterEach(() => resetPullSession());

describe("the one pull that may be running", () => {
  it("is nothing until a run claims it", () => {
    expect(isPullLive()).toBe(false);
    expect(livePull()).toBeNull();
  });

  it("refuses a second claim rather than queueing it", () => {
    /*
     * The second run is never what anybody wanted: both write whole-pool snapshots, so the later
     * one overwrites the earlier's teams, and the cursor has already marked those settled — a
     * resume would skip them for good.
     */
    const first = beginPull("2026-09-17T08:00:00.000Z");
    expect(first).not.toBeNull();
    expect(beginPull("2026-09-17T08:00:01.000Z")).toBeNull();
    expect(livePull()).toBe(first);
  });

  it("lets the next run start once the first gives the slot up", () => {
    const first = beginPull("2026-09-17T08:00:00.000Z")!;
    endPull(first);
    expect(isPullLive()).toBe(false);
    expect(beginPull("2026-09-17T08:05:00.000Z")).not.toBeNull();
  });

  it("will not let a finishing straggler end a run that started after it", () => {
    // Otherwise a slow tail from the old run clears the slot the new one is holding.
    const first = beginPull("2026-09-17T08:00:00.000Z")!;
    endPull(first);
    const second = beginPull("2026-09-17T08:05:00.000Z")!;
    endPull(first);
    expect(livePull()).toBe(second);
    expect(isPullLive()).toBe(true);
  });

  it("can be stopped by somebody who did not start it", () => {
    // The panel that began the run may be long closed by the time anyone wants it stopped.
    const session = beginPull("2026-09-17T08:00:00.000Z")!;
    expect(session.controller.signal.aborted).toBe(false);
    stopLivePull();
    expect(session.controller.signal.aborted).toBe(true);
  });

  it("stopping nothing is not an error", () => {
    expect(() => stopLivePull()).not.toThrow();
  });

  it("tells watchers when a run starts and when it ends", () => {
    const seen = vi.fn();
    const unwatch = watchPull(seen);
    const session = beginPull("2026-09-17T08:00:00.000Z")!;
    expect(seen).toHaveBeenCalledTimes(1);
    endPull(session);
    expect(seen).toHaveBeenCalledTimes(2);
    unwatch();
    beginPull("2026-09-17T08:05:00.000Z");
    expect(seen).toHaveBeenCalledTimes(2);
  });
});

describe("the tidy takes the same slot", () => {
  /*
   * Both jobs read the whole pool, work for a long time, and save all of it. While the tidy ran on
   * the main thread nothing else could start during it; in a worker the page stays usable, so a
   * pull can begin halfway through one and have its first few hundred teams overwritten by a tidy
   * that never saw them — with the cursor already counting them settled.
   */
  it("is refused while a pull is running", () => {
    beginPull("2026-09-17T08:00:00.000Z");
    expect(beginTidy("2026-09-17T08:00:01.000Z")).toBeNull();
  });

  it("refuses a pull while it runs", () => {
    beginTidy("2026-09-17T08:00:00.000Z");
    expect(beginPull("2026-09-17T08:00:01.000Z")).toBeNull();
  });

  it("refuses a second tidy", () => {
    const first = beginTidy("2026-09-17T08:00:00.000Z");
    expect(first).not.toBeNull();
    expect(beginTidy("2026-09-17T08:00:01.000Z")).toBeNull();
  });

  it("holds the pool without claiming a pull is running", () => {
    // The banner says "a pull is running" and has to mean it; the guard is the broader question.
    const session = beginTidy("2026-09-17T08:00:00.000Z")!;
    expect(isPoolBusy()).toBe(true);
    expect(isPullLive()).toBe(false);
    endTidy(session);
    expect(isPoolBusy()).toBe(false);
  });

  it("lets a pull start once it gives the slot up", () => {
    const session = beginTidy("2026-09-17T08:00:00.000Z")!;
    endTidy(session);
    expect(beginPull("2026-09-17T08:05:00.000Z")).not.toBeNull();
  });

  it("will not let a finished tidy end the pull that followed it", () => {
    const tidy = beginTidy("2026-09-17T08:00:00.000Z")!;
    endTidy(tidy);
    const pull = beginPull("2026-09-17T08:05:00.000Z")!;
    endTidy(tidy);
    expect(livePull()).toBe(pull);
  });

  it("tells watchers, so a card can grey its button out while it runs", () => {
    const seen = vi.fn();
    const unwatch = watchPull(seen);
    const session = beginTidy("2026-09-17T08:00:00.000Z")!;
    expect(seen).toHaveBeenCalledTimes(1);
    endTidy(session);
    expect(seen).toHaveBeenCalledTimes(2);
    unwatch();
  });
});

describe("what the live tidy is doing", () => {
  /*
   * The Import panel's banner — "the pool is being tidied, so this pull waits" — is about a tidy
   * that some other part of the page started. A hook's own state cannot reach across to it, so it
   * said nothing at all about what was happening, for a minute or two, with a button offering to
   * give up waiting. The slot is what told the banner to appear, so the slot is what can tell it
   * what the tidy is doing.
   */
  const step = (pass: number, name: TidyStep["step"], found: number, done: boolean): TidyStep => ({
    pass,
    step: name,
    found,
    teams: 40_000,
    games: 200_000,
    done,
  });

  beforeEach(() => resetPullSession());
  afterEach(() => resetPullSession());

  it("reports nothing when nothing is tidying", () => {
    expect(tidyWatchNow()).toEqual({ steps: [], now: null });
  });

  it("holds the step in flight, then moves it into what is done", () => {
    const session = beginTidy("2026-09-19T00:00:00.000Z");
    expect(session).not.toBeNull();

    noteTidyStep(step(1, "named", 0, false));
    expect(tidyWatchNow().now?.step).toBe("named");
    expect(tidyWatchNow().steps).toHaveLength(0);

    noteTidyStep(step(1, "named", 416, true));
    expect(tidyWatchNow().now).toBeNull();
    expect(tidyWatchNow().steps).toHaveLength(1);
    expect(tidyWatchNow().steps[0]?.found).toBe(416);
  });

  it("tells whoever is watching the slot, which is how the banner hears", () => {
    const session = beginTidy("2026-09-19T00:00:00.000Z");
    expect(session).not.toBeNull();
    let told = 0;
    const stop = watchPull(() => (told += 1));

    noteTidyStep(step(1, "named", 0, false));

    expect(told).toBe(1);
    stop();
  });

  it("ignores a step from a tidy that has already given the slot up", () => {
    /*
     * A straggler would otherwise draw a run that is not happening, over the top of whatever holds
     * the slot now — and the pull that took it would look like it was tidying.
     */
    const session = beginTidy("2026-09-19T00:00:00.000Z");
    if (!session) throw new Error("expected the slot");
    noteTidyStep(step(1, "named", 416, true));
    endTidy(session);

    noteTidyStep(step(2, "collapsed", 99, true));

    expect(tidyWatchNow().steps).toHaveLength(1);
  });

  it("does not report a tidy while a pull holds the slot", () => {
    const pull = beginPull("2026-09-19T00:00:00.000Z");
    expect(pull).not.toBeNull();

    noteTidyStep(step(1, "named", 5, true));

    expect(tidyWatchNow()).toEqual({ steps: [], now: null });
  });

  it("starts a new tidy from nothing, rather than on top of the last one", () => {
    const first = beginTidy("2026-09-19T00:00:00.000Z");
    if (!first) throw new Error("expected the slot");
    noteTidyStep(step(1, "named", 416, true));
    endTidy(first);

    const second = beginTidy("2026-09-19T00:01:00.000Z");
    expect(second).not.toBeNull();

    expect(tidyWatchNow()).toEqual({ steps: [], now: null });
  });

  it("keeps the last tidy's report after it lets go, so the card can still show it", () => {
    const session = beginTidy("2026-09-19T00:00:00.000Z");
    if (!session) throw new Error("expected the slot");
    noteTidyStep(step(1, "named", 416, true));

    endTidy(session);

    expect(tidyWatchNow().steps).toHaveLength(1);
  });
});
