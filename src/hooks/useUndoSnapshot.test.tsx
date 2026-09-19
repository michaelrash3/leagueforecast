import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUndoSnapshot, type UndoableSeason } from "./useUndoSnapshot";
import * as storage from "../lib/storage";
import type { Matchup, TeamBase } from "../lib/types";

/**
 * Undo is held in memory first and mirrored to storage. Those are two different things that can
 * fail separately, and they used to be reported as one: a working undo announcing "storage full"
 * as an error, which reads as the undo itself having failed.
 */
const season = (label: string): UndoableSeason => ({
  teams: [{ id: "a", name: label } as TeamBase],
  matchups: [{ id: "g1", date: "", away: "a", home: "b" }] as Matchup[],
  logs: {},
  bracketLogs: {},
});

describe("useUndoSnapshot", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const setup = (current: () => UndoableSeason) => {
    const applySeason = vi.fn();
    const showToast = vi.fn();
    const onRankingsRestored = vi.fn();
    const hook = renderHook(() =>
      useUndoSnapshot({
        readSeason: current,
        applySeason,
        onRankingsRestored,
        showToast,
      })
    );
    return { ...hook, applySeason, showToast, onRankingsRestored };
  };

  it("puts back the season as it stood when the snapshot was taken", () => {
    let live = season("before");
    const { result, applySeason, showToast } = setup(() => live);

    act(() => result.current.capture("Enter score"));
    live = season("after");
    act(() => result.current.restore());

    expect(applySeason).toHaveBeenCalledTimes(1);
    expect(applySeason.mock.calls[0]?.[0].teams[0].name).toBe("before");
    expect(showToast).toHaveBeenCalledWith("Restored: Enter score.", { tone: "success" });
  });

  it("does nothing when there is no snapshot to put back", () => {
    const { result, applySeason, showToast } = setup(() => season("only"));

    act(() => result.current.restore());

    expect(applySeason).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("drops the memory copy on forget and falls back to the stored one", () => {
    const { result, applySeason } = setup(() => season("before"));

    act(() => result.current.capture("Enter score"));
    act(() => result.current.forget());
    act(() => result.current.restore());

    // Forget clears what is held, not what is stored, and that is the right reach: the stored
    // snapshot is written under the active season's own key, so after a season switch this reads
    // that season's undo rather than the one belonging to the season just left.
    expect(applySeason).toHaveBeenCalledTimes(1);
    expect(applySeason.mock.calls[0]?.[0].teams[0].name).toBe("before");
  });

  it("has nothing to fall back to once the stored copy is gone as well", () => {
    const { result, applySeason } = setup(() => season("before"));

    act(() => result.current.capture("Enter score"));
    act(() => result.current.forget());
    window.localStorage.clear();
    act(() => result.current.restore());

    expect(applySeason).not.toHaveBeenCalled();
  });

  it("calls a pool that would not fit past a reload what it is, not a broken undo", () => {
    vi.spyOn(storage, "saveUndoSnapshot").mockReturnValue(false);
    const { result, showToast } = setup(() => season("before"));

    act(() => result.current.capture("Import pool", { withTeamRankings: true }));

    // Said as a plain message, not as an error, because the undo itself is ready.
    expect(showToast).toHaveBeenCalledWith(
      "Undo is ready, but this pool is too big to keep it past a reload."
    );
  });

  it("still reports a plain snapshot that will not save as the storage problem it is", () => {
    vi.spyOn(storage, "saveUndoSnapshot").mockReturnValue(false);
    const { result, showToast } = setup(() => season("before"));

    act(() => result.current.capture("Enter score"));

    expect(showToast).toHaveBeenCalledWith("Could not save undo snapshot (storage full).", {
      tone: "error",
    });
  });

  it("restores from storage when nothing is held in memory", () => {
    const { result: first } = setup(() => season("stored"));
    act(() => first.current.capture("Enter score"));

    // A fresh hook is a fresh page: memory is empty and the mirrored copy is all there is.
    const { result: reloaded, applySeason } = setup(() => season("current"));
    act(() => reloaded.current.restore());

    expect(applySeason).toHaveBeenCalledTimes(1);
    expect(applySeason.mock.calls[0]?.[0].teams[0].name).toBe("stored");
  });
});
