import { act, render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createTabTurn, TAB_READ_ONLY } from "../../lib/tabTurn";
import { TabTurnBanner, useTabReadOnly } from "./TabTurnBanner";

/*
 * What a tab another tab has the turn from says (`tabTurn.ts`): that League Standings is open in
 * another tab, so this one is read-only, and "Use here" to take the turn.
 */
describe("a tab that is read-only for another tab's turn", () => {
  it("says so, and Use here takes the turn", async () => {
    const user = userEvent.setup();
    const useHere = vi.fn();
    render(<TabTurnBanner readOnly onUseHere={useHere} />);
    expect(screen.getByText("Open in another tab")).toBeInTheDocument();
    expect(screen.getByText(/read-only/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use here" }));
    expect(useHere).toHaveBeenCalledTimes(1);
  });

  it("says nothing in the tab that has the turn", () => {
    const { container } = render(<TabTurnBanner readOnly={false} onUseHere={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("gives the reason an edit is refused, for the season's lock", () => {
    expect(TAB_READ_ONLY).toMatch(/another tab/);
    expect(TAB_READ_ONLY).toMatch(/Use here/);
  });

  it("follows the turn as it changes, and is never read-only with no turn started", () => {
    let told: ((readOnly: boolean) => void) | undefined;
    const turn = {
      ...createTabTurn({ channel: null, openedAt: 0, id: "t", claimed: () => false }),
      readOnly: () => readOnly,
      onChange: (heard: (readOnly: boolean) => void) => {
        told = heard;
        return () => undefined;
      },
    };
    let readOnly = false;
    const { result } = renderHook(() => useTabReadOnly(turn));
    expect(result.current).toBe(false);
    readOnly = true;
    act(() => told?.(true));
    expect(result.current).toBe(true);

    expect(renderHook(() => useTabReadOnly(null)).result.current).toBe(false);
  });
});
