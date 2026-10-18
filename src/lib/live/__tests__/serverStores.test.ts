import { describe, expect, it, vi } from "vitest";
import { firestoreFieldsOf } from "../../cloud/firestoreRest";
import { newPullJob } from "../../cloud/pullJobs";
import { restServerStores } from "../serverStores";

/*
 * What a job on GitHub may write of the cloud, by what it opened the stores for
 * (`restServerStores`, behind `scripts/cloudPool.ts`'s `openStores`). The republish after a deploy
 * opens them for `live/` alone: it builds the views from the copy and must not be able to write it.
 * A write a store refuses is refused before anything goes out; one it lets through is asked of
 * Firestore, stood in for here by a fetch that answers every request and counts them.
 */

const opened = (writable: boolean | "live") => {
  const fetchImpl = vi.fn(
    async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  );
  const stores = restServerStores(
    {
      projectId: "demo-league-forecast",
      token: async () => "token",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pause: async () => undefined,
    },
    writable
  );
  return { stores, fetchImpl };
};

const PIECE = new Uint8Array([1, 2, 3]);
/** A weekly re-measure's record, its numbers no matter here. */
const CLOSED_LEVEL = {
  format: 1,
  measuredOn: "2026-10-12",
  measuredAt: "2026-10-12T04:40:00.000Z",
  year: 2027,
  check: {
    held: -1.6,
    level: null,
    standardError: null,
    games: 0,
    clusters: 0,
    weeks: [],
    paired: null,
    better: false,
  },
};
const META = { format: 1 } as unknown as Parameters<
  ReturnType<typeof restServerStores>["live"]["commitMeta"]
>[1];

/** Whether `write` went out to Firestore: true, or refused here before it did: false. */
const goesOut = async (
  open: ReturnType<typeof opened>,
  write: (stores: ReturnType<typeof restServerStores>) => Promise<unknown>
): Promise<boolean> => {
  open.fetchImpl.mockClear();
  const refused = await write(open.stores).then(
    () => false,
    (error: unknown) => error instanceof Error && /opened to read/.test(error.message)
  );
  if (refused) expect(open.fetchImpl).not.toHaveBeenCalled();
  else expect(open.fetchImpl).toHaveBeenCalled();
  return !refused;
};

/** Every write each store has, by where it goes. */
const WRITES = {
  copy: [
    (s: ReturnType<typeof restServerStores>) => s.copy.putChunk("piece-0", PIECE),
    (s: ReturnType<typeof restServerStores>) => s.copy.deleteChunk("piece-0"),
    (s: ReturnType<typeof restServerStores>) => s.copy.commitManifest(null, {} as never),
  ],
  uploads: [(s: ReturnType<typeof restServerStores>) => s.uploads.remove("abcdef0123456789")],
  live: [
    (s: ReturnType<typeof restServerStores>) => s.live.putChunk("piece-0", PIECE),
    (s: ReturnType<typeof restServerStores>) => s.live.deleteChunk("piece-0"),
    (s: ReturnType<typeof restServerStores>) => s.live.commitMeta(null, META),
    (s: ReturnType<typeof restServerStores>) => s.writeClosedLevel(CLOSED_LEVEL),
  ],
  gate: [
    (s: ReturnType<typeof restServerStores>) =>
      s.gate.replace("ops/refresh", { nightlyAt: "2026-10-10T04:17:00.000Z" }, null),
  ],
};

const writesOf = async (writable: boolean | "live") => {
  const open = opened(writable);
  const out: Record<keyof typeof WRITES, boolean[]> = { copy: [], uploads: [], live: [], gate: [] };
  for (const where of ["copy", "uploads", "live", "gate"] as const) {
    for (const write of WRITES[where]) out[where].push(await goesOut(open, write));
  }
  return out;
};

