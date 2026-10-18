import { describe, expect, it } from "vitest";
import { tidyPool, type GcImportState } from "../gameChangerImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * One game held twice because both pulled clubs filed their copy against a stand-in. Club A's own
 * row is against a stand-in carrying club B's very name, and club B's own row of the same game, at
 * the same hour with the result mirrored, is against a stand-in or a slot standing for A. Neither
 * row names the other club as GameChanger lists it, so the crossed-halves join, the slot settle and
 * the claim step each pass them by, and both clubs count the game. The pools here are built as a
 * backup holds them, with invented clubs.
 */

const ageGroups: AgeGroup[] = [
  { id: "ag11", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
  { id: "ag12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] },
  { id: "ag13", name: "13U 2027", ageLevel: 13, year: 2027, seasonIds: [] },
  { id: "ag14", name: "14U 2027", ageLevel: 14, year: 2027, seasonIds: [] },
  { id: "ag15", name: "15U 2027", ageLevel: 15, year: 2027, seasonIds: [] },
];
const levelOf = (page: string) => Number(page.slice(2));

const club = (id: string, name: string, state: string, page: string): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: page, ageLevel: levelOf(page) }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string, name: string): ScoutTeam => ({ id, name, placeholder: true });

/** `clubId`'s own row `gameId`, standing as a game against `against`, its own score first. */
const row = (
  clubId: string,
  gameId: string,
  against: string,
  page: string,
  start: string,
  score?: [number, number]
): ScoutGame => ({
  id: `gc_gc${clubId}_${gameId}`,
  teamAId: clubId,
  teamBId: against,
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ageGroupId: page,
  date: start.slice(0, 10),
  ageLevelA: levelOf(page),
  season: "Fall 2026",
  startTs: `${start}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});

const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
  ageGroups,
  teams,
  games,
});

/** Each game as one line, by the names of its sides: what the tidy did, readable in a diff. */
const linesOf = (state: GcImportState): string[] => {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const label = (id: string) => {
    const team = teamById.get(id);
    if (!team) return `${id}?`;
    return `${team.name}${team.gcTeams?.length ? "" : team.placeholder ? " (slot)" : " (stand-in)"}`;
  };
  return state.games
    .map((game) => {
      const score = game.teamAScore === undefined ? "v" : `${game.teamAScore}-${game.teamBScore}`;
      const levels = `${game.ageLevelA ?? "-"}/${game.ageLevelB ?? "-"}`;
      const held = (game.alsoRows ?? [])
        .map(
          (record) =>
            `${record.teamId}:${record.gameId}` +
            (record.filedAgainst ? ` filed against ${label(record.filedAgainst)}` : "")
        )
        .join("; ");
      return (
        `${game.date} ${game.startTs?.slice(11, 16)} ${game.ageGroupId} ${levels} ` +
        `${label(game.teamAId)} ${score} ${label(game.teamBId)}` +
        (held ? ` [holds ${held}]` : "")
      );
    })
    .sort();
};
/** What a tidy did to a pool: each game as a line, and the steps that changed anything. */
const tidied = (state: GcImportState) => {
  const out = tidyPool(state);
  const counts = Object.fromEntries(
    Object.entries(out).filter(([key, value]) => key !== "state" && key !== "passes" && value !== 0)
  );
  return { lines: linesOf(out.state), counts };
};

const DAY = "2026-10-03";
const ridge = club("RIDGE", "North Ridge Bombers", "IN", "ag12");
const hustle = club("HUSTLE", "Lakeshore Hustle", "IN", "ag13");

/** The shape the audit found most: a stand-in each side, one level apart. */
const standInEachSide = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:00`, [11, 4]),
    ]
  );

/** A slot on B's side, two clubs a country apart at one level: out of the import's reach. */
const slotOnB = () =>
  pool(
    [
      club("WAR", "Valley Warriors", "CA", "ag12"),
      club("STARS", "Hudson Stars", "NY", "ag12"),
      standIn("S-STARS", "Hudson Stars"),
      slot("TBD-1", "TBD- 09/11/26, 6:00 PM"),
    ],
    [
      row("WAR", "w1", "S-STARS", "ag12", "2026-09-11T22:00", [8, 3]),
      row("STARS", "s1", "TBD-1", "ag12", "2026-09-11T22:00", [3, 8]),
    ]
  );

/** A slot on B's side an hour off, B a level below A. */
const slotAnHourOff = () =>
  pool(
    [
      club("TIGERS", "Lakeview Tigers", "IL", "ag15"),
      club("HEAT", "Prairie Heat - Ortiz", "IL", "ag14"),
      standIn("S-HEAT", "Prairie Heat-Ortiz"),
      slot("TBD-2", "TBD- 10/03/26, 6:00 PM"),
    ],
    [
      row("TIGERS", "t1", "S-HEAT", "ag15", `${DAY}T22:00`, [5, 8]),
      row("HEAT", "p1", "TBD-2", "ag14", `${DAY}T23:00`, [8, 5]),
    ]
  );

/** B's mirrored row a week after A's, at the same clock: another meeting, not this one. */
const aWeekOff = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h8", "S-RIDGE", "ag13", "2026-10-10T14:00", [11, 4]),
    ]
  );

