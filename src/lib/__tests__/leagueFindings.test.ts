import { describe, expect, it } from "vitest";
import {
  auditLeague,
  daysFromToday,
  isDismissed,
  repairIsDestructive,
  repairPreview,
  severityCounts,
  type Finding,
  type FindingCode,
  type LeagueAuditInput,
} from "../leagueFindings";
import type { ScoutLinkRow } from "../teamRankings";
import { DEFAULT_SETTINGS, type GameLog, type Matchup } from "../types";

/** Placeholder teams; "today" is 10 June, a season played from April into July. */
const TODAY = new Date(2026, 5, 10, 12);

const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const open = (away = "", home = ""): GameLog => ({ ...final(away, home), isFinal: false });

const TEAMS = ["Aces", "Bears", "Comets", "Ducks"].map((name) => ({ id: name[0] ?? name, name }));

/** Each pair once, all played well before today: a clean season. */
const CLEAN: Matchup[] = [
  { id: "g1", date: "4/5", away: "A", home: "B" },
  { id: "g2", date: "4/5", away: "C", home: "D" },
  { id: "g3", date: "4/12", away: "A", home: "C" },
  { id: "g4", date: "4/12", away: "B", home: "D" },
  { id: "g5", date: "4/19", away: "A", home: "D" },
  { id: "g6", date: "4/19", away: "B", home: "C" },
];
const CLEAN_LOGS: Record<string, GameLog> = Object.fromEntries(
  CLEAN.map((game, at) => [game.id, final(String(3 + at), String(at % 3))])
);

const audit = (change: Partial<LeagueAuditInput> = {}) =>
  auditLeague({
    teams: TEAMS,
    matchups: CLEAN,
    logs: CLEAN_LOGS,
    settings: { ...DEFAULT_SETTINGS, goldCutoff: 2, regularSeasonGamesPerTeam: 0 },
    today: TODAY,
    ...change,
  });

const only = (findings: Finding[], code: FindingCode) => {
  const found = findings.filter((finding) => finding.code === code);
  expect(found).toHaveLength(1);
  return found[0] as Finding;
};
const codes = (findings: Finding[]) => findings.map((finding) => finding.code);
const gameIds = (finding: Finding) =>
  finding.targets.filter((target) => target.kind === "game").map((target) => target.id);
const teamIds = (finding: Finding) =>
  finding.targets.filter((target) => target.kind === "team").map((target) => target.id);

