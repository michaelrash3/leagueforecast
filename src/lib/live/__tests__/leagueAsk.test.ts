import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudManifest } from "../../cloud/cloudManifest";
import type { QueryOf } from "../queries";

/** What the stand-ins answer: the callable's reply, and the copy's reader. */
const stand = vi.hoisted(() => ({
  reply: null as unknown,
  reader: null as null | { readManifest: () => Promise<unknown> },
}));

vi.mock("../editClient", () => ({
  callQuery: async () => stand.reply,
}));
vi.mock("../../cloud/cloudSession", () => ({
  memberToken: async () => "token",
  copyReader: async () => stand.reader,
}));

const { askLeague, copyAtNow } = await import("../leagueAsk");

const BRIDGE = {
  results: [],
  seasonLinked: false,
  rows: [],
  linkedCount: 0,
  countedResults: 0,
};

describe("askLeague", () => {
  beforeEach(() => {
    stand.reply = null;
  });

  it("answers with the copy and version the server worked it out from", async () => {
    stand.reply = {
      ok: true,
      value: {
        ok: true,
        copy: "c1",
        version: 7,
        answer: { kind: "league.bridge", bridge: BRIDGE, candidates: [] },
      },
    };
    expect(
      await askLeague({ kind: "league.bridge", season: "s1", teams: [], fixtures: [] })
    ).toEqual({
      kind: "league.bridge",
      bridge: BRIDGE,
      candidates: [],
      at: { copy: "c1", version: 7 },
    });
  });

  it("answers nothing for a call that failed or a question refused", async () => {
    const question: QueryOf<"league.bridge"> = {
      kind: "league.bridge",
      season: "s1",
      teams: [],
      fixtures: [],
    };
    stand.reply = { ok: false, message: "offline" };
    expect(await askLeague(question)).toBeNull();
    stand.reply = { ok: true, value: { ok: false, why: "refused" } };
    expect(await askLeague(question)).toBeNull();
  });
});

describe("copyAtNow", () => {
  it("reads the copy's id and version from its manifest", async () => {
    const manifest = { copy: "c1", version: 9 } as unknown as CloudManifest;
    stand.reader = { readManifest: async () => manifest };
    expect(await copyAtNow()).toEqual({ copy: "c1", version: 9 });
  });

  it("is nothing where there is no reader, no copy, or the read fails", async () => {
    stand.reader = null;
    expect(await copyAtNow()).toBeNull();
    stand.reader = { readManifest: async () => null };
    expect(await copyAtNow()).toBeNull();
    stand.reader = {
      readManifest: async () => {
        throw new Error("timed out reading the cloud's copy");
      },
    };
    expect(await copyAtNow()).toBeNull();
  });
});
