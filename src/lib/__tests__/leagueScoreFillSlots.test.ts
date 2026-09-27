import { describe, expect, it } from "vitest";
import {
  applyLeagueScoreFill,
  defaultFillSelection,
  planLeagueScoreFill,
  summarizeLeagueFill,
  type LeagueScoreFillInput,
} from "../leagueScoreFill";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import type { TeamBase } from "../types";

/*
 * Fill scores from Team Rankings, where the names alone could not say.
 *
 * Three cases from the 26 September pool and the Cincinnati 9U league. 513 Force - Bouley's own
 * schedule had its 25 September game at the Hornets against "TBD- 09/25/26, 7:15 PM", a slot, and
 * nothing else in the pool named the game, so the review called it a game with no result. The two
 * clubs' own schedules disagree about one two-sided game in ten on the 9U page, and the fill wrote
 * side A's version, ticked, without a word. And a league team linked in Settings to a club spelled
 * another way was still offered as "Check name".
 */
const SEASON = "fall2026";
const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [SEASON] },
  { id: "ag8", name: "8U 2027", ageLevel: 8, year: 2027, seasonIds: [] },
  { id: "ag9old", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
];
const leagueTeams: TeamBase[] = [
  { id: "L-513", name: "513 FORCE - BOULEY" },
  { id: "L-HORN", name: "Cincinnati Hornets" },
  { id: "L-TP", name: "Trash Pandas Baseball Club" },
  { id: "L-YEAG", name: "Yeager Dreyer" },
];
const pulled = (id: string, name: string, gcId: string): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9", ageLevel: 9 }],
});
const scoutTeams: ScoutTeam[] = [
  pulled("S-513", "513 FORCE - BOULEY", "gc513"),
  pulled("S-HORN", "Cincinnati Hornets", "gcHORN"),
  pulled("S-TP", "Trash Pandas Baseball Club", "gcTP"),
  pulled("S-YEAG", "Yeager Dreyer", "gcYEAG"),
  pulled("S-FALL", "Cincinnati Hornets *Fall Ball*", "gcFALL"),
  { id: "S-TBD", name: "TBD- 09/25/26, 7:15 PM", placeholder: true },
  { id: "S-TBD2", name: "TBD- 09/25/26, 7:15 PM (2)", placeholder: true },
  { id: "S-FORCE", name: "Force", nameOnly: true },
];
/** A row off `schedule`'s own GameChanger schedule; side A is that club. */
const row = (
  id: string,
  a: string,
  b: string,
  sa: number,
  sb: number,
  schedule: string | undefined,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  ageGroupId: "ag9",
  teamAId: a,
  teamBId: b,
  teamAScore: sa,
  teamBScore: sb,
  date: "2026-09-25",
  ...(schedule ? { source: { kind: "gamechanger" as const, teamId: schedule, gameId: id } } : {}),
  ...extra,
});
/** 513 at the Hornets on 25 September, and Trash Pandas at Yeager the same day. */
const input = (over: Partial<LeagueScoreFillInput> = {}): LeagueScoreFillInput => ({
  seasonId: SEASON,
  teams: leagueTeams,
  matchups: [
    { id: "m1", date: "9/25", away: "L-513", home: "L-HORN" },
    { id: "m2", date: "9/25", away: "L-TP", home: "L-YEAG" },
  ],
  logs: {},
  ageGroups,
  scoutTeams,
  scoutGames: [],
  today: "2026-09-26",
  ...over,
});
const againstSlot = row("gc_513_1", "S-513", "S-TBD", 0, 13, "gc513");
const rowOf = (plan: ReturnType<typeof planLeagueScoreFill>, matchupId: string) =>
  plan.rows.find((entry) => entry.matchupId === matchupId);

