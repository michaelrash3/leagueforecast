import { describe, expect, it, vi } from "vitest";
import { memoryCloud } from "../../cloud/__tests__/memoryCloud";
import { commitChanges } from "../../cloud/cloudEngine";
import { builtFrom, BOARD_FAMILY } from "../boardInputs";
import { NO_LEAGUE_DOCS } from "../cloudLeague";
import { rebuildJobControl } from "../rebuildJobControl";
import { requestRebuildJob } from "../rebuildJobLaunch";
import { publishViews } from "../viewStore";
import { memoryLive } from "./memoryLive";

const DAY = "2026-10-13";
const AT = "2026-10-13T17:00:00Z";
const task = { copy: "copy", kind: "edit" as const, window: 1, savedAt: AT };
const setup = async () => {
  const cloud = memoryCloud();
  const saved = await commitChanges({
    store: cloud.store,
    base: null,
    changes: [{ key: "league_forecast_scout_teams_v1", value: [], at: 1 }],
    device: "test",
    now: AT,
  });
  if (!saved.ok) throw new Error("seed");
  const live = memoryLive();
  const values = new Map<string, Record<string, unknown>>([["ops/rebuild", { on: true }]]);
  let version = 1;
  const docs = {
    readAt: async (path: string) =>
      values.has(path) ? { fields: values.get(path)!, token: String(version) } : null,
    replace: async (path: string, fields: Record<string, unknown>, token: string | null) => {
      if (token !== (values.has(path) ? String(version) : null)) return false;
      version++;
      values.set(path, fields);
      return true;
    },
  };
  const deps = {
    docs,
    copyStore: cloud.store,
    liveStore: live.store,
    leagueDocs: NO_LEAGUE_DOCS,
    launch: vi.fn(async () => {}),
    enqueue: vi.fn(async () => {}),
    now: () => Date.parse(AT),
    today: () => DAY,
  };
  return {
    deps,
    live,
    values,
    manifest: saved.manifest,
    control: rebuildJobControl(docs, deps.now),
  };
};
describe("cheap ranking rebuild requests", () => {
  it("starts a stale copy once and coalesces pending requests before the job starts", async () => {
    const test = await setup();
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "launched" });
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "joined" });
    expect(test.deps.launch).toHaveBeenCalledTimes(1);
  });
  it("starts no job when published rankings already match the latest copy", async () => {
    const test = await setup();
    await publishViews({
      store: test.live.store,
      views: [],
      owns: [BOARD_FAMILY],
      copy: { id: test.manifest.copy, version: test.manifest.version },
      today: DAY,
      now: AT,
      built: { family: BOARD_FAMILY, from: await builtFrom(test.manifest, DAY) },
    });
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "current" });
    expect(test.deps.launch).not.toHaveBeenCalled();
  });
  it("joins a running job before doing source reads and respects a switched-off ledger", async () => {
    const test = await setup();
    await test.control.request(task);
    await test.control.claim("active");
    const read = vi.spyOn(test.deps.copyStore, "readManifest");
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "joined" });
    expect(read).not.toHaveBeenCalled();
    test.values.set("ops/rebuild", { on: false });
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "off" });
    expect(test.deps.launch).not.toHaveBeenCalled();
  });
  it("spaces quick edits and reconnects deferred work without starting a premature job", async () => {
    const test = await setup();
    test.values.set("ops/rebuild", { on: true, lastEndedAt: AT });
    const quick = { ...task, kind: "live" as const };
    expect(await requestRebuildJob(quick, test.deps)).toMatchObject({ end: "spaced" });
    expect(test.deps.enqueue).toHaveBeenCalledTimes(1);
    await test.control.request(task);
    await test.control.claim("worker");
    // The day's budget spent, which the deferral waits on.
    test.values.set("ops/rebuild", { on: true, lastEndedAt: AT, day: DAY, dayGiBs: 10_000 });
    await test.control.defer("worker", new Date("2026-10-14T04:01:00Z"), "Daily budget");
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "joined" });
    expect(test.deps.enqueue).toHaveBeenCalledTimes(2);
    expect(test.deps.launch).not.toHaveBeenCalled();
  });
  it("lifts a deferral once its budget has room again, the owner having raised the cap", async () => {
    const test = await setup();
    // October 2026 as it stood: the month's vCPU-seconds past their cap, the job waiting for 1 Nov.
    const spent = { on: true, month: "2026-10", monthGiBs: 113_924, monthVcpuS: 49_530 };
    test.values.set("ops/rebuild", spent);
    await test.control.request(task);
    await test.control.claim("worker");
    await test.control.defer("worker", new Date("2026-11-01T04:01:00Z"), "Waiting for month-cap");
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "joined" });
    expect(test.deps.launch).not.toHaveBeenCalled();
    test.values.set("ops/rebuild", { ...spent, caps: { monthGiBs: 250_000, monthVcpuS: 125_000 } });
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "launched" });
    expect(test.deps.launch).toHaveBeenCalledTimes(1);
    expect((await test.control.read()).deferredUntil).toBe("");
  });
  it("keeps a deferral while a run is still going", async () => {
    const test = await setup();
    await test.control.request(task);
    await test.control.claim("worker");
    await test.control.defer("worker", new Date("2026-10-13T17:05:00Z"), "Waiting for busy");
    test.values.set("ops/rebuild", {
      on: true,
      open: {
        at: "2026-10-13T16:59:00Z",
        day: DAY,
        cost: { gibs: 2_560, vcpuS: 640 },
        until: "2026-10-13T17:59:00Z",
      },
    });
    expect(await requestRebuildJob(task, test.deps)).toEqual({ end: "joined" });
    expect(test.deps.launch).not.toHaveBeenCalled();
  });
});
