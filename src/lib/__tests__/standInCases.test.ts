import { describe, expect, it } from "vitest";
import { caseIndex, CLOCK_MINUTES, standInCases, tallyClock } from "../standInCases";
import type { ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * Why a game against a stand-in is not paired: the pulled clubs whose names read like the stand-in's,
 * and every other club's own row on the clock, scored or not, beside a week either side. Placeholder
 * names throughout.
 */
const PAGE = "ag_10u_2027";
const OLD = "ag_14u_2027";
const LEVELS: Record<string, number> = { [PAGE]: 10, [OLD]: 14 };
const levelOf = (id: string) => LEVELS[id];
const club = (id: string, name: string, page = PAGE): ScoutTeam => ({
  id,
  name,
  gcTeams: [{ teamId: `gc-${id}`, name, ageGroupId: page, ageLevel: LEVELS[page]! }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });

const TEAMS: ScoutTeam[] = [
  club("N", "Northside Owls"),
  club("H", "Riverbend Hawks"),
  club("B", "Bears"),
  club("O", "Riverbend Hawks", OLD),
  club("Y", "Hawks Elite"),
  club("M", "Mates"),
  standIn("S", "Riverbend Hawks Smith"),
  standIn("T", "Northside"),
  standIn("U", "Someone"),
];

let made = 0;
/** A row of `schedule`'s own: A against B, at a start, A's runs first, or none. */
const row = (
  schedule: string,
  a: string,
  b: string,
  startTs: string,
  runs: [number, number] | null,
  page = PAGE
): ScoutGame => ({
  id: `g${(made += 1)}`,
  ageGroupId: page,
  teamAId: a,
  teamBId: b,
  date: startTs.slice(0, 10),
  startTs,
  ...(runs ? { teamAScore: runs[0], teamBScore: runs[1] } : {}),
  source: { kind: "gamechanger", teamId: `gc-${schedule}`, gameId: `x${made}` },
});

const GAMES: ScoutGame[] = [
  // The row: Northside beat "Riverbend Hawks Smith" 5-3 at 2 PM.
  row("N", "N", "S", "2026-09-12T14:00:00Z", [5, 3]),
  // Riverbend Hawks' own row 75 minutes on, against a name for Northside, with no score kept.
  row("H", "H", "T", "2026-09-12T15:15:00Z", null),
  // Bears' own row at 2:30, the result mirrored, a name nothing like the stand-in's.
  row("B", "B", "U", "2026-09-12T14:30:00Z", [3, 5]),
  // The other Riverbend Hawks, four levels up, and a row past the clock: neither on it.
  row("O", "O", "U", "2026-09-12T14:00:00Z", [3, 5], OLD),
  row("Y", "Y", "U", "2026-09-12T18:00:00Z", [3, 5]),
  // A game both clubs' own schedules list is theirs, and nobody's other half.
  {
    ...row("M", "M", "B", "2026-09-12T14:10:00Z", [1, 1]),
    alsoFrom: ["gc-B"],
  },
  // A week on, where the game is not, Hawks Elite plays at 2 PM: chance, by a word.
  row("Y", "Y", "U", "2026-09-19T14:05:00Z", [2, 0]),
];

// Rare among three: of the six pulled names, "riverbend" is in two, "hawks" in three.
const index = caseIndex(TEAMS, GAMES, levelOf, 3);
const northside = (one: { namerId: string }) => one.namerId === "N";

describe("another club's own row on the clock", () => {
  it("is any result or none, within the clock and two levels, a game of two clubs' own left out", () => {
    const [mine] = index.against.filter(northside);
    expect(
      index
        .onTheClock(mine!)
        .map((other) => other.clubId)
        .sort()
    ).toEqual(["B", "H"]);
    expect(CLOCK_MINUTES).toBe(90);
  });

  it("is counted by whether its club's name reads like the stand-in's, beside a week either side", () => {
    expect(tallyClock(index, northside)).toEqual({
      rows: 1,
      noStart: 0,
      any: 1,
      sharesWord: 1,
      sharesRare: 1,
      mirrored: 0,
      scoredOtherwise: 0,
      unscored: 1,
      decoy: { any: 0.5, sharesWord: 0.5, sharesRare: 0 },
    });
  });
});

describe("a row laid out by eye", () => {
  it("names the clubs most like the stand-in, near its level, with their rows that day", () => {
    const [laid] = standInCases(index, northside, 1);
    expect(laid!.byName.map((one) => one.clubId)).toEqual(["H", "Y"]);
    expect(laid!.byName[0]!.like.shared.sort()).toEqual(["hawks", "riverbend"]);
    expect(laid!.byName[0]!.thatDay.map((other) => other.opponentId)).toEqual(["T"]);
    expect(laid!.byClock.map(({ other }) => other.clubId)).toEqual(["H", "B"]);
  });
});
