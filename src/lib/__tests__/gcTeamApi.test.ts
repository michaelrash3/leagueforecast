import { afterEach, describe, expect, it, vi } from "vitest";
import profileFixture from "./fixtures/gc-team-profile.json";
import gamesFixture from "./fixtures/gc-team-games.json";
import handler from "../../../api/gc-team";
import { GC_GAMES_ACCEPT, GC_PROFILE_ACCEPT, type GcTeamResponse } from "../gameChangerApi";

const TEAM_ID = "gsUthn4XoIxS";

type Recorded = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
};

/** A minimal Vercel-style response that records what the handler did. */
const makeRes = () => {
  const recorded: Recorded = { statusCode: 0, body: undefined, headers: {} };
  const res = {
    status: (code: number) => {
      recorded.statusCode = code;
      return res;
    },
    json: (body: unknown) => {
      recorded.body = body;
    },
    setHeader: (name: string, value: string) => {
      recorded.headers[name.toLowerCase()] = value;
    },
    end: () => {},
  };
  return { res, recorded };
};

let nextClient = 0;

/** Each request gets its own client address so the per-IP throttle never crosses tests. */
const makeReq = (url: string, method = "GET") => {
  nextClient += 1;
  return {
    method,
    url,
    headers: {},
    socket: { remoteAddress: `10.0.0.${nextClient}` },
  };
};

type Upstream = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

type Captured = { url: string; headers: Record<string, string> };

/**
 * Stubs global fetch with a router keyed on the upstream path: `/games` answers with `games`,
 * anything else with `profile`. A thrown error stands in for a network failure or a timeout.
 */
const stubUpstream = ({ profile, games }: { profile: Upstream; games: Upstream }): Captured[] => {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      captured.push({ url, headers: { ...((init?.headers as Record<string, string>) ?? {}) } });
      const spec = url.endsWith("/games") ? games : profile;
      if (spec instanceof Error) throw spec;
      const status = spec.status ?? 200;
      const isJson = spec.body !== undefined && typeof spec.body !== "string";
      const text = isJson ? JSON.stringify(spec.body) : ((spec.body as string | undefined) ?? "");
      return new Response(text, {
        status,
        headers: {
          "content-type": isJson ? "application/json" : "text/html",
          ...(spec.headers ?? {}),
        },
      });
    })
  );
  return captured;
};

