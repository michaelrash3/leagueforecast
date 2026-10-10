import { describe, expect, it, vi } from "vitest";
import { FIREBASE_WEB_CONFIG } from "../../cloud/cloudConfig";
import {
  CALL_LIMIT_MS,
  callEdit,
  callQuery,
  callStartRefresh,
  callWarm,
  coerceEditReply,
  EDIT_URL,
  START_PULL_URL,
} from "../editClient";
import type { EditReply } from "../editHandle";
import { EDIT_TIMEOUT_S } from "../editWorkerProtocol";

/*
 * A device's call to the edit function (`editClient.ts`): the callable protocol over fetch, with the
 * member's sign-in, and nothing of the answer taken on trust.
 */

const COMMAND = { kind: "team.state", teamId: "B", state: "KY" } as const;

const MADE: EditReply = {
  ok: true,
  copy: "c0ffee01",
  version: 9,
  inverse: { kind: "team.put", team: { id: "B", name: "Club B" } },
  changed: ["league_forecast_scout_teams_v1"],
  ms: { load: 40, apply: 5, commit: 300 },
};

/** A stand-in for the function: the status and body it answers, and what it was sent. */
const answering = (status: number, body: unknown) => {
  const sent: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  });
  return { sent, fetchImpl: fetchImpl as unknown as typeof fetch };
};

const signedIn = { token: async () => "id-token" };

describe("a call to the edit function", () => {
  it("is the function's own address, waited on past its timeout", () => {
    expect(EDIT_URL).toBe(
      `https://us-central1-${FIREBASE_WEB_CONFIG.projectId}.cloudfunctions.net/edit`
    );
    expect(CALL_LIMIT_MS).toBeGreaterThan(EDIT_TIMEOUT_S * 1000);
  });

  it("posts the command and the copy with the member's sign-in, and hands back the edit made", async () => {
    const server = answering(200, { result: MADE });
    const called = await callEdit(
      { command: COMMAND, copy: "c0ffee01" },
      { ...signedIn, fetchImpl: server.fetchImpl, url: "https://functions.example/edit" }
    );
    expect(called).toEqual({ ok: true, value: MADE });
    expect(server.sent).toHaveLength(1);
    const [{ url, init }] = server.sent as [{ url: string; init: RequestInit }];
    expect(url).toBe("https://functions.example/edit");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer id-token",
    });
    expect(JSON.parse(String(init.body))).toEqual({ data: { command: COMMAND, copy: "c0ffee01" } });
  });

  it("hands back a refusal as the server's answer", async () => {
    const server = answering(200, { result: { ok: false, why: "missing" } });
    expect(
      await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: server.fetchImpl })
    ).toEqual({
      ok: true,
      value: { ok: false, why: "missing" },
    });
    expect(JSON.parse(String(server.sent[0]?.init.body))).toEqual({ data: { command: COMMAND } });
  });

  it("says who may not call, what the server could not read or check, and an edit it did not make", async () => {
    const cases: Array<[number, string, string]> = [
      [401, "UNAUTHENTICATED", "signed-out"],
      [403, "PERMISSION_DENIED", "not-member"],
      [400, "INVALID_ARGUMENT", "invalid"],
      [503, "UNAVAILABLE", "unavailable"],
      [409, "ABORTED", "failed"],
    ];
    for (const [status, code, why] of cases) {
      const server = answering(status, { error: { status: code, message: `said ${code}` } });
      expect(
        await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: server.fetchImpl })
      ).toEqual({
        ok: false,
        why,
        message: `said ${code}`,
      });
    }
  });

  /*
   * An edit is said not made only where the server said so. A failure that does not say may have
   * come after the save landed (a worker lost after its commit, the platform's own answer), and a
   * device told to try again would make the edit twice, or find an Undo that undoes nothing.
   */
  it("says an edit may or may not have been made for any answer that does not prove it was not", async () => {
    const proveNothing: Array<[number, unknown, string]> = [
      [500, { error: { status: "INTERNAL", message: "INTERNAL" } }, "INTERNAL"],
      [500, { error: { status: "UNKNOWN", message: "said UNKNOWN" } }, "said UNKNOWN"],
      [429, { error: { status: "RESOURCE_EXHAUSTED", message: "busy" } }, "busy"],
      [503, { error: { status: "SOMETHING_NEW" } }, "The server answered HTTP 503."],
      [502, null, "The server answered HTTP 502."],
      [400, { error: { status: "constructor" } }, "The server answered HTTP 400."],
    ];
    for (const [status, body, message] of proveNothing) {
      const server = answering(status, body);
      expect([
        status,
        await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: server.fetchImpl }),
      ]).toEqual([status, { ok: false, why: "unanswered", message }]);
    }
    // The platform's own answer to a call it timed out, which is no callable's.
    const timedOut = vi.fn(
      async () => new Response("upstream request timeout", { status: 504 })
    ) as unknown as typeof fetch;
    expect(await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: timedOut })).toEqual({
      ok: false,
      why: "unanswered",
      message: "The server answered HTTP 504.",
    });
  });

  it("says no answer came when an answer that began well is cut off", async () => {
    const cut = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(new TypeError("terminated")),
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch;
    expect(await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: cut })).toEqual({
      ok: false,
      why: "unanswered",
      message: "No answer came from the server, so the change may or may not have been made.",
    });
  });

  it("asks nothing without a sign-in, or when the sign-in cannot be had just now", async () => {
    const server = answering(200, { result: MADE });
    expect(
      await callEdit({ command: COMMAND }, { token: async () => null, fetchImpl: server.fetchImpl })
    ).toMatchObject({ ok: false, why: "signed-out" });
    const offline = async (): Promise<string | null> => {
      throw new Error("Firebase: Error (auth/network-request-failed).");
    };
    expect(
      await callEdit({ command: COMMAND }, { token: offline, fetchImpl: server.fetchImpl })
    ).toMatchObject({ ok: false, why: "unavailable" });
    expect(server.sent).toHaveLength(0);
  });

  it("says no answer came, rather than that the edit failed, when the request did not come back", async () => {
    const lost = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect(await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: lost })).toMatchObject({
      ok: false,
      why: "unanswered",
    });
    // A call left waiting past its limit is ended the same way.
    const hung = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted")))
        )
    ) as unknown as typeof fetch;
    expect(
      await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: hung, limitMs: 5 })
    ).toMatchObject({ ok: false, why: "unanswered" });
  });

  it("reads no answer this build does not know as one, an inverse that is not exactly a command least of all", async () => {
    const broken: unknown[] = [
      null,
      { ...MADE, version: "9" },
      { ...MADE, version: 9.5 },
      { ...MADE, inverse: { kind: "team.put", team: { id: "B", name: "Club B", extra: 1 } } },
      { ...MADE, inverse: { kind: "nope" } },
      { ...MADE, changed: [1] },
      { ...MADE, copy: 5 },
      { ...MADE, ms: { load: Number.NaN, apply: 0, commit: 0 } },
      { ...MADE, ms: { load: 1, apply: 0 } },
      { ok: false, why: "toString" },
      { ok: false, why: "gone" },
      // The caps refuse a question that refits, never an edit.
      { ok: false, why: "day-spent" },
      { ok: "true" },
    ];
    for (const result of broken) expect([result, coerceEditReply(result)]).toEqual([result, null]);
    // The server did answer, and may have made the edit: this build just cannot tell.
    const server = answering(200, { result: { ...MADE, version: -1 } });
    expect(
      await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: server.fetchImpl })
    ).toMatchObject({
      ok: false,
      why: "unanswered",
    });
  });

  it("takes a made edit whose timings a server's clock stepped back for, as none", async () => {
    const server = answering(200, { result: { ...MADE, ms: { load: -2, apply: 5, commit: 300 } } });
    expect(
      await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: server.fetchImpl })
    ).toEqual({ ok: true, value: { ...MADE, ms: { load: 0, apply: 5, commit: 300 } } });
  });
});

