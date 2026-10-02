import { afterEach, describe, expect, it, vi } from "vitest";
import gcTeamForMembers, {
  clearProfileCache,
  gcTeamHandler as handler,
} from "../../../api/gc-team";
import type { ApiRequest, ApiResponse } from "../apiShared";
import {
  isGcProxyOrigin,
  MIN_GZIP_CHARS,
  serveGcProxy,
  type ProxyResponse,
} from "../firebaseProxy";

/*
 * The GameChanger proxy as a Firebase function: the Vercel handler, answering a page on another
 * origin and compressing what it sends, which Vercel does for a function and Firebase does not.
 */
type Sent = { status: number; headers: Record<string, string>; body?: string | Uint8Array };

const respond = () => {
  const sent: Sent = { status: 200, headers: {} };
  const res: ProxyResponse = {
    status: (code) => {
      sent.status = code;
    },
    setHeader: (name, value) => {
      sent.headers[name.toLowerCase()] = value;
    },
    json: () => {
      throw new Error("the wrapper answers with end, never json");
    },
    end: (body) => {
      sent.body = body;
    },
  };
  return { res, sent };
};

let client = 0;
const request = (url: string, headers: Record<string, string> = {}, method = "GET"): ApiRequest => {
  client += 1;
  return { method, url, headers, socket: { remoteAddress: `10.1.0.${client}` } };
};

const ungzip = async (bytes: Uint8Array): Promise<string> => {
  const stream = new Blob([new Uint8Array(bytes)])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
};

const APP = "https://leagueforecast.vercel.app";

afterEach(() => {
  vi.unstubAllGlobals();
  clearProfileCache();
});

describe("which pages may read the proxy", () => {
  it("is the app, its preview builds and a local dev server", () => {
    expect(isGcProxyOrigin(APP)).toBe(true);
    expect(isGcProxyOrigin("https://leagueforecast-git-rash-mays-michaelrash3.vercel.app")).toBe(
      true
    );
    expect(isGcProxyOrigin("http://localhost:5173")).toBe(true);
    expect(isGcProxyOrigin("https://example.com")).toBe(false);
    expect(isGcProxyOrigin("https://leagueforecast.vercel.app.example.com")).toBe(false);
    expect(isGcProxyOrigin("http://leagueforecast.vercel.app")).toBe(false);
  });

  it("names the app's page, and lets it read GameChanger's Retry-After", async () => {
    const { res, sent } = respond();
    await serveGcProxy(request("/?probe=1", { origin: APP }), res, handler);
    expect(sent.headers["access-control-allow-origin"]).toBe(APP);
    expect(sent.headers["access-control-expose-headers"]).toBe("retry-after");
    expect(JSON.parse(String(sent.body))).toMatchObject({ functionDeployed: true });
  });

  it("names nobody else", async () => {
    const { res, sent } = respond();
    await serveGcProxy(request("/?probe=1", { origin: "https://example.com" }), res, handler);
    expect(sent.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers a preflight without calling GameChanger", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const { res, sent } = respond();
    await serveGcProxy(request("/", { origin: APP }, "OPTIONS"), res, handler);
    expect(sent.status).toBe(204);
    expect(sent.headers["access-control-allow-methods"]).toBe("GET");
    // A pull carries its sign-in in Authorization, which a page on another origin may send only
    // when the preflight's answer names it.
    expect(sent.headers["access-control-allow-headers"]).toBe("accept, authorization");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("turns away a pull with no sign-in, in words the app's page can read", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    const { res, sent } = respond();
    await serveGcProxy(
      request("/gcTeam?ids=gsUthn4XoIxS&raw=1", { origin: APP }),
      res,
      gcTeamForMembers
    );
    expect(sent.status).toBe(401);
    expect(sent.headers["access-control-allow-origin"]).toBe(APP);
    expect(JSON.parse(String(sent.body))).toMatchObject({ ok: false, reason: "members-only" });
    // Neither GameChanger nor Firestore was asked: there was no sign-in to ask with.
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("what the proxy sends back", () => {
  const big = { ok: true, teams: "x".repeat(MIN_GZIP_CHARS * 4) };
  const answering =
    (status: number, body: unknown) =>
    async (_req: ApiRequest, res: ApiResponse): Promise<void> => {
      res.setHeader("cache-control", "no-store");
      res.status(status).json(body);
    };

  it("gzips a large answer for a browser that takes it, and it reads back whole", async () => {
    const { res, sent } = respond();
    await serveGcProxy(
      request("/", { "accept-encoding": "gzip, deflate, br" }),
      res,
      answering(200, big)
    );
    expect(sent.headers["content-encoding"]).toBe("gzip");
    expect(sent.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(sent.headers["cache-control"]).toBe("no-store");
    expect(sent.body).toBeInstanceOf(Uint8Array);
    const bytes = sent.body as Uint8Array;
    expect(bytes.length).toBeLessThan(JSON.stringify(big).length / 10);
    expect(JSON.parse(await ungzip(bytes))).toEqual(big);
  });

  it("sends a small answer, or one to a client that takes no gzip, as it is", async () => {
    for (const [headers, body] of [
      [{ "accept-encoding": "gzip" }, { ok: false, reason: "invalid-id" }],
      [{}, big],
    ] as const) {
      const { res, sent } = respond();
      await serveGcProxy(request("/", headers), res, answering(400, body));
      expect(sent.status).toBe(400);
      expect(sent.headers["content-encoding"]).toBeUndefined();
      expect(JSON.parse(String(sent.body))).toEqual(body);
    }
  });

  it("carries the handler's own status and headers through a real pull", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "30" } }))
    );
    const { res, sent } = respond();
    await serveGcProxy(
      request("/?ids=SmokeTeam001,SmokeTeam002&raw=1", { origin: APP, "accept-encoding": "gzip" }),
      res,
      handler
    );
    expect(sent.status).toBe(200);
    expect(sent.headers["retry-after"]).toBe("30");
    const text =
      sent.headers["content-encoding"] === "gzip"
        ? await ungzip(sent.body as Uint8Array)
        : String(sent.body);
    const answer = JSON.parse(text) as { teams: Array<{ result: { reason?: string } }> };
    expect(answer.teams.map((team) => team.result.reason)).toEqual(["throttled", "throttled"]);
  });
});
