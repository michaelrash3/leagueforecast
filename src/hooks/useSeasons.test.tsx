import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSeasons } from "./useSeasons";
import { createSeason, getActiveSeasonId, listSeasons, setActiveSeason } from "../lib/storage";

/**
 * The season index lives in localStorage and is not React state, so every operation here writes it
 * and reads it back rather than keeping a copy in step by hand. What is worth guarding is the part
 * that is not a passthrough: when the active season's *data* has to be re-read, and when it does
 * not. Getting that wrong either leaves the previous season's schedule on screen under a new name,
 * or throws away an undo snapshot nobody asked to lose.
 */
const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => backing.set(k, v),
    removeItem: (k: string) => backing.delete(k),
    clear: () => backing.clear(),
  });
});

const setup = (over: { confirm?: boolean; seasonLabel?: string } = {}) => {
  const loadActiveSeason = vi.fn();
  const showToast = vi.fn();
  const requestConfirmation = vi.fn().mockResolvedValue(over.confirm ?? true);
  const hook = renderHook(
    ({ seasonLabel }: { seasonLabel: string }) =>
      useSeasons({ seasonLabel, loadActiveSeason, showToast, requestConfirmation }),
    { initialProps: { seasonLabel: over.seasonLabel ?? "" } }
  );
  return { ...hook, loadActiveSeason, showToast, requestConfirmation };
};

const toastText = (showToast: ReturnType<typeof vi.fn>) =>
  showToast.mock.calls.map((call) => String(call[0])).join(" | ");

describe("switching between seasons", () => {
  it("re-reads what the season holds, and says which one it moved to", () => {
    const other = createSeason("Fall 2026");
    const { result, loadActiveSeason, showToast } = setup();

    act(() => result.current.switchTo(other.id));

    expect(getActiveSeasonId()).toBe(other.id);
    expect(loadActiveSeason).toHaveBeenCalledTimes(1);
    expect(toastText(showToast)).toContain("Fall 2026");
  });

  it("does nothing at all when that season is already the one on screen", () => {
    // Re-reading here would throw away the undo snapshot and the selection for no reason.
    const { result, loadActiveSeason, showToast } = setup();

    act(() => result.current.switchTo(getActiveSeasonId()));

    expect(loadActiveSeason).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("deleting a season", () => {
  it("asks first, and deletes nothing when the answer is no", async () => {
    const other = createSeason("Fall 2026");
    const { result, requestConfirmation } = setup({ confirm: false });

    await act(async () => result.current.remove(other.id));

    expect(requestConfirmation).toHaveBeenCalledTimes(1);
    expect(listSeasons().map((season) => season.id)).toContain(other.id);
  });

  it("re-reads the season's data when the one deleted was the one on screen", async () => {
    const other = createSeason("Fall 2026");
    setActiveSeason(other.id);
    const { result, loadActiveSeason } = setup();

    await act(async () => result.current.remove(other.id));

    // The active season moved out from under the page, so everything it holds is somebody else's.
    expect(loadActiveSeason).toHaveBeenCalledTimes(1);
    expect(listSeasons().map((season) => season.id)).not.toContain(other.id);
  });

  it("leaves the season on screen alone when a different one is deleted", async () => {
    const other = createSeason("Fall 2026");
    const { result, loadActiveSeason } = setup();

    await act(async () => result.current.remove(other.id));

    expect(loadActiveSeason).not.toHaveBeenCalled();
    expect(result.current.all.map((season) => season.id)).not.toContain(other.id);
  });

  it("refuses the last one, and says why", async () => {
    const { result, showToast } = setup();

    await act(async () => result.current.remove(getActiveSeasonId()));

    expect(listSeasons()).toHaveLength(1);
    expect(toastText(showToast)).toContain("only season");
  });
});

/*
 * Only the one rule here. That a blank label leaves the name alone is `renameSeason`'s rule, not
 * this hook's — the early-out above it is a spared write, and removing it changes nothing — so it
 * is guarded where it lives, in the storage tests.
 */
describe("the season's name and its label", () => {
  it("renames the index entry to follow the label that was typed", () => {
    const { result, rerender } = setup();

    rerender({ seasonLabel: "Spring 2027" });

    expect(result.current.all.find((season) => season.id === result.current.activeId)?.name).toBe(
      "Spring 2027"
    );
  });
});
