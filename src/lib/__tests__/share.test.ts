import { describe, expect, it } from "vitest";
import {
  MAX_SHARE_URL_PAYLOAD,
  buildShareUrl,
  decodeSnapshot,
  encodeSnapshot,
  readShareUiStateFromHash,
  readSharedFromHash,
  type SharedSnapshot,
} from "../share";
import { DEFAULT_SETTINGS } from "../types";

const snapshot: SharedSnapshot = {
  v: 1,
  teams: [
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
  ],
  matchups: [{ id: "g1", date: "5/1", away: "A", home: "B" }],
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

  it("uses a compact URL payload and round-trips through the public shape", () => {
    const encoded = encodeSnapshot(snapshot);
    const legacyJson = JSON.stringify(snapshot);
    expect(encoded.length).toBeLessThan(legacyJson.length);
    expect(decodeSnapshot(encoded)).toEqual(snapshot);
  });

  it("decodes legacy v1 payloads", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    const legacy = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeSnapshot(legacy)).toEqual(snapshot);
  });

  it("returns null for garbage", () => {
    expect(decodeSnapshot("not-base64-data!!")).toBeNull();
  });

  it("rejects payloads above max share length", () => {
    const oversized = "a".repeat(MAX_SHARE_URL_PAYLOAD + 1);
    expect(decodeSnapshot(oversized)).toBeNull();
  });
});

describe("buildShareUrl + readSharedFromHash", () => {
  it("survives a full URL round-trip and preserves UI context", () => {
    const url = buildShareUrl("https://example.com/?foo=bar#old", snapshot, {
      view: "teamStats",
      teamId: "A",
    });
    expect(url.startsWith("https://example.com/?foo=bar#s=")).toBe(true);
    expect(url).toContain("&view=teamStats&team=A");
    const hash = url.split("#")[1] ?? "";
    const decoded = readSharedFromHash(`#${hash}`);
    expect(decoded).toEqual(snapshot);
    expect(readShareUiStateFromHash(`#${hash}`)).toEqual({ view: "teamStats", teamId: "A" });
  });

  it("returns null when no payload in hash", () => {
    expect(readSharedFromHash("")).toBeNull();
    expect(readSharedFromHash("#foo=bar")).toBeNull();
    expect(readShareUiStateFromHash("#view=not-real&team=A")).toEqual({ teamId: "A" });
  });

  it("throws when share payload is too large", () => {
    const largeSnapshot: SharedSnapshot = {
      ...snapshot,
      teams: Array.from({ length: 1000 }, (_, i) => ({ id: `T${i}`, name: `Team ${i}` })),
    };
    expect(() => buildShareUrl("https://example.com", largeSnapshot)).toThrow();
  });
});

it("round-trips player-pitch fields and pitch mode", () => {
  const playerSnapshot: SharedSnapshot = {
    ...snapshot,
    logs: {
      g1: {
        ...snapshot.logs.g1!,
        awayErrors: "2",
        homeErrors: "1",
        awayWalksAllowed: "4",
        homeWalksAllowed: "3",
      },
    },
    settings: { ...DEFAULT_SETTINGS, pitchMode: "player" },
  };

  expect(decodeSnapshot(encodeSnapshot(playerSnapshot))).toEqual(playerSnapshot);
});
