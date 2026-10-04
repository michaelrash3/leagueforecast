import { act, render, renderHook } from "@testing-library/react";
import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { PoolCommand } from "../lib/live/commands";
import { EDIT_LOCKS, EDIT_REFUSED, QUERY_REFUSED, WARM_AFTER_MS } from "../lib/live/liveEdits";

vi.mock("../lib/cloud/cloudSession", () => ({ memberToken: async () => null }));

const { useLiveEdits } = await import("./useLiveEdits");
type LiveEdits = ReturnType<typeof useLiveEdits>;

/*
 * A member's edits from the live page (`useLiveEdits`): sent against the copy the views are of,
 * each answer said, an Undo sent as the edit's inverse, the edit drawn until the views show it, and
 * nothing sent while edits are off. Placeholder names throughout.
 */

const COPY = { id: "c0ffee", version: 4 };
const STATE = { kind: "team.state", teamId: "S-1", state: "KY" } as const;
const BACK: PoolCommand = { kind: "team.put", team: { id: "S-1", name: "Placeholder S-1" } };

/** The edit function: what it was sent, and its answers in turn (the last one again after). */
const server = (...answers: Array<{ status?: number; body: unknown }>) => {
  const sent: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push((JSON.parse(String(init?.body)) as { data: unknown }).data);
    const answer = answers[Math.min(sent.length, answers.length) - 1]!;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return { sent, deps: { token: async () => "id-token", fetchImpl: fetchImpl as typeof fetch } };
};
const made = (
  version: number,
  changed = ["league_forecast_scout_teams_v1"],
  inverse: PoolCommand = BACK
) => ({
  body: {
    result: {
      ok: true,
      copy: COPY.id,
      version,
      inverse,
      changed,
      ms: { load: 1, apply: 1, commit: 1 },
    },
  },
});

const hook = (
  call: ReturnType<typeof server>,
  { locked = null, now = () => 0 }: { locked?: string | null; now?: () => number } = {}
) => {
  const toasts: Array<[string, Record<string, unknown> | undefined]> = [];
  const showToast = (message: string, options?: Record<string, unknown>) => {
    toasts.push([message, options]);
  };
  const rendered = renderHook(
    ({ copy }) => useLiveEdits({ copy, locked, showToast, deps: call.deps, now }),
    { initialProps: { copy: COPY as { id: string; version: number } | null } }
  );
  return { ...rendered, toasts };
};

describe("an edit from the live page", () => {
  it("is sent against the copy the views are of, said, and taken back by its inverse", async () => {
    const call = server(made(5), made(6));
    const { result, toasts } = hook(call);
    let done = false;
    await act(async () => {
      done = await result.current.edit(STATE, { done: "Set to KY.", undo: true });
    });
    expect(done).toBe(true);
    expect(call.sent).toEqual([{ command: STATE, copy: "c0ffee" }]);
    expect(toasts).toEqual([
      ["Set to KY.", { tone: "undo", actionLabel: "Undo", onAction: expect.any(Function) }],
    ]);
    await act(async () => {
      (toasts[0]?.[1]?.onAction as () => void)();
    });
    await vi.waitFor(() => expect(toasts.map(([message]) => message)).toContain("Undone."));
    expect(call.sent[1]).toEqual({ command: BACK, copy: "c0ffee" });
    // An Undo's own toast offers nothing more to take back.
    expect(toasts[1]).toEqual(["Undone.", { tone: "success" }]);
  });

  it("offers no Undo for an edit the server sent nothing to take it back by", async () => {
    const call = server(made(5, undefined, { kind: "none" }));
    const { result, toasts } = hook(call);
    await act(async () => {
      await result.current.edit(STATE, { done: "Moved 600 clubs.", undo: true });
    });
    expect(toasts).toEqual([["Moved 600 clubs.", { tone: "success" }]]);
  });

  it("tells the screen once its Undo is made, and not when the Undo was refused", async () => {
    // The two edits, the first's Undo made, the second's refused.
    const call = server(made(5), made(6), made(7), {
      body: { result: { ok: false, why: "missing" } },
    });
    const { result, toasts } = hook(call);
    const undone: string[] = [];
    await act(async () => {
      await result.current.edit(STATE, {
        done: "Set.",
        undo: true,
        afterUndo: () => undone.push("first"),
      });
      await result.current.edit(STATE, {
        done: "Set again.",
        undo: true,
        afterUndo: () => undone.push("second"),
      });
    });
    await act(async () => (toasts[0]?.[1]?.onAction as () => void)());
    await vi.waitFor(() => expect(undone).toEqual(["first"]));
    await act(async () => (toasts[1]?.[1]?.onAction as () => void)());
    await vi.waitFor(() => expect(call.sent).toHaveLength(4));
    await act(() => Promise.resolve());
    expect(undone).toEqual(["first"]);
  });

  it("is drawn until views of its version are out, and not at all once they already were", async () => {
    const call = server(made(5), made(6));
    const { result, rerender } = hook(call);
    await act(async () => {
      await result.current.edit(STATE, { done: "Set." });
    });
    expect(result.current.pending).toEqual([{ command: STATE, copy: "c0ffee", version: 5 }]);
    rerender({ copy: { id: "c0ffee", version: 5 } });
    expect(result.current.pending).toEqual([]);
    // Views already of a later version by the time the answer came leave nothing to draw.
    rerender({ copy: { id: "c0ffee", version: 9 } });
    await act(async () => {
      await result.current.edit(STATE, { done: "Set." });
    });
    expect(result.current.pending).toEqual([]);
  });

  it("is not drawn when what it saved is nothing the views read", async () => {
    const call = server(made(5, ["league_forecast_gc_real_clubs_v1"]));
    const { result } = hook(call);
    await act(async () => {
      await result.current.edit(
        { kind: "answers", list: "realClubs", add: ["gc-1"], remove: [] },
        { done: "Kept." }
      );
    });
    expect(result.current.pending).toEqual([]);
  });

  it("is not sent while edits are off, nor before there are views to send it against", async () => {
    const call = server(made(5));
    const off = hook(call, { locked: EDIT_LOCKS.offline });
    let done = true;
    await act(async () => {
      done = await off.result.current.edit(STATE, { done: "Set." });
    });
    expect(done).toBe(false);
    expect(off.toasts).toEqual([[EDIT_LOCKS.offline, { tone: "error" }]]);
    const none = hook(call);
    none.rerender({ copy: null });
    await act(async () => {
      done = await none.result.current.edit(STATE, { done: "Set." });
    });
    expect(done).toBe(false);
    expect(call.sent).toEqual([]);
  });

  it("says a refusal in plain words, and a call that came to nothing in the call's own", async () => {
    const refused = server({ body: { result: { ok: false, why: "missing" } } });
    const one = hook(refused);
    await act(async () => {
      await one.result.current.edit(STATE, { done: "Set." });
    });
    expect(one.toasts).toEqual([[EDIT_REFUSED.missing, { tone: "error" }]]);
    expect(one.result.current.pending).toEqual([]);
    const lost = server({
      status: 500,
      body: { error: { status: "INTERNAL", message: "INTERNAL" } },
    });
    const two = hook(lost);
    await act(async () => {
      await two.result.current.edit(STATE, { done: "Set." });
    });
    expect(two.toasts).toEqual([["INTERNAL", { tone: "error" }]]);
  });
});

