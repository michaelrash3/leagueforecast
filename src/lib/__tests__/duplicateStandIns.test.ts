import { describe, expect, it } from "vitest";
import { mergeDuplicateStandIns, tidyPool, type GcImportState } from "../gameChangerImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A stand-in filed twice: two entries of one name, level and squad year, each named by a club of
 * one state. Oklahoma's 10U clubs named "Mojo Gold 2036" — a 9U squad by its class — and each found
 * an entry of its own.
 */
const groups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
];
const club = (id: string, name: string, state: string, level = 10): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [
    { teamId: `gc${id}`, name: `${name} ${level}U`, ageGroupId: `ag${level}`, ageLevel: level },
  ],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
let serial = 0;
/** A row of `clubId`'s own schedule against `against`, on a 10U page. */
const row = (
  clubId: string,
  against: string,
  date: string,
  clock: string,
  typed?: number
): ScoutGame => {
  serial += 1;
  return {
    id: `gc_gc${clubId}_${serial}`,
    teamAId: clubId,
    teamBId: against,
    teamAScore: 3,
    teamBScore: 5,
    ageGroupId: "ag10",
    ageLevelA: 10,
    ...(typed === undefined ? {} : { ageLevelB: typed }),
    date,
    startTs: `${date}T${clock}:00.000Z`,
    source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId: String(serial) },
  };
};
const pirates = club("PIRATES", "Pirates", "OK");
const ryal = club("RYAL", "Ryal", "OK");
const plano = club("PLANO", "Plano Power", "TX");
const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
  ageGroups: groups,
  teams,
  games,
});
/** The team each game's side B now is. */
const against = (state: GcImportState) => state.games.map((game) => game.teamBId);

