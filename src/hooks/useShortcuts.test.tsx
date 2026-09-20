import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShortcuts, type Shortcut } from "./useShortcuts";

const press = (key: string) => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
};

const chordTo = (handler: () => void): Shortcut[] => [
  { combo: "g s", description: "Go to Standings", group: "Navigate", handler },
];

describe("a two-key shortcut", () => {
  it("fires when both keys arrive", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts(chordTo(handler)));

    press("g");
    press("s");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  /*
   * The half-pressed chord has to survive a render. `shortcuts` is rebuilt whenever the app mode,
   * the theme toggle or the Team Rankings command list changes identity, and that list is state
   * App holds and the view republishes as its route and pool move — so something can easily land
   * in the tenth of a second between the two keys. The prefix used to live in a `let` inside the
   * effect, which meant any of that reset it and "g" then "s" quietly did nothing.
   */
  it("survives the shortcut list being rebuilt between the two keys", () => {
    const handler = vi.fn();
    const { rerender } = renderHook(({ list }: { list: Shortcut[] }) => useShortcuts(list), {
      initialProps: { list: chordTo(handler) },
    });

    press("g");
    // A new array with the same content: what a memo recomputing hands back.
    rerender({ list: chordTo(handler) });
    press("s");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("forgets the prefix once the window has passed", () => {
    vi.useFakeTimers();
    try {
      const handler = vi.fn();
      renderHook(() => useShortcuts(chordTo(handler)));

      press("g");
      vi.advanceTimersByTime(1000);
      press("s");

      expect(handler).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets the prefix once the chord has fired, so a lone second key does nothing", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts(chordTo(handler)));

    press("g");
    press("s");
    press("s");

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
