import { describe, expect, it } from "vitest";
import { buildTeamRankings, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

/**
 * What shipping a recency scheme actually buys, proved through the path the app ranks on.
 *
 * `byGamesSince` counts a team's own games, not the calendar, so this is not "the autumn is worth
 * less than the spring". A side that played its season and stopped keeps every one of those games
 * at full weight, because from its point of view nothing has happened since. What it does buy is
 * *form*: inside one team's record, the games it played most recently pull harder than the ones it
 * played first.
 *
 * So the test is two clubs with the identical record, the identical opponents and the identical
 * margins, differing only in which half of the season the wins fell in. Unweighted they are the
 * same team. Weighted, the one that finished strong rates higher — and that difference is the
 * whole feature.
 */
/* Squad year 2026 runs 2025-08-01 to 2026-07-31 — the autumn and the spring used below. */
const pool: AgeGroup[] = [{ id: "u10", name: "10U 2026", ageLevel: 10, year: 2026, seasonIds: [] }];

const OPPONENTS = ["O-0", "O-1", "O-2", "O-3", "O-4", "O-5", "O-6", "O-7", "O-8", "O-9"];
/** Five dates in the autumn, then five in the spring the same squad year ran into. */
const EARLY = ["2025-09-06", "2025-09-13", "2025-09-20", "2025-09-27", "2025-10-04"];
const LATE = ["2026-04-11", "2026-04-18", "2026-04-25", "2026-05-02", "2026-05-09"];

const built = () => {
  const teams: ScoutTeam[] = [
    { id: "T-RISE", name: "Finished strong" },
    { id: "T-FALL", name: "Started strong" },
    ...OPPONENTS.map((id, i) => ({ id, name: `Club ${i}` })),
  ];
  const games: ScoutGame[] = [];
  let seq = 0;
  const add = (a: string, b: string, sa: number, sb: number, date: string) => {
    games.push({
      id: `g${seq++}`,
      ageGroupId: "u10",
      teamAId: a,
      teamBId: b,
      teamAScore: sa,
      teamBScore: sb,
      date,
    });
  };

  /*
   * The opponents play each other across both halves, so they are joined into one scale and are
   * themselves ageing at the same rate for both clubs. Without this the two clubs sit in separate
   * pieces of the schedule and their ratings are not comparable at all.
   */
  OPPONENTS.forEach((home, i) => {
    OPPONENTS.slice(i + 1).forEach((away, j) => {
      const margin = [0, 2, -2, 1, -1, 3, -3][(i + j) % 7]!;
      add(
        home,
        away,
        5 + Math.max(0, margin),
        5 + Math.max(0, -margin),
        (i + j) % 2 ? EARLY[j % 5]! : LATE[j % 5]!
      );
    });
  });

  // Mirrored seasons: same ten opponents, same ±5 margins, opposite halves.
  OPPONENTS.slice(0, 5).forEach((opponent, i) => {
    add("T-RISE", opponent, 5, 10, EARLY[i]!); // loses early
    add("T-FALL", opponent, 10, 5, EARLY[i]!); // wins early
  });
  OPPONENTS.slice(5).forEach((opponent, i) => {
    add("T-RISE", opponent, 10, 5, LATE[i]!); // wins late
    add("T-FALL", opponent, 5, 10, LATE[i]!); // loses late
  });

  return { teams, games };
};

const ranked = () => {
  const { teams, games } = built();
  const rows = buildTeamRankings("u10", teams, games, undefined, pool);
  return {
    rise: rows.find((row) => row.teamId === "T-RISE")!,
    fall: rows.find((row) => row.teamId === "T-FALL")!,
  };
};

describe("recency weighting, through the ranking the app builds", () => {
  it("rates the club that finished strong above the one that started strong", () => {
    const { rise, fall } = ranked();
    expect(rise.pointRating).toBeGreaterThan(fall.pointRating);
    expect(rise.rating).toBeGreaterThan(fall.rating);
    // And by enough to be the weighting rather than a rounding of the solver.
    expect(rise.rating - fall.rating).toBeGreaterThan(0.25);
  });

  it("leaves the record alone, which weighting is never allowed to touch", () => {
    const { rise, fall } = ranked();
    // Both went 5-5 against the same ten clubs by the same margins. The fit leans; the season does
    // not move. A table that quietly showed one of them 6-4 would be lying about what happened.
    expect(rise.record).toBe(fall.record);
    expect(rise.games).toBe(10);
    expect(fall.games).toBe(10);
  });
});