describe("a warm-up call", () => {
  it("asks the server to bring its pool up, and reads back how", async () => {
    const server = answering(200, {
      result: { warmed: { ok: true, cold: true, fetched: 30, loadMs: 4_000 } },
    });
    expect(await callWarm({ ...signedIn, fetchImpl: server.fetchImpl })).toEqual({
      ok: true,
      value: { ok: true, cold: true, fetched: 30, loadMs: 4_000 },
    });
    expect(JSON.parse(String(server.sent[0]?.init.body))).toEqual({ data: { warm: true } });
    const refused = answering(200, { result: { warmed: { ok: false, reason: "no-copy" } } });
    expect(await callWarm({ ...signedIn, fetchImpl: refused.fetchImpl })).toEqual({
      ok: true,
      value: { ok: false, reason: "no-copy" },
    });
    // A reason only an edit has is not one a warm-up gives, and nothing rides on a warm-up, so
    // any answer that is not one is a failure.
    const odd = answering(200, { result: { warmed: { ok: false, reason: "missing" } } });
    expect(await callWarm({ ...signedIn, fetchImpl: odd.fetchImpl })).toMatchObject({
      ok: false,
      why: "failed",
    });
    const internal = answering(500, { error: { status: "INTERNAL", message: "INTERNAL" } });
    expect(await callWarm({ ...signedIn, fetchImpl: internal.fetchImpl })).toMatchObject({
      ok: false,
      why: "failed",
    });
  });
});