describe("a stand-in filed twice", () => {
  it("is made one where the name carries a graduating class", () => {
    const before = pool(
      [pirates, ryal, standIn("S-MOJO1", "Mojo Gold 2036"), standIn("S-MOJO2", "Mojo Gold 2036")],
      [
        row("PIRATES", "S-MOJO1", "2026-09-13", "15:00", 9),
        row("RYAL", "S-MOJO2", "2026-08-30", "16:00", 9),
      ]
    );
    const { state, merged } = mergeDuplicateStandIns(before);
    expect(merged).toBe(1);
    expect(against(state)).toEqual(["S-MOJO1", "S-MOJO1"]);
    expect(state.teams.map((team) => team.id)).not.toContain("S-MOJO2");
    // However many pulled clubs carry the name: the class says which squad.
    const common = pool(
      [
        ...before.teams,
        club("MOJOTX", "Mojo Gold 2036", "TX"),
        club("MOJOKS", "Mojo Gold 2036", "KS"),
      ],
      before.games
    );
    expect(mergeDuplicateStandIns(common).merged).toBe(1);
  });

  it("is made one where no more than one pulled club carries the name", () => {
    const before = pool(
      [
        pirates,
        ryal,
        standIn("S-CHARGE1", "Cherokee Charge"),
        standIn("S-CHARGE2", "Cherokee Charge"),
      ],
      [
        row("PIRATES", "S-CHARGE1", "2026-09-13", "15:00"),
        row("RYAL", "S-CHARGE2", "2026-08-30", "16:00"),
      ]
    );
    expect(against(mergeDuplicateStandIns(before).state)).toEqual(["S-CHARGE1", "S-CHARGE1"]);
  });

  it("takes the claims filed against the entry that goes", () => {
    const holder: ScoutGame = {
      ...row("RYAL", "PIRATES", "2026-09-20", "18:00"),
      alsoRows: [{ teamId: "gcPIRATES", gameId: "x1", filedAgainst: "S-MOJO2", onSideB: true }],
      alsoFrom: ["gcPIRATES"],
    };
    const before = pool(
      [pirates, ryal, standIn("S-MOJO1", "Mojo Gold 2036"), standIn("S-MOJO2", "Mojo Gold 2036")],
      [
        row("PIRATES", "S-MOJO1", "2026-09-13", "15:00", 9),
        row("RYAL", "S-MOJO2", "2026-08-30", "16:00", 9),
        holder,
      ]
    );
    const { state } = mergeDuplicateStandIns(before);
    expect(state.games[2]?.alsoRows?.[0]?.filedAgainst).toBe("S-MOJO1");
  });

  describe("is left as two", () => {
    it("under a name several pulled clubs carry", () => {
      const tigers = [club("TIGERS1", "Tigers", "NJ"), club("TIGERS2", "Tigers", "TN")];
      const before = pool(
        [pirates, ryal, ...tigers, standIn("S-TIG1", "Tigers"), standIn("S-TIG2", "Tigers")],
        [
          row("PIRATES", "S-TIG1", "2026-09-13", "15:00"),
          row("RYAL", "S-TIG2", "2026-08-30", "16:00"),
        ]
      );
      expect(mergeDuplicateStandIns(before).merged).toBe(0);
    });

    it("named by clubs of states that do not meet", () => {
      const before = pool(
        [
          pirates,
          plano,
          standIn("S-MOJO1", "Mojo Gold 2036"),
          standIn("S-MOJO2", "Mojo Gold 2036"),
        ],
        [
          row("PIRATES", "S-MOJO1", "2026-09-13", "15:00", 9),
          row("PLANO", "S-MOJO2", "2026-08-30", "16:00", 9),
        ]
      );
      expect(mergeDuplicateStandIns(before).merged).toBe(0);
    });

    it("where the two played other opponents within the hour of each other", () => {
      const before = pool(
        [pirates, ryal, standIn("S-PAD1", "Padres 2036"), standIn("S-PAD2", "Padres 2036")],
        [
          row("PIRATES", "S-PAD1", "2026-09-19", "20:00", 9),
          row("RYAL", "S-PAD2", "2026-09-19", "20:30", 9),
        ]
      );
      expect(mergeDuplicateStandIns(before).merged).toBe(0);
      // The same two hours apart is a team's doubleheader.
      const apart = pool(before.teams, [
        row("PIRATES", "S-PAD1", "2026-09-19", "18:00", 9),
        row("RYAL", "S-PAD2", "2026-09-19", "20:30", 9),
      ]);
      expect(mergeDuplicateStandIns(apart).merged).toBe(1);
    });

    it("at two levels, or where one was filed at two", () => {
      const teams = [
        pirates,
        ryal,
        standIn("S-MOJO1", "Mojo Gold 2036"),
        standIn("S-MOJO2", "Mojo Gold 2036"),
      ];
      const twoLevels = pool(teams, [
        row("PIRATES", "S-MOJO1", "2026-09-13", "15:00", 9),
        row("RYAL", "S-MOJO2", "2026-08-30", "16:00", 11),
      ]);
      expect(mergeDuplicateStandIns(twoLevels).merged).toBe(0);
      const spread = pool(teams, [
        row("PIRATES", "S-MOJO1", "2026-09-13", "15:00", 9),
        row("PIRATES", "S-MOJO1", "2026-09-20", "15:00", 11),
        row("RYAL", "S-MOJO2", "2026-08-30", "16:00", 9),
      ]);
      expect(mergeDuplicateStandIns(spread).merged).toBe(0);
    });

    it("where they are bracket slots rather than names", () => {
      const slot = (id: string): ScoutTeam => ({ id, name: "Mojo Gold 2036", placeholder: true });
      const before = pool(
        [pirates, ryal, slot("S-SLOT1"), slot("S-SLOT2")],
        [
          row("PIRATES", "S-SLOT1", "2026-09-13", "15:00", 9),
          row("RYAL", "S-SLOT2", "2026-08-30", "16:00", 9),
        ]
      );
      expect(mergeDuplicateStandIns(before).merged).toBe(0);
    });
  });

  it("is made one by the tidy, which then finds nothing more", () => {
    const before = pool(
      [pirates, ryal, standIn("S-MOJO1", "Mojo Gold 2036"), standIn("S-MOJO2", "Mojo Gold 2036")],
      [
        row("PIRATES", "S-MOJO1", "2026-09-13", "15:00", 9),
        row("RYAL", "S-MOJO2", "2026-08-30", "16:00", 9),
      ]
    );
    const tidy = tidyPool(before);
    expect(tidy.merged).toBe(1);
    const again = tidyPool(tidy.state);
    expect(again.merged).toBe(0);
    expect(again.passes).toBe(1);
  });
});
