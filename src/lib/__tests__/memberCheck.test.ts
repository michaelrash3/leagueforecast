import { describe, expect, it, vi } from "vitest";
import type { ApiRequest, ApiResponse } from "../apiShared";
import {
  bearerToken,
  createMemberCheck,
  MEMBER_CHECK_TTL_MS,
  membersOnly,
  WRITE_CHECK_TTL_MS,
  tokenAddress,
  tokenExpiry,
  type MemberCheck,
} from "../memberCheck";

/*
 * The GameChanger proxy's door: who is on the cloud copy's list, asked of Firestore with the
 * caller's own sign-in, and what everyone else is told. Firestore itself is a stand-in here,
 * answering by status; the rules' own answers are proved on the emulator
 * (`firestoreRules.test.ts`).
 */

const NOW = Date.parse("2026-10-02T20:00:00Z");

const base64url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A sign-in token as Firebase shapes one; its signature is never looked at here. */
const token = (claims: Record<string, unknown>): string =>
  `${base64url(JSON.stringify({ alg: "RS256" }))}.${base64url(JSON.stringify(claims))}.signature`;

const signedIn = (email: string, exp = NOW / 1000 + 3_600, extra: Record<string, unknown> = {}) =>
  token({ email, exp, ...extra });

/** A Firestore that answers every read with `status`, and records what it was asked. */
const firestore = (status: number | "down", body = "{}") => {
  const asked: Array<{ url: string; authorization: string | null }> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    asked.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    });
    if (status === "down") throw new TypeError("fetch failed");
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
};

describe("reading a sign-in", () => {
  it("takes the token from a Bearer header and nothing else", () => {
    expect(bearerToken("Bearer abc.def.ghi")).toBe("abc.def.ghi");
    expect(bearerToken("bearer  abc.def.ghi ")).toBe("abc.def.ghi");
    for (const junk of [undefined, "", "Basic abc", "Bearer", "Bearer a b"]) {
      expect(bearerToken(junk)).toBeNull();
    }
  });

  it("reads whose it is, in lower case, and when it ends, whatever else it carries", () => {
    const one = signedIn("Coach@Example.COM", 1_900_000_000, { name: "Zoë Ó Briain" });
    expect(tokenAddress(one)).toBe("coach@example.com");
    expect(tokenExpiry(one)).toBe(1_900_000_000_000);
    expect(tokenAddress("not a token")).toBeNull();
    expect(tokenAddress(token({ sub: "no-email" }))).toBeNull();
    expect(tokenExpiry(token({ email: "a@b.c" }))).toBeNull();
  });
});

describe("the check against the list", () => {
  const check = (status: number | "down", now = () => NOW, body?: string) => {
    const store = firestore(status, body);
    return {
      ...store,
      run: createMemberCheck({
        projectId: "league-forecast-youth",
        fetchImpl: store.fetchImpl,
        now,
      }),
    };
  };

  it("asks for the caller's own entry, with the caller's own sign-in", async () => {
    const { run, asked } = check(200);
    const sent = signedIn("Coach@Example.com");
    expect(await run(`Bearer ${sent}`)).toBe("member");
    expect(asked).toEqual([
      {
        url: "https://firestore.googleapis.com/v1/projects/league-forecast-youth/databases/(default)/documents/members/coach%40example.com",
        authorization: `Bearer ${sent}`,
      },
    ]);
  });

  it("reads the entry's role: the owner's only when it says so, and a member's for anything else", async () => {
    const entry = (role: unknown) =>
      JSON.stringify({ name: "members/a@b.c", fields: { role: { stringValue: role } } });
    const caller = `Bearer ${signedIn("a@b.c")}`;
    expect(await check(200, () => NOW, entry("owner")).run(caller)).toBe("owner");
    expect(await check(200, () => NOW, entry("member")).run(caller)).toBe("member");
    expect(await check(200, () => NOW, entry("Owner")).run(caller)).toBe("member");
    expect(await check(200, () => NOW, "not json").run(caller)).toBe("member");
    expect(await check(200, () => NOW, JSON.stringify({ fields: {} })).run(caller)).toBe("member");
  });

  it("reads Firestore's answer: refused or missing is not on the list, unauthenticated is signed out", async () => {
    expect(await check(403).run(`Bearer ${signedIn("a@b.c")}`)).toBe("not-member");
    expect(await check(404).run(`Bearer ${signedIn("a@b.c")}`)).toBe("not-member");
    expect(await check(401).run(`Bearer ${signedIn("a@b.c")}`)).toBe("signed-out");
    expect(await check(500).run(`Bearer ${signedIn("a@b.c")}`)).toBe("unavailable");
    expect(await check("down").run(`Bearer ${signedIn("a@b.c")}`)).toBe("unavailable");
  });

  it("turns away without asking anything when there is no sign-in to ask with", async () => {
    const { run, asked } = check(200);
    expect(await run(undefined)).toBe("signed-out");
    expect(await run("Bearer not-a-token")).toBe("signed-out");
    expect(await run(`Bearer ${token({ sub: "no-email" })}`)).toBe("signed-out");
    // Ended already: Firestore would say so, and there is no need to ask.
    expect(await run(`Bearer ${signedIn("a@b.c", NOW / 1000 - 1)}`)).toBe("signed-out");
    expect(asked).toHaveLength(0);
  });

  it("keeps an answer ten minutes, never past the token's own end, and never one it could not get", async () => {
    let now = NOW;
    const { run, asked } = check(200, () => now);
    const lasting = `Bearer ${signedIn("a@b.c")}`;
    await run(lasting);
    await run(lasting);
    expect(asked).toHaveLength(1);
    now += MEMBER_CHECK_TTL_MS + 1;
    await run(lasting);
    expect(asked).toHaveLength(2);

    // A token with five minutes left is asked about again once they are up.
    now = NOW;
    const short = `Bearer ${signedIn("b@b.c", NOW / 1000 + 300)}`;
    const second = check(200, () => now);
    await second.run(short);
    now += 301_000;
    expect(await second.run(short)).toBe("signed-out");
    expect(second.asked).toHaveLength(1);

    for (const failing of ["down", 500] as const) {
      const unanswered = check(failing);
      await unanswered.run(lasting);
      await unanswered.run(lasting);
      expect(unanswered.asked).toHaveLength(2);
    }
  });

  it("keeps an answer a minute for a call that writes, so an account taken off stops within it", async () => {
    let at = NOW;
    let status = 200;
    const fetchImpl = (async () => new Response("{}", { status })) as unknown as typeof fetch;
    const run = createMemberCheck({
      projectId: "league-forecast-youth",
      fetchImpl,
      now: () => at,
      ttlMs: WRITE_CHECK_TTL_MS,
    });
    const header = `Bearer ${signedIn("member@example.com")}`;
    expect(await run(header)).toBe("member");
    status = 404;
    at = NOW + 59_000;
    expect(await run(header)).toBe("member");
    at = NOW + 61_000;
    expect(await run(header)).toBe("not-member");
    expect(WRITE_CHECK_TTL_MS).toBeLessThan(MEMBER_CHECK_TTL_MS);
  });

  it("says the list could not be asked when it does not answer in time", async () => {
    const silent = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out")));
      })) as unknown as typeof fetch;
    const run = createMemberCheck({
      projectId: "league-forecast-youth",
      fetchImpl: silent,
      now: () => NOW,
      waitMs: 20,
    });
    expect(await run(`Bearer ${signedIn("member@example.com")}`)).toBe("unavailable");
  });

  it("keeps a refusal too, so a stranger's sign-in is not a read on every request", async () => {
    const { run, asked } = check(403);
    const stranger = `Bearer ${signedIn("stranger@example.com")}`;
    await run(stranger);
    await run(stranger);
    expect(asked).toHaveLength(1);
  });

  it("keeps at most five hundred answers, letting the oldest go first", async () => {
    const { run, asked } = check(200);
    const first = `Bearer ${signedIn("user0@example.com")}`;
    await run(first);
    for (let n = 1; n <= 500; n += 1) await run(`Bearer ${signedIn(`user${n}@example.com`)}`);
    expect(asked).toHaveLength(501);
    await run(first);
    expect(asked).toHaveLength(502);
  });
});

