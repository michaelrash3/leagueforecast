import { describe, expect, it, vi } from "vitest";
import type { RecapItem } from "../insights";
import { LEAGUE_SUMMARY_ENDPOINT } from "../leagueSummary";
import {
  describeLeagueSummaryHealth,
  fetchLeagueSummaryHealth,
  buildForecastSummaryRequest,
  buildLeagueSummaryRequest,
  requestLeagueSummary,
} from "../leagueSummaryClient";

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

  it("sends the whole table and marks which rows are inside the cut line", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      standings,
    });
    expect(request.standings?.map((row) => row.rank)).toEqual([1, 8, 9, 14]);
    expect(request.standings?.map((row) => row.insideCut)).toEqual([true, true, false, false]);
  });

  it("carries power ratings through with display names", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      powerRatings: [
        {
          rank: 1,
          teamName: "NKB Stallions 8u",
          rating: 4.23,
          record: "10-2",
          trend: "Up",
          recentForm: 2.1,
          sosRank: 3,
        },
      ],
    });
    expect(request.powerRatings).toEqual([
      {
        rank: 1,
        name: "Stallions",
        rating: 4.23,
        record: "10-2",
        trend: "Up",
        recentForm: 2.1,
        sosRank: 3,
      },
    ]);
  });

  it("reduces each stat metric to its leader and runner-up", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      statMetrics: [
        {
          label: "Runs per game",
          direction: "desc",
          average: 5.2,
          entries: [
            { teamName: "Stallions", value: 8.4 },
            { teamName: "Wolves", value: 6.1 },
            { teamName: "Comets", value: 2.0 },
          ],
        },
      ],
    });
    expect(request.statLeaders).toEqual([
      {
        metric: "Runs per game",
        leaderName: "Stallions",
        leaderValue: 8.4,
        runnerUpName: "Wolves",
        runnerUpValue: 6.1,
        leagueAverage: 5.2,
        direction: "desc",
      },
    ]);
  });

  it("drops metrics with no finalized games rather than reporting a zero leader", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      statMetrics: [
        {
          label: "Strikeouts per game",
          direction: "desc",
          average: null,
          entries: [
            { teamName: "Stallions", value: null },
            { teamName: "Wolves", value: null },
          ],
        },
      ],
    });
    expect(request.statLeaders).toEqual([]);
  });

  it("passes season context so the model can judge the sample size", () => {
    const request = buildLeagueSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 8,
      recapItems,
      season: { finalGames: 4, totalGames: 36, leaderName: "Stallions", gamesPerTeam: 12 },
    });
    expect(request.season).toEqual({
      finalGames: 4,
      totalGames: 36,
      leaderName: "Stallions",
      gamesPerTeam: 12,
    });
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

  it("reports a 404 as a missing endpoint, not a missing API key", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;

    const outcome = await requestLeagueSummary(request, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, reason: "endpoint-missing" });
  });

  it("treats a non-JSON 200 as a missing endpoint, not a summary", async () => {
    // An SPA/static fallback answering instead of the function.
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("<!doctype html>");
      },
    })) as unknown as typeof fetch;

    const outcome = await requestLeagueSummary(request, { fetchImpl });
    expect(outcome).toMatchObject({ ok: false, reason: "endpoint-missing" });
  });

  it("still reports the server's own reason when it sends one", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(503, { error: "GEMINI_API_KEY is not configured.", reason: "unconfigured" })
    ) as unknown as typeof fetch;

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

