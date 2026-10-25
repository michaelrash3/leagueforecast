import { describe, expect, it } from "vitest";
import { eliminationNumberForGold, magicForGold, neededResults } from "../magic";
import { calculateTeams, rankOptionsFromSettings, rankTeams } from "../sim";
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
    // A has beaten B; g3 is its last game. Win it and A has 2, with no losses. B and C can reach 1
    // each, and D can reach 2 only by winning both its games — so at most one club can be level
    // with A, and two places go to the top two whatever the tie.
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 1),
    });
    const result = magicForGold("A", live, matchups.slice(1), 2, settings);
    expect(result.type).toBe("magic");
    expect(result.ownWinsNeeded).toBe(1);
    expect(result.opponentLossesNeeded).toBe(0);
    expect(result.tiebreak).toBeUndefined();
  });

  it("clinched when nobody can pass", () => {
    // A 2-0; B beat D. C and D have one game left between them, so neither can reach 2.
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 0),
      g3: finalLog(5, 0),
      g4: finalLog(4, 2),
    });
    const result = magicForGold("A", live, [matchups[1]!], 1, settings);
    expect(result.type).toBe("clinched");
  });

  it("does not call a clinch that a tie on points could still take away", () => {
    // A 2-0 with nothing left; D can win both its games and draw level. Level on points and on
    // losses, it comes down to run differential in games not yet played. This used to be "Already
    // clinched", because the tie went to A on its id.
    const live = calculateTeams(teams, matchups, {
      g1: finalLog(5, 0),
      g3: finalLog(5, 0),
    });
    const result = magicForGold("A", live, [matchups[1]!, matchups[3]!], 1, settings);
    expect(result.type).toBe("magic");
    expect(result.tiebreak).toBe(true);
    expect(result.description).toBe(
      "Level for the last Gold Bracket spot at worst; the tiebreakers decide."
    );
  });

  it("leaves a tie with nothing left to play to the table, whatever the teams are called", () => {
    // Three clubs, nothing played and nothing left. The ids used to settle it: A clinched, C out.
    const tinyTeams: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B" },
      { id: "C", name: "C" },
    ];
    const live = calculateTeams(tinyTeams, [], {});
    expect(magicForGold("A", live, [], 1, settings).tiebreak).toBe(true);
    expect(magicForGold("C", live, [], 1, settings).tiebreak).toBe(true);

    // With the table's own ranks, as the app passes them, the season is simply over.
    const table = rankTeams(live, rankOptionsFromSettings(settings));
    const first = table.find((team) => team.rank === 1)!;
    const last = table.find((team) => team.rank === 3)!;
    expect(magicForGold(first.id, table, [], 1, settings).type).toBe("clinched");
    expect(magicForGold(last.id, table, [], 1, settings).type).toBe("impossible");
    expect(eliminationNumberForGold(last.id, table, [], 1, settings).opponentLossesNeeded).toBe(0);
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
     * A plays both of the others and they never play each other. One win puts A level on points
     * with whoever beat it, 1-1 against 1-0, and the table puts the club with fewer losses first:
     * this said one win on the strength of A's id. Two wins, and nobody can reach A.
     */
    expect(result.type).toBe("magic");
    expect(result.ownWinsNeeded).toBe(2);
    expect(result.opponentLossesNeeded).toBe(0);
    expect(result.tiebreak).toBeUndefined();
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
    // B and C have beaten A, and nothing is left: A cannot reach either, tie or no tie.
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

    expect(magicForGold("A", live, [], 2, settings).type).toBe("impossible");
    expect(magicForGold("A", live, [], 2, settings).tiebreak).toBeUndefined();
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

    /*
     * One loss puts A behind on fewer losses — 1-1 against the 1-0 club that beat it — whichever
     * game it loses, and the table puts fewer losses first, before any tiebreaker. Where a tie
     * scores nothing the search reads each team's losses off its points and says one, the least.
     * Where a tie scores, points cannot tell a win from two ties, losses go unread, and level
     * points are left to the tiebreakers: two, which is true but not the least.
     */
    const noTies = eliminationNumberForGold("A", live, tinyMatchups, 1, {
      ...settings,
      tiePoints: 0,
    });
    expect(noTies.type).toBe("elimination");
    expect(noTies.opponentLossesNeeded).toBe(1);
    expect(noTies.tiebreak).toBeUndefined();

    const result = eliminationNumberForGold("A", live, tinyMatchups, 1, settings);
    expect(result.type).toBe("elimination");
    expect(result.opponentLossesNeeded).toBe(2);
    expect(result.tiebreak).toBeUndefined();
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

describe("eliminationNumberForGold, for a team with nothing left to lose", () => {
  /*
   * A has played its last game; B can still win two. One place goes through. No number of A's own
   * losses settles it, since A has none left to lose, and the answer used to be "Cannot be
   * eliminated" for that reason alone, though B winning both puts A out.
   */
  const three: TeamBase[] = [
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
    { id: "C", name: "Comets" },
  ];
  const games: Matchup[] = [
    { id: "g1", date: "5/1", away: "A", home: "C" },
    { id: "g2", date: "5/2", away: "A", home: "C" },
    { id: "g3", date: "5/3", away: "B", home: "C" },
    { id: "g4", date: "5/4", away: "B", home: "C" },
    { id: "g5", date: "5/5", away: "B", home: "C" },
  ];
  const played = { g1: finalLog(5, 1), g2: finalLog(5, 1), g3: finalLog(5, 1) };
  const ranked = () =>
    rankTeams(calculateTeams(three, games, played, settings), rankOptionsFromSettings(settings));
  const left = games.filter((game) => !(game.id in played));

  it("does not call a team safe that other results can still put out", () => {
    const answer = eliminationNumberForGold("A", ranked(), left, 1, settings);

    expect(answer.description).not.toMatch(/Cannot be eliminated/);
    expect(answer.description).toBe(
      "Its own losses cannot eliminate it, but other results still can."
    );
  });

  it("still calls a team safe that no result can put out", () => {
    const answer = eliminationNumberForGold("A", ranked(), left, 2, settings);

    expect(answer.description).toBe("Cannot be eliminated from the Gold Bracket this season.");
  });
});

describe("neededResults", () => {
  const three: TeamBase[] = [
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
    { id: "C", name: "Comets" },
  ];
  const standing = (games: Matchup[], played: Record<string, GameLog>) =>
    rankTeams(calculateTeams(three, games, played, settings), rankOptionsFromSettings(settings));

  it("names the one result in the team's own hands", () => {
    // A and B are both 1-0, C 0-2. One place. Whoever wins A v B is first: the other cannot catch
    // up on points and losses. B v C does not matter to A once A has won.
    const games: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "C" },
      { id: "p2", date: "5/2", away: "B", home: "C" },
      { id: "g3", date: "5/3", away: "A", home: "B" },
      { id: "g4", date: "5/4", away: "B", home: "C" },
    ];
    const played = { p1: finalLog(5, 1), p2: finalLog(5, 1) };
    const left = games.filter((game) => !(game.id in played));

    expect(neededResults("A", standing(games, played), left, 1, settings)).toEqual([
      // A tie scores half a win by default, and leaves A ahead on fewer losses: not losing is enough.
      { gameId: "g3", date: "5/3", side: "A", against: "B", orTie: true },
    ]);
  });

  it("names the help a team needs from a game it is not in", () => {
    // B is 2-0 and A 1-0, C 0-3. One place. A can reach 2-0 at most, so it needs its own win over
    // C and the Comets to beat the Bears.
    const games: Matchup[] = [
      { id: "p1", date: "5/1", away: "B", home: "C" },
      { id: "p2", date: "5/2", away: "B", home: "C" },
      { id: "p3", date: "5/3", away: "A", home: "C" },
      { id: "g4", date: "5/4", away: "A", home: "C" },
      { id: "g5", date: "5/5", away: "B", home: "C" },
    ];
    const played = { p1: finalLog(5, 1), p2: finalLog(5, 1), p3: finalLog(5, 1) };
    const left = games.filter((game) => !(game.id in played));

    expect(neededResults("A", standing(games, played), left, 1, settings)).toEqual([
      // Here a tie in either game leaves the Bears out of reach: both have to be won.
      { gameId: "g4", date: "5/4", side: "A", against: "C", orTie: false },
      { gameId: "g5", date: "5/5", side: "C", against: "B", orTie: false },
    ]);
  });

  it("needs nothing of a team in whatever happens, or out whatever happens", () => {
    const games: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "C" },
      { id: "p2", date: "5/2", away: "A", home: "B" },
      { id: "g3", date: "5/3", away: "B", home: "C" },
    ];
    const played = { p1: finalLog(5, 1), p2: finalLog(5, 1) };
    const left = games.filter((game) => !(game.id in played));
    const table = standing(games, played);

    expect(neededResults("A", table, left, 1, settings)).toBeNull();
    expect(neededResults("C", table, left, 1, settings)).toBeNull();
  });

  it("leaves a level finish after the last game to the tiebreakers, not to the statistics as they stand", () => {
    // One place. A has beaten C 2-1; B v C is the only game left. If B wins, A and B are both 1-0
    // and never met, so run differential decides, and B's comes from the game not yet played: 10-0
    // puts B first. The table as it stands has B at 0 runs to A's +1, and reading that as final
    // told B it needed C to beat it as well as to beat C.
    const games: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "C" },
      { id: "g2", date: "5/2", away: "B", home: "C" },
    ];
    const played = { p1: finalLog(2, 1) };
    const left = games.filter((game) => !(game.id in played));

    expect(neededResults("B", standing(games, played), left, 1, settings)).toEqual([
      // A tie leaves B half a point behind A.
      { gameId: "g2", date: "5/2", side: "B", against: "C", orTie: false },
    ]);
  });

  it("still puts fewer losses ahead after the last game, where a tie scores", () => {
    // One place. A and B drew, and each beat C; B v C is the only game left. If C wins, A and B
    // are level on points at 1.5 but B has the loss, so A is first. A tie or a win puts B first.
    const games: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "B" },
      { id: "p2", date: "5/2", away: "A", home: "C" },
      { id: "p3", date: "5/3", away: "B", home: "C" },
      { id: "g4", date: "5/4", away: "B", home: "C" },
    ];
    const played = { p1: finalLog(3, 3), p2: finalLog(5, 1), p3: finalLog(5, 1) };
    const left = games.filter((game) => !(game.id in played));

    expect(neededResults("B", standing(games, played), left, 1, settings)).toEqual([
      { gameId: "g4", date: "5/4", side: "B", against: "C", orTie: true },
    ]);
  });

  it("keeps a need on the last day that a head-to-head record the game cannot change makes real", () => {
    // One place. C is 2-1, A 1-1, B 1-2, and A at B is all that is left. An A win by any score puts
    // A level with C at 2-1, and A beat C, so C is second; a B win or a tie keeps C first. Leaving
    // every level finish to go C's way told C it needed nothing.
    const games: Matchup[] = [
      { id: "p1", date: "5/1", away: "C", home: "B" },
      { id: "p2", date: "5/2", away: "A", home: "C" },
      { id: "p3", date: "5/3", away: "C", home: "B" },
      { id: "p4", date: "5/4", away: "B", home: "A" },
      { id: "g5", date: "5/5", away: "A", home: "B" },
    ];
    const played = {
      p1: finalLog(5, 1),
      p2: finalLog(6, 2),
      p3: finalLog(4, 3),
      p4: finalLog(2, 0),
    };
    const left = games.filter((game) => !(game.id in played));

    expect(neededResults("C", standing(games, played), left, 1, settings)).toEqual([
      { gameId: "g5", date: "5/5", side: "B", against: "A", orTie: true },
    ]);
  });

  it("needs nothing on the last day of a team out however it ends, rather than both sides", () => {
    // One place, ties worth half. A drew with B and beat C; C beat B; B at C is left. A B win puts
    // B level with A on points but a loss behind, so A is first whatever happens; so is it where A
    // has beaten everyone. Neither table may tell B it needs both itself and C to win.
    const drew: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "B" },
      { id: "p2", date: "5/2", away: "A", home: "C" },
      { id: "p3", date: "5/3", away: "C", home: "B" },
      { id: "g4", date: "5/4", away: "B", home: "C" },
    ];
    const drawn = { p1: finalLog(3, 3), p2: finalLog(5, 1), p3: finalLog(5, 1) };
    expect(
      neededResults(
        "B",
        standing(drew, drawn),
        drew.filter((game) => !(game.id in drawn)),
        1,
        settings
      )
    ).toBeNull();

    const swept: Matchup[] = [
      { id: "p1", date: "5/1", away: "A", home: "B" },
      { id: "p2", date: "5/2", away: "B", home: "A" },
      { id: "p3", date: "5/3", away: "A", home: "C" },
      { id: "p4", date: "5/4", away: "B", home: "C" },
      { id: "p5", date: "5/5", away: "C", home: "B" },
      { id: "g6", date: "5/6", away: "B", home: "C" },
    ];
    const sweep = {
      p1: finalLog(4, 1),
      p2: finalLog(1, 4),
      p3: finalLog(4, 1),
      p4: finalLog(4, 1),
      p5: finalLog(1, 4),
    };
    expect(
      neededResults(
        "B",
        standing(swept, sweep),
        swept.filter((game) => !(game.id in sweep)),
        1,
        settings
      )
    ).toBeNull();
  });
});