describe("auditing a League Standings season", () => {
  it("finds nothing in a clean season", () => {
    expect(audit()).toEqual([]);
  });

  it("says when one team is too few to forecast, and nothing of a season not set up yet", () => {
    expect(
      only(audit({ teams: TEAMS.slice(0, 1), matchups: [], logs: {} }), "too-few-teams").severity
    ).toBe("attention");
    expect(audit({ teams: [], matchups: [], logs: {} })).toEqual([]);
  });

  it("finds games with a team not on the roster, and a team against itself", () => {
    const matchups = [
      ...CLEAN,
      { id: "x1", date: "4/26", away: "A", home: "Z" },
      { id: "x2", date: "4/26", away: "B", home: "B" },
    ];
    const findings = audit({ matchups });
    expect(gameIds(only(findings, "unknown-team"))).toEqual(["x1"]);
    expect(gameIds(only(findings, "self-game"))).toEqual(["x2"]);
  });

  it("finds a final with a score missing, and not one with both, a zero included", () => {
    const findings = audit({ logs: { ...CLEAN_LOGS, g1: final("5", ""), g2: final("0", "0") } });
    const finding = only(findings, "final-without-score");
    expect(gameIds(finding)).toEqual(["g1"]);
    expect(finding.affectsForecast).toBe(true);
  });

  describe("the same game twice", () => {
    const twice = [...CLEAN, { id: "g1b", date: "04/05", away: "B", home: "A" }];

    it("is the same pair on the same day, either way round", () => {
      const finding = only(audit({ matchups: twice }), "duplicate-game");
      expect(gameIds(finding).sort()).toEqual(["g1", "g1b"]);
      expect(finding.severity).toBe("review");
      // The copy with nothing entered can go; the scored one stays.
      expect(finding.repair).toEqual({ kind: "removeGames", gameIds: ["g1b"] });
    });

    it("affects the forecast while a copy is not final, since the forecast plays it", () => {
      expect(only(audit({ matchups: twice }), "duplicate-game").affectsForecast).toBe(true);
      // Neither copy played yet: the pair is simulated twice, and each has a game too many left.
      const ahead = [
        ...CLEAN,
        { id: "f1", date: "6/20", away: "C", home: "D" },
        { id: "f1b", date: "6/20", away: "C", home: "D" },
      ];
      const finding = only(audit({ matchups: ahead }), "duplicate-game");
      expect(finding.affectsForecast).toBe(true);
      expect(finding.repair).toEqual({ kind: "removeGames", gameIds: ["f1b"] });
    });

    it("is worth reviewing when two finals have one score, and can be put aside", () => {
      // Aces 3, Bears 0 on both cards, entered either way round.
      const finding = only(
        audit({ matchups: twice, logs: { ...CLEAN_LOGS, g1b: final("0", "3") } }),
        "duplicate-game"
      );
      expect(finding.severity).toBe("review");
      expect(finding.affectsForecast).toBe(true);
      expect(finding.repair).toBeUndefined();
      expect(finding.detail).toMatch(/doubleheader/);
      expect(isDismissed(finding, { [finding.fingerprint]: finding.severity })).toBe(true);
    });

    it("is not a rematch on another day, nor two undated games", () => {
      const rematch = [...CLEAN, { id: "r1", date: "5/3", away: "B", home: "A" }];
      expect(codes(audit({ matchups: rematch }))).not.toContain("duplicate-game");
      const undated = [
        ...CLEAN,
        { id: "u1", date: "", away: "A", home: "B" },
        { id: "u2", date: "", away: "A", home: "B" },
      ];
      expect(codes(audit({ matchups: undated }))).not.toContain("duplicate-game");
    });
  });

  describe("a doubleheader", () => {
    // The league writes no time, so two games of one pair on one day look like a copy.
    const doubleheader = [
      ...CLEAN,
      { id: "d1", date: "6/20", away: "A", home: "B" },
      { id: "d2", date: "6/20", away: "B", home: "A" },
    ];
    const played = (second: GameLog) => ({ ...CLEAN_LOGS, d1: final("5", "3"), d2: second });

    it("is named as what it may be before it is played, and can be put aside", () => {
      const finding = only(audit({ matchups: doubleheader }), "duplicate-game");
      expect(finding.severity).toBe("review");
      expect(finding.detail).toMatch(/doubleheader/);
      expect(finding.suggestion).toMatch(/doubleheader/);
      expect(isDismissed(finding, { [finding.fingerprint]: finding.severity })).toBe(true);
    });

    it("is information once both are final with different scores, never a game counted twice", () => {
      // Aces 5-3 and then 8-2: two games played, not one entered twice.
      const finding = only(
        audit({ matchups: doubleheader, logs: played(final("2", "8")) }),
        "duplicate-game"
      );
      expect(finding.severity).toBe("info");
      expect(finding.affectsForecast).toBe(false);
      expect(finding.summary).toBe("Aces and Bears played 2 games on 6/20");
      expect(finding.detail).not.toMatch(/counts? 2 times/);
      expect(finding.repair).toBeUndefined();
    });

    it("stays aside once played, unless the two finals come out with one score", () => {
      const before = only(audit({ matchups: doubleheader }), "duplicate-game");
      const aside = { [before.fingerprint]: before.severity };
      const differ = only(
        audit({ matchups: doubleheader, logs: played(final("2", "8")) }),
        "duplicate-game"
      );
      expect(isDismissed(differ, aside)).toBe(true);
      // Bears 3, Aces 5 again: what one game entered twice looks like, so it is asked again.
      const same = only(
        audit({ matchups: doubleheader, logs: played(final("3", "5")) }),
        "duplicate-game"
      );
      expect(same.severity).toBe("review");
      expect(isDismissed(same, aside)).toBe(false);
    });
  });

  it("finds undated games and dates that cannot be read", () => {
    const matchups = [
      ...CLEAN,
      { id: "u1", date: "", away: "A", home: "B" },
      { id: "u2", date: "next week", away: "C", home: "D" },
    ];
    const findings = audit({ matchups });
    expect(gameIds(only(findings, "missing-date"))).toEqual(["u1"]);
    expect(gameIds(only(findings, "invalid-date"))).toEqual(["u2"]);
  });

  describe("past games not finished", () => {
    const later = [
      ...CLEAN,
      { id: "p1", date: "6/9", away: "A", home: "B" },
      { id: "p2", date: "6/9", away: "C", home: "D" },
      { id: "t1", date: "6/10", away: "A", home: "C" },
      { id: "f1", date: "6/20", away: "B", home: "D" },
    ];

    it("are scored ones not marked final, which can be marked final", () => {
      const finding = only(
        audit({ matchups: later, logs: { ...CLEAN_LOGS, p1: open("4", "2") } }),
        "scored-not-final"
      );
      expect(gameIds(finding)).toEqual(["p1"]);
      expect(finding.severity).toBe("attention");
      expect(finding.repair).toEqual({ kind: "markFinal", gameIds: ["p1"] });
    });

    it("and ones without a score; today's and later games are not past", () => {
      const findings = audit({
        matchups: later,
        logs: { ...CLEAN_LOGS, p1: open("4", "2"), t1: open("1", "0") },
      });
      expect(gameIds(only(findings, "past-unplayed"))).toEqual(["p2"]);
      expect(gameIds(only(findings, "scored-not-final"))).toEqual(["p1"]);
    });

    it("read each date in the year nearest today", () => {
      expect(daysFromToday("6/9", TODAY)).toBe(-1);
      expect(daysFromToday("6/10", TODAY)).toBe(0);
      // Seen in February, a March game is next month's, not last year's.
      expect(daysFromToday("3/5", new Date(2027, 1, 10))).toBe(23);
      // Seen in October, a May game is this spring's.
      expect(daysFromToday("5/3", new Date(2026, 9, 1))).toBeLessThan(0);
      expect(daysFromToday("", TODAY)).toBeNull();
      // Across New Year: a late-December game seen in January was last week, not next December.
      expect(daysFromToday("12/28", new Date(2027, 0, 5))).toBe(-8);
      expect(daysFromToday("1/3", new Date(2026, 11, 30))).toBe(4);
    });
  });

  it("finds an unusual final score, and not one at the limits", () => {
    const logs = {
      ...CLEAN_LOGS,
      g1: final("41", "3"),
      g2: final("31", "0"),
      g3: final("40", "10"),
      g4: final("30", "0"),
    };
    expect(gameIds(only(audit({ logs }), "implausible-score")).sort()).toEqual(["g1", "g2"]);
  });

  it("finds an uneven schedule, and not a difference of one game", () => {
    const short = CLEAN.filter((game) => game.id !== "g6");
    expect(codes(audit({ matchups: short }))).not.toContain("uneven-schedule");
    const shorter = short.filter((game) => game.id !== "g4");
    const finding = only(audit({ matchups: shorter }), "uneven-schedule");
    expect(teamIds(finding)).toEqual(["B"]);
    expect(finding.severity).toBe("info");
  });

  describe("games per team against the schedule", () => {
    it("finds teams with fewer scheduled, offering the schedule's count when even", () => {
      const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2, regularSeasonGamesPerTeam: 5 };
      const finding = only(audit({ settings }), "short-schedule");
      expect(teamIds(finding)).toEqual(["A", "B", "C", "D"]);
      expect(finding.repair).toEqual({ kind: "gamesPerTeam", from: 5, to: 3 });
      expect(finding.affectsForecast).toBe(true);
    });

    it("is quiet when the setting is the schedule's, fewer, or unset", () => {
      for (const regularSeasonGamesPerTeam of [3, 2, 0]) {
        const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2, regularSeasonGamesPerTeam };
        expect(codes(audit({ settings }))).not.toContain("short-schedule");
      }
    });

    it("offers no count when the schedule itself is uneven", () => {
      const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2, regularSeasonGamesPerTeam: 5 };
      const matchups = CLEAN.filter((game) => game.id !== "g6");
      expect(only(audit({ settings, matchups }), "short-schedule").repair).toBeUndefined();
    });
  });

  it("finds teams without a final, worth a look once the league has played some", () => {
    const early = { g1: final("3", "1") };
    const finding = only(audit({ logs: early }), "team-without-results");
    expect(teamIds(finding)).toEqual(["C", "D"]);
    expect(finding.severity).toBe("info");
    // Nothing played at all is a season not started, not a finding.
    expect(codes(audit({ logs: {} }))).not.toContain("team-without-results");
    const games = [
      ...CLEAN,
      ...CLEAN.map((game) => ({ ...game, id: `${game.id}b`, date: "5/3" })),
      ...CLEAN.map((game) => ({ ...game, id: `${game.id}c`, date: "5/10" })),
    ];
    const played = Object.fromEntries(
      games
        .filter((game) => game.away !== "D" && game.home !== "D")
        .map((g) => [g.id, final("2", "1")])
    );
    expect(only(audit({ matchups: games, logs: played }), "team-without-results").severity).toBe(
      "review"
    );
  });

  it("finds two teams of one name, whatever their case and spacing", () => {
    const teams = [...TEAMS, { id: "E", name: " aces  " }];
    expect(teamIds(only(audit({ teams }), "duplicate-team-name"))).toEqual(["A", "E"]);
  });

  it("finds a cut line every team is on one side of, only where there is a cut", () => {
    const cut = (goldCutoff: number, postseasonFormat = DEFAULT_SETTINGS.postseasonFormat) => ({
      settings: { ...DEFAULT_SETTINGS, goldCutoff, postseasonFormat, regularSeasonGamesPerTeam: 0 },
    });
    expect(only(audit(cut(4, "cut")), "cut-line").severity).toBe("attention");
    expect(codes(audit(cut(0, "cut")))).toContain("cut-line");
    expect(codes(audit(cut(3, "cut")))).not.toContain("cut-line");
    expect(codes(audit(cut(4, "all")))).not.toContain("cut-line");
  });

  describe("links to Team Rankings", () => {
    const row = (leagueTeamId: string, more: Partial<ScoutLinkRow>): ScoutLinkRow => ({
      leagueTeamId,
      leagueTeamName: leagueTeamId,
      how: "picked",
      ...more,
    });

    it("finds a picked club gone, a club shared, and a guess among namesakes", () => {
      const links = [
        row("A", { how: "none", staleScoutTeamId: "old" }),
        row("B", { scoutTeamId: "s1", conflictWith: ["C"] }),
        row("C", { scoutTeamId: "s1", conflictWith: ["B"] }),
        row("D", { how: "guessed", scoutTeamId: "s2", ambiguousCount: 3 }),
      ];
      const findings = audit({ links });
      expect(teamIds(only(findings, "link-gone"))).toEqual(["A"]);
      expect(teamIds(only(findings, "link-shared"))).toEqual(["B", "C"]);
      expect(teamIds(only(findings, "link-ambiguous"))).toEqual(["D"]);
      expect(only(findings, "link-shared").severity).toBe(
        DEFAULT_SETTINGS.useScoutResults ? "attention" : "review"
      );
    });

    it("leaves a picked club alone however many share its name", () => {
      const links = [row("A", { scoutTeamId: "s1", ambiguousCount: 4 })];
      expect(codes(audit({ links }))).not.toContain("link-ambiguous");
    });
  });

  it("puts what needs attention first, and counts each severity", () => {
    const findings = audit({
      matchups: [...CLEAN, { id: "u1", date: "", away: "A", home: "B" }],
      logs: { ...CLEAN_LOGS, g1: final("5", "") },
    });
    expect(findings.map((finding) => finding.severity)).toEqual(["attention", "info"]);
    expect(severityCounts(findings)).toEqual({ attention: 1, review: 0, info: 1 });
  });
});

