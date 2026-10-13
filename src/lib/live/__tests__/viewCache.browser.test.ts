import { afterEach, expect, it, vi } from "vitest";
import { hashJson, packHashed } from "../../cloud/cloudPack";
import { openViewCache } from "../viewCache";
import { isPoolStoreOpen } from "../../teamRankingsStorage";

const held = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../idb", () => ({
  idbAvailable: () => true,
  idbKeys: async () => [...held.keys()],
  idbGet: async (key: string) => held.get(key) ?? null,
  idbSet: async (key: string, value: unknown) => {
    held.set(key, value);
    return true;
  },
  idbDelete: async (key: string) => {
    held.delete(key);
  },
}));
vi.mock("../../teamRankingsStorage", () => ({ isPoolStoreOpen: vi.fn(() => false) }));
afterEach(() => {
  held.clear();
  vi.clearAllMocks();
});

it("persists and reopens a live view while the browser pool stays closed in cloud mode", async () => {
  const cache = openViewCache();
  const hashed = await hashJson({ rows: ["cached team"] });
  const pieces = await packHashed(hashed);
  await cache.keepView(hashed.hash, pieces[0]!);
  await cache.keepMeta("member", { version: 3 }, "2026-10-13T04:00:00Z");
  const reopened = openViewCache();
  expect(await reopened.view(hashed.hash)).toEqual({ rows: ["cached team"] });
  expect(await reopened.meta("member")).toMatchObject({ meta: { version: 3 } });
  expect(isPoolStoreOpen).not.toHaveBeenCalled();
});
