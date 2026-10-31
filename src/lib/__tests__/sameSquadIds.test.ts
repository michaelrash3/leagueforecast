import { describe, expect, it } from "vitest";
import type { GcGame, GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedules,
  mergeSameSquadIds,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { apartKey } from "../keptApart";
import { gcRowId, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

/*
 * Two squads a club lists under one GameChanger name, at one level in one state, are folded into
 * one club only where their own schedules filed the same fixture (`mergeSameSquadIds`). The sweep of
 * 30 October 2026 found the fixture read off a TBD: every plain "TBD" keys to "tbd", so two such
 * squads that each beat a TBD 5-3 on one day, hours apart, were one club, and one squad left the
 * board with its season pooled into the other's. The owner's answer that the two are two clubs did
 * not stop it, since the tidy did not pass that answer to the fold. Invented clubs.
 */
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const game = (id: string, start: string, opponentName: string, own: number, theirs: number) =>
  ({
    id,
    date: start.slice(0, 10),
    startTs: `${start}:00.000Z`,
    opponentName,
    status: "completed",
    teamScore: own,
    opponentScore: theirs,
  }) satisfies GcGame;
const squad = (id: string, games: GcGame[], name = "Comets 10U"): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ageLevel: 10,
    season: { season: "fall", year: 2026 },
    state: "KY",
    city: "Alphaville",
  },
  games,
  fetchedAt: "2026-10-01T12:00:00.000Z",
});
const vipers = squad(
  "gcVIP",
  [game("v1", "2026-09-20T15:00", "Comets", 2, 9), game("v2", "2026-09-27T15:00", "Comets", 4, 3)],
  "Vipers 10U"
);
/** Each pulled club's GameChanger ids, one club per entry: two squads kept two, or one folded. */
const clubsOf = (state: GcImportState) =>
  state.teams
    .filter((team) => team.gcTeams?.length)
    .map((team) =>
      (team.gcTeams ?? [])
        .map((link) => link.teamId)
        .sort()
        .join("+")
    )
    .sort();
const TWO_SQUADS = ["gcBLUE", "gcGOLD", "gcVIP"];

describe("two same-named squads with bracket games typed as TBD", () => {
  /** GOLD and BLUE, each with one game against a TBD on 13 September and one against the Vipers. */
  const pulled = (
    gold: [string, number, number, string?],
    blue: [string, number, number, string?]
  ) => {
    const at = (time: string) => `2026-09-13T${time}`;
    return importGcSchedules(
      [
        squad("gcGOLD", [
          game("g1", at(gold[0]), gold[3] ?? "TBD", gold[1], gold[2]),
          game("g2", "2026-09-20T15:00", "Vipers", 9, 2),
        ]),
        squad("gcBLUE", [
          game("b1", at(blue[0]), blue[3] ?? "TBD", blue[1], blue[2]),
          game("b2", "2026-09-27T15:00", "Vipers", 3, 4),
        ]),
        vipers,
      ],
      empty
    ).state;
  };

  it("are two clubs where they met as TBD on both schedules and tied", () => {
    const tidy = tidyPool(pulled(["15:00", 5, 5], ["15:00", 5, 5]));
    expect(tidy.folded).toBe(0);
    expect(clubsOf(tidy.state)).toEqual(TWO_SQUADS);
  });

  it("are two clubs where each beat a different TBD by one score, hours apart", () => {
    const tidy = tidyPool(pulled(["10:00", 5, 3], ["13:00", 5, 3]));
    expect(tidy.folded).toBe(0);
    expect(clubsOf(tidy.state)).toEqual(TWO_SQUADS);
  });

  it("are two clubs where each played a slot GameChanger dated at one start, by one score", () => {
    const dated = "TBD- 09/13/26, 3:00 PM";
    const tidy = tidyPool(pulled(["15:00", 5, 3, dated], ["15:00", 5, 3, dated]));
    expect(tidy.folded).toBe(0);
    expect(clubsOf(tidy.state)).toEqual(TWO_SQUADS);
  });

  it("are two clubs where each beat a club nobody pulled by one score that day", () => {
    // A name nobody pulled is a stand-in, and a stand-in of one name is many teams.
    const tidy = tidyPool(pulled(["10:00", 5, 3, "Raptors"], ["13:00", 5, 3, "Raptors"]));
    expect(tidy.folded).toBe(0);
    expect(clubsOf(tidy.state)).toEqual(TWO_SQUADS);
  });
});

