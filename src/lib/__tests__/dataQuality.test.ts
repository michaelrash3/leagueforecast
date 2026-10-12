import { describe, expect, it } from "vitest";
import { auditLeagueData, dismissFinding, visibleFindings } from "../dataQuality";
import { DEFAULT_SETTINGS, type GameLog, type Matchup } from "../types";

const teams = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
];
const final = (awayRuns = "4", homeRuns = "2"): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const audit = (matchups: Matchup[], logs: Record<string, GameLog> = {}) =>
  auditLeagueData({
    teams,
    matchups,
    logs,
    settings: { ...DEFAULT_SETTINGS, regularSeasonGamesPerTeam: 0 },
  });

describe("league data-quality audit", () => {
  it("finds duplicate fixtures and escalates duplicate finals", () => {
    const games = [
      { id: "g1", date: "10/1", away: "A", home: "B" },
      { id: "g2", date: "10/1", away: "B", home: "A" },
    ];
    const duplicate = audit(games, { g1: final(), g2: final() }).find(
      (item) => item.code === "duplicate-fixture"
    );
    expect(duplicate).toMatchObject({
      severity: "needs-attention",
      gameIds: ["g1", "g2"],
      safeRepair: "remove-duplicate",
      affectsForecast: true,
    });
  });

  it("finds missing and invalid dates without treating a valid date as invalid", () => {
    const findings = audit([
      { id: "blank", date: "", away: "A", home: "B" },
      { id: "bad", date: "tomorrowish", away: "A", home: "C" },
      { id: "good", date: "10/2", away: "B", home: "C" },
    ]);
    expect(
      findings.filter((item) => item.code === "missing-date").map((item) => item.gameIds)
    ).toEqual([["blank"]]);
    expect(
      findings.filter((item) => item.code === "invalid-date").map((item) => item.gameIds)
    ).toEqual([["bad"]]);
  });

  it("finds scores and team references that cannot be simulated", () => {
    const findings = audit([{ id: "g1", date: "10/1", away: "A", home: "missing" }], {
      g1: final("100", "2"),
    });
    expect(findings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["unknown-team", "implausible-score"])
    );
  });

  it("reports schedule totals and uneven schedules at their false-positive boundaries", () => {
    const games: Matchup[] = [
      { id: "g1", date: "10/1", away: "A", home: "B" },
      { id: "g2", date: "10/2", away: "A", home: "B" },
      { id: "g3", date: "10/3", away: "A", home: "C" },
      { id: "g4", date: "10/4", away: "A", home: "B" },
    ];
    expect(audit(games).some((item) => item.code === "uneven-schedule")).toBe(true);
    const exact = auditLeagueData({
      teams,
      matchups: [
        { id: "e1", date: "10/1", away: "A", home: "B" },
        { id: "e2", date: "10/2", away: "B", home: "C" },
        { id: "e3", date: "10/3", away: "C", home: "A" },
      ],
      logs: {},
      settings: { ...DEFAULT_SETTINGS, regularSeasonGamesPerTeam: 2 },
    });
    expect(exact.some((item) => item.code === "schedule-total-mismatch")).toBe(false);
  });
});

describe("finding dismissals", () => {
  it("stays dismissed while its fingerprint and severity are unchanged", () => {
    const finding = audit([{ id: "g1", date: "", away: "A", home: "B" }]).find(
      (item) => item.code === "missing-date"
    )!;
    const dismissed = dismissFinding({}, finding, "now");
    expect(visibleFindings([finding], dismissed)).toEqual([]);
    expect(visibleFindings([{ ...finding, severity: "needs-attention" }], dismissed)).toHaveLength(
      1
    );
  });

  it("reopens when the affected value changes its fingerprint", () => {
    const first = audit([{ id: "g1", date: "bad-one", away: "A", home: "B" }]).find(
      (item) => item.code === "invalid-date"
    )!;
    const changed = audit([{ id: "g1", date: "bad-two", away: "A", home: "B" }]).find(
      (item) => item.code === "invalid-date"
    )!;
    expect(visibleFindings([changed], dismissFinding({}, first, "now"))).toEqual([changed]);
  });
});
