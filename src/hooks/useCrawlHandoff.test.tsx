import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_CHANNEL } from "../lib/crawlHandoff";
import {
  handoffLoaded,
  heldHandoff,
  resetHandoffForTests,
  takeHandoff,
} from "../lib/crawlHandoffStore";
import { useCrawlHandoff } from "./useCrawlHandoff";

/* The page listening for the crawl's files from the owner's userscript. Placeholder names. */

const TEAMS = '"Team Name","Team ID"\r\n"Placeholder Owls","Ab3dE5gH7jK9"';
const from = (data: object, over: { origin?: string; source?: MessageEventSource | null } = {}) =>
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { channel: HANDOFF_CHANNEL, v: 1, from: "miner", ...data },
        origin: over.origin ?? window.location.origin,
        source: over.source === undefined ? window : over.source,
      })
    );
  });
const files = (id = "run_1") => ({
  type: "files",
  id,
  createdAt: "2026-10-25T18:00:00.000Z",
  teams: { name: "GC_Teams_New.csv", text: TEAMS },
});

let posted: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetHandoffForTests();
  posted = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});
afterEach(() => {
  posted.mockRestore();
  resetHandoffForTests();
});
const said = (): Array<[string, object, string]> =>
  (posted.mock.calls as Array<[object, string]>).map(([message, target]) => [
    (message as { type: string }).type,
    message,
    target,
  ]);

/** The last thing the page said. */
const last = (): object | undefined => {
  const all = said();
  return all[all.length - 1]?.[1];
};

describe("the page listening for the crawl's files", () => {
  it("says it is ready as it mounts, and again to every hello", () => {
    renderHook(() => useCrawlHandoff(() => {}));
    expect(said()).toEqual([
      ["ready", expect.objectContaining({ from: "app", type: "ready" }), window.location.origin],
    ]);
    from({ type: "hello" });
    expect(said().map(([type]) => type)).toEqual(["ready", "ready"]);
  });

  it("holds the files, answers, and opens Import, with nothing fetched", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const open = vi.fn();
    renderHook(() => useCrawlHandoff(open));
    from(files());
    expect(heldHandoff().teams?.id).toBe("run_1");
    expect(last()).toMatchObject({ type: "ack", id: "run_1", accepted: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("tells the miner as each file goes in, and again for an id sent twice, applying it once", () => {
    const open = vi.fn();
    renderHook(() => useCrawlHandoff(open));
    from(files());
    takeHandoff("teams");
    act(() => handoffLoaded("run_1", "teams"));
    expect(last()).toMatchObject({ type: "loaded", id: "run_1", kind: "teams" });
    posted.mockClear();
    from(files());
    expect(said().map(([, message]) => message)).toEqual([
      expect.objectContaining({ type: "ack", id: "run_1", accepted: true }),
      expect.objectContaining({ type: "loaded", id: "run_1", kind: "teams" }),
    ]);
    expect(heldHandoff().teams).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("answers nothing, and holds nothing, from another origin or window", () => {
    const open = vi.fn();
    renderHook(() => useCrawlHandoff(open));
    posted.mockClear();
    from(files(), { origin: "https://web.gc.com" });
    from(files(), { source: null });
    expect(posted).not.toHaveBeenCalled();
    expect(heldHandoff()).toEqual({ teams: null, orgs: null });
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses, saying why, files it cannot take", () => {
    renderHook(() => useCrawlHandoff(() => {}));
    from({ ...files(), v: 2 });
    expect(last()).toMatchObject({
      type: "ack",
      id: "run_1",
      accepted: false,
      reason: "version",
    });
    expect(heldHandoff().teams).toBeNull();
  });

  it("stops listening when it unmounts", () => {
    const open = vi.fn();
    const { unmount } = renderHook(() => useCrawlHandoff(open));
    unmount();
    from(files());
    expect(open).not.toHaveBeenCalled();
    act(() => handoffLoaded("run_9", "orgs"));
    expect(said().filter(([type]) => type === "loaded")).toEqual([]);
  });
});
