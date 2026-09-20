import { describe, expect, it } from "vitest";
import {
  dateInSquadYear,
  deriveLeagueScoutGames,
  inSegment,
  inSquadYear,
  segmentOfDate,
  type ScoutTeam,
} from "../teamRankings";
import { coerceScoutTeams } from "../teamRankingsCompact";

/**
 * Three ways the app quietly lost something, found by an audit and each confirmed against the
 * code before it was touched. None of them said anything on screen: a league season that simply
 * did not count, a backup that came back missing the one field the fold list runs on, and a
 * migration that deleted what it had failed to copy.
 */

describe("a League Standings date, carried onto a Team Rankings page", () => {
  it("is placed in the squad year the page is for", () => {
    // August starts the squad year, so a month from August is in the calendar year before its
    // number and a month before August is in the number itself.
    expect(dateInSquadYear("9/13", 2027)).toBe("2026-09-13");
    expect(dateInSquadYear("12/1", 2027)).toBe("2026-12-01");
    expect(dateInSquadYear("3/4", 2027)).toBe("2027-03-04");
    expect(dateInSquadYear("7/31", 2027)).toBe("2027-07-31");
    expect(dateInSquadYear("8/1", 2027)).toBe("2026-08-01");
  });

  it("leaves alone what it cannot place, and what is already placed", () => {
    expect(dateInSquadYear("2026-09-13", 2027)).toBe("2026-09-13");
    expect(dateInSquadYear("9/13", undefined)).toBe("9/13");
    expect(dateInSquadYear("", 2027)).toBe("");
    expect(dateInSquadYear(undefined, 2027)).toBeUndefined();
    expect(dateInSquadYear("13/40", 2027)).toBe("13/40");
  });

  it("passes the season tests it used to fail", () => {
    /*
     * Every one of these is a string comparison against the squad-year window, and "9/13" is not
     * less than "2027-07-31". So a league game was outside its own season, in neither half of it,
     * and left out of the fit, the record and the table it was carried across for.
     */
    const placed = dateInSquadYear("9/13", 2027);

    expect(inSquadYear("9/13", 2027)).toBe(false);
    expect(inSquadYear(placed, 2027)).toBe(true);
    expect(segmentOfDate(placed, 2027)).toBe("fall");
    expect(inSegment(placed, 2027, "fall")).toBe(true);
    expect(dateInSquadYear("3/4", 2027)).toSatisfy(
      (date) => segmentOfDate(date, 2027) === "spring"
    );
  });

  it("comes off deriveLeagueScoutGames ready to count", () => {
    const { games } = deriveLeagueScoutGames(
      "ag9",
      [
        {
          seasonId: "s1",
          teams: [
            { id: "l1", name: "Trash Pandas" },
            { id: "l2", name: "River City Raptors" },
          ],
          matchups: [{ id: "m1", date: "9/13", away: "l1", home: "l2" }],
          logs: {
            m1: {
              awayRuns: "6",
              awayHits: "8",
              awayK: "4",
              homeRuns: "5",
              homeHits: "7",
              homeK: "5",
              innings: "6",
              isFinal: true,
            },
          },
        },
      ],
      [],
      2027
    );

    expect(games).toHaveLength(1);
    expect(games[0]?.date).toBe("2026-09-13");
    expect(inSegment(games[0]?.date, 2027, "fall")).toBe(true);
  });
});

describe("a stored team, read back", () => {
  it("keeps the mark that says nobody has pulled it", () => {
    const [team] = coerceScoutTeams([
      { id: "t1", name: "Warriors", nameOnly: true, avatarKey: "av-1" },
    ]);

    expect(team?.nameOnly).toBe(true);
    expect(team?.avatarKey).toBe("av-1");
  });

  it("keeps the coaches, the roster count and when it was taken", () => {
    // Two coaches in common is the only thing in the data that says two GameChanger ids are one
    // club inside a season, so losing them emptied the fold list of the pairs worth folding.
    const [team] = coerceScoutTeams([
      {
        id: "t1",
        name: "Ambush",
        gcTeams: [
          {
            teamId: "xFkSEXq8zoxB",
            name: "Ambush 9U",
            ageGroupId: "ag9",
            staff: ["Ali Castle", "Crystal Akers"],
            playerCount: 12,
            countedAt: "2026-09-17T17:02:00.000Z",
          },
        ],
      },
    ]);

    expect(team?.gcTeams?.[0]).toMatchObject({
      staff: ["Ali Castle", "Crystal Akers"],
      playerCount: 12,
      countedAt: "2026-09-17T17:02:00.000Z",
    });
  });

  it("drops a staff list that is not a list of names", () => {
    const [team] = coerceScoutTeams([
      {
        id: "t1",
        name: "Ambush",
        gcTeams: [{ teamId: "x", name: "n", ageGroupId: "ag", staff: [1, 2] }],
      },
    ]);

    expect(team?.gcTeams?.[0]?.staff).toBeUndefined();
  });
});

/** A roster with a mark and a picture, for the identity checks the pool runs on. */
export const standIn: ScoutTeam = { id: "t1", name: "Warriors", nameOnly: true, avatarKey: "av" };
