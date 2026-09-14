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

const idOf = (url: string): string => new URL(url, "http://localhost").searchParams.get("id") ?? "";

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

  it("pulls every id and keys the map in input order regardless of completion order", async () => {
    const ids = ["Aaaaaaaa0001", "Bbbbbbbb0002", "Cccccccc0003"];
    const resolvers = new Map<string, () => void>();
    const fetchImpl = fakeFetch(
      (url) =>
        new Promise<Response>((resolve) => {
          resolvers.set(idOf(url), () => resolve(jsonResponse(200, okBody)));
        })
    );
    const progress: { done: number; total: number; teamId: string }[] = [];
    const pending = fetchGcTeams(ids, {
      fetchImpl,
      delayMs: () => 0,
      onProgress: ({ done, total, teamId }) => progress.push({ done, total, teamId }),
    });

    // All three start at once (concurrency 4); finish them back to front.
    await vi.waitFor(() => expect(resolvers.size).toBe(3));
    resolvers.get("Cccccccc0003")?.();
    await vi.waitFor(() => expect(progress).toHaveLength(1));
    resolvers.get("Aaaaaaaa0001")?.();
    await vi.waitFor(() => expect(progress).toHaveLength(2));
    resolvers.get("Bbbbbbbb0002")?.();

    const results = await pending;
    expect([...results.keys()]).toEqual(ids);
    expect([...results.values()].every((result) => result.ok)).toBe(true);
    expect(progress).toEqual([
      { done: 1, total: 3, teamId: "Cccccccc0003" },
      { done: 2, total: 3, teamId: "Aaaaaaaa0001" },
      { done: 3, total: 3, teamId: "Bbbbbbbb0002" },
    ]);
  });

  it("never has more than `concurrency` requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = fakeFetch(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return jsonResponse(200, okBody);
    });
    const ids = Array.from({ length: 9 }, (_, index) => `Team${String(index).padStart(8, "0")}`);
    const results = await fetchGcTeams(ids, { fetchImpl, concurrency: 2, delayMs: () => 0 });
    expect(results.size).toBe(9);
    expect(peak).toBe(2);
    expect(fetchImpl.calls).toHaveLength(9);
  });

  it("retries a throttled answer with the injected backoff and keeps the eventual success", async () => {
    const fetchImpl = fakeFetch((_url, call) =>
      call === 1 ? jsonResponse(429, throttled) : jsonResponse(200, okBody)
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

  it("uses the default backoff of one second then three when no delay is injected", async () => {
    // Fake timers make the default backoff observable without waiting it out. Assertions run
    // straight after each advance (no waitFor, which would move the fake clock on its own).
    vi.useFakeTimers();
    try {
      const fetchImpl = fakeFetch(() => jsonResponse(429, throttled));
      const pending = fetchGcTeams([TEAM_ID], { fetchImpl });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetchImpl.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchImpl.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2_999);
      expect(fetchImpl.calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchImpl.calls).toHaveLength(3);
      const results = await pending;
      expect(results.get(TEAM_ID)).toEqual(throttled);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops starting new requests once aborted and leaves the rest out of the map", async () => {
    const controller = new AbortController();
    const ids = ["Aaaaaaaa0001", "Bbbbbbbb0002", "Cccccccc0003", "Dddddddd0004"];
    const fetchImpl = fakeFetch((_url, call) => {
      if (call === 2) controller.abort();
      return jsonResponse(200, okBody);
    });
    const results = await fetchGcTeams(ids, {
      fetchImpl,
      concurrency: 1,
      delayMs: () => 0,
      signal: controller.signal,
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect([...results.keys()]).toEqual(["Aaaaaaaa0001", "Bbbbbbbb0002"]);
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
    const fetchImpl = fakeFetch(() => jsonResponse(200, okBody));
    const results = await fetchGcTeams([TEAM_ID, " ", TEAM_ID, "Bbbbbbbb0002"], {
      fetchImpl,
      delayMs: () => 0,
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect([...results.keys()]).toEqual([TEAM_ID, "Bbbbbbbb0002"]);
  });

  it("returns an empty map for an empty list without touching fetch", async () => {
    const fetchImpl = fakeFetch(() => jsonResponse(200, okBody));
    const results = await fetchGcTeams([], { fetchImpl });
    expect(results.size).toBe(0);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
