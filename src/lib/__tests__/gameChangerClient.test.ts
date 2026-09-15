import { describe, expect, it, vi } from "vitest";
import profileFixture from "./fixtures/gc-team-profile.json";
import gamesFixture from "./fixtures/gc-team-games.json";
import {
  GC_TEAM_ENDPOINT,
  normalizeGcGames,
  normalizeGcTeamProfile,
  type GcFetchErrorReason,
  type GcTeamResponse,
  type GcTeamSchedule,
} from "../gameChangerApi";
import { fetchGcTeam, fetchGcTeams } from "../gameChangerClient";

const TEAM_ID = "gsUthn4XoIxS";

const schedule: GcTeamSchedule = {
  profile: normalizeGcTeamProfile(profileFixture)!,
  games: normalizeGcGames(gamesFixture),
  fetchedAt: "2026-09-14T12:00:00.000Z",
};

const okBody: GcTeamResponse = { ok: true, schedule };

const jsonResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

const htmlResponse = (status: number): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError("Unexpected token <");
    },
  }) as unknown as Response;

type FakeFetch = typeof fetch & { calls: { url: string; init: RequestInit | undefined }[] };

const fakeFetch = (
  respond: (url: string, call: number) => Response | Promise<Response>
): FakeFetch => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond(url, calls.length);
  }) as FakeFetch;
  impl.calls = calls;
  return impl;
};

/** The ids one batch request asked for, in order. */
const idsOf = (url: string): string[] => {
  const raw = new URL(url, "http://localhost").searchParams.get("ids");
  return raw ? raw.split(",").map((id) => decodeURIComponent(id)) : [];
};

/**
 * A proxy that answers a batch the way the real one does: one entry per id, each carrying that
 * team's own result, so a failure for one team is not a failure for the request.
 */
const batchFetch = (perTeam: (teamId: string) => GcTeamResponse): FakeFetch =>
  fakeFetch((url) =>
    jsonResponse(200, {
      ok: true,
      teams: idsOf(url).map((teamId) => ({ teamId, result: perTeam(teamId) })),
    })
  );

describe("fetchGcTeam", () => {
  it("asks the proxy for the id and returns the schedule", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, okBody));
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl });
    expect(fetchImpl.calls[0]?.url).toBe(`${GC_TEAM_ENDPOINT}?id=${TEAM_ID}`);
    expect(fetchImpl.calls[0]?.init?.method).toBe("GET");
    expect(result).toEqual(okBody);
    if (result.ok) {
      expect(result.schedule.games).toHaveLength(12);
      expect(result.schedule.profile.name).toBe("NV Stars 9u Scout");
    }
  });

  it("honours a custom endpoint and URL-encodes the id", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, okBody));
    await fetchGcTeam("odd id", { fetchImpl, endpoint: "/proxy/gc" });
    expect(fetchImpl.calls[0]?.url).toBe("/proxy/gc?id=odd%20id");
  });

  it("reports a non-JSON 200 (the app shell from vite dev) as unconfigured", async () => {
    const fetchImpl = fakeFetch(() => htmlResponse(200));
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unconfigured");
      expect(result.message).toMatch(/Vercel function/);
      expect(result.message).toMatch(/vercel dev/);
    }
  });

  it("reports a bodyless 404 as unconfigured too", async () => {
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl: fakeFetch(() => htmlResponse(404)) });
    expect(result).toMatchObject({ ok: false, reason: "unconfigured", status: 404 });
  });

  it("reports a bodyless 5xx as an upstream error", async () => {
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl: fakeFetch(() => htmlResponse(502)) });
    expect(result).toMatchObject({ ok: false, reason: "upstream-error", status: 502 });
  });

  it("passes the proxy's error shape through", async () => {
    const payload: GcTeamResponse = {
      ok: false,
      reason: "not-found",
      message: "GameChanger has no public profile for this team id.",
      status: 404,
      diagnostics: { url: "https://api.team-manager.gc.com/public/teams/x", status: 404 },
    };
    const result = await fetchGcTeam(TEAM_ID, {
      fetchImpl: fakeFetch(() => jsonResponse(404, payload)),
    });
    expect(result).toEqual(payload);
  });

  it("falls back to upstream-error for an unknown reason and fills the status", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(500, { ok: false, reason: "mystery" }));
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "upstream-error", status: 500 });
    if (!result.ok) expect(result.message).toContain("500");
  });

  it("treats an ok body with no readable schedule as unrecognized", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, { ok: true, schedule: { games: [] } }));
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: "unrecognized" });
  });

  it("turns a thrown network error into a network failure", async () => {
    const fetchImpl = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl });
    expect(result).toEqual({ ok: false, reason: "network", message: "Failed to fetch" });
  });

  it("turns an abort into a network failure that says it was cancelled", async () => {
    const controller = new AbortController();
    const fetchImpl = fakeFetch(() => {
      controller.abort();
      throw new DOMException("The user aborted a request.", "AbortError");
    });
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, reason: "network" });
    if (!result.ok) expect(result.message).toMatch(/cancelled/i);
  });
});