describe("putting a finding aside", () => {
  const undated = (ids: string[]) =>
    only(
      audit({
        matchups: [...CLEAN, ...ids.map((id) => ({ id, date: "", away: "A", home: "B" }))],
      }),
      "missing-date"
    );

  it("lasts while what it is about is unchanged", () => {
    const finding = undated(["u1"]);
    const dismissals = { [finding.fingerprint]: finding.severity };
    expect(isDismissed(undated(["u1"]), dismissals)).toBe(true);
    // Another undated game is another finding.
    expect(isDismissed(undated(["u1", "u2"]), dismissals)).toBe(false);
  });

  it("ends when the finding grows more serious", () => {
    const early = only(audit({ logs: { g1: final("3", "1") } }), "team-without-results");
    expect(early.severity).toBe("info");
    const dismissals = { [early.fingerprint]: early.severity };
    expect(isDismissed(early, dismissals)).toBe(true);
    const later: Finding = { ...early, severity: "review" };
    expect(isDismissed(later, dismissals)).toBe(false);
    expect(isDismissed(later, { [early.fingerprint]: "review" })).toBe(true);
  });

  it("is never allowed for what needs attention", () => {
    const finding = only(
      audit({ logs: { ...CLEAN_LOGS, g1: final("5", "") } }),
      "final-without-score"
    );
    expect(isDismissed(finding, { [finding.fingerprint]: "attention" })).toBe(false);
  });
});

describe("previewing a repair", () => {
  it("names each game and score it touches", () => {
    const season = { teams: TEAMS, matchups: CLEAN, logs: { ...CLEAN_LOGS, g1: open("4", "2") } };
    expect(repairPreview({ kind: "markFinal", gameIds: ["g1"] }, season)).toEqual([
      "Mark Aces at Bears, 4/5 final at 4-2.",
    ]);
    expect(repairPreview({ kind: "removeGames", gameIds: ["g2"] }, season)).toEqual([
      "Delete Comets at Ducks, 4/5 (no score entered).",
    ]);
    expect(repairPreview({ kind: "gamesPerTeam", from: 5, to: 3 }, season)).toEqual([
      "Change games per team from 5 to 3.",
    ]);
  });

  it("asks before deleting, and only then", () => {
    expect(repairIsDestructive({ kind: "removeGames", gameIds: ["g1"] })).toBe(true);
    expect(repairIsDestructive({ kind: "markFinal", gameIds: ["g1"] })).toBe(false);
    expect(repairIsDestructive({ kind: "gamesPerTeam", from: 5, to: 3 })).toBe(false);
  });
});
