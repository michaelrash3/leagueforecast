import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, {
  clearModelCaches,
  setSummarySecurityTestHooks,
} from "../../../api/league-summary";
import { buildLeagueSummaryRequest } from "../leagueSummaryClient";

/**
 * The AI write-up's function: Gemini first, and Groq when Gemini cannot write one, which is what
 * the user added a Groq key for on 28 September 2026. The network is faked by URL.
 */
const GEMINI_LIST = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200";
/**
 * Every Gemini model's generate URL answers the same: the key lists one model, and the app's own
 * fallbacks are tried after it.
 */
const GEMINI_GENERATE = "gemini:generateContent";
const isGeminiGenerate = (url: string) =>
  url.startsWith("https://generativelanguage.googleapis.com/v1beta/models/") &&
  url.endsWith(":generateContent");
const GROQ_LIST = "https://api.groq.com/openai/v1/models";
const GROQ_CHAT = "https://api.groq.com/openai/v1/chat/completions";

type Reply = { status: number; body: unknown };
const ok = (body: unknown): Reply => ({ status: 200, body });
const limited = (message: string): Reply => ({ status: 429, body: { error: { message } } });

const geminiText = (text: string) =>
  ok({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
const groqText = (text: string) =>
  ok({ choices: [{ message: { content: text }, finish_reason: "stop" }] });

type Call = { url: string; init: RequestInit };

/** Answers each upstream by URL, and records every request made. */
const stubUpstream = (replies: Record<string, Reply>): Call[] => {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const reply = replies[isGeminiGenerate(url) ? GEMINI_GENERATE : url];
      if (!reply) throw new Error(`unexpected request to ${url}`);
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => reply.body,
      } as Response;
    })
  );
  return calls;
};

const lists = {
  [GEMINI_LIST]: ok({
    models: [{ name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] }],
  }),
  [GROQ_LIST]: ok({
    data: [
      { id: "whisper-large-v3", active: true },
      { id: "llama-3.3-70b-versatile", active: true },
    ],
  }),
};

type Recorded = { statusCode: number; body: unknown; headers: Record<string, string> };
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

