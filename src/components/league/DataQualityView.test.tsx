import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Finding } from "../../lib/leagueFindings";
import { DataQualityView } from "./DataQualityView";

/** One finding about ten games and a team, placeholder names. */
const FINDING: Finding = {
  code: "past-unplayed",
  severity: "review",
  summary: "10 past games still without a score",
  detail: "Their dates have gone by.",
  suggestion: "Enter the scores.",
  targets: [
    ...Array.from({ length: 10 }, (_, at) => ({
      kind: "game" as const,
      id: `g${at}`,
      label: `Game ${at}`,
    })),
    { kind: "team", id: "A", label: "Aces" },
  ],
  affectsForecast: true,
  fingerprint: "past-unplayed|g0",
};

const draw = (onOpen = vi.fn()) =>
  render(
    <DataQualityView
      findings={[FINDING]}
      putAside={[]}
      tier="Developing"
      preview={() => []}
      onOpen={onOpen}
      onRepair={vi.fn()}
      onPutAside={vi.fn()}
      onBringBack={vi.fn()}
    />
  );

describe("a finding's links", () => {
  it("show the first few, and every one on asking", async () => {
    draw();
    const links = () =>
      within(screen.getByRole("list", { name: "Where to put it right" })).getAllByRole("button", {
        name: /^Open /,
      });
    expect(links()).toHaveLength(8);
    await userEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    expect(links()).toHaveLength(11);
  });

  it("each hands its target on to be opened", async () => {
    const onOpen = vi.fn();
    draw(onOpen);
    await userEvent.click(screen.getByRole("button", { name: "Show 3 more" }));
    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    expect(onOpen).toHaveBeenCalledWith({ kind: "team", id: "A", label: "Aces" });
  });
});
