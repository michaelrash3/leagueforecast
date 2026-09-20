import { describe, expect, it } from "vitest";
import { buildTrendStates } from "../trend";
import { calculateTeams, rankOptionsFromSettings, rankTeams, simulateGoldOdds } from "../sim";
import { isFinal } from "../util";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";
import { dateInSquadYear, dedupeLeagueFixtures, inSegment, type ScoutGame } from "../teamRankings";

/**
 * The trend chart's right-hand end is the point a reader takes for where things stand, so it has
 * to be the season that actually stands — the same one the odds beside it are drawn from.
 */
const settings = { ...DEFAULT_SETTINGS, goldCutoff: 2 };
const bases: TeamBase[] = ["A", "B", "C", "D", "E", "F"].map((id) => ({ id, name: id }));

/** Three round robins, home and away: 45 games, 40 of them played and 5 still to come. */
const season = () => {
  const matchups: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  let n = 0;
  for (let round = 0; round < 3; round += 1) {
    for (let i = 0; i < bases.length; i += 1) {
      for (let j = i + 1; j < bases.length; j += 1) {
        const id = `g${String(n).padStart(2, "0")}`;
        matchups.push({
          id,
          date: `${1 + Math.floor(n / 4)}/${1 + (n % 4)}`,
          away: bases[i]!.id,
          home: bases[j]!.id,
        });
        if (n < 40) {
          // A wins everything early and nothing late, so the window and the season disagree hard.
          const awayWins = bases[i]!.id === "A" ? n < 20 : n % 2 === 0;
          logs[id] = {
            awayRuns: awayWins ? "9" : "2",
            awayHits: "6",
            awayK: "4",
            homeRuns: awayWins ? "2" : "9",
            homeHits: "6",
            homeK: "4",
            innings: "6",
            isFinal: true,
          };
        }
        n += 1;
      }
    }
  }
  const completed = matchups.filter((game) => isFinal(logs[game.id]));
  return { matchups, logs, completed };
};

describe("the seasons behind the Gold-odds trend", () => {
  const { matchups, logs, completed } = season();
  const built = buildTrendStates(bases, matchups, logs, completed, {
    states: 8,
    goldCutoff: 2,
    settings,
  });

  it("draws one point per game in the window", () => {
    expect(completed).toHaveLength(40);
    expect(built).toHaveLength(8);
  });

  it("ends on the season as it actually stands, not on the window alone", () => {
    /*
     * The window says how many points to draw; it was also deciding which games had happened, so
     * every point simulated a season missing everything before it. On this fixture the last point
     * put the leader on 2.4% where the real season has them on 100%.
     */
    const last = built[built.length - 1]!;
    const live = rankTeams(
      calculateTeams(bases, matchups, logs, settings),
      rankOptionsFromSettings(settings)
    );

    expect(last.remaining).toHaveLength(5);
    // Every played game counts on the last point, so every record matches the live table.
    const record = (rows: readonly { id: string; w: number; l: number; t: number }[]) =>
      rows
        .map((row) => `${row.id} ${row.w}-${row.l}-${row.t}`)
        .sort()
        .join(", ");

    expect(record(last.teams)).toBe(record(live));
  });

  it("gives the last point the odds the rest of the page shows", () => {
    const last = built[built.length - 1]!;
    const chart = simulateGoldOdds(
      rankTeams(last.teams, rankOptionsFromSettings(settings)),
      last.remaining,
      2000,
      last.seedText,
      2,
      settings
    );
    const live = simulateGoldOdds(
      rankTeams(calculateTeams(bases, matchups, logs, settings), rankOptionsFromSettings(settings)),
      matchups.filter((game) => !isFinal(logs[game.id])),
      2000,
      last.seedText,
      2,
      settings
    );

    expect(chart).toEqual(live);
  });

  it("grows one game at a time, oldest point first", () => {
    const played = built.map((state) => state.teams.reduce((sum, team) => sum + team.games, 0) / 2);

    expect(played).toEqual([33, 34, 35, 36, 37, 38, 39, 40]);
  });

  it("draws what it has when fewer games have been played than the window holds", () => {
    const few = completed.slice(0, 3);
    const built3 = buildTrendStates(bases, matchups, logs, few, {
      states: 8,
      goldCutoff: 2,
      settings,
    });

    expect(built3).toHaveLength(3);
    expect(built3.map((state) => state.teams.reduce((sum, t) => sum + t.games, 0) / 2)).toEqual([
      1, 2, 3,
    ]);
  });
});

describe("a league game that GameChanger also has", () => {
  /*
   * Nearly every League Standings game is on GameChanger too, so the thing that matters is that
   * such a fixture counts exactly once. It does, and it always did — `fixtureKeyOf` runs both
   * dates through `normalizeDateInput`, which reads "2026-09-13" and "9/13" as the same day, so
   * the collapse fired whichever shape the league row carried.
   *
   * What was wrong was the count: the collapse kept the league row, as the league's own book is
   * authoritative for its own games, and the squad-year test then dropped that row for carrying a
   * date it could not place. The pair counted *zero* times. Placing the date made it one, and
   * this pins that it is not two.
   */
  const fixture = (over: Partial<ScoutGame> & { id: string }): ScoutGame => ({
    teamAId: "T-A",
    teamBId: "T-B",
    teamAScore: 6,
    teamBScore: 5,
    ageGroupId: "ag9",
    date: "2026-09-13",
    ...over,
  });

  it("collapses to one row, the league's, whichever shape its date is in", () => {
    const pulled = fixture({
      id: "gc_abc_1",
      source: { kind: "gamechanger", teamId: "abc", gameId: "1" },
    });

    [dateInSquadYear("9/13", 2027), "9/13"].forEach((date) => {
      const out = dedupeLeagueFixtures([fixture({ id: "league_s1_m1", date }), pulled]);

      expect(out).toHaveLength(1);
      expect(out[0]?.id).toBe("league_s1_m1");
    });
  });

  it("counts that one row, now that its date can be placed in the season", () => {
    const placed = fixture({ id: "league_s1_m1", date: dateInSquadYear("9/13", 2027) });

    expect(inSegment(placed.date, 2027, "fall")).toBe(true);
    // The shape it used to carry, which no squad year could place — so nothing counted it.
    expect(inSegment("9/13", 2027, "fall")).toBe(false);
  });
});
