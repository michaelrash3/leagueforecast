import { expect, it } from "vitest";
import { importBeat, importLease, IMPORT_LEASE_MS, IMPORT_STALL_MS } from "../importLease";

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
