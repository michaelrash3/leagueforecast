import { describe, expect, it } from "vitest";
import {
  createGcImporter,
  describeTidy,
  proposeTwinSquads,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";
import { gcRowId, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";
import { countsTowardRating, scoreSeenBy } from "../teamRankings/games";

/*
 * One game, three copies. The Marrowby Hawks' own schedule has the game against the Brackwell
 * Comets, and so has the Comets' own schedule: one game, held once, with both rows. The Comets'
 * squad is also on GameChanger as the Quillfen Riders, and the Riders' schedule has the same game,
 * the same minute and the same result, typed against the Hawks. The Riders' row stands as a game of
 * its own, and the Hawks are credited with the game twice. The pools are built as a backup holds
 * them, with invented clubs.
 */

const ageGroups: AgeGroup[] = [
  { id: "ag12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
];
const DAY = "2026-10-04";

const club = (id: string, name: string): ScoutTeam => ({
  id,
  name,
  state: "IN",
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag12", ageLevel: 12 }],
});
const hawks = club("HAWKS", "Marrowby Hawks");
const comets = club("COMETS", "Brackwell Comets");
const riders = club("RIDERS", "Quillfen Riders");
const otters = club("OTTERS", "Tarnfield Otters");

/** `clubId`'s own row `gameId` against `against`, its own score first. */
const row = (
  clubId: string,
  gameId: string,
  against: string,
  clock: string,
  score: [number, number]
): ScoutGame => ({
  id: gcRowId(`gc${clubId}`, gameId),
  teamAId: clubId,
  teamBId: against,
  teamAScore: score[0],
  teamBScore: score[1],
  ageGroupId: "ag12",
  date: DAY,
  ageLevelA: 12,
  startTs: `${DAY}T${clock}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});

/** The Hawks' 7-3 over the Comets at two, held with the Comets' own row of it. */
const bothHold = (clock = "14:00"): ScoutGame => ({
  ...row("HAWKS", "h1", "COMETS", clock, [7, 3]),
  alsoRows: [
    {
      teamId: "gcCOMETS",
      gameId: "c1",
      startTs: `${DAY}T${clock}:00.000Z`,
      ownScore: 3,
      opponentScore: 7,
      onSideB: true,
    },
  ],
});
/** The Riders' row of the same game: the Comets' 3-7, typed against the Hawks. */
const ridersCopy = (clock = "14:00", score: [number, number] = [3, 7]) =>
  row("RIDERS", "r1", "HAWKS", clock, score);

const pool = (games: ScoutGame[], teams: ScoutTeam[] = [hawks, comets, riders]): GcImportState => ({
  ageGroups,
  teams,
  games,
});

/** A club's record as its page reads it: wins, losses and ties, each game once. */
const recordOf = (state: GcImportState, clubId: string) => {
  const tally = [0, 0, 0];
  state.games.forEach((game) => {
    if (game.teamAId !== clubId && game.teamBId !== clubId) return;
    if (!countsTowardRating(game, "2026-10-11")) return;
    const seen = scoreSeenBy(game, clubId);
    if (!seen) return;
    tally[seen.own > seen.opponent ? 0 : seen.own < seen.opponent ? 1 : 2]! += 1;
  });
  return tally.join("-");
};
const RIDERS_ROW = gcRowId("gcRIDERS", "r1");
const copyIn = (state: GcImportState) => state.games.find((game) => game.id === RIDERS_ROW);

/** A tidy, and a second over its result that finds nothing: the pool the step converges on. */
const settled = (state: GcImportState) => {
  const first = tidyPool(state);
  const again = tidyPool(first.state);
  expect(again.passes).toBe(1);
  expect(again.state.games).toBe(first.state.games);
  return first;
};

describe("a third GameChanger team's copy of a game both clubs' schedules hold", () => {
  it("counts for nothing, so the club it names is credited once", () => {
    const before = pool([bothHold(), ridersCopy()]);
    expect(recordOf(before, "HAWKS")).toBe("2-0-0");

    const after = settled(before);
    expect(after.countedElsewhere).toBe(1);
    expect(copyIn(after.state)).toMatchObject({ countedElsewhere: true, teamBId: "HAWKS" });
    expect(recordOf(after.state, "HAWKS")).toBe("1-0-0");
    expect(recordOf(after.state, "COMETS")).toBe("0-1-0");
    expect(recordOf(after.state, "RIDERS")).toBe("0-0-0");
    // The row is still the Riders' game, found by its own id: nothing is moved or folded.
    expect(after.state.games).toHaveLength(2);
  });

  it("says so in the tidy's summary", () => {
    expect(describeTidy(tidyPool(pool([bothHold(), ridersCopy()])))).toContain(
      "1 copy of a game both clubs' own schedules already hold set not to count, or counted again once they stop holding it."
    );
  });

  it("and within the hour as well as at the same minute", () => {
    const after = settled(pool([bothHold("14:00"), ridersCopy("14:45")]));
    expect(copyIn(after.state)?.countedElsewhere).toBe(true);
  });

  describe("leaves the copy counting", () => {
    it.each([
      ["more than an hour from the game", pool([bothHold("14:00"), ridersCopy("15:10")])],
      ["with another result", pool([bothHold(), ridersCopy("14:00", [4, 7])])],
      [
        "where only the Hawks' own schedule holds the game",
        pool([row("HAWKS", "h1", "COMETS", "14:00", [7, 3]), ridersCopy()]),
      ],
      [
        // With a game of the Hawks' own that evening, so a row naming them stays on them.
        "where only the Comets' own schedule holds the game",
        pool(
          [
            row("COMETS", "c1", "HAWKS", "14:00", [3, 7]),
            ridersCopy(),
            row("HAWKS", "h9", "OTTERS", "18:00", [5, 4]),
          ],
          [hawks, comets, riders, otters]
        ),
      ],
      [
        "where the Riders played another game of their own that hour",
        pool(
          [bothHold(), ridersCopy(), row("RIDERS", "r2", "OTTERS", "14:30", [5, 2])],
          [hawks, comets, riders, otters]
        ),
      ],
      [
        "where two of the Hawks' games fit it",
        pool(
          [
            bothHold("14:00"),
            {
              ...row("HAWKS", "h2", "OTTERS", "14:30", [7, 3]),
              alsoRows: [
                {
                  teamId: "gcOTTERS",
                  gameId: "o1",
                  startTs: `${DAY}T14:30:00.000Z`,
                  ownScore: 3,
                  opponentScore: 7,
                  onSideB: true,
                },
              ],
            },
            ridersCopy("14:15"),
          ],
          [hawks, comets, riders, otters]
        ),
      ],
    ])("%s", (_, state) => {
      const after = settled(state);
      expect(after.countedElsewhere).toBe(0);
      expect(copyIn(after.state)?.countedElsewhere).toBeUndefined();
    });
  });

  it("counts again once the schedules stop bearing it out", () => {
    const marked = settled(pool([bothHold(), ridersCopy()])).state;
    // The Riders' scorekeeper puts the score right: a 4-7, so not the Hawks' 7-3 after all.
    const apart: GcImportState = {
      ...marked,
      games: marked.games.map((game) =>
        game.id === RIDERS_ROW ? { ...game, teamAScore: 4, teamBScore: 7 } : game
      ),
    };
    const after = settled(apart);
    expect(after.countedElsewhere).toBe(1);
    expect(copyIn(after.state)?.countedElsewhere).toBeUndefined();
    expect(recordOf(after.state, "RIDERS")).toBe("0-1-0");
  });

  it("leaves the game counted once where the Comets' own row of it goes", () => {
    // Only the Hawks' schedule holds the 7-3 now, against the Comets by name: the claim step reads
    // it as the Riders' game, and it is one game either way.
    const marked = settled(pool([bothHold(), ridersCopy()])).state;
    const unheld: GcImportState = {
      ...marked,
      games: marked.games.map((game) => {
        if (game.id !== gcRowId("gcHAWKS", "h1")) return game;
        // As a pull of the Comets' schedule leaves it: the row and the schedule on record both go.
        const { alsoRows: _rows, alsoFrom: _from, ...rest } = game;
        return rest;
      }),
    };
    const after = settled(unheld);
    expect(after.state.games.some((game) => game.countedElsewhere)).toBe(false);
    expect(recordOf(after.state, "HAWKS")).toBe("1-0-0");
  });

  it("stays marked through a pull of the Riders' schedule that changes nothing", () => {
    const marked = settled(pool([bothHold(), ridersCopy()])).state;
    const schedule: GcTeamSchedule = {
      profile: {
        id: "gcRIDERS",
        name: riders.name,
        ageLevel: 12,
        season: { season: "fall", year: 2026 },
        state: "IN",
      },
      games: [
        {
          id: "r1",
          date: DAY,
          opponentName: hawks.name,
          status: "completed",
          teamScore: 3,
          opponentScore: 7,
          startTs: `${DAY}T14:00:00.000Z`,
        },
      ],
      fetchedAt: "2026-10-11T12:00:00.000Z",
    };
    // The first pull writes what a pull writes that the pool here was built without.
    const first = createGcImporter(marked, { today: "2026-10-11" });
    expect(first.add(schedule)).toMatchObject({ gamesAdded: 0 });
    expect(copyIn(first.state)?.countedElsewhere).toBe(true);
    const settledAgain = settled(first.state).state;
    const second = createGcImporter(settledAgain, { today: "2026-10-11" });
    expect(second.add(schedule)).toMatchObject({
      gamesAdded: 0,
      gamesUpdated: 0,
      gamesUnchanged: 1,
    });
    expect(copyIn(second.state)?.countedElsewhere).toBe(true);
    expect(tidyPool(second.state).passes).toBe(1);
  });

  it("is still offered, with the Comets, as one squad on GameChanger twice", () => {
    // Two such games make the pair: the Riders and the Comets post the same games.
    const second = (game: ScoutGame, id: string, clock: string): ScoutGame => ({
      ...game,
      id: gcRowId(game.source!.teamId, id),
      date: "2026-10-05",
      startTs: `2026-10-05T${clock}:00.000Z`,
      source: { ...game.source!, gameId: id },
      ...(game.alsoRows
        ? {
            alsoRows: game.alsoRows.map((record) => ({
              ...record,
              gameId: `${record.gameId}b`,
              startTs: `2026-10-05T${clock}:00.000Z`,
            })),
          }
        : {}),
    });
    const after = settled(
      pool([
        bothHold(),
        ridersCopy(),
        second(bothHold("10:00"), "h1b", "10:00"),
        second(ridersCopy("10:00"), "r1b", "10:00"),
      ])
    );
    expect(after.countedElsewhere).toBe(2);
    expect(recordOf(after.state, "HAWKS")).toBe("2-0-0");
    const offers = proposeTwinSquads(after.state.teams, after.state.games);
    expect(offers.map((offer) => [offer.fromTeamId, offer.toTeamId].sort())).toEqual([
      ["COMETS", "RIDERS"],
    ]);
  });
});
