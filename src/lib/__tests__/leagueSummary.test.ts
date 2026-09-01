import { describe, expect, it } from "vitest";
import {
  buildLeagueSummaryPrompt,
  leagueSummarySignature,
  systemInstructionForKind,
  LEAGUE_FORECAST_SYSTEM_INSTRUCTION,
  LEAGUE_SUMMARY_SYSTEM_INSTRUCTION,
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
  powerRatings: [
    {
      rank: 1,
      name: "Stallions",
      rating: 4.2,
      record: "10-2",
      trend: "Up",
      recentForm: 2.1,
      sosRank: 3,
    },
    {
      rank: 2,
      name: "Wolves",
      rating: -0.8,
      record: "6-6",
      trend: "Down",
      recentForm: -1.4,
      sosRank: 1,
    },
  ],
  statLeaders: [
    {
      metric: "Runs per game",
      leaderName: "Stallions",
      leaderValue: 8.4,
      runnerUpName: "Wolves",
      runnerUpValue: 6.1,
      leagueAverage: 5.2,
      direction: "desc",
    },
    {
      metric: "Runs allowed per game",
      leaderName: "Wolves",
      leaderValue: 3.2,
      leagueAverage: 5.2,
      direction: "asc",
    },
  ],
  season: { finalGames: 12, totalGames: 36, leaderName: "Stallions", gamesPerTeam: 12 },
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

  it("clamps the power rating and stat leader lists too", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [{ text: "movement" }],
      powerRatings: Array.from({ length: 60 }, (_, i) => ({ rank: i + 1, name: `Team ${i}` })),
      statLeaders: Array.from({ length: 60 }, (_, i) => ({
        metric: `Metric ${i}`,
        leaderName: "Team",
      })),
    });
    expect(request?.powerRatings).toHaveLength(LEAGUE_SUMMARY_LIMITS.powerRatings);
    expect(request?.statLeaders).toHaveLength(LEAGUE_SUMMARY_LIMITS.statLeaders);
  });

  it("drops stat leaders that name no metric or no leader", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [{ text: "movement" }],
      statLeaders: [
        { metric: "", leaderName: "Wolves" },
        { metric: "Runs per game", leaderName: "" },
        { metric: "Hits per game", leaderName: "Wolves", leaderValue: 9.2, direction: "desc" },
      ],
    });
    expect(request?.statLeaders?.map((row) => row.metric)).toEqual(["Hits per game"]);
    expect(request?.statLeaders?.[0]?.leaderValue).toBe(9.2);
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

  it("includes power ratings with the opponent-adjusted framing", () => {
    const request = sanitizeLeagueSummaryRequest(validBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("Power ratings");
    expect(prompt).toContain("#1 Stallions (10-2) — rating +4.2 runs");
    expect(prompt).toContain("recent form -1.4, trending Down, SOS rank 1");
  });

  it("includes stat leaders with direction, runner-up, and league average", () => {
    const request = sanitizeLeagueSummaryRequest(validBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain(
      "Runs per game (higher is better): Stallions at 8.4; next is Wolves at 6.1; league average 5.2"
    );
    expect(prompt).toContain("Runs allowed per game (lower is better): Wolves at 3.2");
  });

  it("includes season context so the model knows how thin the sample is", () => {
    const request = sanitizeLeagueSummaryRequest(validBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("Games finalized so far: 12 of 36.");
    expect(prompt).toContain("Regular season is 12 games per team.");
    expect(prompt).toContain("Current leader: Stallions.");
  });

  it("passes the deterministic story to the model as reference material", () => {
    const request = sanitizeLeagueSummaryRequest(validBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("Reference summary of the standings movement");
    expect(prompt).toContain("Deterministic story.");
  });

  it("omits optional sections that carry no data", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [{ text: "movement" }],
    }) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).not.toContain("Final scores");
    expect(prompt).not.toContain("Current standings");
    expect(prompt).not.toContain("Reference summary");
    expect(prompt).not.toContain("Power ratings");
    expect(prompt).not.toContain("Stat leaders");
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
    expect(normalizeSummaryText(raw)).toBe("Recap\n\nStallions clinched.\nWolves slipped to #9.");
  });

  it("keeps paragraph breaks so a multi-paragraph analysis stays readable", () => {
    const raw = "The Stallions clinched.\nIt was never close.\n\nThe Wolves fell out.";
    expect(normalizeSummaryText(raw)).toBe(
      "The Stallions clinched. It was never close.\n\nThe Wolves fell out."
    );
  });

  it("removes code fences, numbered lists, and wrapping quotes", () => {
    expect(normalizeSummaryText("```\n1. Stallions clinched.\n```")).toBe("Stallions clinched.");
    expect(normalizeSummaryText('"Stallions clinched."')).toBe("Stallions clinched.");
  });

  it("caps runaway output", () => {
    expect(normalizeSummaryText("x".repeat(9000))).toHaveLength(
      LEAGUE_SUMMARY_LIMITS.summaryLength
    );
  });

  it("returns an empty string for blank output", () => {
    expect(normalizeSummaryText("   \n\n  ")).toBe("");
  });
});

