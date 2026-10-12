import { describe, expect, it, vi } from "vitest";
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
      live: [true, true, true],
      gate: [false],
    });
  });

  it("writes everything when opened to write, as the nightly's live run is", async () => {
    expect(await writesOf(true)).toEqual({
      copy: [true, true, true],
      uploads: [true],
      live: [true, true, true],
      gate: [true],
    });
  });

  it("writes nothing when opened to read, as the nightly's dry run is", async () => {
    expect(await writesOf(false)).toEqual({
      copy: [false, false, false],
      uploads: [false],
      live: [false, false, false],
      gate: [false],
    });
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