describe("a question from the live page", () => {
  const QUESTION = { kind: "rename.preview", teamId: "S-1", name: "Placeholder Q" } as const;
  const ANSWER = {
    kind: "rename.preview",
    name: "Placeholder Q",
    into: null,
    games: 0,
    dropped: 0,
  };

  it("hands back the server's answer, or null once it has said why there is none", async () => {
    const call = server(
      { body: { result: { ok: true, copy: COPY.id, version: 4, answer: ANSWER } } },
      { body: { result: { ok: false, why: "copy-replaced" } } }
    );
    const { result, toasts } = hook(call);
    let answer: unknown;
    await act(async () => {
      answer = await result.current.ask(QUESTION);
    });
    expect(answer).toEqual(ANSWER);
    expect(call.sent).toEqual([{ query: QUESTION, copy: "c0ffee" }]);
    await act(async () => {
      answer = await result.current.ask(QUESTION);
    });
    expect(answer).toBeNull();
    expect(toasts).toEqual([[QUERY_REFUSED["copy-replaced"], { tone: "error" }]]);
  });
  /*
   * A card asks in its own effect once edits are on, as every live card does. The network's first
   * answer for the board brings the copy and turns edits on in the one render, and a card's effects
   * run before its page's: the copy has to be there for them already.
   */
  it("is asked of the copy the views are of in the very render that brings it", async () => {
    const call = server({
      body: { result: { ok: true, copy: COPY.id, version: 4, answer: ANSWER } },
    });
    const toasts: string[] = [];
    const answers: unknown[] = [];
    function Card({ edits }: { edits: LiveEdits }) {
      const { locked, ask } = edits;
      useEffect(() => {
        if (locked) return;
        void ask(QUESTION).then((answer) => answers.push(answer));
      }, [locked, ask]);
      return null;
    }
    function Page({ copy, locked }: { copy: typeof COPY | null; locked: string | null }) {
      const edits = useLiveEdits({
        copy,
        locked,
        showToast: (message) => void toasts.push(message),
        deps: call.deps,
      });
      return <Card edits={edits} />;
    }
    const shown = render(<Page copy={null} locked={EDIT_LOCKS.waiting} />);
    shown.rerender(<Page copy={COPY} locked={null} />);
    await vi.waitFor(() => expect(answers).toEqual([ANSWER]));
    expect(call.sent).toEqual([{ query: QUESTION, copy: "c0ffee" }]);
    expect(toasts).toEqual([]);
  });
});

describe("a warm-up from the live page", () => {
  it("is sent as an edit screen opens, and not again until a while after the last call", async () => {
    const call = server({
      body: { result: { warmed: { ok: true, cold: true, fetched: 9, loadMs: 9 } } },
    });
    let at = 0;
    const { result } = hook(call, { now: () => at });
    act(() => result.current.warm());
    await vi.waitFor(() => expect(call.sent).toEqual([{ warm: true }]));
    at = WARM_AFTER_MS - 1;
    act(() => result.current.warm());
    expect(call.sent).toHaveLength(1);
    at = 2 * WARM_AFTER_MS;
    act(() => result.current.warm());
    await vi.waitFor(() => expect(call.sent).toHaveLength(2));
    const off = server({ body: {} });
    const locked = hook(off, { locked: EDIT_LOCKS.waiting });
    act(() => locked.result.current.warm());
    expect(off.sent).toEqual([]);
  });
});
