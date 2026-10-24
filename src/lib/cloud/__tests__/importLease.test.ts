import { afterEach, expect, it, vi } from "vitest";
import {
  importBeat,
  importHeard,
  importLease,
  importStopsNow,
  importTryStatus,
  IMPORT_LEASE_MS,
  IMPORT_STALL_MS,
  type ImportWatch,
  watchLease,
} from "../importLease";

it("admits one execution, renews ownership, and allows takeover only after expiry or release", async () => {
  let value: { fields: Record<string, unknown>; token: string } | null = null;
  let revision = 0;
  const docs = {
    readAt: async () => (value ? structuredClone(value) : null),
    replace: async (_: string, fields: Record<string, unknown>, token: string | null) => {
      if (token !== (value?.token ?? null)) return false;
      value = { fields, token: String(++revision) };
      return true;
    },
  };
  const first = importLease(docs, "job", "first");
  const second = importLease(docs, "job", "second");
  const simultaneous = await Promise.all([first.claim(1000), second.claim(1000)]);
  expect(simultaneous).toEqual([true, false]);
  expect(await first.renew(2000)).toBe(true);
  expect(await second.claim(1000 + IMPORT_LEASE_MS)).toBe(false);
  expect(await second.claim(2001 + IMPORT_LEASE_MS)).toBe(true);
  expect(await first.renew(2002 + IMPORT_LEASE_MS)).toBe(false);
  await first.release();
  expect(await second.renew(2003 + IMPORT_LEASE_MS)).toBe(true);
  await second.release();
  expect(await first.claim(2004 + IMPORT_LEASE_MS)).toBe(true);
});

it("ends a try whose worker has said nothing for half an hour, and renews one that speaks", () => {
  const start = Date.parse("2026-10-17T05:00:00.000Z");
  // A beat every ten seconds renews the lease; the worker spoke a moment ago.
  expect(importBeat({ now: start + 10_000, renewedAt: start, heardAt: start + 5_000 })).toBe(
    "renew"
  );
  // Quiet for a minute short of the limit, as a long save might be: still renewed.
  const quiet = start + IMPORT_STALL_MS - 60_000;
  expect(importBeat({ now: quiet, renewedAt: quiet - 10_000, heardAt: start })).toBe("renew");
  // Quiet for the limit, with the lease renewed all along: stuck, and ended.
  const stuck = start + IMPORT_STALL_MS;
  expect(importBeat({ now: stuck, renewedAt: stuck - 10_000, heardAt: start })).toBe("stalled");
  // A word just now puts it back to renewing.
  expect(importBeat({ now: stuck, renewedAt: stuck - 10_000, heardAt: stuck - 1 })).toBe("renew");
});

it("gives a try up as out of contact before its lease could lapse, first of all", () => {
  const start = Date.parse("2026-10-17T05:00:00.000Z");
  const late = start + IMPORT_LEASE_MS - 20_000;
  expect(importBeat({ now: late - 1, renewedAt: start, heardAt: late - 1 })).toBe("renew");
  expect(importBeat({ now: late, renewedAt: start, heardAt: late })).toBe("lost-contact");
  // Both at once: the lease's, which another execution could take over.
  expect(importBeat({ now: late + IMPORT_STALL_MS, renewedAt: start, heardAt: start })).toBe(
    "lost-contact"
  );
});

it("counts every message from the worker as a word, a bare progress among them", () => {
  const start = Date.parse("2026-10-17T05:00:00.000Z");
  let watch: ImportWatch = { heardAt: start, latestDetail: null };
  // Most of what the worker says is a bare progress: every stage written, every checkpoint.
  watch = importHeard(watch, { progress: true }, start + IMPORT_STALL_MS - 1);
  expect(watch).toEqual({ heardAt: start + IMPORT_STALL_MS - 1, latestDetail: null });
  const at = start + IMPORT_STALL_MS;
  expect(importBeat({ now: at, renewedAt: at - 10_000, heardAt: watch.heardAt })).toBe("renew");
  // One with a detail gives the beat its line to write, which a bare one after it leaves.
  watch = importHeard(watch, { progress: true, detail: "Final tidy, pass 2" }, at);
  watch = importHeard(watch, { progress: true }, at + 1);
  expect(watch).toEqual({
    heardAt: at + 1,
    latestDetail: { detail: "Final tidy, pass 2", progressAt: new Date(at).toISOString() },
  });
});

it("carries out a stop only while the import runs and is not saving", () => {
  const job = { stopAsked: true, stage: "fetching" as const, status: "running" as const };
  expect(importStopsNow(job)).toBe(true);
  expect(importStopsNow({ ...job, stopAsked: false })).toBe(false);
  // The save finishes first.
  expect(importStopsNow({ ...job, stage: "saving" })).toBe(false);
  // Asked during the save and the import since finished: it stays finished, its downloads gone
  // as a finished import's are, rather than written over as stopped with nothing to resume from.
  expect(importStopsNow({ ...job, stage: "waiting", status: "done" })).toBe(false);
  expect(importStopsNow({ ...job, stage: "waiting", status: "failed" })).toBe(false);
  expect(importStopsNow({ ...job, stage: "waiting", status: "cancelled" })).toBe(false);
  expect(importStopsNow(null)).toBe(false);
});

it("leaves a try that failed stopped where a stop was asked, and failed only on the last", () => {
  expect(importTryStatus({ last: false, stopAsked: false })).toBeNull();
  expect(importTryStatus({ last: true, stopAsked: false })).toBe("failed");
  expect(importTryStatus({ last: true, stopAsked: true })).toBe("cancelled");
  expect(importTryStatus({ last: false, stopAsked: true })).toBe("cancelled");
});

afterEach(() => {
  vi.useRealTimers();
});

/** A lease whose renewals answer `answers` in turn, then the last of them again. */
const renewing = (answers: Array<boolean | Error>) => {
  let asked = 0;
  return {
    asked: () => asked,
    renew: async () => {
      const answer = answers[Math.min(asked, answers.length - 1)];
      asked += 1;
      if (answer instanceof Error) throw answer;
      return answer ?? true;
    },
  };
};

it("keeps a leg's lease renewed, and says nothing while it stands", async () => {
  vi.useFakeTimers();
  const lease = renewing([true]);
  const lost: string[] = [];
  const stop = watchLease(lease, (why) => lost.push(why));
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(lost).toEqual([]);
  expect(lease.asked()).toBe(60);
  stop();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(lease.asked()).toBe(60);
});

it("says the lease is lost once another execution holds it, and only once", async () => {
  vi.useFakeTimers();
  const lease = renewing([true, false]);
  const lost: string[] = [];
  watchLease(lease, (why) => lost.push(why));
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(lost).toEqual(["taken"]);
  expect(lease.asked()).toBe(2);
});

it("says so before the lease could lapse while renewals fail", async () => {
  vi.useFakeTimers();
  const lease = renewing([new Error("Firestore is unreachable")]);
  const lost: Array<{ why: string; at: number }> = [];
  const started = Date.now();
  watchLease(lease, (why) => lost.push({ why, at: Date.now() - started }));
  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(lost).toHaveLength(1);
  expect(lost[0]?.why).toBe("lost-contact");
  // Inside the lease's own life, so no other execution could have taken it yet.
  expect(lost[0]?.at).toBeLessThan(IMPORT_LEASE_MS);
});
