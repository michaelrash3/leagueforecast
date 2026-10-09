import { afterEach, describe, expect, it, vi } from "vitest";
import { resetTeamRankingsStore } from "../lib/teamRankingsStorage";
import type { BackupAnswer } from "./backupProtocol";

/** Node's own, where the worker's realm is stood in for: the app's types know no `process`. */
declare const process: {
  on: (event: "unhandledRejection", listener: (reason: unknown) => void) => void;
  off: (event: "unhandledRejection", listener: (reason: unknown) => void) => void;
};

/*
 * The backup worker's port itself (`backup.worker.ts`), which the protocol's tests do not reach: an
 * answer the browser cannot post, such as one too large to clone on a phone, is said as a failure,
 * so the page that waits on it is answered rather than left waiting with nothing ever coming.
 */

describe("the backup worker's port", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTeamRankingsStore();
  });

  it("says it failed when its answer cannot be posted", async () => {
    const posted: BackupAnswer[] = [];
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const scope: {
      onmessage: ((event: { data: unknown }) => void) | null;
      postMessage: (answer: BackupAnswer) => void;
    } = {
      onmessage: null,
      postMessage: (answer) => {
        if (answer.ok)
          throw new DOMException("Data cannot be cloned, out of memory.", "DataCloneError");
        posted.push(answer);
      },
    };
    vi.stubGlobal("self", scope);
    await import("./backup.worker");
    scope.onmessage?.({ data: { parts: [], want: "csv", savedAt: "2027-04-15T07:20:00.000Z" } });
    await vi.waitFor(() => expect(posted).toEqual([{ ok: false, why: "failed" }]));
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
    expect(posted).toEqual([{ ok: false, why: "failed" }]);
  });
});