const forecastBody = () => ({
  kind: "forecast",
  seasonLabel: "2026 Spring",
  cutoff: 7,
  facts: [],
  projections: [
    {
      projectedRank: 1,
      name: "Stallions",
      currentRank: 3,
      projectedRecord: "14-4",
      goldPct: 92.4,
      goldMargin: 5,
      bestSeed: 1,
      worstSeed: 4,
      insideCut: true,
    },
    {
      projectedRank: 8,
      name: "Wolves",
      currentRank: 6,
      projectedRecord: "9-9",
      goldPct: 41.2,
      goldMargin: 6,
      bestSeed: 4,
      worstSeed: 12,
      insideCut: false,
    },
  ],
  gameForecasts: [
    {
      matchup: "Wolves at Stallions",
      favorite: "Stallions",
      winPct: 63,
      impact: "High",
      date: "9/20",
    },
  ],
  keyGames: [
    { label: "Wolves at Bandits", reason: "Winner takes the final Gold slot.", date: "9/21" },
  ],
  modelAccuracy: { gamesEvaluated: 40, brierScore: 0.183, hitRate: 71.5, upsetCaptureRate: 33.3 },
});

describe("forecast write-up", () => {
  it("uses the forecast system instruction, not the recap one", () => {
    expect(systemInstructionForKind("forecast")).toBe(LEAGUE_FORECAST_SYSTEM_INSTRUCTION);
    expect(systemInstructionForKind("league-story")).toBe(LEAGUE_SUMMARY_SYSTEM_INSTRUCTION);
  });

  it("tells the model to respect uncertainty and never state a projection as fact", () => {
    expect(LEAGUE_FORECAST_SYSTEM_INSTRUCTION).toContain("close to a coin flip");
    expect(LEAGUE_FORECAST_SYSTEM_INSTRUCTION).toContain("These are projections, never outcomes.");
  });

  it("accepts a forecast with no recap facts", () => {
    const request = sanitizeLeagueSummaryRequest(forecastBody());
    expect(request?.kind).toBe("forecast");
    expect(request?.facts).toEqual([]);
    expect(request?.projections).toHaveLength(2);
  });

  it("still rejects a body with nothing to write about", () => {
    expect(
      sanitizeLeagueSummaryRequest({ kind: "forecast", facts: [], projections: [] })
    ).toBeNull();
  });

  it("defaults an unknown kind to the league story", () => {
    const request = sanitizeLeagueSummaryRequest({ kind: "nonsense", facts: [{ text: "moved" }] });
    expect(request?.kind).toBe("league-story");
  });

  it("renders projections with seed range, margin of error, and cut-line side", () => {
    const request = sanitizeLeagueSummaryRequest(forecastBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain(
      "#1 Stallions (currently #3) — projected 14-4, 92% ±5 Gold odds, projects inside the cut line, realistic seed range #1–#4"
    );
    expect(prompt).toContain("#8 Wolves (currently #6)");
    expect(prompt).toContain("projects outside the cut line");
  });

  it("renders game predictions and the games that matter most", () => {
    const request = sanitizeLeagueSummaryRequest(forecastBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("9/20: Wolves at Stallions — Stallions favored at 63%, high impact");
    expect(prompt).toContain("9/21: Wolves at Bandits — Winner takes the final Gold slot.");
  });

  it("explains the accuracy numbers rather than dumping them", () => {
    const request = sanitizeLeagueSummaryRequest(forecastBody()) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("measured over 40 finished games");
    expect(prompt).toContain("72% of picks correct");
    expect(prompt).toContain("Brier score 0.183 (0 is perfect, 0.25 is a coin flip)");
    expect(prompt).toContain("33% of upsets called");
  });

  it("closes with the forecast instruction instead of the recap one", () => {
    const request = sanitizeLeagueSummaryRequest(forecastBody()) as LeagueSummaryRequest;
    expect(buildLeagueSummaryPrompt(request)).toContain(
      "Write the forecast write-up for the rest of the season"
    );
  });

  it("omits the standings-movement section when there are no facts", () => {
    const request = sanitizeLeagueSummaryRequest(forecastBody()) as LeagueSummaryRequest;
    expect(buildLeagueSummaryPrompt(request)).not.toContain("Standings movement");
  });
});

describe("leagueSummarySignature", () => {
  it("is empty when there is nothing to write about, so no request is made", () => {
    expect(leagueSummarySignature(null)).toBe("");
    expect(
      leagueSummarySignature(
        sanitizeLeagueSummaryRequest({ facts: [{ text: "moved" }] }) as LeagueSummaryRequest
      )
    ).not.toBe("");
  });

  it("keys a forecast on its projections even though it carries no recap facts", () => {
    // Regression: the signature used to require facts, so the Forecast write-up
    // was never requested at all.
    const request = sanitizeLeagueSummaryRequest(forecastBody()) as LeagueSummaryRequest;
    expect(leagueSummarySignature(request)).not.toBe("");
  });

  it("ignores simulation jitter in a forecast", () => {
    const base = forecastBody();
    const jittered = {
      ...base,
      projections: base.projections.map((row) => ({ ...row, goldPct: row.goldPct + 1.4 })),
      gameForecasts: base.gameForecasts.map((game) => ({ ...game, winPct: game.winPct + 2 })),
    };
    const a = sanitizeLeagueSummaryRequest(base) as LeagueSummaryRequest;
    const b = sanitizeLeagueSummaryRequest(jittered) as LeagueSummaryRequest;
    expect(leagueSummarySignature(b)).toBe(leagueSummarySignature(a));
  });

  it("changes when the projected order changes", () => {
    const base = forecastBody();
    const reordered = {
      ...base,
      projections: [
        { ...base.projections[0], projectedRank: 2 },
        { ...base.projections[1], projectedRank: 1 },
      ],
    };
    const a = sanitizeLeagueSummaryRequest(base) as LeagueSummaryRequest;
    const b = sanitizeLeagueSummaryRequest(reordered) as LeagueSummaryRequest;
    expect(leagueSummarySignature(b)).not.toBe(leagueSummarySignature(a));
  });

  it("changes when another game goes final", () => {
    const a = sanitizeLeagueSummaryRequest({
      ...forecastBody(),
      season: { finalGames: 4, totalGames: 36 },
    }) as LeagueSummaryRequest;
    const b = sanitizeLeagueSummaryRequest({
      ...forecastBody(),
      season: { finalGames: 5, totalGames: 36 },
    }) as LeagueSummaryRequest;
    expect(leagueSummarySignature(b)).not.toBe(leagueSummarySignature(a));
  });

  it("changes when the recap facts change", () => {
    const a = sanitizeLeagueSummaryRequest({ facts: [{ text: "one" }] }) as LeagueSummaryRequest;
    const b = sanitizeLeagueSummaryRequest({ facts: [{ text: "two" }] }) as LeagueSummaryRequest;
    expect(leagueSummarySignature(b)).not.toBe(leagueSummarySignature(a));
  });
});

describe("prompts for a league with no cut line", () => {
  it("tells the model there is nothing to qualify for", () => {
    const request = sanitizeLeagueSummaryRequest({
      hasCutLine: false,
      facts: [{ kind: "rank-change", text: "Wolves climbed to #2." }],
      standings: [{ rank: 1, name: "Stallions", record: "10-2", goldPct: 0, status: "" }],
    }) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    expect(prompt).toContain("no playoff cut line");
    expect(prompt).toContain("Cover the race for the top of the table instead.");
    expect(prompt).not.toContain("teams qualify");
  });

  it("leaves Gold odds and cut-line sides out of the table", () => {
    const request = sanitizeLeagueSummaryRequest({
      hasCutLine: false,
      facts: [{ text: "moved" }],
      standings: [
        { rank: 1, name: "Stallions", record: "10-2", goldPct: 92, status: "In", insideCut: true },
      ],
    }) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    const row = prompt.split("\n").find((line) => line.includes("#1 Stallions")) ?? "";
    expect(row).toBe("- #1 Stallions (10-2)");
    expect(prompt).not.toContain("Gold odds");
  });

  it("leaves them out of the projection too", () => {
    const request = sanitizeLeagueSummaryRequest({
      kind: "forecast",
      hasCutLine: false,
      facts: [],
      projections: [
        {
          projectedRank: 1,
          name: "Stallions",
          projectedRecord: "14-4",
          goldPct: 92,
          insideCut: true,
        },
      ],
    }) as LeagueSummaryRequest;
    const prompt = buildLeagueSummaryPrompt(request);
    const row = prompt.split("\n").find((line) => line.includes("#1 Stallions")) ?? "";
    expect(row).toBe("- #1 Stallions — projected 14-4");
    expect(prompt).not.toContain("Gold odds");
  });

  it("defaults to having a cut line when the flag is absent", () => {
    const request = sanitizeLeagueSummaryRequest({
      facts: [{ text: "moved" }],
    }) as LeagueSummaryRequest;
    expect(request.hasCutLine).toBe(true);
    expect(buildLeagueSummaryPrompt(request)).toContain("teams qualify");
  });
});
