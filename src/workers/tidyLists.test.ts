import { describe, expect, it } from "vitest";
import { createTidyHandler, packPool, type WorkerResponse } from "./tidyProtocol";
import { poolLists } from "../lib/poolLists";
import { proposeSeasonPairings, proposeTwinSquads } from "../lib/gameChangerImport";
import { countedTwice } from "../lib/countedTwice";
import { unpulledClubs } from "../lib/unpulledClubs";
import { filedAtWrongAge } from "../lib/wrongAge";
import { apartKey, keptApartList } from "../lib/keptApart";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";

/*
 * Pool health's lists, worked out in the tidy worker beside its numbers.
 *
 * Each walks the whole pool, and the page worked all four out after the worker's answer came back,
 * on the pool the worker had just unpacked: on the 18:40 pool a 2.4 s freeze after every press of
 * "Check the pool", 12 to 13 s at a phone's speed. What must hold is that they are the lists the
 * page worked out, and that a pair kept apart is still not offered.
 */
const club = (id: string, name: string): ScoutTeam => ({
  id,
  name,
  state: "NJ",
  gcTeams: [{ teamId: `gc${id}`, name: `${name} 9U`, ageGroupId: "ag9", ageLevel: 9 }],
});
let serial = 0;
/** A row of `clubId`'s own schedule, its score first. */
const row = (clubId: string, against: string, clock: string, score: [number, number]) => {
  serial += 1;
  const date = "2026-09-19";
  return {
    id: `gc_gc${clubId}_${serial}`,
    teamAId: clubId,
    teamBId: against,
    teamAScore: score[0],
    teamBScore: score[1],
    ageGroupId: "ag9",
    date,
    startTs: `${date}T${clock}:00.000Z`,
    source: { kind: "gamechanger" as const, teamId: `gc${clubId}`, gameId: String(serial) },
  } satisfies ScoutGame;
};
const ageGroups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
];
/** One squad on GameChanger twice (two clubs posting the same games), and a stand-in to pull. */
const state = {
  ageGroups,
  teams: [
    club("GRN", "EB GRN"),
    club("CUBS", "Cubs Fall 2026"),
    club("BULL", "Brick American Bulldogs"),
    club("HAWK", "Hawks"),
    { id: "S-OWLS", name: "Owls", nameOnly: true },
  ] satisfies ScoutTeam[],
  games: [
    row("GRN", "BULL", "14:00", [4, 7]),
    row("CUBS", "BULL", "14:00", [4, 7]),
    row("GRN", "HAWK", "17:00", [9, 1]),
    row("CUBS", "HAWK", "17:00", [9, 1]),
    row("HAWK", "S-OWLS", "19:00", [3, 2]),
  ],
};
const TODAY = "2026-09-27";

const inspect = (apart: string[] = []) => {
  const posted: WorkerResponse[] = [];
  createTidyHandler((response) => posted.push(response))({
    kind: "inspect",
    id: 1,
    state: packPool(state),
    stamp: "",
    today: TODAY,
    apart,
  });
  const answer = posted[0];
  if (answer?.kind !== "inspect") throw new Error("no inspection");
  return answer.lists;
};

describe("pool health's lists, from the worker", () => {
  it("are the lists the page worked out", () => {
    const lists = inspect();
    expect(lists).toEqual({
      toPull: unpulledClubs(state),
      duplicates: proposeSeasonPairings(state.teams, state.games).filter(
        (pairing) => pairing.kind === "same-season"
      ),
      twins: proposeTwinSquads(state.teams, state.games),
      twice: countedTwice(state.teams, state.games, TODAY),
      // Read in the squad year being played on the day asked about.
      wrongAge: filedAtWrongAge(state, 2027),
    });
    // The fixture is worth something: there is a twin pair to offer.
    expect(lists.twins).toHaveLength(1);
    // And the inline path is the same function.
    expect(poolLists(state, new Set(), TODAY)).toEqual(lists);
  });

  it("do not offer a pair the user said is two clubs", () => {
    const apart = keptApartList(new Set([apartKey("gcGRN", "gcCUBS")]));
    expect(inspect(apart).twins).toEqual([]);
  });
});

describe("the clubs filed at the wrong age, from the worker", () => {
  it("are read in the squad year being played on the day asked about", () => {
    const pages: AgeGroup[] = [
      { id: "ag8", name: "8U 2027", ageLevel: 8, year: 2027, seasonIds: [] },
      { id: "ag9", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
    ];
    const at = (id: string, name: string, page: string): ScoutTeam => ({
      id,
      name,
      gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: page }],
    });
    const played = (a: string, b: string, date: string): ScoutGame => ({
      id: `${a}-${b}-${date}`,
      ageGroupId: "ag8",
      teamAId: a,
      teamBId: b,
      date,
    });
    const posted: WorkerResponse[] = [];
    createTidyHandler((response) => posted.push(response))({
      kind: "inspect",
      id: 2,
      state: packPool({
        ageGroups: pages,
        teams: [
          at("HORN", "Hornets 9U", "ag8"),
          at("N1", "Nine One 9U", "ag9"),
          at("N2", "Nine Two 9U", "ag9"),
        ],
        games: [played("HORN", "N1", "2026-09-12"), played("HORN", "N2", "2026-09-26")],
      }),
      stamp: "",
      today: TODAY,
      apart: [],
    });
    const answer = posted[0];
    if (answer?.kind !== "inspect") throw new Error("no inspection");
    expect(answer.lists.wrongAge).toMatchObject([
      { teamId: "HORN", year: 2027, filed: 8, suggested: 9, gcTeamIds: ["gcHORN"] },
    ]);
  });
});
