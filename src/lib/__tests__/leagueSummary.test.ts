import { describe, expect, it } from "vitest";
import {
  buildLeagueSummaryPrompt,
  LEAGUE_SUMMARY_LIMITS,
  normalizeSummaryText,
  sanitizeLeagueSummaryRequest,
  type LeagueSummaryRequest,
} from "../leagueSummary";

const validBody = () => ({
  seasonLabel: "2026 Spring",
  cutoff: 8,
  updateTitle: "Latest Update — 5/12",
  finalScores: ["Stallions 7, Wolves 3"],
  facts: [
    { kind: "clinched", text: "Stallions clinched a Gold Bracket spot.", impactScore: 95 },
    { kind: "rank-change", text: "Wolves slipped from #7 to #9.", impactScore: 58 },
  ],
  standings: [
    {
      rank: 1,
      name: "Stallions",
      record: "10-2",
      goldPct: 99.4,
      status: "Clinched",
      insideCut: true,
    },
    { rank: 9, name: "Wolves", record: "6-6", goldPct: 21.2, status: "Alive", insideCut: false },
  ],
  fallback: "Deterministic story.",
});

describe("sanitizeLeagueSummaryRequest", () => {
  it("accepts a well formed body", () => {
    const request = sanitizeLeagueSummaryRequest(validBody());
    expect(request?.seasonLabel).toBe("2026 Spring");
    expect(request?.cutoff).toBe(8);
    expect(request?.facts).toHaveLength(2);
    expect(request?.standings?.[0]?.insideCut).toBe(true);
  });

  it("rejects non-objects and bodies with no usable facts", () => {
    expect(sanitizeLeagueSummaryRequest(null)).toBeNull();
    expect(sanitizeLeagueSummaryRequest("nope")).toBeNull();
    expect(sanitizeLeagueSummaryRequest({ facts: [] })).toBeNull();
    expect(sanitizeLeagueSummaryRequest({ facts: [{ text: "   " }] })).toBeNull();
    expect(sanitizeLeagueSummaryRequest({ facts: "not-an-array" })).toBeNull();
  });

  it("clamps list lengths so one client cannot inflate the prompt", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: Array.from({ length: 60 }, (_, i) => ({ kind: "rank-change", text: `fact ${i}` })),
      standings: Array.from({ length: 60 }, (_, i) => ({ rank: i + 1, name: `Team ${i}` })),
      finalScores: Array.from({ length: 60 }, (_, i) => `score ${i}`),
    });
    expect(request?.facts).toHaveLength(LEAGUE_SUMMARY_LIMITS.facts);
    expect(request?.standings).toHaveLength(LEAGUE_SUMMARY_LIMITS.standings);
    expect(request?.finalScores).toHaveLength(LEAGUE_SUMMARY_LIMITS.finalScores);
  });

  it("truncates long strings and collapses whitespace", () => {
    const request = sanitizeLeagueSummaryRequest({
      seasonLabel: "S".repeat(500),
      facts: [{ kind: "note", text: `spaced   out\n\ntext ${"x".repeat(900)}` }],
    });
    expect(request?.seasonLabel).toHaveLength(LEAGUE_SUMMARY_LIMITS.labelLength);
    expect(request?.facts[0]?.text).toHaveLength(LEAGUE_SUMMARY_LIMITS.textLength);
    expect(request?.facts[0]?.text.startsWith("spaced out text")).toBe(true);
  });

  it("coerces bad numbers into range", () => {
    const request = sanitizeLeagueSummaryRequest({
      cutoff: -12,
      facts: [{ text: "something moved", impactScore: 5000 }],
      standings: [{ rank: "nope", name: "Wolves", goldPct: 412 }],
    });
    expect(request?.cutoff).toBe(1);
    expect(request?.facts[0]?.impactScore).toBe(100);
    expect(request?.standings?.[0]?.rank).toBe(0);
    expect(request?.standings?.[0]?.goldPct).toBe(100);
  });

  it("defaults the season label and ignores unknown fields", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [{ text: "movement" }],
      sneaky: "ignored",
    }) as LeagueSummaryRequest & { sneaky?: string };
    expect(request.seasonLabel).toBe("Season");
    expect(request.sneaky).toBeUndefined();
  });
});

describe("buildLeagueSummaryPrompt", () => {
  it("includes the facts, scores, table, and cut line", () => {
    const request = sanitizeLeagueSummaryRequest(validBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);

    expect(prompt).toContain("Season: 2026 Spring");
    expect(prompt).toContain("Update: Latest Update — 5/12");
    expect(prompt).toContain("top 8 teams qualify");
    expect(prompt).toContain("Stallions 7, Wolves 3");
    expect(prompt).toContain("[clinched] Stallions clinched a Gold Bracket spot.");
    expect(prompt).toContain("#1 Stallions (10-2) — 99% Gold odds, Clinched, inside the cut line");
    expect(prompt).toContain("END DATA");
  });

  it("orders facts by impact so the model leads with the biggest move", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [
        { kind: "gold-shift", text: "low impact", impactScore: 10 },
        { kind: "clinched", text: "high impact", impactScore: 95 },
      ],
    }) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt.indexOf("high impact")).toBeLessThan(prompt.indexOf("low impact"));
  });

  it("passes the deterministic story to the model as reference material", () => {
    const request = sanitizeLeagueSummaryRequest(validBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("Reference summary of these same facts");
    expect(prompt).toContain("Deterministic story.");
  });

  it("omits optional sections that carry no data", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [{ text: "movement" }],
    }) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).not.toContain("Final scores");
    expect(prompt).not.toContain("Current table");
    expect(prompt).not.toContain("Reference summary");
  });
});

describe("normalizeSummaryText", () => {
  it("keeps plain prose untouched", () => {
    expect(normalizeSummaryText("The Stallions clinched. The Wolves fell out.")).toBe(
      "The Stallions clinched. The Wolves fell out."
    );
  });

  it("strips markdown the model was told not to use", () => {
    const raw = "## Recap\n\n- **Stallions** clinched.\n- Wolves *slipped* to #9.";
    expect(normalizeSummaryText(raw)).toBe("Recap Stallions clinched. Wolves slipped to #9.");
  });

  it("removes code fences, numbered lists, and wrapping quotes", () => {
    expect(normalizeSummaryText("```\n1. Stallions clinched.\n```")).toBe("Stallions clinched.");
    expect(normalizeSummaryText('"Stallions clinched."')).toBe("Stallions clinched.");
  });

  it("caps runaway output", () => {
    expect(normalizeSummaryText("x".repeat(5000))).toHaveLength(1200);
  });

  it("returns an empty string for blank output", () => {
    expect(normalizeSummaryText("   \n\n  ")).toBe("");
  });
});
