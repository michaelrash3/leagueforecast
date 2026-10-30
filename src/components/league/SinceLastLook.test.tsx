import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { lookGames, readLook, saveLook, takeLook } from "../../lib/sinceLastLook";
import { SinceLastLook, type LookInput } from "./SinceLastLook";

/*
 * The card at the top of the Dashboard: kept quiet on a first visit and within the hour, told
 * once a later visit finds the season moved, and put away until the next change. Placeholder
 * names.
 */
const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-30T12:00:00Z");

const before: LookInput = {
  seasonId: "s1",
  ready: true,
  rows: [
    { id: "ACES", name: "Aces", rank: 2, goldPct: 40 },
    { id: "BEAR", name: "Bears", rank: 1, goldPct: 80 },
  ],
  matchups: [{ id: "g1", date: "10/24", away: "ACES", home: "BEAR" }],
  logs: {},
  predictions: [{ gameId: "g1", teamAId: "ACES", pA: 0.3 }],
  followed: "ACES",
  withGold: true,
};

const after: LookInput = {
  ...before,
  rows: [
    { id: "ACES", name: "Aces", rank: 1, goldPct: 75 },
    { id: "BEAR", name: "Bears", rank: 2, goldPct: 50 },
  ],
  logs: {
    g1: {
      awayRuns: "9",
      homeRuns: "4",
      awayHits: "",
      homeHits: "",
      awayK: "",
      homeK: "",
      innings: "6",
      isFinal: true,
    },
  },
  predictions: [],
};

const keepLookAt = (at: number) =>
  saveLook(
    "s1",
    takeLook(at, before.rows, lookGames(before.matchups, before.logs), before.predictions, true)
  );

describe("Since you last looked", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps where the season stands on a first visit and tells nothing", () => {
    const onShown = vi.fn();
    render(<SinceLastLook look={after} onDismiss={() => {}} onShown={onShown} />);
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(readLook("s1")).toMatchObject({ at: NOW, finals: ["g1"], places: { ACES: 1 } });
  });

  it("tells a later visit what changed, until it is put away", async () => {
    keepLookAt(NOW - 2 * 24 * HOUR);
    const onDismiss = vi.fn();
    const onShown = vi.fn();
    const user = userEvent.setup();
    render(<SinceLastLook look={after} onDismiss={onDismiss} onShown={onShown} />);

    const card = screen.getByRole("region", { name: "Since you last looked" });
    expect(card).toHaveTextContent("2 days ago");
    expect(card).toHaveTextContent("Place 2 then, 1 now");
    expect(card).toHaveTextContent("40% then, 75% now");
    // The chance the team had is the one the last look saw, while the game was still to play.
    expect(card).toHaveTextContent("W 9–4 vs Bears · you had 30%");
    expect(card).toHaveTextContent("Upset: Aces over Bears 9–4 · they had 30%");
    expect(card).toHaveTextContent("You passed: Bears");
    // The Dashboard hides the list of other devices' changes meanwhile.
    expect(onShown).toHaveBeenLastCalledWith(true);
    // Nothing is kept until it is put away, so leaving without reading it shows it again.
    expect(readLook("s1")?.at).toBe(NOW - 2 * 24 * HOUR);

    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(onShown).toHaveBeenLastCalledWith(false);
    expect(readLook("s1")).toMatchObject({ at: NOW, finals: ["g1"] });
  });

  it("says nothing within the hour of the last look, and keeps that look", () => {
    keepLookAt(NOW - HOUR / 2);
    render(<SinceLastLook look={after} onDismiss={() => {}} onShown={() => {}} />);
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readLook("s1")?.at).toBe(NOW - HOUR / 2);
  });

  it("keeps a visit that found nothing new as the next one's start", () => {
    keepLookAt(NOW - 2 * 24 * HOUR);
    render(<SinceLastLook look={before} onDismiss={() => {}} onShown={() => {}} />);
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readLook("s1")?.at).toBe(NOW);
  });

  it("waits for the forecast to describe the season before it looks", () => {
    keepLookAt(NOW - 2 * 24 * HOUR);
    const { rerender } = render(
      <SinceLastLook look={{ ...after, ready: false }} onDismiss={() => {}} onShown={() => {}} />
    );
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readLook("s1")?.at).toBe(NOW - 2 * 24 * HOUR);

    rerender(<SinceLastLook look={after} onDismiss={() => {}} onShown={() => {}} />);
    expect(screen.getByRole("region", { name: "Since you last looked" })).toBeInTheDocument();
  });
});
