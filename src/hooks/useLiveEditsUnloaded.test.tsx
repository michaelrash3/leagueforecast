import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CLIENT_UNLOADED } from "../lib/live/liveEdits";

/*
 * The edit function's client is loaded at the first call (`useLiveEdits`), so a page offline as it
 * asks for it, or one a release replaced underneath, finds none: the edit or question is not sent,
 * and the person is told so in plain words rather than left with an error nobody catches.
 */

vi.mock("../lib/cloud/cloudSession", () => ({ memberToken: async () => null }));
vi.mock("../lib/live/editClient", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

const { useLiveEdits } = await import("./useLiveEdits");

describe("an edit or a question whose client would not load", () => {
  it("is not sent, and says why", async () => {
    const toasts: Array<[string, unknown]> = [];
    const { result } = renderHook(() =>
      useLiveEdits({
        copy: { id: "c0ffee", version: 4 },
        locked: null,
        showToast: (message, options) => toasts.push([message, options]),
        now: () => 0,
      })
    );
    let made = true;
    let answer: unknown = "unasked";
    await act(async () => {
      // First, as a screen opening sends it: nothing rides on it, and nothing is said.
      result.current.warm();
      await new Promise((resolve) => setTimeout(resolve, 0));
      made = await result.current.edit(
        { kind: "team.state", teamId: "S-1", state: "KY" },
        { done: "Set." }
      );
      answer = await result.current.ask({ kind: "health.summary", today: "2027-04-15" });
    });
    expect(made).toBe(false);
    expect(answer).toBeNull();
    expect(toasts).toEqual([
      [CLIENT_UNLOADED, { tone: "error" }],
      [CLIENT_UNLOADED, { tone: "error" }],
    ]);
  });
});