describe("a club's own row against a slot", () => {
  it("is offered for its only league game that day, never ticked", () => {
    const plan = planLeagueScoreFill(input({ scoutGames: [againstSlot] }));
    const found = rowOf(plan, "m1");

    expect(found).toMatchObject({ action: "slot", awayRuns: 0, homeRuns: 13 });
    expect(found!.detail).toMatch(/“TBD- 09\/25\/26, 7:15 PM”/);
    expect(defaultFillSelection(plan)).not.toContain("m1");
    expect(plan.unmatched).toBe(1);
  });

  it("is the club's from the home seat too", () => {
    const hornetsOwn = row("gc_horn_1", "S-HORN", "S-TBD", 13, 0, "gcHORN");
    const plan = planLeagueScoreFill(input({ scoutGames: [hornetsOwn] }));

    expect(rowOf(plan, "m1")).toMatchObject({ action: "slot", awayRuns: 0, homeRuns: 13 });
  });

  it("is found by the Settings link when the league spells the club another way", () => {
    const teams = leagueTeams.map((team) =>
      team.id === "L-513" ? { ...team, name: "513 Force", scoutTeamId: "S-513" } : team
    );
    const plan = planLeagueScoreFill(input({ teams, scoutGames: [againstSlot] }));

    expect(rowOf(plan, "m1")?.action).toBe("slot");
  });

  it("is one row when both clubs' schedules have it against slots and agree", () => {
    const hornetsOwn = row("gc_horn_1", "S-HORN", "S-TBD2", 13, 0, "gcHORN");
    const plan = planLeagueScoreFill(input({ scoutGames: [againstSlot, hornetsOwn] }));

    expect(plan.rows.filter((entry) => entry.matchupId === "m1")).toHaveLength(1);
    expect(rowOf(plan, "m1")).toMatchObject({ action: "slot", awayRuns: 0, homeRuns: 13 });
    expect(plan.unusedResults).toBe(0);
  });

  it("is a dispute when both clubs' schedules have it against slots with different winners", () => {
    const hornetsOwn = row("gc_horn_1", "S-HORN", "S-TBD2", 3, 5, "gcHORN");
    const plan = planLeagueScoreFill(input({ scoutGames: [againstSlot, hornetsOwn] }));

    expect(rowOf(plan, "m1")).toMatchObject({
      action: "disputed",
      awayRuns: 0,
      homeRuns: 13,
      alternative: { awayRuns: 5, homeRuns: 3, reportedBy: "Cincinnati Hornets" },
    });
  });

  it("is not a stand-in's: slots only", () => {
    const againstStandIn = row("gc_513_2", "S-513", "S-FORCE", 0, 13, "gc513");
    const plan = planLeagueScoreFill(input({ scoutGames: [againstStandIn] }));

    expect(rowOf(plan, "m1")).toBeUndefined();
    expect(plan.unmatched).toBe(2);
  });

  it("is left alone on a day the club has two league games", () => {
    const plan = planLeagueScoreFill(
      input({
        matchups: [
          { id: "m1", date: "9/25", away: "L-513", home: "L-HORN" },
          { id: "m3", date: "9/25", away: "L-513", home: "L-YEAG" },
        ],
        scoutGames: [againstSlot],
      })
    );

    expect(plan.rows).toEqual([]);
  });

  it("is left alone when the club has two rows against slots that day", () => {
    const second = row("gc_513_3", "S-513", "S-TBD2", 4, 2, "gc513");
    const plan = planLeagueScoreFill(input({ scoutGames: [againstSlot, second] }));

    expect(rowOf(plan, "m1")).toBeUndefined();
  });

  it("is not a row somebody typed in against TBD", () => {
    const typed = row("typed_1", "S-513", "S-TBD", 0, 13, undefined);
    const plan = planLeagueScoreFill(input({ scoutGames: [typed] }));

    expect(rowOf(plan, "m1")).toBeUndefined();
  });

  it("is counted among the rows still to confirm", () => {
    const plan = planLeagueScoreFill(input({ scoutGames: [againstSlot] }));
    expect(summarizeLeagueFill(plan, 0)).toMatch(/1 still to confirm/);
  });
});