describe("what proves two same-named squads one", () => {
  const groups: AgeGroup[] = [
    { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  ];
  const club = (id: string, name = "Comets"): ScoutTeam => ({
    id,
    name,
    state: "KY",
    gcTeams: [{ teamId: `gc${id}`, name: `${name} 10U`, ageGroupId: "ag10", ageLevel: 10 }],
  });
  const row = (clubId: string, gameId: string, against: string, start: string, score: number[]) =>
    ({
      id: gcRowId(`gc${clubId}`, gameId),
      teamAId: clubId,
      teamBId: against,
      teamAScore: score[0],
      teamBScore: score[1],
      ageGroupId: "ag10",
      date: start.slice(0, 10),
      startTs: `${start}:00.000Z`,
      source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
    }) satisfies ScoutGame;
  const pool = (teams: ScoutTeam[], games: ScoutGame[]): GcImportState => ({
    ageGroups: groups,
    teams: [club("GOLD"), club("BLUE"), ...teams],
    games,
  });
  /** Both squads' own rows of one 9-2 over `against` on 20 September, at one start. */
  const sameGame = (against: string) => [
    row("GOLD", "g1", against, "2026-09-20T15:00", [9, 2]),
    row("BLUE", "b1", against, "2026-09-20T15:00", [9, 2]),
  ];

  it("is the same game against a pulled third club, as it was", () => {
    expect(mergeSameSquadIds(pool([club("VIP", "Vipers")], sameGame("VIP"))).merged).toBe(1);
  });

  it("is that very club, by its id, and not another club of its name", () => {
    // Each squad beat a different pulled Vipers 5-3 that day, hours apart, one Vipers of Kentucky
    // and one of Ohio, each Vipers club's own row mirroring its game: one name, two clubs, two
    // games. Keyed by the name, the two games were one fixture and the squads one club.
    const vipers = [club("VIPKY", "Vipers"), { ...club("VIPOH", "Vipers"), state: "OH" }];
    const state = pool(vipers, [
      row("GOLD", "g1", "VIPKY", "2026-09-13T10:00", [5, 3]),
      row("VIPKY", "k1", "GOLD", "2026-09-13T10:00", [3, 5]),
      row("BLUE", "b1", "VIPOH", "2026-09-13T13:00", [5, 3]),
      row("VIPOH", "o1", "BLUE", "2026-09-13T13:00", [3, 5]),
    ]);
    expect(mergeSameSquadIds(state).merged).toBe(0);
    const tidy = tidyPool(state);
    expect(tidy.folded).toBe(0);
    expect(clubsOf(tidy.state)).toEqual(["gcBLUE", "gcGOLD", "gcVIPKY", "gcVIPOH"]);
  });

  it("is a pulled club of the squads' own name too, from another state", () => {
    // Read by its id, a Comets of Ohio is a third club like any other. The squads' own tie with
    // each other is not read by this: each squad's row of it names the other, two ids (below).
    const ohio = { ...club("OHIO"), state: "OH" };
    expect(mergeSameSquadIds(pool([ohio], sameGame("OHIO"))).merged).toBe(1);
  });

  it("is never a game against a slot, a placeholder or a stand-in", () => {
    const against: ScoutTeam[] = [
      { id: "T-1", name: "TBD", placeholder: true },
      { id: "T-2", name: "Winner of Game 3", placeholder: true },
      { id: "S-RAPTORS", name: "Raptors", nameOnly: true },
    ];
    against.forEach((team) =>
      expect(mergeSameSquadIds(pool([team], sameGame(team.id))).merged).toBe(0)
    );
  });

  it("is never the two squads' own tie with each other", () => {
    // Each squad's row of a 5-5 between them names the other, whose name is its own: the tie
    // reads the same from either side, and proved them one squad, which then played itself.
    const tie = [
      row("GOLD", "g1", "BLUE", "2026-09-13T15:00", [5, 5]),
      row("BLUE", "b1", "GOLD", "2026-09-13T15:00", [5, 5]),
    ];
    expect(mergeSameSquadIds(pool([], tie)).merged).toBe(0);
    const tidy = tidyPool(pool([], tie));
    expect(tidy.folded).toBe(0);
    const between = tidy.state.games.filter(
      (one) => [one.teamAId, one.teamBId].sort().join() === "BLUE,GOLD"
    );
    expect(between).toHaveLength(1);
  });

  it("is never enough where the owner said the two are two clubs, in the tidy as well", () => {
    const vipersClub = club("VIP", "Vipers");
    const state = pool(
      [vipersClub],
      [...sameGame("VIP"), row("VIP", "v1", "GOLD", "2026-09-20T15:00", [2, 9])]
    );
    const apart = new Set([apartKey("gcGOLD", "gcBLUE")]);
    expect(mergeSameSquadIds(state, apart).merged).toBe(0);
    expect(tidyPool(state).folded).toBe(1);
    expect(tidyPool(state, undefined, apart).folded).toBe(0);
  });

  /*
   * A third squad of the name, RED, with the most games, that shares a 9-2 over the Vipers with
   * GOLD and a 4-3 with BLUE: both fold into it in one pass. Each squad is asked against those
   * already folding into RED as well as RED itself, or two that cannot be one club end as one.
   */
  const intoRed = [
    row("RED", "r1", "VIP", "2026-09-20T15:00", [9, 2]),
    row("RED", "r2", "VIP", "2026-09-27T15:00", [4, 3]),
    row("RED", "r3", "VIP", "2026-10-04T15:00", [1, 1]),
    row("GOLD", "g1", "VIP", "2026-09-20T15:00", [9, 2]),
    row("BLUE", "b1", "VIP", "2026-09-27T15:00", [4, 3]),
  ];
  /** Whether one club holds both GOLD's and BLUE's ids. */
  const goldWithBlue = (state: GcImportState) =>
    clubsOf(state).some((one) => one.includes("gcBLUE") && one.includes("gcGOLD"));

  it("never folds two the owner said are two clubs into a third squad in one pass", () => {
    const state = pool([club("RED"), club("VIP", "Vipers")], intoRed);
    const apart = new Set([apartKey("gcGOLD", "gcBLUE")]);
    expect(goldWithBlue(mergeSameSquadIds(state).state)).toBe(true);
    const folded = mergeSameSquadIds(state, apart);
    expect(folded.merged).toBe(1);
    expect(goldWithBlue(folded.state)).toBe(false);
    expect(goldWithBlue(tidyPool(state, undefined, apart).state)).toBe(false);
  });

  it("never folds squads of two states into a third squad of none in one pass", () => {
    const { state: _none, ...red } = club("RED");
    const state: GcImportState = {
      ageGroups: groups,
      teams: [club("GOLD"), { ...club("BLUE"), state: "OH" }, red, club("VIP", "Vipers")],
      games: intoRed,
    };
    const folded = mergeSameSquadIds(state);
    expect(folded.merged).toBe(1);
    expect(goldWithBlue(folded.state)).toBe(false);
    expect(goldWithBlue(tidyPool(state).state)).toBe(false);
  });
});