/** B's row gives A's result from its own seat: two results, not one game seen from two sides. */
const notMirrored = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:00`, [4, 11]),
    ]
  );

/** Two pulled clubs carry the stand-in's name, and each has a mirrored row within the hour. */
const twoNamesakes = () =>
  pool(
    [
      ridge,
      hustle,
      club("HUSTLE2", "Lakeshore Hustle", "OH", "ag11"),
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      slot("TBD-3", "TBD"),
      slot("TBD-4", "TBD"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "TBD-3", "ag13", `${DAY}T14:00`, [11, 4]),
      row("HUSTLE2", "o1", "TBD-4", "ag11", `${DAY}T14:30`, [11, 4]),
    ]
  );

/** Two clubs each filed a row against a stand-in of B's name that B's one row mirrors. */
const twoNamers = () =>
  pool(
    [
      ridge,
      hustle,
      club("PINES", "North Pines Bombers", "IN", "ag12"),
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-HUSTLE-2", "Lakeshore Hustle"),
      slot("TBD-5", "TBD"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("PINES", "n1", "S-HUSTLE-2", "ag12", `${DAY}T14:20`, [4, 11]),
      row("HUSTLE", "h1", "TBD-5", "ag13", `${DAY}T14:00`, [11, 4]),
    ]
  );

/** Neither side has a result yet, at the very same minute. */
const unscored = () =>
  pool(
    [
      ridge,
      hustle,
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      standIn("S-RIDGE", "NR - Ridge Bombers"),
    ],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`),
      row("HUSTLE", "h1", "S-RIDGE", "ag13", `${DAY}T14:00`),
    ]
  );

/** B's stand-in shares no word with A's name. */
const noWordShared = () =>
  pool(
    [ridge, hustle, standIn("S-HUSTLE", "Lakeshore Hustle"), standIn("S-COMETS", "Saginaw Comets")],
    [
      row("RIDGE", "r1", "S-HUSTLE", "ag12", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE", "h1", "S-COMETS", "ag13", `${DAY}T14:00`, [11, 4]),
    ]
  );

/** B's page three levels from A's. */
const threeLevelsApart = () =>
  pool(
    [
      club("RIDGE11", "North Ridge Bombers", "IN", "ag11"),
      club("HUSTLE14", "Lakeshore Hustle", "IN", "ag14"),
      standIn("S-HUSTLE", "Lakeshore Hustle"),
      slot("TBD-6", "TBD"),
    ],
    [
      row("RIDGE11", "r1", "S-HUSTLE", "ag11", `${DAY}T14:00`, [4, 11]),
      row("HUSTLE14", "h1", "TBD-6", "ag14", `${DAY}T14:00`, [11, 4]),
    ]
  );

describe("the tidy before the namesake join, pinned", () => {
  /*
   * What the tidy did with each of these pools before the join existed: both copies stand, each
   * counted for its own club. The shapes the join reads as one game are pinned here as they were,
   * so the change shows as the edit it is; the decoys must read the same after it, to the line.
   */
  it("holds the stand-in each side shape twice", () => {
    expect(tidied(standInEachSide())).toEqual({
      counts: {},
      lines: [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 NR - Ridge Bombers (stand-in)",
      ],
    });
  });

  it("holds the slot on B's side twice", () => {
    expect(tidied(slotOnB())).toEqual({
      counts: {},
      lines: [
        "2026-09-11 22:00 ag12 12/- Hudson Stars 3-8 TBD- 09/11/26, 6:00 PM (slot)",
        "2026-09-11 22:00 ag12 12/- Valley Warriors 8-3 Hudson Stars (stand-in)",
      ],
    });
  });

  it("holds the slot an hour off twice", () => {
    expect(tidied(slotAnHourOff())).toEqual({
      counts: {},
      lines: [
        "2026-10-03 22:00 ag15 15/- Lakeview Tigers 5-8 Prairie Heat-Ortiz (stand-in)",
        "2026-10-03 23:00 ag14 14/- Prairie Heat - Ortiz 8-5 TBD- 10/03/26, 6:00 PM (slot)",
      ],
    });
  });

  it.each([
    [
      "a week off",
      aWeekOff,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-10 14:00 ag13 13/- Lakeshore Hustle 11-4 NR - Ridge Bombers (stand-in)",
      ],
    ],
    [
      "a result not mirrored",
      notMirrored,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 4-11 NR - Ridge Bombers (stand-in)",
      ],
    ],
    [
      "two namesakes",
      twoNamesakes,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 TBD (slot)",
        "2026-10-03 14:30 ag11 11/- Lakeshore Hustle 11-4 TBD (slot)",
      ],
    ],
    [
      "two namers",
      twoNamers,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 TBD (slot)",
        "2026-10-03 14:20 ag12 12/- North Pines Bombers 4-11 Lakeshore Hustle (stand-in)",
      ],
    ],
    [
      "no result yet",
      unscored,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers v Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle v NR - Ridge Bombers (stand-in)",
      ],
    ],
    [
      "no word shared",
      noWordShared,
      [
        "2026-10-03 14:00 ag12 12/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag13 13/- Lakeshore Hustle 11-4 Saginaw Comets (stand-in)",
      ],
    ],
    [
      "three levels apart",
      threeLevelsApart,
      [
        "2026-10-03 14:00 ag11 11/- North Ridge Bombers 4-11 Lakeshore Hustle (stand-in)",
        "2026-10-03 14:00 ag14 14/- Lakeshore Hustle 11-4 TBD (slot)",
      ],
    ],
  ])("leaves %s as it was", (_, build, lines) => {
    expect(tidied(build())).toEqual({ counts: {}, lines });
  });
});
