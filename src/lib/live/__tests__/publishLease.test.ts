import { describe, expect, it } from "vitest";
import { LAUNCH_HOLD_MS, PUBLISH_HOLD_MS, PUBLISH_LEASE_PATH, publishLease } from "../publishLease";

/*
 * Who is publishing the boards after a save (`publishLease.ts`): one launch at a time, taken over
 * by the job it starts, and let go when the job ends, or lapsing where nobody lets it go.
 */

const memoryDocs = () => {
  let value: { fields: Record<string, unknown>; token: string } | null = null;
  let revision = 0;
  const paths: string[] = [];
  return {
    docs: {
      readAt: async (path: string) => {
        paths.push(path);
        return value ? structuredClone(value) : null;
      },
      replace: async (path: string, fields: Record<string, unknown>, token: string | null) => {
        paths.push(path);
        if (token !== (value?.token ?? null)) return false;
        value = { fields, token: String(++revision) };
        return true;
      },
    },
    held: () => value?.fields ?? null,
    paths,
  };
};

const T = 1_000_000;

describe("the boards' publish lease", () => {
  it("lets one of two launchers at once start the job, and tells the other until when", async () => {
    const { docs, paths } = memoryDocs();
    const lease = publishLease(docs);
    const [a, b] = await Promise.all([lease.launch(T), lease.launch(T)]);
    expect([a, b]).toEqual([{ ok: true }, { ok: false, until: T + LAUNCH_HOLD_MS }]);
    expect(await lease.launch(T + 60_000)).toEqual({ ok: false, until: T + LAUNCH_HOLD_MS });
    expect(new Set(paths)).toEqual(new Set([PUBLISH_LEASE_PATH]));
  });

  it("hands a launch over to the job it started, which holds it for its own time", async () => {
    const { docs, held } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T);
    expect(await lease.take(T + 30_000, "job-1")).toBe(true);
    expect(held()).toEqual({ owner: "job-1", until: T + 30_000 + PUBLISH_HOLD_MS });
    // A second job, or a launch, waits on a job that holds it.
    expect(await lease.take(T + 40_000, "job-2")).toBe(false);
    expect(await lease.launch(T + 40_000)).toEqual({
      ok: false,
      until: T + 30_000 + PUBLISH_HOLD_MS,
    });
  });

  it("is free again once the job lets it go, and only its own job lets it go", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.take(T, "job-1");
    await lease.release("job-2");
    expect(await lease.launch(T + 1)).toMatchObject({ ok: false });
    await lease.release("job-1");
    expect(await lease.launch(T + 2)).toEqual({ ok: true });
  });

  it("is let go by a launch that failed, but never from under a job", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T);
    await lease.unlaunch();
    expect(await lease.launch(T + 1)).toEqual({ ok: true });
    await lease.take(T + 2, "job-1");
    await lease.unlaunch();
    expect(await lease.launch(T + 3)).toMatchObject({ ok: false });
  });

  it("lapses at its time where nobody lets it go: a launch never answered, a job killed", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T);
    expect(await lease.launch(T + LAUNCH_HOLD_MS)).toEqual({ ok: true });
    await lease.take(T + LAUNCH_HOLD_MS, "job-1");
    const lapsed = T + LAUNCH_HOLD_MS + PUBLISH_HOLD_MS;
    expect(await lease.take(lapsed - 1, "job-2")).toBe(false);
    expect(await lease.take(lapsed, "job-2")).toBe(true);
  });
});