describe("buildForecastSummaryRequest", () => {
  it("marks the request as a forecast and sends no recap facts", () => {
    const request = buildForecastSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 7,
      projections: [
        {
          name: "NKB Stallions 8u",
          projectedRank: 1,
          currentRank: 3,
          projectedRecord: "14-4",
          goldPct: 92.4,
        },
      ],
    });
    expect(request.kind).toBe("forecast");
    expect(request.facts).toEqual([]);
    expect(request.projections?.[0]?.name).toBe("Stallions");
  });

  it("derives insideCut from the projected rank against the cutoff", () => {
    const request = buildForecastSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 7,
      projections: [
        { name: "Stallions", projectedRank: 7, projectedRecord: "12-6", goldPct: 70 },
        { name: "Wolves", projectedRank: 8, projectedRecord: "9-9", goldPct: 40 },
      ],
    });
    expect(request.projections?.map((row) => row.insideCut)).toEqual([true, false]);
  });

  it("formats matchups as away at home with display names", () => {
    const request = buildForecastSummaryRequest({
      seasonLabel: "2026 Spring",
      cutoff: 7,
      projections: [],
      gameForecasts: [
        {
          awayName: "NKB Wolves 8u",
          homeName: "NKB Stallions 8u",
          favoriteName: "NKB Stallions 8u",
          winPct: 63,
          impact: "High",
          date: "9/20",
        },
      ],
    });
    expect(request.gameForecasts).toEqual([
      {
        matchup: "Wolves at Stallions",
        favorite: "Stallions",
        winPct: 63,
        impact: "High",
        date: "9/20",
      },
    ]);
  });
});

describe("fetchLeagueSummaryHealth", () => {
  it("asks for the probe by default", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { functionDeployed: true, keyConfigured: true })
    ) as unknown as typeof fetch;
    await fetchLeagueSummaryHealth({ fetchImpl });
    const call = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] ?? [];
    expect(String(call[0])).toContain("probe=1");
    expect(call[1]?.method).toBe("GET");
  });

  it("reports a 404 as a missing endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 404,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;
    await expect(fetchLeagueSummaryHealth({ fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: "endpoint-missing",
    });
  });

  it("treats the app shell answering with HTML as a missing endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 200,
      json: async () => {
        throw new Error("<!doctype html>");
      },
    })) as unknown as typeof fetch;
    await expect(fetchLeagueSummaryHealth({ fetchImpl })).resolves.toMatchObject({
      ok: false,
      reason: "endpoint-missing",
    });
  });
});

describe("describeLeagueSummaryHealth", () => {
  it("points at the deploy, not the key, when nothing is serving the endpoint", () => {
    const text = describeLeagueSummaryHealth({
      ok: false,
      reason: "endpoint-missing",
      message: "HTTP 404",
    });
    expect(text).toContain("not deployed");
    expect(text).toContain("not the API key");
  });

  it("names the environment and build when the key is missing", () => {
    const text = describeLeagueSummaryHealth({
      ok: true,
      health: {
        functionDeployed: true,
        keyConfigured: false,
        vercelEnv: "production",
        commit: "abc1234",
      },
    });
    expect(text).toContain("env production");
    expect(text).toContain("build abc1234");
    expect(text).toContain("redeploy");
  });

  it("reports success with the model that would be tried first", () => {
    const text = describeLeagueSummaryHealth({
      ok: true,
      health: {
        keyConfigured: true,
        keyLength: 39,
        vercelEnv: "production",
        probe: { ok: true, modelCount: 5, candidates: ["gemini-3-flash", "gemini-3-pro"] },
      },
    });
    expect(text).toContain("Working");
    expect(text).toContain("5 usable models");
    expect(text).toContain("gemini-3-flash is first in line");
  });

  it("relays why Gemini rejected the key", () => {
    const text = describeLeagueSummaryHealth({
      ok: true,
      health: {
        keyConfigured: true,
        keyLength: 39,
        probe: { ok: false, note: "The key is restricted." },
      },
    });
    expect(text).toContain("would not accept it");
    expect(text).toContain("The key is restricted.");
  });

  it("flags a key pasted with stray whitespace", () => {
    const text = describeLeagueSummaryHealth({
      ok: true,
      health: {
        keyConfigured: true,
        keyLength: 39,
        keyHadSurroundingWhitespace: true,
        probe: { ok: true, modelCount: 3, candidates: ["gemini-3-flash"] },
      },
    });
    expect(text).toContain("stray whitespace");
  });
});
