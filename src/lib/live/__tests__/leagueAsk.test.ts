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

  it("tells the asker what the reply said of the edits' month, answered or not, and nothing where it said none", async () => {
    const question: QueryOf<"league.bridge"> = {
      kind: "league.bridge",
      season: "s1",
      teams: [],
      fixtures: [],
    };
    const SPENT = { month: "2026-10", spent: true };
    const RAISED = { month: "2026-10", spent: false };
    const heard: unknown[] = [];
    const note = (month: unknown) => heard.push(month);
    const answer = { kind: "league.bridge", bridge: BRIDGE, candidates: [] };
    stand.reply = {
      ok: true,
      value: { ok: true, copy: "c1", version: 7, answer, editMonth: SPENT },
    };
    // The answer is the answer's alone: the month is told, not handed back with it.
    expect(await askLeague(question, note)).toEqual({ ...answer, at: { copy: "c1", version: 7 } });
    stand.reply = { ok: true, value: { ok: false, why: "kept-moving", editMonth: RAISED } };
    expect(await askLeague(question, note)).toBeNull();
    stand.reply = { ok: false, why: "failed", message: "Not answered.", editMonth: SPENT };
    expect(await askLeague(question, note)).toBeNull();
    expect(heard).toEqual([SPENT, RAISED, SPENT]);
    // An older server's reply, or a call that never reached one, says none, and nothing is told.
    stand.reply = { ok: true, value: { ok: true, copy: "c1", version: 7, answer } };
    await askLeague(question, note);
    stand.reply = { ok: false, why: "failed", message: "offline" };
    await askLeague(question, note);
    expect(heard).toHaveLength(3);
    // Asked with nobody to tell, as Fill and the start from clubs ask, it is answered as before.
    stand.reply = { ok: false, why: "failed", message: "Not answered.", editMonth: SPENT };
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