describe("the proxy behind the list", () => {
  type Sent = { status: number; headers: Record<string, string>; body: unknown };
  const call = async (check: MemberCheck, url: string, authorization?: string) => {
    const handler = vi.fn(async (_req: ApiRequest, res: ApiResponse) => {
      res.status(200).json({ ok: true });
    });
    const sent: Sent = { status: 200, headers: {}, body: undefined };
    const res: ApiResponse = {
      status(code) {
        sent.status = code;
        return res;
      },
      setHeader(name, value) {
        sent.headers[name] = value;
      },
      json(body) {
        sent.body = body;
      },
      end() {},
    };
    await membersOnly(handler, check)(
      { method: "GET", url, headers: authorization ? { authorization } : {} },
      res
    );
    return { handler, sent };
  };
  const answers =
    (verdict: Awaited<ReturnType<MemberCheck>>): MemberCheck =>
    async () =>
      verdict;

  it("lets a member through to the handler, and the owner", async () => {
    for (const verdict of ["member", "owner"] as const) {
      const { handler, sent } = await call(answers(verdict), "/api/gc-team?id=x", "Bearer t");
      expect(handler).toHaveBeenCalledTimes(1);
      expect(sent.status).toBe(200);
    }
  });

  it("tells a browser with no sign-in to sign in, and an account not on the list to ask", async () => {
    const out = await call(answers("signed-out"), "/api/gc-team?ids=a,b");
    expect(out.handler).not.toHaveBeenCalled();
    expect(out.sent).toMatchObject({
      status: 401,
      headers: { "cache-control": "no-store" },
      body: { ok: false, reason: "members-only", status: 401 },
    });
    expect((out.sent.body as { message: string }).message).toMatch(/Sign in with one/);

    const stranger = await call(answers("not-member"), "/api/gc-team?id=x", "Bearer t");
    expect(stranger.handler).not.toHaveBeenCalled();
    expect(stranger.sent).toMatchObject({
      status: 403,
      body: { ok: false, reason: "members-only", status: 403 },
    });
    expect((stranger.sent.body as { message: string }).message).toMatch(/Ask the list's owner/);
  });

  it("says the list could not be asked, rather than that the caller is not on it", async () => {
    const { handler, sent } = await call(answers("unavailable"), "/api/gc-team?id=x", "Bearer t");
    expect(handler).not.toHaveBeenCalled();
    expect(sent).toMatchObject({ status: 503, body: { ok: false, reason: "upstream-error" } });
  });

  it("leaves the probe open, which touches nothing upstream", async () => {
    const refusing = vi.fn(answers("signed-out"));
    const { handler } = await call(refusing, "/api/gc-team?probe=1");
    expect(handler).toHaveBeenCalledTimes(1);
    expect(refusing).not.toHaveBeenCalled();
  });
});
