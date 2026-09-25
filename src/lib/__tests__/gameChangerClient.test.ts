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
import { BATCH_SIZE, fetchGcTeam, fetchGcTeams, MAX_REFUSALS } from "../gameChangerClient";

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

  // The id of every entry the schedule answered with rides along, so the import can tell a row it
  // could not read from one the schedule dropped.
  it("keeps the ids of every row the schedule answered with", async () => {
    const fetchImpl = fakeFetch(() =>
      jsonResponse(200, { ok: true, schedule: { ...schedule, rowIds: ["a1", 7, "b2"] } })
    );
    const result = await fetchGcTeam(TEAM_ID, { fetchImpl });
    expect(result.ok && result.schedule.rowIds).toEqual(["a1", "b2"]);
    const plain = await fetchGcTeam(TEAM_ID, {
      fetchImpl: fakeFetch(() => jsonResponse(200, okBody)),
    });
    expect(plain.ok && "rowIds" in plain.schedule).toBe(false);
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

  it("gives up on a refused route instead of burning the rest of the list on it", async () => {
    /*
     * GameChanger's WAF turns away the server, so every remaining id is behind the same refusal.
     * Before this, `blocked` was in neither retry set and the brake only watched for "throttled",
     * so nothing slowed and nothing counted: eight workers raced through the remainder turning
     * each id into a permanent failure that no resume would ever ask for again.
     */
    const blocked: GcTeamResponse = {
      ok: false,
      reason: "blocked" satisfies GcFetchErrorReason,
      message: "The AWS WAF turned the server away.",
      status: 403,
    };
    const ids = Array.from({ length: 60 }, (_, i) => `Team${String(i).padStart(8, "0")}`);
    const fetchImpl = batchFetch(() => blocked);
    const seen: string[] = [];
    const refusals: number[] = [];

    const results = await fetchGcTeams(ids, {
      fetchImpl,
      concurrency: 1,
      delayMs: () => 0,
      refusedHoldMs: 0,
      onRefused: (count) => refusals.push(count),
      onProgress: ({ teamId }) => seen.push(teamId),
    });

    // Stopped early rather than walking the whole list.
    expect(fetchImpl.calls.length).toBeLessThan(ids.length / BATCH_SIZE);
    // Said so, once.
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toBeGreaterThan(MAX_REFUSALS);
    // And crucially: the refused ids were never reported, so the caller cannot settle them and a
    // resume asks for them again. A reported failure is a permanent one.
    expect(seen).toHaveLength(0);
    expect(results.size).toBe(0);
  });

  it("still hands over what a refused batch did fetch", async () => {
    const blocked: GcTeamResponse = {
      ok: false,
      reason: "blocked" satisfies GcFetchErrorReason,
      message: "blocked",
      status: 403,
    };
    const ids = Array.from({ length: 30 }, (_, i) => `Team${String(i).padStart(8, "0")}`);
    // One id answers every time; the rest are refused. Those schedules were paid for.
    const fetchImpl = batchFetch((teamId) => (teamId === ids[0] ? okBody : blocked));
    const seen: string[] = [];

    await fetchGcTeams(ids, {
      fetchImpl,
      concurrency: 1,
      delayMs: () => 0,
      refusedHoldMs: 0,
      onProgress: ({ teamId }) => seen.push(teamId),
    });

    expect(seen).toContain(ids[0]);
    expect(seen.every((teamId) => teamId === ids[0])).toBe(true);
  });

  it("does not give up on a refusal that does not repeat", async () => {
    const blocked: GcTeamResponse = {
      ok: false,
      reason: "blocked" satisfies GcFetchErrorReason,
      message: "blocked",
      status: 403,
    };
    // A single challenge can fire once and never again, which is not a reason to abandon a run.
    const ids = Array.from({ length: 30 }, (_, i) => `Team${String(i).padStart(8, "0")}`);
    const fetchImpl = batchFetch((teamId) => (teamId === ids[0] ? blocked : okBody));
    const refusals: number[] = [];

    const results = await fetchGcTeams(ids, {
      fetchImpl,
      concurrency: 1,
      delayMs: () => 0,
      refusedHoldMs: 0,
      onRefused: (count) => refusals.push(count),
    });

    expect(refusals).toHaveLength(0);
    expect(results.size).toBe(ids.length);
  });

  it("waits as long as the throttled team asked, not as long as its neighbour did not", async () => {
    /*
     * The hold used to read Retry-After off the first still-pending id. In a batch failing two
     * ways — one throttled, one timed out — that asked the timed-out team how long to wait, got
     * nothing, and fell back to the local ladder while GameChanger had named a figure.
     */
    const timedOut: GcTeamResponse = {
      ok: false,
      reason: "timeout" satisfies GcFetchErrorReason,
      message: "no answer in time",
    };
    // Fractional seconds, so the assertion is about which team was asked rather than about
    // sitting through the answer: 0.05s is 50ms, and still unmistakable next to the zero ladder.
    const slow: GcTeamResponse = { ...throttled, diagnostics: { retryAfter: "0.05" } };
    const ids = ["Aaaaaaaa0001", "Bbbbbbbb0002"];
    let call = 0;
    const fetchImpl = batchFetch((teamId) => {
      call += 1;
      if (call > 4) return okBody;
      return teamId === "Aaaaaaaa0001" ? timedOut : slow;
    });
    const waited: number[] = [];
    const sleeps = vi.spyOn(globalThis, "setTimeout");

    await fetchGcTeams(ids, { fetchImpl, concurrency: 1, delayMs: () => 0, retries: 2 });
    sleeps.mock.calls.forEach(([, ms]) => {
      if (typeof ms === "number" && ms > 0) waited.push(ms);
    });
    sleeps.mockRestore();

    // The figure GameChanger named, rather than the zero the injected ladder would have given.
    expect(waited).toContain(50);
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

/*
 * The fixed pool was the ceiling on a long pull. Eight workers of ten teams, at a second or two a
 * batch, is about two thousand teams a minute whatever the route could actually take — so a
 * hundred thousand teams was most of an hour, and eight was a guess either way. It now starts
 * where it always did and asks the route for more.
 */
describe("growing the pool while the route stays clean", () => {
  const manyIds = (count: number): string[] =>
    Array.from({ length: count }, (_unused, at) => `Team${String(at).padStart(8, "0")}`);

  it("stays where it started when told nothing about a ceiling", async () => {
    const seen: number[] = [];
    await fetchGcTeams(manyIds(60 * BATCH_SIZE), {
      fetchImpl: batchFetch(() => okBody),
      delayMs: () => 0,
      concurrency: 4,
      onConcurrency: (workers) => seen.push(workers),
    });
    expect(seen).toEqual([]);
  });

  it("adds workers as clean batches go by, up to the ceiling", async () => {
    const seen: number[] = [];
    await fetchGcTeams(manyIds(400 * BATCH_SIZE), {
      fetchImpl: batchFetch(() => okBody),
      delayMs: () => 0,
      concurrency: 4,
      maxConcurrency: 9,
      onConcurrency: (workers) => seen.push(workers),
    });
    // One at a time, in order, and never past the ceiling.
    expect(seen).toEqual([5, 6, 7, 8, 9]);
  });

  it("never grows past the number of batches there are to fetch", async () => {
    const seen: number[] = [];
    await fetchGcTeams(manyIds(2 * BATCH_SIZE), {
      fetchImpl: batchFetch(() => okBody),
      delayMs: () => 0,
      concurrency: 1,
      maxConcurrency: 20,
      onConcurrency: (workers) => seen.push(workers),
    });
    expect(Math.max(0, ...seen)).toBeLessThanOrEqual(2);
  });

  /*
   * The point of the whole arrangement. A route that has pushed back once is not one to lean on
   * harder, so the first hold of any kind stops the climb for good — a run that crept up to a
   * ceiling and then got itself blocked is worse than one that stayed where it started.
   */
  it("stops growing for good at the first hold", async () => {
    /*
     * One refused batch, which holds every worker off directly — a single refusal is well under
     * MAX_REFUSALS, so the run carries on and the question is only whether it keeps climbing.
     */
    const refusedOnce: GcTeamResponse = {
      ok: false,
      reason: "blocked" satisfies GcFetchErrorReason,
      message: "The AWS WAF turned the server away.",
      status: 403,
    };
    /*
     * Clean for the first fifty batches, one refused team, then clean again for the remaining
     * three hundred and fifty. `batchFetch` is asked per team, so the id is what picks the moment.
     */
    const refuseAt = `Team${String(500).padStart(8, "0")}`;
    const fetchImpl = batchFetch((teamId) => (teamId === refuseAt ? refusedOnce : okBody));
    const seen: number[] = [];
    let refusals = 0;
    await fetchGcTeams(manyIds(400 * BATCH_SIZE), {
      fetchImpl,
      delayMs: () => 0,
      retries: 0,
      // No wait asked for, so this also pins that a refusal freezes the climb on its own.
      refusedHoldMs: 0,
      concurrency: 4,
      maxConcurrency: 20,
      onBlocked: () => {
        refusals += 1;
      },
      onConcurrency: (workers) => seen.push(workers),
    });
    expect(refusals).toBeGreaterThan(0);
    /*
     * It had climbed a little before the refusal and not a step after it. Four hundred clean
     * batches at one step per ten would have reached the ceiling several times over, so a peak
     * well short of twenty is the latch holding.
     */
    const peak = Math.max(0, ...seen);
    // Fifty clean batches is five steps up from four.
    expect(peak).toBeGreaterThanOrEqual(5);
    // Four hundred batches would have reached the ceiling of twenty many times over.
    expect(peak).toBeLessThan(15);
  });
});
