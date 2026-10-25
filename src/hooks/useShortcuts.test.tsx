import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShortcuts, type Shortcut } from "./useShortcuts";

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = window) => {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init })
  );
};

const one = (combo: string, handler: () => void): Shortcut[] => [
  { combo, description: combo, group: "General", handler },
];

describe("useShortcuts", () => {
  it("runs a single-key shortcut", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts(one("d", handler)));

    press("d");

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("asks for the modifiers a combo names, and no others", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts(one("shift+/", handler)));

    press("/");
    press("/", { ctrlKey: true, shiftKey: true });
    expect(handler).not.toHaveBeenCalled();

    press("/", { shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("leaves a key typed into a field alone", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts(one("d", handler)));
    const input = document.createElement("input");
    document.body.append(input);

    press("d", {}, input);

    expect(handler).not.toHaveBeenCalled();
    input.remove();
  });

  /*
   * The two-key "g s" chords were taken out with the command palette. A combo with a space in it is
   * now just a key that never arrives, so nothing half-pressed can linger between renders.
   */
  it("treats a two-key combo as nothing at all", () => {
    const handler = vi.fn();
    renderHook(() => useShortcuts(one("g s", handler)));

    press("g");
    press("s");

    expect(handler).not.toHaveBeenCalled();
  });
});