describe("a game the two clubs' own schedules score differently", () => {
  /** Trash Pandas' schedule has 7-13; Yeager's own has the score given. */
  const disputed = (yeagerSays: { teamAScore: number; teamBScore: number }) =>
    row("gc_tp_1", "S-TP", "S-YEAG", 7, 13, "gcTP", { reportedByB: yeagerSays });

  it("fills side A's score, ticked, and shows both when they agree on the winner", () => {
    const plan = planLeagueScoreFill(
      input({ scoutGames: [disputed({ teamAScore: 7, teamBScore: 12 })] })
    );
    const found = rowOf(plan, "m2")!;

    expect(found).toMatchObject({
      action: "fill",
      awayRuns: 7,
      homeRuns: 13,
      reportedBy: "Trash Pandas Baseball Club",
      alternative: { awayRuns: 7, homeRuns: 12, reportedBy: "Yeager Dreyer" },
    });
    expect(found.detail).toMatch(/Trash Pandas Baseball Club’s has 7–13, Yeager Dreyer’s 7–12/);
    expect(defaultFillSelection(plan)).toContain("m2");
  });

  it("waits for a person when they disagree on the winner", () => {
    const plan = planLeagueScoreFill(
      input({ scoutGames: [disputed({ teamAScore: 9, teamBScore: 8 })] })
    );

    expect(rowOf(plan, "m2")?.action).toBe("disputed");
    expect(defaultFillSelection(plan)).not.toContain("m2");
  });

  it("waits for a person when one has a tie", () => {
    const plan = planLeagueScoreFill(
      input({ scoutGames: [disputed({ teamAScore: 8, teamBScore: 8 })] })
    );

    expect(rowOf(plan, "m2")?.action).toBe("disputed");
  });

  it("is already in when the league has the other club's version", () => {
    const plan = planLeagueScoreFill(
      input({
        scoutGames: [disputed({ teamAScore: 9, teamBScore: 8 })],
        logs: {
          m2: {
            awayRuns: "9",
            homeRuns: "8",
            awayHits: "",
            awayK: "",
            homeHits: "",
            homeK: "",
            innings: "6",
            isFinal: true,
          },
        },
      })
    );

    expect(rowOf(plan, "m2")).toMatchObject({ action: "unchanged", awayRuns: 9, homeRuns: 8 });
  });

  it("fills the other club's version when that is the one chosen", () => {
    const plan = planLeagueScoreFill(
      input({ scoutGames: [disputed({ teamAScore: 9, teamBScore: 8 })] })
    );
    const { logs } = applyLeagueScoreFill(plan, ["m2"], {}, 6, ["m2"]);

    expect(logs.m2).toMatchObject({ awayRuns: "9", homeRuns: "8", isFinal: true });
    expect(applyLeagueScoreFill(plan, ["m2"], {}, 6).logs.m2).toMatchObject({
      awayRuns: "7",
      homeRuns: "13",
    });
  });
});

describe("a league team linked in Settings", () => {
  const shortNamed = leagueTeams.map((team) =>
    team.id === "L-TP" ? { ...team, name: "Trash Pandas", scoutTeamId: "S-TP" } : team
  );
  const played = row("gc_tp_1", "S-TP", "S-YEAG", 7, 13, "gcTP");

  it("is that club, however each half spells it", () => {
    const plan = planLeagueScoreFill(input({ teams: shortNamed, scoutGames: [played] }));
    const found = rowOf(plan, "m2")!;

    expect(found.action).toBe("fill");
    expect(found.detail).toBeUndefined();
    expect(defaultFillSelection(plan)).toContain("m2");
  });

  it("is still a name to check when it is not linked", () => {
    const unlinked = shortNamed.map((team) =>
      team.id === "L-TP" ? { id: team.id, name: team.name } : team
    );
    const plan = planLeagueScoreFill(input({ teams: unlinked, scoutGames: [played] }));

    expect(rowOf(plan, "m2")?.action).toBe("suggested");
  });

  it("is read on the other pages of the squad year, where its listing files its games", () => {
    // The league's Hornets are the fall team, listed at 8U: its copy is on the 8U page.
    const teams = leagueTeams.map((team) =>
      team.id === "L-HORN" ? { ...team, scoutTeamId: "S-FALL" } : team
    );
    const fallCopy = row("gc_fall_1", "S-FALL", "S-513", 13, 0, "gcFALL", { ageGroupId: "ag8" });

    const plan = planLeagueScoreFill(input({ teams, scoutGames: [fallCopy] }));
    expect(rowOf(plan, "m1")).toMatchObject({ action: "fill", awayRuns: 0, homeRuns: 13 });

    // Unlinked, another page's row is another squad's; another year's is another season's.
    expect(rowOf(planLeagueScoreFill(input({ scoutGames: [fallCopy] })), "m1")).toBeUndefined();
    const lastYear = { ...fallCopy, ageGroupId: "ag9old" };
    expect(rowOf(planLeagueScoreFill(input({ teams, scoutGames: [lastYear] })), "m1")).toBe(
      undefined
    );
  });
});
