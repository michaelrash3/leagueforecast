import { describe, expect, it, vi } from "vitest";
import type { RecapItem } from "../insights";
import { LEAGUE_SUMMARY_ENDPOINT } from "../leagueSummary";
import { buildLeagueSummaryRequest, requestLeagueSummary } from "../leagueSummaryClient";

const recapItems: RecapItem[] = [
  { kind: "clinched", text: "Stallions clinched a Gold Bracket spot.", impactScore: 95 },
  { kind: "rank-change", text: "Wolves slipped from #7 to #9.", impactScore: 58 },
];

const standings = [
  { rank: 1, name: "Stallions", w: 10, l: 2, t: 0, goldPct: 99.4, status: "Clinched" },
  { rank: 8, name: "Bandits", w: 7, l: 5, t: 0, goldPct: 55.1, status: "Alive" },
  { rank: 9, name: "Wolves", w: 6, l: 6, t: 1, goldPct: 21.2, status: "Alive" },
  { rank: 14, name: "Comets", w: 1, l: 11, t: 0, goldPct: 0, status: "Eliminated" },
];

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

describe("buildLeagueSummaryRequest", () => {
  it("carries the recap facts through with their impact scores", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
    });
    expect(request.facts).toEqual([
      { kind: "clinched", text: "Stallions clinched a Gold Bracket spot.", impactScore: 95 },
      { kind: "rank-change", text: "Wolves slipped from #7 to #9.", impactScore: 58 },
    ]);
  });

  it("keeps the top of the table and the teams around the cut line", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      standings,
    });
    expect(request.standings?.map((row) => row.rank)).toEqual([1, 8, 9]);
    expect(request.standings?.map((row) => row.insideCut)).toEqual([true, true, false]);
  });

  it("formats records and cleans up display names", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      standings: [{ rank: 3, name: "NKB Wolves 8u", w: 6, l: 6, t: 1, goldPct: 21.2 }],
    });
    expect(request.standings?.[0]?.record).toBe("6-6-1");
    expect(request.standings?.[0]?.name).toBe("Wolves");
  });

  it("passes the deterministic story through as the fallback", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      fallback: "Deterministic story.",
    });
    expect(request.fallback).toBe("Deterministic story.");
  });
});

describe("requestLeagueSummary", () => {
  const request = buildLeagueSummaryRequest({
    seasonLabel: "2026 Spring",
    cutoff: 8,
    recapItems,
  });

  it("posts JSON to the summary endpoint and returns the summary", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { summary: "Stallions are in.", model: "gemini-3-flash", source: "gemini" })
    ) as unknown as typeof fetch;

    const outcome = await requestLeagueSummary(request, { fetchImpl });

    expect(outcome).toEqual({ ok: true, summary: "Stallions are in.", model: "gemini-3-flash" });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(call[0]).toBe(LEAGUE_SUMMARY_ENDPOINT);
    expect(call[1]?.method).toBe("POST");
    expect(JSON.parse(call[1]?.body).facts).toHaveLength(2);
  });

  it("reports the server reason so the caller can stay quiet", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "GEMINI_API_KEY is not configured.", reason: "unconfigured" })
    ) as unknown as typeof fetch;

    await expect(requestLeagueSummary(request, { fetchImpl })).resolves.toEqual({
      ok: false,
      reason: "unconfigured",
      message: "GEMINI_API_KEY is not configured.",
    });
  });

  it("treats a missing endpoint as unconfigured rather than an error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    const outcome = await requestLeagueSummary(request, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, reason: "unconfigured" });
  });

  it("flags an empty summary instead of rendering blank text", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { summary: "   ", model: "gemini-3-flash" })
    ) as unknown as typeof fetch;

    await expect(requestLeagueSummary(request, { fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: "upstream-error",
    });
  });

  it("never throws on a network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await expect(requestLeagueSummary(request, { fetchImpl })).resolves.toEqual({
      ok: false,
      reason: "upstream-error",
      message: "offline",
    });
  });
});