const run = async (url: string, method = "GET") => {
  const { res, recorded } = makeRes();
  await handler(makeReq(url, method), res);
  return recorded;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GET /api/gc-team", () => {
  it("fetches profile and games in parallel with the schedule page's headers", async () => {
    const captured = stubUpstream({
      profile: { body: profileFixture },
      games: { body: gamesFixture },
    });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);

    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["cache-control"]).toBe("no-store");
    const body = recorded.body as GcTeamResponse;
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.schedule.profile).toMatchObject({
        id: TEAM_ID,
        name: "NV Stars 9u Scout",
        ageLevel: 9,
        season: { season: "fall", year: 2026 },
        avatarKey: "5192a689-d888-4ae5-abce-446885dca7c7",
      });
      expect(body.schedule.games).toHaveLength(12);
      expect(body.schedule.games[0]?.date).toBe("2026-08-22");
      expect(Number.isNaN(Date.parse(body.schedule.fetchedAt))).toBe(false);
    }

    expect(captured.map((call) => call.url)).toEqual([
      `https://api.team-manager.gc.com/public/teams/${TEAM_ID}`,
      `https://api.team-manager.gc.com/public/teams/${TEAM_ID}/games`,
    ]);
    const [profileCall, gamesCall] = captured;
    expect(profileCall?.headers).toMatchObject({
      accept: GC_PROFILE_ACCEPT,
      "gc-app-name": "web",
      origin: "https://web.gc.com",
      referer: "https://web.gc.com/",
      "accept-language": "en-US,en;q=0.9",
    });
    expect(profileCall?.headers["user-agent"]).toMatch(/Chrome/);
    expect(gamesCall?.headers.accept).toBe(GC_GAMES_ACCEPT);
    expect(profileCall?.headers).not.toHaveProperty("gc-token");
  });

  it("applies GC_API_BASE, GC_EXTRA_HEADERS and GC_TOKEN to every upstream request", async () => {
    vi.stubEnv("GC_API_BASE", "http://localhost:9999/mirror/");
    vi.stubEnv("GC_EXTRA_HEADERS", JSON.stringify({ "x-aws-waf-token": "waf-abc", "x-num": 7 }));
    vi.stubEnv("GC_TOKEN", " secret-token ");
    const captured = stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);

    expect(recorded.statusCode).toBe(200);
    expect(captured.map((call) => call.url)).toEqual([
      `http://localhost:9999/mirror/public/teams/${TEAM_ID}`,
      `http://localhost:9999/mirror/public/teams/${TEAM_ID}/games`,
    ]);
    for (const call of captured) {
      expect(call.headers["x-aws-waf-token"]).toBe("waf-abc");
      expect(call.headers["x-num"]).toBe("7");
      expect(call.headers["gc-token"]).toBe("secret-token");
    }
  });

  it("ignores a malformed GC_EXTRA_HEADERS rather than failing", async () => {
    vi.stubEnv("GC_EXTRA_HEADERS", "{not json");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("accepts a pasted team URL as the id", async () => {
    const captured = stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const recorded = await run(
      `/api/gc-team?id=${encodeURIComponent(`https://web.gc.com/teams/${TEAM_ID}/slug/schedule`)}`
    );
    expect(recorded.statusCode).toBe(200);
    expect(captured[0]?.url).toBe(`https://api.team-manager.gc.com/public/teams/${TEAM_ID}`);
  });

  it("returns ok with zero games when the schedule is a 404 but the profile is good", async () => {
    stubUpstream({
      profile: { body: profileFixture },
      games: { status: 404, body: { error: "x" } },
    });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(200);
    const body = recorded.body as GcTeamResponse;
    expect(body.ok).toBe(true);
    if (body.ok) {
      expect(body.schedule.games).toEqual([]);
      expect(body.schedule.profile.name).toBe("NV Stars 9u Scout");
    }
  });

  it("rejects an invalid id with 400 before fetching anything", async () => {
    const captured = stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const recorded = await run("/api/gc-team?id=nope");
    expect(recorded.statusCode).toBe(400);
    expect(recorded.body).toMatchObject({ ok: false, reason: "invalid-id" });
    expect(captured).toHaveLength(0);

    const missing = await run("/api/gc-team");
    expect(missing.statusCode).toBe(400);
    expect(missing.body).toMatchObject({ ok: false, reason: "invalid-id" });
  });

  it("answers the probe without touching GameChanger", async () => {
    vi.stubEnv("GC_EXTRA_HEADERS", JSON.stringify({ "x-aws-waf-token": "waf-abc" }));
    vi.stubEnv("GC_TOKEN", "t");
    const captured = stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const recorded = await run("/api/gc-team?probe=1");
    expect(recorded.statusCode).toBe(200);
    expect(recorded.headers["cache-control"]).toBe("no-store");
    expect(recorded.body).toMatchObject({
      base: "https://api.team-manager.gc.com",
      extraHeaderNames: ["x-aws-waf-token"],
      hasToken: true,
    });
    // Names only: the token value never leaves the server.
    expect(JSON.stringify(recorded.body)).not.toContain("waf-abc");
    expect(captured).toHaveLength(0);
  });

  it("refuses other methods with 405 and an Allow header", async () => {
    stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`, "POST");
    expect(recorded.statusCode).toBe(405);
    expect(recorded.headers.allow).toBe("GET");
    expect(recorded.body).toMatchObject({ ok: false });
  });

  it("maps a profile 404 to not-found", async () => {
    stubUpstream({ profile: { status: 404, body: { message: "Not Found" } }, games: { body: [] } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(404);
    expect(recorded.body).toMatchObject({ ok: false, reason: "not-found", status: 404 });
  });

  it("maps a 429 to throttled and passes Retry-After through", async () => {
    stubUpstream({
      profile: { status: 429, body: "slow down", headers: { "retry-after": "17" } },
      games: { body: [] },
    });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(429);
    expect(recorded.headers["retry-after"]).toBe("17");
    expect(recorded.body).toMatchObject({
      ok: false,
      reason: "throttled",
      diagnostics: { retryAfter: "17" },
    });
    expect((recorded.body as { message: string }).message).toContain("17");
  });

  it("maps a games 429 to throttled even when the profile is fine", async () => {
    stubUpstream({ profile: { body: profileFixture }, games: { status: 429, body: "" } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(429);
    expect(recorded.body).toMatchObject({ ok: false, reason: "throttled" });
  });

  it("maps 401/403/405 to blocked, naming the WAF and the escape hatch", async () => {
    for (const status of [401, 403, 405]) {
      stubUpstream({ profile: { status, body: "<html>Forbidden</html>" }, games: { body: [] } });
      const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
      expect(recorded.statusCode).toBe(502);
      const body = recorded.body as { ok: false; reason: string; message: string };
      expect(body.reason).toBe("blocked");
      expect(body.message).toMatch(/AWS WAF/);
      expect(body.message).toMatch(/GC_EXTRA_HEADERS/);
      expect(body.message).toContain(`HTTP ${status}`);
    }
  });

  it("maps a 202 challenge body to blocked", async () => {
    stubUpstream({
      profile: { status: 202, body: "<script src='awswaf-challenge.js'></script>" },
      games: { body: [] },
    });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.body).toMatchObject({ ok: false, reason: "blocked" });
    expect((recorded.body as { message: string }).message).toMatch(/challenge/i);
  });

  it("maps a timeout to timeout and a network failure to network", async () => {
    stubUpstream({
      profile: new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      games: { body: [] },
    });
    const timedOut = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(timedOut.statusCode).toBe(504);
    expect(timedOut.body).toMatchObject({ ok: false, reason: "timeout" });

    stubUpstream({ profile: new TypeError("fetch failed"), games: { body: [] } });
    const offline = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(offline.statusCode).toBe(502);
    expect(offline.body).toMatchObject({ ok: false, reason: "network" });
    expect((offline.body as { message: string }).message).toContain("fetch failed");
  });

  it("maps another non-2xx to upstream-error with diagnostics", async () => {
    stubUpstream({ profile: { status: 503, body: { error: "maintenance" } }, games: { body: [] } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(502);
    expect(recorded.body).toMatchObject({
      ok: false,
      reason: "upstream-error",
      diagnostics: { status: 503, topLevelKeys: ["error"] },
    });
  });

  it("reports JSON it cannot normalize as unrecognized with diagnostics", async () => {
    stubUpstream({
      profile: { body: { foo: 1, bar: { deep: true }, longText: "x".repeat(1000) } },
      games: { body: [] },
    });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(502);
    const body = recorded.body as Extract<GcTeamResponse, { ok: false }>;
    expect(body.reason).toBe("unrecognized");
    expect(body.diagnostics).toMatchObject({
      url: `https://api.team-manager.gc.com/public/teams/${TEAM_ID}`,
      status: 200,
      contentType: "application/json",
      topLevelKeys: ["foo", "bar", "longText"],
    });
    expect(body.diagnostics?.bodyPreview).toHaveLength(300);
  });

  it("reports a non-JSON 200 profile as unrecognized", async () => {
    stubUpstream({ profile: { body: "<!doctype html><title>oops</title>" }, games: { body: [] } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.body).toMatchObject({
      ok: false,
      reason: "unrecognized",
      diagnostics: { contentType: "text/html", bodyPreview: "<!doctype html><title>oops</title>" },
    });
  });

  it("reports a games body that holds no list as unrecognized", async () => {
    stubUpstream({ profile: { body: profileFixture }, games: { body: { nothing: "here" } } });
    const recorded = await run(`/api/gc-team?id=${TEAM_ID}`);
    expect(recorded.statusCode).toBe(502);
    expect(recorded.body).toMatchObject({
      ok: false,
      reason: "unrecognized",
      diagnostics: { topLevelKeys: ["nothing"] },
    });
  });

  it("throttles one client after 240 requests in a minute", async () => {
    stubUpstream({ profile: { body: profileFixture }, games: { body: [] } });
    const req = makeReq(`/api/gc-team?id=${TEAM_ID}`);
    for (let index = 0; index < 240; index += 1) {
      const { res, recorded } = makeRes();
      await handler(req, res);
      expect(recorded.statusCode).toBe(200);
    }
    const { res, recorded } = makeRes();
    await handler(req, res);
    expect(recorded.statusCode).toBe(429);
    expect(recorded.body).toMatchObject({ ok: false, reason: "throttled" });
    expect((recorded.body as { message: string }).message).toMatch(/this app's own limit/);
  });
});
