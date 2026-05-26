import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ToastView } from "../Toast";
import type { Toast } from "../../hooks/useToast";

function buildToast(tone: Toast["tone"]): Toast {
  return {
    id: 1,
    message: "Test message",
    tone,
    durationMs: 3000,
    actionLabel: "Undo",
    onAction: vi.fn(),
  };
}

describe("ToastView", () => {
  it("uses status/polite for non-error toasts", () => {
    const html = renderToStaticMarkup(
      <ToastView toast={buildToast("info")} onDismiss={() => {}} />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
  });

  it("uses alert/assertive for error toasts", () => {
    const html = renderToStaticMarkup(
      <ToastView toast={buildToast("error")} onDismiss={() => {}} />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('aria-atomic="true"');
  });

  it("returns null markup when there is no toast", () => {
    const html = renderToStaticMarkup(<ToastView toast={null} onDismiss={() => {}} />);

    expect(html).toBe("");
  });
});