describe("summary endpoint security boundary", () => {
  it("rejects missing authentication before contacting a provider", async () => {
    const calls = stubUpstream(lists);
    const { res, recorded } = makeRes();
    const req = makeReq("POST", "/api/league-summary", story);
    req.headers.authorization = "";
    await handler(req, res);
    expect(recorded.statusCode).toBe(401);
    expect(recorded.headers["cache-control"]).toContain("no-store");
    expect(calls).toHaveLength(0);
  });

  it("rejects invalid credentials, content types, and parsed oversized bodies", async () => {
    const calls = stubUpstream(lists);
    const invalid = makeReq("POST", "/api/league-summary", story);
    invalid.headers.authorization = "Bearer invalid";
    let response = makeRes();
    await handler(invalid, response.res);
    expect(response.recorded.statusCode).toBe(401);

    const unsupported = makeReq("POST", "/api/league-summary", story);
    unsupported.headers["content-type"] = "text/plain";
    response = makeRes();
    await handler(unsupported, response.res);
    expect(response.recorded.statusCode).toBe(415);

    const oversized = makeReq("POST", "/api/league-summary", { text: "x".repeat(200_000) });
    response = makeRes();
    await handler(oversized, response.res);
    expect(response.recorded.statusCode).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("returns predictable shared-quota responses before providers", async () => {
    setSummarySecurityTestHooks({
      verify: async () => ({ uid: "owner" }),
      quota: async () => ({ allowed: false, retryAfter: 37 }),
    });
    const calls = stubUpstream(lists);
    const { res, recorded } = makeRes();
    await handler(makeReq("POST", "/api/league-summary", story), res);
    expect(recorded.statusCode).toBe(429);
    expect(recorded.headers["retry-after"]).toBe("37");
    expect(calls).toHaveLength(0);
  });
});

let nextClient = 0;
const makeReq = (method: string, url: string, body?: unknown) => {
  nextClient += 1;
  return {
    method,
    url,
    body,
    headers: { authorization: "Bearer valid-token", "content-type": "application/json" },
    socket: { remoteAddress: `10.1.0.${nextClient}` },
  };
};

const story = buildLeagueSummaryRequest({
  seasonLabel: "2026 Fall",
  cutoff: 8,
  recapItems: [
    { kind: "clinched", text: "Stallions clinched a Gold Bracket spot.", impactScore: 95 },
  ],
});

const post = async () => {
  const { res, recorded } = makeRes();
  await handler(makeReq("POST", "/api/league-summary", story), res);
  return recorded;
};

beforeEach(() => {
  clearModelCaches();
  setSummarySecurityTestHooks({
    verify: async (token) => (token === "valid-token" ? { uid: "owner" } : null),
    quota: async () => ({ allowed: true, retryAfter: 60 }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("GEMINI_API_KEY", "g-key");
  vi.stubEnv("GROQ_API_KEY", "q-key");
  vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("GROQ_MODEL", "");
});

afterEach(() => {
  setSummarySecurityTestHooks(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a story when Gemini is at its limit", () => {
  it("is written by Groq, on the first of its chat models, with its own key", async () => {
    const calls = stubUpstream({
      ...lists,
      [GEMINI_GENERATE]: limited("Resource has been exhausted."),
      [GROQ_CHAT]: groqText("The Stallions are in."),
    });

    const recorded = await post();

    expect(recorded.statusCode).toBe(200);
    expect(recorded.body).toEqual({
      summary: "The Stallions are in.",
      model: "llama-3.3-70b-versatile",
      source: "groq",
    });
    const chat = calls.find((call) => call.url === GROQ_CHAT);
    expect(chat?.init.headers).toMatchObject({ authorization: "Bearer q-key" });
    expect(JSON.parse(String(chat?.init.body)).model).toBe("llama-3.3-70b-versatile");
    // Gemini was asked first.
    expect(calls.findIndex((call) => isGeminiGenerate(call.url))).toBeLessThan(
      calls.findIndex((call) => call.url === GROQ_CHAT)
    );
  });

  it("says both limits, and to try again, when Groq is at its own too", async () => {
    stubUpstream({
      ...lists,
      [GEMINI_GENERATE]: limited("Resource has been exhausted."),
      [GROQ_CHAT]: limited("Rate limit reached for model llama-3.3-70b-versatile."),
    });

    const recorded = await post();

    expect(recorded.statusCode).toBe(429);
    expect(recorded.body).toMatchObject({ reason: "rate-limited" });
    expect((recorded.body as { error: string }).error).toMatch(
      /^Gemini rate-limited every model tried \(gemini-3-flash, [^)]*\)\. Groq rate-limited every model tried \(llama-3\.3-70b-versatile\)\. Try again shortly\.$/
    );
  });
});

describe("Groq's reserved time", () => {
  it("goes on an answer, not on listing models, when Gemini has used its own", async () => {
    // Each Gemini attempt takes five seconds of the clock, so Gemini spends its twenty and
    // leaves Groq five: too little to list models and still answer, so it does not list.
    vi.useFakeTimers({ toFake: ["Date"] });
    const calls = stubUpstream({ ...lists, [GROQ_CHAT]: groqText("Groq, in time.") });
    const upstream = globalThis.fetch as unknown as (
      url: string,
      init?: RequestInit
    ) => Promise<Response>;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (isGeminiGenerate(url)) {
        calls.push({ url, init: init ?? {} });
        vi.setSystemTime(Date.now() + 5_000);
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { message: "Resource has been exhausted." } }),
        } as Response;
      }
      return upstream(url, init);
    });

    try {
      const recorded = await post();

      expect(recorded.body).toEqual({
        summary: "Groq, in time.",
        model: "llama-3.3-70b-versatile",
        source: "groq",
      });
      expect(calls.some((call) => call.url === GROQ_LIST)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a story Gemini writes", () => {
  it("never asks Groq", async () => {
    const calls = stubUpstream({
      ...lists,
      [GEMINI_GENERATE]: geminiText("The Stallions clinched."),
    });

    const recorded = await post();

    expect(recorded.body).toEqual({
      summary: "The Stallions clinched.",
      model: "gemini-3-flash",
      source: "gemini",
    });
    expect(calls.some((call) => call.url.startsWith("https://api.groq.com"))).toBe(false);
  });

  it("keeps the retry hint when only Gemini is set up and at its limit", async () => {
    vi.stubEnv("GROQ_API_KEY", "");
    stubUpstream({ ...lists, [GEMINI_GENERATE]: limited("Resource has been exhausted.") });

    const recorded = await post();

    expect(recorded.statusCode).toBe(429);
    expect(recorded.body).toMatchObject({ reason: "rate-limited" });
    expect((recorded.body as { error: string }).error).toMatch(
      /^Gemini rate-limited every model tried \(gemini-3-flash, [^)]*\)\. Try again shortly\.$/
    );
  });
});

describe("either key alone", () => {
  it("writes with Groq when Groq's is the only key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const calls = stubUpstream({ ...lists, [GROQ_CHAT]: groqText("Groq alone.") });

    const recorded = await post();

    expect(recorded.body).toMatchObject({ summary: "Groq alone.", source: "groq" });
    expect(calls.some((call) => call.url.startsWith("https://generativelanguage"))).toBe(false);
  });

  it("is off, and says which keys, with neither", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    stubUpstream({});

    const recorded = await post();

    expect(recorded.statusCode).toBe(503);
    expect(recorded.body).toEqual({
      error: "Neither GEMINI_API_KEY nor GROQ_API_KEY is configured.",
      reason: "unconfigured",
    });
  });
});

describe("the health check", () => {
  it("says whether the Groq key reaches the function, never what it is", async () => {
    stubUpstream({});
    const { res, recorded } = makeRes();
    await handler(makeReq("GET", "/api/league-summary"), res);

    expect(recorded.body).toMatchObject({
      keyConfigured: true,
      groq: { keyConfigured: true, keyLength: 5, keyHadSurroundingWhitespace: false },
    });
    expect(JSON.stringify(recorded.body)).not.toContain("q-key");
  });

  it("lists the models Groq offers the key when asked to probe", async () => {
    stubUpstream({ ...lists });
    const { res, recorded } = makeRes();
    await handler(makeReq("GET", "/api/league-summary?probe=1"), res);

    expect(recorded.body).toMatchObject({
      groq: {
        probe: {
          ok: true,
          modelCount: 1,
          candidates: ["llama-3.3-70b-versatile"],
          listError: null,
        },
      },
    });
  });
});
