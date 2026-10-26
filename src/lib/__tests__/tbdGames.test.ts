import { describe, expect, it } from "vitest";
import { describeTidy, tidyPool, type GcImportState } from "../gameChangerImport";
import { gcRowId, namesTbd, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { countsTowardRating, scoreSeenBy } from "../teamRankings/games";

/*
 * The owner's rule of 26 October 2026: "That TBD game should be paired with another team that played
 * at that date and time. If it doesn't. It shouldn't count. I mean this only on Placeholder games
 * listed as TBD." The Edgefield Stags' schedule lists a 20-5 over "TBD- 08/29/26, 3:00 PM", which
 * the import files against a slot of its own. The pools are built as a backup holds them, with
 * invented clubs.
 */

const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
];
const DAY = "2026-08-29";

const club = (id: string, name: string): ScoutTeam => ({
  id,
  name,
  state: "KY",
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag9", ageLevel: 9 }],
});
const stags = club("STAGS", "Edgefield Stags");
const cruisers = club("CRUISERS", "Thornbury Cruisers");
const slot = (id: string, name: string): ScoutTeam => ({ id, name, placeholder: true });
const tbd = slot("TBD1", "TBD- 08/29/26, 3:00 PM");

/** `clubId`'s own row `gameId` against `against`, its own score first, or none for one to come. */
const row = (
  clubId: string,
  gameId: string,
  against: string,
  clock: string,
  score?: [number, number],
  day = DAY
): ScoutGame => ({
  id: gcRowId(`gc${clubId}`, gameId),
  teamAId: clubId,
  teamBId: against,
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ageGroupId: "ag9",
  date: day,
  ageLevelA: 9,
  startTs: `${day}T${clock}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});
const TBD_ROW = gcRowId("gcSTAGS", "s1");
/** The Stags' 20-5 over the TBD slot at three. */
const overTbd = (against = "TBD1") => row("STAGS", "s1", against, "15:00", [20, 5]);

const pool = (games: ScoutGame[], teams: ScoutTeam[] = [stags, cruisers, tbd]): GcImportState => ({
  ageGroups,
  teams,
  games,
});

/** A club's record as its page reads it: wins, losses and ties, each game once. */
const recordOf = (state: GcImportState, clubId: string) => {
  const tally = [0, 0, 0];
  state.games.forEach((game) => {
    if (game.teamAId !== clubId && game.teamBId !== clubId) return;
    if (!countsTowardRating(game, "2026-10-26")) return;
    const seen = scoreSeenBy(game, clubId);
    if (!seen) return;
    tally[seen.own > seen.opponent ? 0 : seen.own < seen.opponent ? 1 : 2]! += 1;
  });
  return tally.join("-");
};
const tbdRowIn = (state: GcImportState) => state.games.find((game) => game.id === TBD_ROW);

/** A tidy, and a second over its result that finds nothing: the pool the step converges on. */
const settled = (state: GcImportState) => {
  const first = tidyPool(state);
  const again = tidyPool(first.state);
  expect(again.passes).toBe(1);
  expect(again.state.games).toBe(first.state.games);
  return first;
};

describe("names listed as TBD", () => {
  it.each([
    ["TBD- 08/29/26, 3:00 PM", true],
    ["TBD", true],
    ["T.B.D.", true],
    ["tbd 9U", true],
    ["Tbd-1", true],
    ["To Be Determined", true],
    // Held to TBD by the owner: initials a club can carry, and a bracket slot that is not one.
    ["TBA", false],
    ["TBC", false],
    ["Winner of Game 3", false],
    ["TBDs Baseball", false],
    ["Edgefield Stags", false],
  ])("%s → %s", (name, expected) => {
    expect(namesTbd(name)).toBe(expected);
  });
});

describe("a game against a TBD slot", () => {
  it("counts for nothing where no other team's game pairs it at that date and time", () => {
    const before = pool([overTbd()]);
    // As it was: a 20-5 over nobody known, counted as a win over an ordinary team.
    expect(recordOf(before, "STAGS")).toBe("1-0-0");

    const after = settled(before);
    expect(after.tbdSlots).toBe(1);
    expect(tbdRowIn(after.state)).toMatchObject({ countedElsewhere: true, teamBId: "TBD1" });
    expect(recordOf(after.state, "STAGS")).toBe("0-0-0");
    // Kept on the Stags' page, shown as not counted: nothing is deleted.
    expect(after.state.games).toHaveLength(1);
  });

  it("says so in the tidy's summary", () => {
    expect(describeTidy(tidyPool(pool([overTbd()])))).toContain(
      "1 game against a TBD slot set not to count: a game another team's schedule holds at that date and time counts in its place, and one nobody's does counts for nothing."
    );
  });

  it("counts once, as the game it pairs with, where another team's schedule holds the club then", () => {
    // The Cruisers' own row names the Stags at half past three, scored apart: the slot's row still
    // stands beside it, and only the Cruisers' game counts.
    const after = settled(pool([overTbd(), row("CRUISERS", "c1", "STAGS", "15:30", [4, 6])]));
    expect(tbdRowIn(after.state)?.countedElsewhere).toBe(true);
    expect(recordOf(after.state, "STAGS")).toBe("1-0-0");
    expect(recordOf(after.state, "CRUISERS")).toBe("0-1-0");
  });

  it("is folded into that game as before where the other schedule names the club at its start", () => {
    // The same instant, the result mirrored: one game, and nothing left against the slot to mark.
    const after = settled(pool([overTbd(), row("CRUISERS", "c1", "STAGS", "15:00", [5, 20])]));
    expect(after.tbdSlots).toBe(0);
    expect(tbdRowIn(after.state)).toBeUndefined();
    expect(recordOf(after.state, "STAGS")).toBe("1-0-0");
    expect(recordOf(after.state, "CRUISERS")).toBe("0-1-0");
  });

  describe("is left as it was", () => {
    it.each([
      // Still to be played: the club's next game, whoever it turns out to be against.
      ["with no score yet", [row("STAGS", "s1", "TBD1", "15:00", undefined, "2026-11-07")], tbd],
      ["against a slot named TBA", [overTbd("TBA1")], slot("TBA1", "TBA")],
      ["against a bracket slot", [overTbd("WIN1")], slot("WIN1", "Winner of Game 3")],
    ])("%s", (_, games, other) => {
      const after = settled(pool(games, [stags, cruisers, other]));
      expect(after.tbdSlots).toBe(0);
      expect(tbdRowIn(after.state)?.countedElsewhere).toBeUndefined();
    });

    it("on the own schedule of a club GameChanger holds under the name TBD", () => {
      // A coach's page called "TBD" is pulled like any other, and its own rows are its games.
      const own = row("TBDCLUB", "t1", "STAGS", "15:00", [5, 20]);
      const after = settled(pool([own], [stags, cruisers, club("TBDCLUB", "TBD")]));
      expect(after.tbdSlots).toBe(0);
      expect(after.state.games.some((game) => game.countedElsewhere)).toBe(false);
      expect(recordOf(after.state, "TBDCLUB")).toBe("0-1-0");
    });

    it("on the own schedule of a slot somebody has since pulled by its GameChanger id", () => {
      // Pulled, it is a club, whatever it was first filed as, and its own rows are its games.
      const linked: ScoutTeam = { ...club("TBD1", tbd.name), placeholder: true };
      const own = row("TBD1", "t1", "STAGS", "15:00", [5, 20]);
      const after = settled(pool([own], [stags, cruisers, linked]));
      expect(after.tbdSlots).toBe(0);
      expect(after.state.games.some((game) => game.countedElsewhere)).toBe(false);
    });
  });

  it("is set not to count where another schedule filed it on such a club, which names nobody", () => {
    // As the tidy has long done (`namesNobody`): the Stags' "TBD" is a slot of its own, not the
    // coach's page, and is then a game against a TBD slot like any other.
    const after = settled(pool([overTbd("TBDCLUB")], [stags, cruisers, club("TBDCLUB", "TBD")]));
    expect(tbdRowIn(after.state)?.teamBId).not.toBe("TBDCLUB");
    expect(tbdRowIn(after.state)?.countedElsewhere).toBe(true);
    expect(recordOf(after.state, "STAGS")).toBe("0-0-0");
  });

  it("counts again once the slot is named as the club the Stags played", () => {
    const marked = settled(pool([overTbd()])).state;
    // The owner renames the slot onto the Cruisers: the row is now the Stags' game against them.
    const named: GcImportState = {
      ...marked,
      teams: marked.teams.filter((team) => team.id !== "TBD1"),
      games: marked.games.map((game) =>
        game.id === TBD_ROW ? { ...game, teamBId: "CRUISERS" } : game
      ),
    };
    const after = settled(named);
    expect(tbdRowIn(after.state)?.countedElsewhere).toBeUndefined();
    expect(recordOf(after.state, "STAGS")).toBe("1-0-0");
  });
});
