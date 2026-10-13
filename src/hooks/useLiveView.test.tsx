import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { hashJson, packHashed } from "../lib/cloud/cloudPack";
import { LIVE_FORMAT, LIVE_SCHEMA, type LiveMeta } from "../lib/live/viewStore";
import { openViewCache } from "../lib/live/viewCache";
import { useLiveView } from "./useLiveView";

it("draws saved data while the replacement downloads and keeps it through a connection failure", async () => {
  const saved = new Map<string, unknown>();
  const cache = openViewCache({
    enabled: () => true,
    keys: async () => [...saved.keys()],
    get: async (key) => saved.get(key) ?? null,
    set: async (key, value) => {
      saved.set(key, value);
      return true;
    },
    remove: async (key) => {
      saved.delete(key);
    },
    now: () => 1,
  });
  const hashed = await hashJson({ teams: 12 });
  const pieces = await packHashed(hashed);
  await cache.keepView(hashed.hash, pieces[0]!, { key: "games:test", copy: "copy-a" });
  const meta: LiveMeta = {
    format: LIVE_FORMAT,
    schema: LIVE_SCHEMA,
    copy: { id: "copy-a", version: 2 },
    builtAt: "2026-10-13",
    today: "2026-10-13",
    views: { "games:test": { h: "f".repeat(64), id: "new-data", c: 1, b: 100, k: "copy-a", v: 2 } },
    retired: [],
    inline: {},
    built: {},
    marks: { "copy-a": 2 },
  };
  let reject: ((reason: unknown) => void) | undefined;
  const source = {
    meta,
    cache,
    settled: true,
    refused: () => undefined,
    reader: {
      readMeta: async () => meta,
      getChunk: () =>
        new Promise<Uint8Array>((_, fail) => {
          reject = fail;
        }),
    },
  };
  const coerce = (value: unknown) =>
    value && typeof value === "object" && "teams" in value ? (value as { teams: number }) : null;
  const memory = new Map<string, { teams: number }>();
  const { result } = renderHook(() => useLiveView(source, "games:test", coerce, memory));
  await waitFor(() => expect(result.current.view).toEqual({ teams: 12 }));
  expect(result.current.failed).toBe(false);
  await waitFor(() => expect(reject).toBeTypeOf("function"));
  await act(async () => reject?.({ code: "unavailable" }));
  expect(result.current.view).toEqual({ teams: 12 });
  expect(result.current.failed).toBe(false);
  expect(await cache.previous?.("games:test", "copy-b")).toBeNull();
});