describe("a question", () => {
  const QUESTION = { kind: "rename.preview", teamId: "A", name: "Club B" } as const;
  const ANSWER = {
    kind: "rename.preview",
    name: "Club B",
    into: { id: "B", name: "Club B" },
    games: 4,
    dropped: 2,
  } as const;

  it("posts the question and the copy with the member's sign-in, and hands back its answer", async () => {
    const server = answering(200, {
      result: { ok: true, copy: "c0ffee01", version: 9, answer: ANSWER },
    });
    expect(
      await callQuery(
        { query: QUESTION, copy: "c0ffee01" },
        { ...signedIn, fetchImpl: server.fetchImpl }
      )
    ).toEqual({ ok: true, value: { ok: true, copy: "c0ffee01", version: 9, answer: ANSWER } });
    expect(JSON.parse(String(server.sent[0]?.init.body))).toEqual({
      data: { query: QUESTION, copy: "c0ffee01" },
    });
    for (const why of ["copy-replaced", "day-spent", "month-spent"]) {
      const refused = answering(200, { result: { ok: false, why } });
      expect(
        await callQuery({ query: QUESTION }, { ...signedIn, fetchImpl: refused.fetchImpl })
      ).toEqual({ ok: true, value: { ok: false, why } });
    }
  });

  it("takes no answer to another question, or a refusal only an edit gives, and nothing unclear as more than a failure", async () => {
    for (const result of [
      { ok: true, copy: "c0ffee01", version: 9, answer: { ...ANSWER, kind: "merge.preview" } },
      { ok: true, copy: "c0ffee01", version: 9.5, answer: ANSWER },
      { ok: true, version: 9, answer: ANSWER },
      { ok: false, why: "missing" },
      { ok: false, why: "unsure" },
    ]) {
      const server = answering(200, { result });
      expect(
        await callQuery({ query: QUESTION }, { ...signedIn, fetchImpl: server.fetchImpl })
      ).toMatchObject({ ok: false, why: "failed" });
    }
    // A question changes nothing, so a server that failed in a way that does not say, or an
    // answer that never came, is a question to ask again.
    const internal = answering(500, { error: { status: "INTERNAL", message: "INTERNAL" } });
    expect(
      await callQuery({ query: QUESTION }, { ...signedIn, fetchImpl: internal.fetchImpl })
    ).toMatchObject({ ok: false, why: "failed" });
    const lost = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(
      await callQuery(
        { query: QUESTION },
        { ...signedIn, fetchImpl: lost as unknown as typeof fetch }
      )
    ).toEqual({ ok: false, why: "failed", message: "No answer came from the server." });
  });
});

describe("asking for Refresh now", () => {
  const ASK = { timeZone: "America/Chicago", device: "device-abc-123" };
  const JOB = "0123456789abcdef0123456789abcdef";

  it("posts the asking to startPull with the member's sign-in, and hands back the job to watch", async () => {
    expect(START_PULL_URL).toBe(
      `https://us-central1-${FIREBASE_WEB_CONFIG.projectId}.cloudfunctions.net/startPull`
    );
    const server = answering(200, { result: { status: "queued", jobId: JOB, already: false } });
    expect(await callStartRefresh(ASK, { ...signedIn, fetchImpl: server.fetchImpl })).toEqual({
      ok: true,
      value: { status: "queued", jobId: JOB, already: false },
    });
    const [{ url, init }] = server.sent as [{ url: string; init: RequestInit }];
    expect(url).toBe(START_PULL_URL);
    expect(JSON.parse(String(init.body))).toEqual({ data: { refresh: ASK } });
  });

  it("says the server's refusals as refusals, each proving no refresh was started", async () => {
    for (const [status, code] of [
      [400, "FAILED_PRECONDITION"],
      [429, "RESOURCE_EXHAUSTED"],
      [409, "ABORTED"],
    ] as const) {
      const server = answering(status, { error: { status: code, message: `said ${code}` } });
      expect(await callStartRefresh(ASK, { ...signedIn, fetchImpl: server.fetchImpl })).toEqual({
        ok: false,
        why: "failed",
        message: `said ${code}`,
      });
    }
    // An edit's call reads the platform's own RESOURCE_EXHAUSTED as proving nothing still.
    const busy = answering(429, { error: { status: "RESOURCE_EXHAUSTED", message: "busy" } });
    expect(
      await callEdit({ command: COMMAND }, { ...signedIn, fetchImpl: busy.fetchImpl })
    ).toEqual({
      ok: false,
      why: "unanswered",
      message: "busy",
    });
  });

  it("takes no answer that does not name the job exactly, which may have started all the same", async () => {
    for (const result of [
      { status: "queued", already: false },
      { status: "queued", jobId: "../copies/main", already: false },
      { status: "queued", jobId: JOB },
      { jobId: JOB, already: true },
    ]) {
      const server = answering(200, { result });
      expect(
        await callStartRefresh(ASK, { ...signedIn, fetchImpl: server.fetchImpl })
      ).toMatchObject({ ok: false, why: "unanswered" });
    }
  });
});
