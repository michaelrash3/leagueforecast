import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DigestListed } from "../../hooks/useSeasonDigest";
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

/** Twenty minutes after `after`: another device's final, a loss to the Bears, and the table turned. */
const later: LookInput = {
  ...after,
  rows: [
    { id: "ACES", name: "Aces", rank: 2, goldPct: 45 },
    { id: "BEAR", name: "Bears", rank: 1, goldPct: 70 },
  ],
  matchups: [...after.matchups, { id: "g2", date: "10/27", away: "BEAR", home: "ACES" }],
  logs: {
    ...after.logs,
    g2: {
      awayRuns: "7",
      homeRuns: "2",
      awayHits: "",
      homeHits: "",
      awayK: "",
      homeK: "",
      innings: "6",
      isFinal: true,
    },
  },
};

/** What the list of other devices' changes said, as the digest hands it over: a token here. */
const listedAt = (): DigestListed => {
  const seen = { games: {}, teams: {}, race: null };
  return { seasonId: "s1", from: seen, to: seen };
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

  it("keeps the look it was worked out from, so a final that came while it was up is told next time", async () => {
    keepLookAt(NOW - 2 * 24 * HOUR);
    const onDismiss = vi.fn();
    const user = userEvent.setup();
    const listedThen = listedAt();
    const { rerender, unmount } = render(
      <SinceLastLook
        look={{ ...after, listed: listedThen }}
        onDismiss={onDismiss}
        onShown={() => {}}
      />
    );
    expect(screen.getByRole("region", { name: "Since you last looked" })).toHaveTextContent(
      "W 9–4 vs Bears"
    );

    // Twenty minutes on, with the card still up, another device's final arrives.
    vi.setSystemTime(NOW + HOUR / 3);
    rerender(
      <SinceLastLook
        look={{ ...later, listed: listedAt() }}
        onDismiss={onDismiss}
        onShown={() => {}}
      />
    );
    await user.click(screen.getByRole("button", { name: "Got it" }));
    // What the card was worked out from, and the list as it was then: never the season at the press.
    expect(readLook("s1")).toMatchObject({ at: NOW, finals: ["g1"], places: { ACES: 1, BEAR: 2 } });
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(onDismiss.mock.calls[0]?.[0]).toBe(listedThen);
    unmount();

    // The next visit, two hours on, is told of the loss.
    vi.setSystemTime(NOW + 2 * HOUR);
    render(<SinceLastLook look={later} onDismiss={() => {}} onShown={() => {}} />);
    const next = screen.getByRole("region", { name: "Since you last looked" });
    expect(next).toHaveTextContent("L 2–7 vs Bears");
    expect(next).toHaveTextContent("Place 1 then, 2 now");
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
