import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { DataQualityFinding } from "../../lib/dataQuality";
import { DataQualityView } from "./DataQualityView";

const finding = (overrides: Partial<DataQualityFinding> = {}): DataQualityFinding => ({
  code: "missing-date",
  severity: "review",
  teamIds: ["A"],
  gameIds: ["g1"],
  summary: "Game is missing a date",
  explanation: "Ordering needs a date.",
  suggestedRepair: "Add the date in Schedule.",
  safeRepair: null,
  fingerprint: "missing-date:g1",
  deepLink: { view: "games", gameId: "g1" },
  affectsForecast: true,
  ...overrides,
});

describe("DataQualityView", () => {
  it("groups findings, exposes deep links, and dismisses only non-blocking findings", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onNavigate = vi.fn();
    const review = finding();
    const blocking = finding({
      code: "invalid-date",
      severity: "needs-attention",
      summary: "Date cannot be read",
      fingerprint: "invalid-date:g2",
    });
    render(
      <DataQualityView
        findings={[blocking, review]}
        onDismiss={onDismiss}
        onNavigate={onNavigate}
      />
    );

    expect(screen.getByRole("heading", { name: /needs attention/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /worth reviewing/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
    await user.click(screen.getAllByRole("button", { name: "Review" })[1]!);
    expect(onNavigate).toHaveBeenCalledWith("games", review);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledWith(review);
  });

  it("collapses empty categories", () => {
    render(<DataQualityView findings={[]} onDismiss={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: /needs attention/i })).not.toBeInTheDocument();
    expect(screen.getByText(/No active findings/)).toBeInTheDocument();
  });
});
