import { describe, expect, it } from "vitest";
import { rebuildJobControl, REBUILD_JOB_LEASE_MS } from "../rebuildJobControl";
import type { RebuildTask } from "../rebuildPlan";

const TASK: RebuildTask = {
  copy: "copy",
  kind: "edit",
  window: 1,
  savedAt: "2026-10-13T12:00:00Z",
};
const setup = () => {
  let now = Date.parse(TASK.savedAt);
  let version = 0;
  let fields: Record<string, unknown> | null = null;
  const docs = {
    readAt: async () =>
      fields ? { fields: structuredClone(fields), token: String(version) } : null,
    replace: async (_path: string, next: Record<string, unknown>, token: string | null) => {
      if (token !== (fields ? String(version) : null)) return false;
      fields = structuredClone(next);
      version++;
      return true;
    },
  };
  return {
    control: rebuildJobControl(docs, () => now),
    advance: (ms: number) => {
      now += ms;
    },
  };
};
describe("one durable rebuild for arriving saves", () => {
  it("launches once while queued, coalesces new saves during a run, and never loses a finishing request", async () => {
    const { control } = setup();
    expect(await control.request(TASK)).toBe(true);
    expect(await control.request(TASK)).toBe(false);
    const running = await control.claim("worker");
    expect(running!.generation).toBe(2);
    expect(await control.claim("duplicate")).toBeNull();
    await control.request({ ...TASK, window: 2 });
    expect(await control.complete("worker", running!.generation)).toBe(false);
    expect(await control.renew("worker", "Including the new save")).toBe(true);
    const latest = await control.read();
    expect(latest.generation).toBe(3);
    expect(await control.complete("worker", latest.generation)).toBe(true);
    expect(await control.request({ ...TASK, window: 3 })).toBe(true);
  });
  it("recovers an expired execution lease and rejects updates from its predecessor", async () => {
    const { control, advance } = setup();
    await control.request(TASK);
    await control.claim("old");
    advance(REBUILD_JOB_LEASE_MS + 1);
    expect((await control.claim("new"))!.owner).toBe("new");
    expect(await control.renew("old")).toBe(false);
    expect(await control.complete("old", 1)).toBe(false);
    expect(await control.release("old")).toBe(false);
  });
  it("keeps new requests pending while budget is deferred and accepts them once budget returns", async () => {
    const { control, advance } = setup();
    await control.request(TASK);
    await control.claim("worker");
    const until = new Date(Date.parse(TASK.savedAt) + 3600000);
    expect(await control.defer("worker", until, "Waiting for daily budget")).toBe(true);
    expect(await control.request({ ...TASK, window: 2 })).toBe(false);
    expect(await control.claim("late duplicate")).toBeNull();
    advance(3600001);
    expect(await control.request(TASK)).toBe(true);
    expect((await control.claim("resumed"))!.generation).toBe(3);
  });
});