describe("what a job on GitHub may write of the cloud", () => {
  it("writes the views and nothing of the copy when opened for live/ alone, as the republish is", async () => {
    expect(await writesOf("live")).toEqual({
      copy: [false, false, false],
      uploads: [false],
      live: [true, true, true, true],
      gate: [false],
    });
  });

  it("writes everything when opened to write, as the nightly's live run is", async () => {
    expect(await writesOf(true)).toEqual({
      copy: [true, true, true],
      uploads: [true],
      live: [true, true, true, true],
      gate: [true],
    });
  });

  it("writes nothing when opened to read, as the nightly's dry run is", async () => {
    expect(await writesOf(false)).toEqual({
      copy: [false, false, false],
      uploads: [false],
      live: [false, false, false, false],
      gate: [false],
    });
  });

  it("keeps the weekly record where members' devices read it, and reads it back from there", async () => {
    // Where the browser's reader looks (`firestoreLive`), named once for both (`closedLevelPath`).
    // Firestore as it answers when there is none yet: a read finds nothing, and the write lands.
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Response(init?.method === "POST" ? "{}" : '{"error":{"code":404}}', {
          status: init?.method === "POST" ? 200 : 404,
          headers: { "content-type": "application/json" },
        })
    );
    const stores = restServerStores(
      {
        projectId: "demo-league-forecast",
        token: async () => "token",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        pause: async () => undefined,
      },
      true
    );
    await stores.writeClosedLevel(CLOSED_LEVEL);
    expect(await stores.readClosedLevel()).toBeNull();
    const asked = fetchImpl.mock.calls.map(
      ([input, init]) =>
        `${init?.method ?? "GET"} ${String(input).replace(/^.*\/documents/, "")} ${String(init?.body ?? "")}`
    );
    // Its version read, the write over it, and the read back.
    expect(asked).toHaveLength(3);
    for (const request of asked) expect(request).toMatch(/\/live\/closedLevel\b/);
    expect(asked[0]).toMatch(/^GET \/live\/closedLevel /);
    expect(asked[1]).toMatch(/^POST :commit .*documents\/live\/closedLevel"/);
    expect(asked[2]).toMatch(/^GET \/live\/closedLevel /);
  });

  it("reads the copy's manifest at its update time, the rebuild job's control and the pulls under way, however it was opened", async () => {
    const RUNNING = {
      ...newPullJob({
        list: { hash: "0".repeat(64), teams: 1, pieces: 1 },
        seasonYears: [],
        timeZone: "America/New_York",
        device: "phone",
        now: "2026-10-16T11:00:00.000Z",
      }),
      status: "running" as const,
    };
    for (const writable of [true, false, "live"] as const) {
      const fetchImpl = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        const answer = url.endsWith(":runQuery")
          ? [
              {
                document: {
                  name: `${url.split(":runQuery")[0]}/pullJobs/${"a".repeat(32)}`,
                  fields: firestoreFieldsOf(RUNNING),
                },
              },
              // A pull this build cannot read is left out, not taken for one under way.
              {
                document: {
                  name: `${url.split(":runQuery")[0]}/pullJobs/${"b".repeat(32)}`,
                  fields: firestoreFieldsOf({ format: 99, status: "running" }),
                },
              },
            ]
          : url.endsWith("/copies/main")
            ? {
                fields: { version: { integerValue: "7" } },
                updateTime: "2026-10-16T11:50:00.123456Z",
              }
            : { fields: { owner: { nullValue: null }, until: { integerValue: "0" } } };
        return new Response(JSON.stringify(answer), { status: 200 });
      });
      const stores = restServerStores(
        {
          projectId: "demo-league-forecast",
          token: async () => "token",
          fetchImpl: fetchImpl as unknown as typeof fetch,
          pause: async () => undefined,
        },
        writable
      );
      expect(await stores.readCopyAt()).toEqual({
        manifest: { version: 7 },
        savedAt: "2026-10-16T11:50:00.123456Z",
      });
      expect(await stores.readRebuildJob()).toEqual({ owner: null, until: 0 });
      expect(await stores.pullsUnderWay()).toEqual([RUNNING]);
      const asked = fetchImpl.mock.calls.map(([input]) => String(input));
      expect(asked.map((url) => url.replace(/^.*\/documents/, ""))).toEqual([
        "/copies/main",
        "/ops/rebuildJob",
        ":runQuery",
      ]);
      // The query asks for the pulls queued or running.
      const query = JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)) as {
        structuredQuery: unknown;
      };
      expect(query.structuredQuery).toEqual({
        from: [{ collectionId: "pullJobs" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "status" },
            op: "IN",
            value: {
              arrayValue: { values: [{ stringValue: "queued" }, { stringValue: "running" }] },
            },
          },
        },
      });
    }
  });

  it("reads the refresh gate and a job however it was opened", async () => {
    for (const writable of [true, false, "live"] as const) {
      const open = opened(writable);
      // The stand-in answers every read with an empty document, which says nothing either way.
      await open.stores.gate.readAt("ops/refresh").catch(() => undefined);
      await open.stores.readJob("0123456789abcdef0123456789abcdef");
      expect(open.fetchImpl).toHaveBeenCalledTimes(2);
    }
  });
});
