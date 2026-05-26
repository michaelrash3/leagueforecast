import { describe, expect, it } from "vitest";

import { shouldShowInlineRuntimeToast } from "../useSimulationRuntimeNotice";

describe("shouldShowInlineRuntimeToast", () => {
  it("shows toast only for first inline runtime transition", () => {
    expect(shouldShowInlineRuntimeToast("inline", false)).toBe(true);
    expect(shouldShowInlineRuntimeToast("inline", true)).toBe(false);
  });

  it("never shows toast for worker runtime", () => {
    expect(shouldShowInlineRuntimeToast("worker", false)).toBe(false);
    expect(shouldShowInlineRuntimeToast("worker", true)).toBe(false);
  });
});
