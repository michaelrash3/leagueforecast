import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConfirmation } from "./useConfirmation";

/**
 * There is one dialog and one resolver slot, so every way of taking that slot from a caller who
 * is still awaiting has to settle them. Left unsettled the `await` never returns: the code after
 * it — the delete, the restore, the toast that says what happened — silently never runs, and it
 * looks like a click that did nothing rather than like a bug.
 */
describe("useConfirmation", () => {
  const ask = { title: "Delete season?", message: "This cannot be undone." };
  const askAgain = { title: "Restore backup?", message: "This replaces everything." };

  it("answers the open dialog with what the person chose", async () => {
    const { result } = renderHook(() => useConfirmation());

    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.request(ask);
    });
    expect(result.current.state?.title).toBe("Delete season?");

    act(() => result.current.resolve(true));
    await expect(answer!).resolves.toBe(true);
    expect(result.current.state).toBeNull();
  });

  it("settles a pending caller as declined when a second dialog takes the slot", async () => {
    const { result } = renderHook(() => useConfirmation());

    let first: Promise<boolean>;
    act(() => {
      first = result.current.request(ask);
    });

    let second: Promise<boolean>;
    act(() => {
      second = result.current.request(askAgain);
    });

    // The first caller is released rather than stranded, and released as a no.
    await expect(first!).resolves.toBe(false);
    // The second dialog is the one now on screen, and it still answers normally.
    expect(result.current.state?.title).toBe("Restore backup?");
    act(() => result.current.resolve(true));
    await expect(second!).resolves.toBe(true);
  });

  it("settles a pending caller as declined when the dialog unmounts", async () => {
    const { result, unmount } = renderHook(() => useConfirmation());

    let pending: Promise<boolean>;
    act(() => {
      pending = result.current.request(ask);
    });

    unmount();
    await expect(pending!).resolves.toBe(false);
  });

  it("declines on Escape", async () => {
    const { result } = renderHook(() => useConfirmation());

    let answer: Promise<boolean>;
    act(() => {
      answer = result.current.request(ask);
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    await expect(answer!).resolves.toBe(false);
    expect(result.current.state).toBeNull();
  });
});