describe("fetchGcTeams", () => {
  const throttled: GcTeamResponse = {
    ok: false,
    reason: "throttled",
    message: "GameChanger is rate-limiting the profile request.",
    status: 429,
  };

  it("asks for the teams in one request and reports them one at a time, in order", async () => {
    const ids = ["Aaaaaaaa0001", "Bbbbbbbb0002", "Cccccccc0003"];
    const fetchImpl = batchFetch(() => okBody);
    const progress: { done: number; total: number; teamId: string }[] = [];
    const results = await fetchGcTeams(ids, {
      fetchImpl,
      delayMs: () => 0,
      onProgress: ({ done, total, teamId }) => progress.push({ done, total, teamId }),
    });

    // One request for all three, and the caller still sees a team at a time.
    expect(fetchImpl.calls).toHaveLength(1);
    expect(idsOf(fetchImpl.calls[0]!.url)).toEqual(ids);
    expect([...results.keys()]).toEqual(ids);
    expect([...results.values()].every((result) => result.ok)).toBe(true);
    expect(progress).toEqual([
      { done: 1, total: 3, teamId: "Aaaaaaaa0001" },
      { done: 2, total: 3, teamId: "Bbbbbbbb0002" },
      { done: 3, total: 3, teamId: "Cccccccc0003" },
    ]);
  });

  it("gives one team's failure to that team and leaves the rest of the batch alone", async () => {
    const ids = ["Aaaaaaaa0001", "Bbbbbbbb0002", "Cccccccc0003"];
    const missing: GcTeamResponse = {
      ok: false,
      reason: "not-found" satisfies GcFetchErrorReason,
      message: "no such team",
    };
    const fetchImpl = batchFetch((teamId) => (teamId === "Bbbbbbbb0002" ? missing : okBody));
    const results = await fetchGcTeams(ids, { fetchImpl, delayMs: () => 0 });
    expect(results.get("Aaaaaaaa0001")?.ok).toBe(true);
    expect(results.get("Bbbbbbbb0002")).toMatchObject({ ok: false, reason: "not-found" });
    expect(results.get("Cccccccc0003")?.ok).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it("never has more than `concurrency` batches in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = fakeFetch(async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return jsonResponse(200, {
        ok: true,
        teams: idsOf(url).map((teamId) => ({ teamId, result: okBody })),
      });
    });
    const ids = Array.from({ length: 45 }, (_, index) => `Team${String(index).padStart(8, "0")}`);
    const results = await fetchGcTeams(ids, { fetchImpl, concurrency: 2, delayMs: () => 0 });
    expect(results.size).toBe(45);
    expect(peak).toBe(2);
    // Ten to a request: five requests, not forty-five.
    expect(fetchImpl.calls).toHaveLength(5);
  });

  it("retries a throttled answer with the injected backoff and keeps the eventual success", async () => {
    const fetchImpl = fakeFetch((url, call) =>
      call === 1
        ? jsonResponse(429, throttled)
        : jsonResponse(200, {
            ok: true,
            teams: idsOf(url).map((teamId) => ({ teamId, result: okBody })),
          })
    );
    const delayMs = vi.fn(() => 0);
    const results = await fetchGcTeams([TEAM_ID], { fetchImpl, delayMs });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(delayMs).toHaveBeenCalledTimes(1);
    expect(delayMs).toHaveBeenCalledWith(1);
    expect(results.get(TEAM_ID)?.ok).toBe(true);
  });

  it("retries network and timeout failures, and gives up after `retries` extra attempts", async () => {
    const timeout: GcTeamResponse = {
      ok: false,
      reason: "timeout" satisfies GcFetchErrorReason,
      message: "GameChanger did not answer.",
      status: 504,
    };
    const fetchImpl = fakeFetch((_url, call) => {
      if (call === 1) throw new TypeError("Failed to fetch");
      return jsonResponse(504, timeout);
    });
    const delayMs = vi.fn(() => 0);
    const results = await fetchGcTeams([TEAM_ID], { fetchImpl, retries: 2, delayMs });
    expect(fetchImpl.calls).toHaveLength(3);
    expect(delayMs.mock.calls).toEqual([[1], [2]]);
    expect(results.get(TEAM_ID)).toEqual(timeout);
  });

  it("does not retry a not-found, blocked or unconfigured answer", async () => {
    for (const reason of ["not-found", "blocked", "unconfigured", "invalid-id"] as const) {
      const fetchImpl = fakeFetch(() =>
        jsonResponse(404, { ok: false, reason, message: `it is ${reason}` })
      );
      const results = await fetchGcTeams([TEAM_ID], { fetchImpl, delayMs: () => 0 });
      expect(fetchImpl.calls).toHaveLength(1);
      expect(results.get(TEAM_ID)).toMatchObject({ ok: false, reason });
    }
  });

  it("backs off 1s, 3s, 8s then 15s when no delay is injected", async () => {
    // Fake timers make the default backoff observable without waiting it out. Assertions run
    // straight after each advance (no waitFor, which would move the fake clock on its own).
    vi.useFakeTimers();
    try {
      const fetchImpl = fakeFetch(() => jsonResponse(429, throttled));
      const pending = fetchGcTeams([TEAM_ID], { fetchImpl });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl.calls).toHaveLength(1);
      for (const [wait, calls] of [
        [1_000, 2],
        [3_000, 3],
        [8_000, 4],
        [15_000, 5],
      ] as const) {
        await vi.advanceTimersByTimeAsync(wait - 1);
        expect(fetchImpl.calls.length).toBeLessThan(calls);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetchImpl.calls).toHaveLength(calls);
      }
      const results = await pending;
      expect(results.get(TEAM_ID)).toEqual(throttled);
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * One throttled answer is about the pull, not the team that happened to get it. Every worker
   * holds off together, or the other seven keep the service that is already refusing us busy.
   */
  it("holds every worker back when one batch is throttled", async () => {
    vi.useFakeTimers();
    try {
      const seen: string[][] = [];
      const fetchImpl = fakeFetch((url, call) => {
        seen.push(idsOf(url));
        return call === 1
          ? jsonResponse(429, throttled)
          : jsonResponse(200, {
              ok: true,
              teams: idsOf(url).map((teamId) => ({ teamId, result: okBody })),
            });
      });
      // Twenty teams is two batches; one worker, so the second waits on the first.
      const ids = Array.from({ length: 20 }, (_, i) => `Team${String(i).padStart(8, "0")}`);
      const pending = fetchGcTeams(ids, { fetchImpl, concurrency: 1 });
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toHaveLength(1);
      // The first batch was refused, so nothing else goes out until the hold expires.
      await vi.advanceTimersByTimeAsync(500);
      expect(seen).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(60_000);
      const results = await pending;
      expect(results.size).toBe(20);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops starting new batches once aborted and leaves the rest out of the map", async () => {
    const controller = new AbortController();
    // Thirty teams is three batches; abort while the second is answering.
    const ids = Array.from({ length: 30 }, (_, i) => `Team${String(i).padStart(8, "0")}`);
    const fetchImpl = fakeFetch((url, call) => {
      if (call === 2) controller.abort();
      return jsonResponse(200, {
        ok: true,
        teams: idsOf(url).map((teamId) => ({ teamId, result: okBody })),
      });
    });
    const results = await fetchGcTeams(ids, {
      fetchImpl,
      concurrency: 1,
      delayMs: () => 0,
      signal: controller.signal,
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect([...results.keys()]).toEqual(ids.slice(0, 20));
  });

  it("cuts a backoff short on abort instead of waiting it out", async () => {
    const controller = new AbortController();
    const fetchImpl = fakeFetch(() => jsonResponse(429, throttled));
    const started = Date.now();
    setTimeout(() => controller.abort(), 5);
    const results = await fetchGcTeams([TEAM_ID], {
      fetchImpl,
      signal: controller.signal,
      delayMs: () => 60_000,
    });
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fetchImpl.calls).toHaveLength(1);
    expect(results.get(TEAM_ID)).toEqual(throttled);
  });

  it("dedupes repeated ids and skips blanks", async () => {
    const fetchImpl = batchFetch(() => okBody);
    const results = await fetchGcTeams([TEAM_ID, " ", TEAM_ID, "Bbbbbbbb0002"], {
      fetchImpl,
      delayMs: () => 0,
    });
    // One request, and it asks for each team once.
    expect(idsOf(fetchImpl.calls[0]!.url)).toEqual([TEAM_ID, "Bbbbbbbb0002"]);
    expect([...results.keys()]).toEqual([TEAM_ID, "Bbbbbbbb0002"]);
  });

  it("returns an empty map for an empty list without touching fetch", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, okBody));
    const results = await fetchGcTeams([], { fetchImpl });
    expect(results.size).toBe(0);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
