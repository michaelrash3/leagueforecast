import { describe, expect, it } from "vitest";
import { eliminationNumberForGold, magicForGold } from "../magic";
import { calculateTeams } from "../sim";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../types";

const teams: TeamBase[] = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Diggers" },
];

const matchups: Matchup[] = [
  { id: "g1", date: "5/1", away: "A", home: "B" },
  { id: "g2", date: "5/2", away: "C", home: "D" },
  { id: "g3", date: "5/3", away: "A", home: "C" },
  { id: "g4", date: "5/4", away: "B", home: "D" },
];

const finalLog = (a: number, h: number): GameLog => ({
  awayRuns: String(a),
  awayHits: "0",
  awayK: "0",
  homeRuns: String(h),
  homeHits: "0",
  homeK: "0",
  innings: "6",
  isFinal: true,
});

const settings = { ...DEFAULT_SETTINGS };

describe("magicForGold", () => {
  /*
   * These three used to assert "impossible", and all three were pinning a bug: `magicForGold`
   * could not return a magic number at all, so every team that had not already clinched was told
   * it could not mathematically clinch. Each is worked through by hand below rather than read off
   * the new output.
   */
  it("names the one win that settles a top-two place", () => {
    // A has beaten B; g3 is its last game. Win it and A has 2. B and C can reach 1 each, D can
    // reach 2 — and a tie with D goes to A on id, so A is second at worst.
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 1),
    });
    const result = magicForGold("A", live, matchups, 2, settings);
    expect(result.type).toBe("magic");
    expect(result.ownWinsNeeded).toBe(1);
    expect(result.opponentLossesNeeded).toBe(0);
  });

  it("clinched when nobody can pass", () => {
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 0),
      g3: finalLog(5, 0),
    });
    const result = magicForGold("A", live, matchups, 1, settings);
    expect(result.type).toBe("clinched");
  });

  it("uses deterministic team-id ordering in tie-heavy schedules", () => {
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const noGamesLeft: Matchup[] = [];

    const live = calculateTeams(tinyTeams, noGamesLeft, {});
    const aResult = magicForGold("A", live, noGamesLeft, 1, settings);
    const cResult = magicForGold("C", live, noGamesLeft, 1, settings);

    expect(aResult.type).toBe("clinched");
    expect(cResult.type).toBe("impossible");
  });

  it("supports edge cutoff values of 1 and n-1 in symmetric schedules", () => {
    const symmetricTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
      { id: "D", name: "D" },
    ];
    const symmetricMatchups: Matchup[] = [
      { id: "s1", date: "5/1", away: "A", home: "B" },
      { id: "s2", date: "5/2", away: "A", home: "C" },
      { id: "s3", date: "5/3", away: "A", home: "D" },
      { id: "s4", date: "5/4", away: "B", home: "C" },
      { id: "s5", date: "5/5", away: "B", home: "D" },
      { id: "s6", date: "5/6", away: "C", home: "D" },
    ];

    const live = calculateTeams(symmetricTeams, symmetricMatchups, {});

    /*
     * First place takes all three. Run the table and A has 3; B, C and D have only the three
     * games among themselves left, so none can pass 2. Two wins is not enough — the club that
     * beat A can still reach 3 and finish above it.
     */
    const forFirst = magicForGold("A", live, symmetricMatchups, 1, settings);
    expect(forFirst.type).toBe("magic");
    expect(forFirst.ownWinsNeeded).toBe(3);

    /*
     * Third of four takes two, and the reason is the tie. On one win A has a point and can still
     * be passed by all three: the club that beat A wins their head-to-head, and the other two
     * split what is left — one wins a game and ties another for 1.5, the third takes the rest —
     * which the three games they have between them will just pay for at half a point a tie. On
     * two wins the two clubs A beat would each need more than two points out of two games.
     */
    const forThird = magicForGold(
      "A",
      live,
      symmetricMatchups,
      symmetricTeams.length - 1,
      settings
    );
    expect(forThird.type).toBe("magic");
    expect(forThird.ownWinsNeeded).toBe(2);
  });

  it("returns known-answer magic number in a manually provable 3-team race", () => {
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const tinyMatchups: Matchup[] = [
      { id: "k1", date: "5/1", away: "A", home: "B" },
      { id: "k2", date: "5/2", away: "A", home: "C" },
    ];

    const live = calculateTeams(tinyTeams, tinyMatchups, {});
    const result = magicForGold("A", live, tinyMatchups, 1, settings);

    /*
     * A plays both of the others and they never play each other, so one win puts A level with
     * whoever beat it and ahead of the club it beat — and a tie goes to A on id. The old comment
     * here said "even winning out cannot guarantee first because B/C can also finish ahead on
     * points", which is not true of this schedule: B and C have no game to pass each other in.
     */
    expect(result.type).toBe("magic");
    expect(result.ownWinsNeeded).toBe(1);
    expect(result.opponentLossesNeeded).toBe(0);
  });

  it("still says impossible when a win cannot put the team in", () => {
    // Bottom of three with nothing left to play: there is no number of wins that changes it.
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const played: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "B" },
      { id: "p2", date: "5/2", away: "A", home: "C" },
    ];
    const live = calculateTeams(tinyTeams, played, { p1: finalLog(0, 9), p2: finalLog(0, 9) });

    expect(magicForGold("A", live, [], 1, settings).type).toBe("impossible");
  });

  it("says one win, in the smallest race there is", () => {
    /*
     * Two clubs level, one game between them, one place. Win it and you are first — and this is
     * what the app told the user could not mathematically happen.
     */
    const pair: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
    ];
    const decider: Matchup[] = [{ id: "d1", date: "5/1", away: "A", home: "B" }];
    const live = calculateTeams(pair, decider, {});

    const result = magicForGold("A", live, decider, 1, settings);

    expect(result.type).toBe("magic");
    expect(result.ownWinsNeeded).toBe(1);
    expect(result.description).toBe("1 more win clinches a Gold Bracket spot.");
  });

  it("returns impossible for mathematically impossible clinch cases", () => {
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const noGamesLeft: Matchup[] = [];
    const live = calculateTeams(tinyTeams, noGamesLeft, {});

    expect(magicForGold("A", live, noGamesLeft, 1, settings).type).toBe("clinched");
    expect(magicForGold("C", live, noGamesLeft, 1, settings).type).toBe("impossible");
  });
});

