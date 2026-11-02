import { describe, expect, it } from "vitest";
import { tidyPool, type GcImportState } from "../gameChangerImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import {
  oneNameLines,
  oneNameRows,
  unjoinedReasonLines,
  unjoinedReasons,
} from "../unjoinedReasons";

/*
 * Why a stand-in the nightly says should have joined its one pulled namesake did not
 * (`unjoinedReasons`): each of its rows read through the refile, counted under the reasons the two
 * name rules gave. Placeholder names throughout.
 */
const groups: AgeGroup[] = [
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  { id: "ag13", name: "13U 2027", seasonIds: [], ageLevel: 13, year: 2027 },
];

const pulled = (id: string, name: string, state: string, level = 10): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: "ag10", ageLevel: level }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });

let made = 0;
const row = (
  club: ScoutTeam,
  against: string,
  date: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id: `g${(made += 1)}`,
  teamAId: club.id,
  teamBId: against,
  ageGroupId: "ag10",
  date,
  startTs: `${date}T14:00:00.000Z`,
  teamAScore: 5,
  teamBScore: 3,
  source: { kind: "gamechanger", teamId: club.gcTeams![0]!.teamId, gameId: `x${made}` },
  ...extra,
});

const namer = pulled("NAMER", "Louisville Sluggers", "KY");
const named = standIn("S-BOMB", "Bluegrass Bombers");
const someone = standIn("S-ELSE", "Somebody Else");

/** The namer's 15 September game against "Bluegrass Bombers", and the Bombers' own on the 20th. */
const pool = (bombers: ScoutTeam, games: ScoutGame[] = []): GcImportState => ({
  ageGroups: groups,
  teams: [namer, bombers, named, someone],
  games: [row(namer, named.id, "2026-09-15"), row(bombers, someone.id, "2026-09-20"), ...games],
});

describe("why a stand-in that should have joined did not", () => {
  it("counts a row the refile would move as one it would move, with no reason", () => {
    const found = unjoinedReasons(pool(pulled("BOMB", "Bluegrass Bombers", "KY")), 2027);
    expect(found).toMatchObject({ standIns: 1, rows: 1, played: 1, wouldMove: 1, reasons: [] });
  });

  it("says which test held a row back: here, a row dated before the club's season", () => {
    // The namer's game on 1 September, three weeks before the Bombers' own first game.
    const state: GcImportState = {
      ageGroups: groups,
      teams: [namer, pulled("BOMB", "Bluegrass Bombers", "KY"), named, someone],
      games: [
        row(namer, named.id, "2026-09-01"),
        row(pulled("BOMB", "Bluegrass Bombers", "KY"), someone.id, "2026-09-20"),
      ],
    };
    const found = unjoinedReasons(tidyPool(state).state, 2027);
    expect(found.wouldMove).toBe(0);
    expect(found.reasons).toEqual([{ key: "beforeSeason | beforeSeason", rows: 1, played: 1 }]);
  });

  it("says why neither rule found the club: listed at a level far from the row's", () => {
    // Its games are on the 10U page, so the report reads it there; its link says 13U.
    const state = tidyPool(pool(pulled("BOMB", "Bluegrass Bombers", "KY", 13))).state;
    const found = unjoinedReasons(state, 2027);
    expect(found.reasons).toEqual([{ key: "none | none", rows: 1, played: 1 }]);
    expect(found.noneWhy).toEqual([{ key: "candidate listed 3 levels from the row", rows: 1 }]);
    expect(unjoinedReasonLines(found)).toContain(
      "    candidate listed 3 levels from the row: 1 rows"
    );
  });
});

describe("one name's clubs and rows, nameless", () => {
  it("lists each club of the name and each row filed against a stand-in of it, with its reason", () => {
    const bombers = {
      ...pulled("BOMB", "Bluegrass Bombers", "KY"),
      gcTeams: [
        {
          teamId: "gcBOMB",
          name: "Bluegrass Bombers",
          ageGroupId: "ag10",
          ageLevel: 10,
          importedAt: "2026-11-02T12:25:00.000Z",
        },
      ],
    };
    const state: GcImportState = {
      ageGroups: groups,
      teams: [namer, bombers, named, someone],
      games: [row(namer, named.id, "2026-09-01"), row(bombers, someone.id, "2026-09-20")],
    };
    const lines = oneNameLines(
      oneNameRows(tidyPool(state).state, 2027, (key) => key === "bluegrass bombers")
    );
    expect(lines).toEqual([
      "Clubs of the name in the squad year: 2",
      "  pulled, KY, listed at 10U; 1 games, first own day 2026-09-20; 1 link(s), last pulled 2026-11-02T12:25:00.000Z",
      "  stand-in, no state, listed at nothing; 1 games, first own day none; 0 link(s), last pulled never",
      "Rows pulled clubs' schedules filed against a stand-in of the name: 1",
      "  2026-09-01 on the 10U page, named from KY, played: beforeSeason | beforeSeason",
    ]);
  });
});
