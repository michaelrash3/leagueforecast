import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLeagueSummary } from "./useLeagueSummary";
import type { LeagueSummaryRequest } from "../lib/leagueSummary";

const request = (team = "Legends"): LeagueSummaryRequest => ({
  kind: "league-story",
  seasonLabel: "Fall 2026",
  cutoff: 4,
  hasCutLine: true,
  facts: [{ kind: "note", text: `${team} won three in a row.` }],
});

/** A fetch that answers instantly, and counts how many times anybody asked. */
const countingFetch = () => {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ summary: "A write-up.", model: "gemini-test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
};

describe("paying for a write-up", () => {
  /*
   * The behaviour being fixed. These are a call against somebody's language-model quota apiece and
   * they fetched themselves — the request is rebuilt whenever its content changes, so switching age
   * group or picking a different team sent another. A few minutes of clicking around cost a few
   * dozen write-ups nobody had asked to read.
   */
  it("sends nothing until it is asked", async () => {
    const { calls, fetchImpl } = countingFetch();
    const { result } = renderHook(() => useLeagueSummary(request(), { fetchImpl, mode: "ask" }));

    // Long enough for the settle delay to have fired, had anything been waiting on it.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(0);
    expect(result.current.status).toBe("idle");
    // And it says so, so a panel can offer the button rather than look broken.
    expect(result.current.waiting).toBe(true);
  });

  it("sends one when it is", async () => {
    const { calls, fetchImpl } = countingFetch();
    const { result } = renderHook(() => useLeagueSummary(request(), { fetchImpl, mode: "ask" }));

    act(() => result.current.ask());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(calls).toHaveLength(1);
    expect(result.current.summary).toBe("A write-up.");
    expect(result.current.waiting).toBe(false);
  });

  /*
   * The press belongs to the facts it was pressed for. Carrying it over would mean one press
   * bought a write-up for every team clicked afterwards, which is the original behaviour wearing a
   * button.
   */
  it("does not carry the press over to a different set of facts", async () => {
    const { calls, fetchImpl } = countingFetch();
    const { result, rerender } = renderHook(
      ({ team }: { team: string }) => useLeagueSummary(request(team), { fetchImpl, mode: "ask" }),
      { initialProps: { team: "Legends" } }
    );

    act(() => result.current.ask());
    await waitFor(() => expect(calls).toHaveLength(1));

    rerender({ team: "Sluggers" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(1);
    expect(result.current.waiting).toBe(true);
  });

  it("fetches on its own when that is what was chosen", async () => {
    const { calls, fetchImpl } = countingFetch();
    const { result } = renderHook(() => useLeagueSummary(request(), { fetchImpl, mode: "auto" }));
    // Past the settle delay that collapses a burst of score entry into one request.
    await waitFor(() => expect(result.current.status).toBe("ready"), { timeout: 4_000 });
    expect(calls).toHaveLength(1);
    // Nothing is waiting on a press, so no panel offers one.
    expect(result.current.waiting).toBe(false);
  });

  it("has nothing to offer when there is nothing to write about", () => {
    const { fetchImpl } = countingFetch();
    const { result } = renderHook(() => useLeagueSummary(null, { fetchImpl, mode: "ask" }));
    expect(result.current.waiting).toBe(false);
  });
});
