import { expect, it } from "vitest";
import { importLease, IMPORT_LEASE_MS } from "../importLease";

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
