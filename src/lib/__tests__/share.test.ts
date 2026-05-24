import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeSnapshot, encodeSnapshot, readSharedFromHash, type SharedSnapshot } from "../share";
import { DEFAULT_SETTINGS } from "../types";

const snapshot: SharedSnapshot = {
  v: 1,
  teams: [{ id: "A", name: "Aces" }],
  matchups: [{ id: "g1", date: "5/1", away: "A", home: "A" }],
  logs: {
    g1: {
      awayRuns: "1",
      awayHits: "0",
      awayK: "0",
      homeRuns: "0",
      homeHits: "0",
      homeK: "0",
      innings: "6",
      isFinal: true,
    },
  },
  settings: { ...DEFAULT_SETTINGS },
};

describe("encode / decodeSnapshot", () => {
  it("round-trips an arbitrary snapshot", () => {
    const encoded = encodeSnapshot(snapshot);
    const decoded = decodeSnapshot(encoded);
    expect(decoded).toEqual(snapshot);
  });

  it("returns null for garbage", () => {
    expect(decodeSnapshot("not-base64-data!!")).toBeNull();
  });
});

describe("buildShareUrl + readSharedFromHash", () => {
  it("survives a full URL round-trip", () => {
    const url = buildShareUrl("https://example.com/?foo=bar#old", snapshot);
    expect(url.startsWith("https://example.com/?foo=bar#s=")).toBe(true);
    const hash = url.split("#")[1] ?? "";
    const decoded = readSharedFromHash(`#${hash}`);
    expect(decoded).toEqual(snapshot);
  });

  it("returns null when no payload in hash", () => {
    expect(readSharedFromHash("")).toBeNull();
    expect(readSharedFromHash("#foo=bar")).toBeNull();
  });
});
