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
const ASK = { settleMs: 0, rebuilds: true };

describe("the boards' publish lease", () => {
  it("lets one of two launchers at once start the job, and tells the other until when", async () => {
    const { docs, paths } = memoryDocs();
    const lease = publishLease(docs);
    const [a, b] = await Promise.all([lease.launch(T, ASK), lease.launch(T, ASK)]);
    expect([a, b]).toEqual([{ ok: true }, { ok: false, until: T + LAUNCH_HOLD_MS }]);
    expect(await lease.launch(T + 60_000, ASK)).toEqual({ ok: false, until: T + LAUNCH_HOLD_MS });
    expect(new Set(paths)).toEqual(new Set([PUBLISH_LEASE_PATH]));
    // The one that lost asked the job the other started for what it wanted too.
    const second = memoryDocs();
    const both = publishLease(second.docs);
    await Promise.all([both.launch(T, ASK), both.launch(T, { settleMs: 60_000, rebuilds: false })]);
    expect(await both.take(T + 1, "job-1")).toEqual({
      taken: true,
      asked: { settleMs: 0, rebuilds: false },
    });
  });

  it("hands a launch over to the job it started, which holds it for its own time", async () => {
    const { docs, held } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T, ASK);
    expect(await lease.take(T + 30_000, "job-1")).toEqual({ taken: true, asked: ASK });
    expect(held()).toEqual({ owner: "job-1", until: T + 30_000 + PUBLISH_HOLD_MS });
    // A second job, or a launch, waits on a job that holds it.
    expect(await lease.take(T + 40_000, "job-2")).toEqual({ taken: false });
    expect(await lease.launch(T + 40_000, ASK)).toEqual({
      ok: false,
      until: T + 30_000 + PUBLISH_HOLD_MS,
    });
  });

  it("is free again once the job lets it go, and only its own job lets it go", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.take(T, "job-1");
    await lease.release("job-2");
    expect(await lease.launch(T + 1, ASK)).toMatchObject({ ok: false });
    await lease.release("job-1");
    expect(await lease.launch(T + 2, ASK)).toEqual({ ok: true });
  });

  it("is let go by a launch that failed, but never from under a job", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T, ASK);
    await lease.unlaunch();
    expect(await lease.launch(T + 1, ASK)).toEqual({ ok: true });
    await lease.take(T + 2, "job-1");
    await lease.unlaunch();
    expect(await lease.launch(T + 3, ASK)).toMatchObject({ ok: false });
  });

  it("hands the job what its launch asked: a check's settle, and a rebuild not to count on", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    const check = { settleMs: 180_000, rebuilds: false };
    await lease.launch(T, check);
    expect(await lease.take(T + 1, "job-1")).toEqual({ taken: true, asked: check });
    // A job started by hand, with no launch before it, was asked nothing.
    const bare = publishLease(memoryDocs().docs);
    expect(await bare.take(T, "job-2")).toEqual({ taken: true, asked: null });
    // Nor was one whose launch's claim says nothing this build can read.
    for (const said of [
      { settleMs: "soon", rebuilds: true },
      { settleMs: -1, rebuilds: true },
      { settleMs: 0 },
      { settleMs: 0, rebuilds: "no" },
    ]) {
      const odd = memoryDocs();
      await odd.docs.replace("x", { owner: "launch", until: T + 1, ...said }, null);
      expect(await publishLease(odd.docs).take(T, "job-3")).toEqual({ taken: true, asked: null });
    }
  });

  it("asks a job under way to go again with what its launchers asked, and lets go once it has", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.take(T, "job-1");
    // Nobody asked: handed back, it is let go.
    expect(await lease.handBack("job-1", T + 1)).toBeNull();
    expect(await lease.launch(T + 2, ASK)).toEqual({ ok: true });
    await lease.take(T + 3, "job-2");
    // A check, then a pull's end: the shorter settle, and a rebuild counted on by neither.
    const check = { settleMs: 180_000, rebuilds: true };
    const pullEnd = { settleMs: 0, rebuilds: false };
    expect(await lease.launch(T + 4, check)).toMatchObject({ ok: false });
    expect(await lease.launch(T + 5, pullEnd)).toMatchObject({ ok: false });
    // Another job's hand back changes nothing.
    expect(await lease.handBack("job-1", T + 6)).toBeNull();
    expect(await lease.handBack("job-2", T + 7)).toEqual({ settleMs: 0, rebuilds: false });
    // Held for the round asked for, and let go after it where nobody asked again.
    expect(await lease.launch(T + 8, ASK)).toEqual({ ok: false, until: T + 7 + PUBLISH_HOLD_MS });
    expect(await lease.handBack("job-2", T + 9)).toEqual(ASK);
    expect(await lease.handBack("job-2", T + 10)).toBeNull();
    expect(await lease.launch(T + 11, ASK)).toEqual({ ok: true });
  });

  it("hands a job what was asked of the launch it takes over, and after it", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T, { settleMs: 180_000, rebuilds: true });
    expect(await lease.launch(T + 1, { settleMs: 60_000, rebuilds: false })).toMatchObject({
      ok: false,
    });
    expect(await lease.take(T + 2, "job-1")).toEqual({
      taken: true,
      asked: { settleMs: 60_000, rebuilds: false },
    });
    // Asked for in its first round: nothing is left over for a second.
    expect(await lease.handBack("job-1", T + 3)).toBeNull();
  });

  it("takes a launch over though a launcher wrote onto its claim meanwhile, with that ask", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T, ASK);
    // Between the job's read and its write, a pull's end finds the claim held and writes onto it.
    let raced = false;
    const racing = {
      readAt: async (path: string) => {
        const at = await docs.readAt(path);
        if (!raced) {
          raced = true;
          await lease.launch(T + 1, { settleMs: 0, rebuilds: false });
        }
        return at;
      },
      replace: docs.replace,
    };
    expect(await publishLease(racing).take(T + 2, "job-1")).toEqual({
      taken: true,
      asked: { settleMs: 0, rebuilds: false },
    });
  });

  it("hands what was asked in a job's last round on to the next job, as a launch's claim", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.take(T, "job-1");
    // Nobody asked: let go.
    expect(await lease.handOn("job-1", T + 1)).toBeNull();
    expect(await lease.launch(T + 2, ASK)).toEqual({ ok: true });
    await lease.take(T + 3, "job-2");
    const pullEnd = { settleMs: 0, rebuilds: false };
    await lease.launch(T + 4, pullEnd);
    // Another job's changes nothing; its own turns into a claim the next job takes over.
    expect(await lease.handOn("job-1", T + 5)).toBeNull();
    expect(await lease.handOn("job-2", T + 6)).toEqual(pullEnd);
    expect(await lease.launch(T + 7, ASK)).toEqual({ ok: false, until: T + 6 + LAUNCH_HOLD_MS });
    expect(await lease.take(T + 8, "job-3")).toEqual({ taken: true, asked: pullEnd });
  });

  it("hands back through several launchers writing onto it at once, with all their asks", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.take(T, "job-1");
    // Five pulls end one after another, each between the job's read and its write.
    let racing = 0;
    const contended = {
      readAt: async (path: string) => {
        const at = await docs.readAt(path);
        if (racing < 5) {
          racing += 1;
          await lease.launch(T + racing, { settleMs: 1_000 * racing, rebuilds: true });
        }
        return at;
      },
      replace: docs.replace,
    };
    expect(await publishLease(contended).handBack("job-1", T + 10)).toEqual({
      settleMs: 1_000,
      rebuilds: true,
    });
  });

  it("lapses at its time where nobody lets it go: a launch never answered, a job killed", async () => {
    const { docs } = memoryDocs();
    const lease = publishLease(docs);
    await lease.launch(T, ASK);
    expect(await lease.launch(T + LAUNCH_HOLD_MS, ASK)).toEqual({ ok: true });
    await lease.take(T + LAUNCH_HOLD_MS, "job-1");
    const lapsed = T + LAUNCH_HOLD_MS + PUBLISH_HOLD_MS;
    expect(await lease.take(lapsed - 1, "job-2")).toEqual({ taken: false });
    // Taken from a job, not a launch: nothing was asked of it.
    expect(await lease.take(lapsed, "job-2")).toEqual({ taken: true, asked: null });
  });
});
