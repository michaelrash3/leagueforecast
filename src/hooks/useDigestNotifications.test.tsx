import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFY, type Change, type NotifyPrefs } from "../lib/seasonDigest";
import { NOTIFY_GATHER_MS, useDigestNotifications } from "./useDigestNotifications";

/*
 * Notifications of League news while the app is open but not looked at (2.6): off until opted
 * into, only news that came after the page was put away, a run of scores gathered into one, and
 * each change announced once on the device. Placeholder teams.
 */

const shown: { title: string; body: string }[] = [];

class FakeNotification {
  static permission: NotificationPermission = "granted";
  constructor(title: string, options?: NotificationOptions) {
    shown.push({ title, body: options?.body ?? "" });
  }
}

let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
};

const finalOf = (gameId: string, away: string, home: string, score: string): Change => ({
  kind: "final",
  gameId,
  teamIds: [away, home],
  after: { date: "2026-05-02", away, home, final: score, detail: "" },
});

/** The followed team's Gold chance, 30% at the last look, now `to`. */
const odds = (to: number): Change => ({ kind: "odds", teamId: "A", teamIds: ["A"], from: 30, to });

type Problem = { kind: string; text: string };
type Props = { changes: Change[]; problem?: Problem | null };

const names: Record<string, string> = { A: "Aces", B: "Bears", C: "Comets" };
const on: NotifyPrefs = { ...DEFAULT_NOTIFY, on: true };

const mount = (prefs: NotifyPrefs = on) =>
  renderHook(
    (props: Props) =>
      useDigestNotifications({
        seasonId: "s1",
        seasonLabel: "Spring 26",
        changes: props.changes,
        prefs,
        followed: "A",
        problem: props.problem ?? null,
        nameOf: (id) => names[id] ?? id,
      }),
    { initialProps: { changes: [] } as Props }
  );

const gather = () => act(() => vi.advanceTimersByTimeAsync(NOTIFY_GATHER_MS));

describe("useDigestNotifications", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    shown.length = 0;
    visibility = "visible";
    vi.stubGlobal("Notification", FakeNotification);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays quiet until notifications are turned on", async () => {
    const view = mount(DEFAULT_NOTIFY);
    act(() => setVisibility("hidden"));
    view.rerender({ changes: [finalOf("g1", "A", "B", "4-2")] });
    await gather();
    expect(shown).toEqual([]);
  });

  it("gathers what arrives while the page is away into one notification", async () => {
    const view = mount();
    act(() => setVisibility("hidden"));
    view.rerender({ changes: [finalOf("g1", "A", "B", "4-2")] });
    await act(() => vi.advanceTimersByTimeAsync(NOTIFY_GATHER_MS / 2));
    view.rerender({ changes: [finalOf("g1", "A", "B", "4-2"), finalOf("g2", "C", "A", "1-3")] });
    await gather();
    expect(shown).toEqual([
      {
        title: "Spring 26",
        body: "2 new finals.\nAces at Bears: final, 4–2.\nComets at Aces: final, 1–3.",
      },
    ]);
  });

  it("announces nothing while the page is being looked at, nor what was on it when put away", async () => {
    const view = mount();
    view.rerender({ changes: [finalOf("g1", "A", "B", "4-2")] });
    await gather();
    expect(shown).toEqual([]);
    act(() => setVisibility("hidden"));
    await gather();
    expect(shown).toEqual([]);
  });

  it("announces each change once, however often the page reloads", async () => {
    const first = mount();
    act(() => setVisibility("hidden"));
    first.rerender({ changes: [finalOf("g1", "A", "B", "4-2")] });
    await gather();
    first.unmount();
    expect(shown).toHaveLength(1);

    const again = mount();
    again.rerender({
      changes: [finalOf("g1", "A", "B", "4-2"), finalOf("g2", "C", "A", "1-3")],
    });
    await gather();
    expect(shown.slice(1)).toEqual([
      { title: "Spring 26", body: "1 new final.\nComets at Aces: final, 1–3." },
    ]);
  });

  it("says when League kept live has stopped and needs a person", async () => {
    const view = mount();
    act(() => setVisibility("hidden"));
    view.rerender({ changes: [], problem: { kind: "gone", text: "This season was deleted." } });
    await gather();
    expect(shown).toEqual([{ title: "Spring 26", body: "This season was deleted." }]);
  });

  it("announces a move in the odds once, however the forecast wobbles after", async () => {
    const view = mount();
    view.rerender({ changes: [odds(50.2)] });
    act(() => setVisibility("hidden"));
    // Finals elsewhere in the league seed the forecast again: the same move, a point apart.
    view.rerender({ changes: [odds(50.7)] });
    await gather();
    view.rerender({ changes: [odds(51.6)] });
    await gather();
    expect(shown).toEqual([]);
    view.rerender({ changes: [odds(66)] });
    await gather();
    expect(shown).toEqual([
      { title: "Spring 26", body: "1 move in the odds.\nAces's Gold chance went from 30% to 66%." },
    ]);
  });

  it("measures a move in the odds in steps of the points chosen for it", async () => {
    const view = mount({ ...on, oddsMove: 15 });
    act(() => setVisibility("hidden"));
    view.rerender({ changes: [odds(46)] });
    await gather();
    // Past a second step of ten points, but still within the first of the fifteen chosen.
    view.rerender({ changes: [odds(51.6)] });
    await gather();
    expect(shown).toEqual([
      { title: "Spring 26", body: "1 move in the odds.\nAces's Gold chance went from 30% to 46%." },
    ]);
  });

  it("leaves out what is not opted into", async () => {
    const view = mount({ ...on, finals: false });
    act(() => setVisibility("hidden"));
    view.rerender({ changes: [finalOf("g1", "A", "B", "4-2")] });
    await gather();
    expect(shown).toEqual([]);
  });
});