describe("eliminationNumberForGold", () => {
  it("returns elimination info when blocked", () => {
    const live = calculateTeams(teams, matchups, {});
    const result = eliminationNumberForGold("A", live, matchups, 1, settings);
    expect(result.type === "elimination" || result.type === "magic").toBe(true);
  });

  it("returns known-answer elimination number in a manually provable 3-team race", () => {
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const tinyMatchups: Matchup[] = [
      { id: "k1", date: "5/1", away: "A", home: "B" },
      { id: "k2", date: "5/2", away: "A", home: "C" },
    ];

    const live = calculateTeams(tinyTeams, tinyMatchups, {});
    const result = eliminationNumberForGold("A", live, tinyMatchups, 1, settings);

    // A is eliminated once it accrues two losses in this 2-game schedule.
    expect(result.type).toBe("elimination");
    expect(result.opponentLossesNeeded).toBe(2);
  });

  it("considers ties as legal outcomes when tiePoints > 0", () => {
    const live = calculateTeams(teams, matchups, {});
    const tieSettings = { ...settings, tiePoints: 0.5 };
    const result = eliminationNumberForGold("A", live, matchups, 2, tieSettings);
    expect(["magic", "elimination"]).toContain(result.type);
  });

  it("handles larger synthetic schedules for regression-level performance coverage", () => {
    const biggerTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
      { id: "D", name: "D" },
      { id: "E", name: "E" },
    ];
    const biggerMatchups: Matchup[] = [];
    let id = 1;
    for (let round = 0; round < 1; round += 1) {
      for (let i = 0; i < biggerTeams.length; i += 1) {
        for (let j = i + 1; j < biggerTeams.length; j += 1) {
          biggerMatchups.push({
            id: `p${id++}`,
            date: `6/${id}`,
            away: biggerTeams[i]!.id,
            home: biggerTeams[j]!.id,
          });
        }
      }
    }

    const live = calculateTeams(biggerTeams, biggerMatchups, {});
    const result = eliminationNumberForGold("A", live, biggerMatchups, 3, settings);
    expect(["magic", "elimination"]).toContain(result.type);
  });
});
