import { describe, expect, it } from "vitest";
import { DATA_SCHEMA, MANIFEST_FORMAT, type CloudManifest } from "../cloudManifest";
import { isSettled, needsApply, planArea, type Area, type PlanState } from "../cloudPlan";

/*
 * The rules of syncing, key by key. Fingerprints here are single letters padded to look like one;
 * the plan only ever compares them.
 */

const h = (letter: string): string => letter.repeat(64);

const manifest = (
  parts: Record<string, { hash: string; at?: number }>,
  copy = "copy-a"
): CloudManifest => ({
  format: MANIFEST_FORMAT,
  schema: DATA_SCHEMA,
  copy,
  version: 7,
  save: "s",
  updatedAt: "",
  device: "other",
  parts: Object.entries(parts).map(([key, part]) => ({
    key,
    hash: part.hash,
    bytes: 1,
    chunks: 1,
    id: "0123456789abcdef",
    at: part.at ?? 100,
    by: "other",
  })),
  kept: [],
});

const plan = async ({
  cloud,
  state,
  area = "pool",
  local,
  localEmpty = false,
  copy = "copy-a",
}: {
  cloud: Record<string, { hash: string; at?: number }>;
  state: Partial<PlanState>;
  area?: Area;
  /** This device's values' fingerprints, by key. */
  local: Record<string, string>;
  localEmpty?: boolean;
  copy?: string;
}) =>
  planArea({
    manifest: manifest(cloud, copy),
    state: { met: { league: "copy-a", pool: "copy-a" }, hashes: {}, dirty: {}, ...state },
    area,
    held: Object.keys(local),
    localEmpty,
    localHash: async (key) => local[key] ?? null,
  });

const actionsOf = async (input: Parameters<typeof plan>[0]) =>
  Object.fromEntries((await plan(input)).actions);

describe("a key both sides agree on", () => {
  it("needs nothing", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("a") } },
        state: { hashes: { teams: h("a") } },
        local: { teams: h("a") },
      })
    ).toEqual({});
  });
});

describe("a key changed on one side", () => {
  it("is taken from the copy when another device changed it", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("b") } },
        state: { hashes: { teams: h("a") } },
        local: { teams: h("a") },
      })
    ).toEqual({ teams: "take" });
  });

  it("is sent when this device changed it", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("a") } },
        state: { hashes: { teams: h("a") }, dirty: { teams: 5 } },
        local: { teams: h("b") },
      })
    ).toEqual({ teams: "send" });
  });

  it("is removed here only when the copy dropped a key this device had synced", async () => {
    expect(
      await actionsOf({
        cloud: {},
        state: { hashes: { archive: h("a") } },
        local: { archive: h("a") },
      })
    ).toEqual({ archive: "take" });
  });

  it("is taken out of the copy only when removed here on the record", async () => {
    expect(
      await actionsOf({
        cloud: { archive: { hash: h("a") } },
        state: { hashes: { archive: h("a") }, dirty: { archive: 5 } },
        local: {},
      })
    ).toEqual({ archive: "send" });
  });

  it("is taken back from the copy when this device lost it without removing it", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("a") } },
        state: { hashes: { teams: h("a") } },
        local: {},
      })
    ).toEqual({ teams: "take" });
  });

  it("is sent when held here with no record on either side", async () => {
    expect(await actionsOf({ cloud: {}, state: {}, local: { stray: h("a") } })).toEqual({
      stray: "send",
    });
  });
});

