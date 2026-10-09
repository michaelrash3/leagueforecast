import { describe, expect, it, vi } from "vitest";
import { EDIT_REFUSED } from "../../live/liveEdits";
import {
  NO_LONGER_KEPT,
  restoreBackupOnServer,
  restoreOnServer,
  UPLOAD_GONE,
  UPLOAD_UNREADABLE,
} from "../serverRestore";

/*
 * The Cloud panel's Bring back asked of the server (`serverRestore.ts`): the edit function's
 * `copy.restore` posted with the member's sign-in, and its answer said in words a person can act
 * on. The function is a stand-in that answers as the callable protocol does.
 */

const answering = (status: number, body: unknown) => {
  const sent: unknown[] = [];
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body ?? "null")));
    return new Response(JSON.stringify(body), { status });
  });
  return {
    sent,
    deps: { token: async () => "id-token", fetchImpl: fetchImpl as unknown as typeof fetch },
  };
};

const MADE = {
  ok: true,
  copy: "copy-1",
  version: 8,
  inverse: { kind: "none" },
  changed: ["league_forecast_scout_teams_v1"],
  ms: { load: 40, apply: 5, commit: 300 },
};

describe("an earlier version brought back by the server", () => {
  it("asks for the version on the copy it was seen in, and says it was brought back", async () => {
    const server = answering(200, { result: MADE });
    expect(await restoreOnServer("g1", "copy-1", server.deps)).toEqual({ ok: true });
    expect(server.sent).toEqual([
      { data: { command: { kind: "copy.restore", group: "g1" }, copy: "copy-1" } },
    ]);
  });

  it("says a version gone meanwhile is no longer kept, and any other refusal as an edit's", async () => {
    const gone = answering(200, { result: { ok: false, why: "missing" } });
    expect(await restoreOnServer("g1", "copy-1", gone.deps)).toEqual({
      ok: false,
      message: NO_LONGER_KEPT,
    });
    const live = answering(200, { result: { ok: false, why: "league-kept-live" } });
    expect(await restoreOnServer("g1", "copy-1", live.deps)).toEqual({
      ok: false,
      message: EDIT_REFUSED["league-kept-live"],
    });
  });

  it("passes on what the call says when the server turns the caller away", async () => {
    const owner = "Only the cloud copy's owner can bring back an earlier version.";
    const server = answering(403, { error: { status: "PERMISSION_DENIED", message: owner } });
    const answer = await restoreOnServer("g1", "copy-1", server.deps);
    expect(answer.ok).toBe(false);
    expect(answer.ok || answer.message).toContain("owner");
  });
});

describe("a backup restored by the server", () => {
  const UPLOAD = "0123456789abcdef0123456789abcdef";

  it("asks for the upload on the copy it was staged for, and says it was restored", async () => {
    const server = answering(200, { result: MADE });
    expect(await restoreBackupOnServer(UPLOAD, "copy-1", server.deps)).toEqual({ ok: true });
    expect(server.sent).toEqual([
      { data: { command: { kind: "backup.restore", upload: UPLOAD }, copy: "copy-1" } },
    ]);
  });

  it("says an upload not whole, or not a backup, in words of its own", async () => {
    for (const [why, message] of [
      ["missing", UPLOAD_GONE],
      ["refused", UPLOAD_UNREADABLE],
      ["kept-moving", EDIT_REFUSED["kept-moving"]],
    ] as const) {
      const server = answering(200, { result: { ok: false, why } });
      expect(await restoreBackupOnServer(UPLOAD, "copy-1", server.deps)).toEqual({
        ok: false,
        message,
      });
    }
  });
});
