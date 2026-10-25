import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAppMode } from "./useAppMode";

/* Which half of the app is open, kept with the address as history moves. */

const go = (search: string) =>
  act(() => {
    window.history.replaceState(null, "", `/${search}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/?view=league");
});
afterEach(() => window.history.replaceState(null, "", "/"));

describe("the app's mode on Back and Forward", () => {
  it("follows the mode the history entry names", () => {
    const { result } = renderHook(() => useAppMode());
    expect(result.current.appMode).toBe("league");
    go("?view=rankings&section=import");
    expect(result.current.appMode).toBe("rankings");
    go("?view=league");
    expect(result.current.appMode).toBe("league");
  });

  it("stays as it is on an entry naming no mode", () => {
    const { result } = renderHook(() => useAppMode());
    go("?view=rankings");
    go("?tab=schedule");
    expect(result.current.appMode).toBe("rankings");
  });
});