describe("a key changed on both sides", () => {
  it("is no conflict when both made the same change", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("b") } },
        state: { hashes: { teams: h("a") }, dirty: { teams: 5 } },
        local: { teams: h("b") },
      })
    ).toEqual({ teams: "synced" });
  });

  it("merges League Standings", async () => {
    expect(
      await actionsOf({
        cloud: { league: { hash: h("b") } },
        state: { hashes: { league: h("a") }, dirty: { league: 5 } },
        local: { league: h("c") },
        area: "league",
      })
    ).toEqual({ league: "merge" });
  });

  it("goes to whichever changed a pool key later", async () => {
    const both = (here: number, there: number) =>
      actionsOf({
        cloud: { teams: { hash: h("b"), at: there } },
        state: { hashes: { teams: h("a") }, dirty: { teams: here } },
        local: { teams: h("c") },
      });
    expect(await both(200, 100)).toEqual({ teams: "local-wins" });
    expect(await both(100, 200)).toEqual({ teams: "cloud-wins" });
  });

  it("keeps an edit here over the copy dropping the key, when the edit is later", async () => {
    expect(
      await actionsOf({
        cloud: {},
        state: { hashes: { archive: h("a") }, dirty: { archive: 500 } },
        local: { archive: h("c") },
      })
    ).toEqual({ archive: "local-wins" });
  });

  it("leaves the other area alone", async () => {
    expect(
      await actionsOf({
        cloud: { league: { hash: h("b") }, teams: { hash: h("b") } },
        state: { hashes: { league: h("a"), teams: h("a") } },
        local: { teams: h("a") },
      })
    ).toEqual({ teams: "take" });
  });
});

describe("an area meeting a copy for the first time", () => {
  const unmet = { met: {} };

  it("sends everything where the copy has nothing of the area", async () => {
    const result = await plan({ cloud: {}, state: unmet, local: { teams: h("a"), games: h("b") } });
    expect(result.meeting).toBe(true);
    expect(Object.fromEntries(result.actions)).toEqual({ teams: "send", games: "send" });
  });

  it("takes the copy's pool whole where this device's holds no team, dropping what it had", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("a") } },
        state: unmet,
        local: { ageGroups: h("z") },
        localEmpty: true,
      })
    ).toEqual({ teams: "take", ageGroups: "take" });
  });

  it("takes the copy's pool whole over a pool of this device's, keeping this device's", async () => {
    expect(
      await actionsOf({
        cloud: { teams: { hash: h("a") }, games: { hash: h("b") } },
        state: unmet,
        local: { teams: h("a"), games: h("c"), mine: h("d") },
      })
    ).toEqual({ teams: "synced", games: "cloud-wins", mine: "cloud-wins" });
  });

  it("merges League Standings both hold, and takes the copy's over an empty league", async () => {
    expect(
      await actionsOf({
        cloud: { league: { hash: h("a") } },
        state: unmet,
        local: { league: h("b") },
        area: "league",
      })
    ).toEqual({ league: "merge" });
    expect(
      await actionsOf({
        cloud: { league: { hash: h("a") } },
        state: unmet,
        local: { league: h("b") },
        area: "league",
        localEmpty: true,
      })
    ).toEqual({ league: "take" });
  });

  it("meets a copy started again as a new one, whatever it knew of the old", async () => {
    const result = await plan({
      cloud: { teams: { hash: h("a") } },
      state: { met: { pool: "old-copy" }, hashes: { teams: h("a") } },
      local: { teams: h("b") },
      copy: "copy-b",
    });
    expect(result.meeting).toBe(true);
    expect(Object.fromEntries(result.actions)).toEqual({ teams: "cloud-wins" });
  });
});

describe("what a plan asks of the device", () => {
  it("writes here only to take, merge or lose to the copy", async () => {
    const sendOnly = await plan({
      cloud: { teams: { hash: h("a") } },
      state: { hashes: { teams: h("a") }, dirty: { teams: 5 } },
      local: { teams: h("b") },
    });
    expect(needsApply(sendOnly)).toBe(false);
    const taking = await plan({
      cloud: { teams: { hash: h("b") } },
      state: { hashes: { teams: h("a") } },
      local: { teams: h("a") },
    });
    expect(needsApply(taking)).toBe(true);
  });

  it("is settled only when nothing is left to move and the area has met the copy", async () => {
    const same = await plan({
      cloud: { teams: { hash: h("a") } },
      state: { hashes: { teams: h("a") } },
      local: { teams: h("a") },
    });
    expect(isSettled(same)).toBe(true);
    const meeting = await plan({ cloud: {}, state: { met: {} }, local: {} });
    expect(isSettled(meeting)).toBe(false);
  });
});
