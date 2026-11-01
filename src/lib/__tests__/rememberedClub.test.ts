import { describe, expect, it } from "vitest";
import type { AgeGroup, ScoutTeam } from "../teamRankings";
import {
  clubLookupOf,
  gcCarriersOf,
  NO_SCOUT_TEAM,
  pageGcId,
  readClub,
  readPick,
  stampPicks,
} from "../teamRankings/leagueBridge";
import type { TeamBase } from "../types";

/*
 * One resolver for every club the device remembers (`readClub`), on the rule League picks are read
 * by (`readPick`): the club id where it still names a club carrying the GameChanger id kept beside
 * it, else the one club that now carries that id, else moved, which a store shows as a club gone.
 * Placeholder names and ids throughout.
 */

const link = (teamId: string, ageGroupId = "ag10", seasonYear?: number) => ({
  teamId,
  name: teamId,
  ageGroupId,
  ...(seasonYear === undefined ? {} : { season: "fall", seasonYear }),
});

const ACES: ScoutTeam = { id: "S-ACES", name: "Aces", gcTeams: [link("gcAces001")] };
const ACES_GOLD: ScoutTeam = { id: "S-ACES2", name: "Aces Gold", gcTeams: [link("gcAcesGld")] };
const BEARS: ScoutTeam = { id: "S-BEAR", name: "Bears", gcTeams: [link("gcBears01")] };

describe("readClub", () => {
  const roster = [ACES, ACES_GOLD, BEARS];

  it("is the club id while it names a club carrying the GameChanger id kept beside it", () => {
    expect(readClub({ id: "S-ACES2", gc: "gcAcesGld" }, clubLookupOf(roster))).toEqual({
      id: "S-ACES2",
    });
  });

  it("follows a club folded into another, which carries its GameChanger ids on", () => {
    // Aces Gold folded into Aces: its id gone, its GameChanger team on Aces.
    const folded = [
      { ...ACES, gcTeams: [...(ACES.gcTeams ?? []), ...(ACES_GOLD.gcTeams ?? [])] },
      BEARS,
    ];
    expect(readClub({ id: "S-ACES2", gc: "gcAcesGld" }, clubLookupOf(folded))).toEqual({
      id: "S-ACES",
    });
  });

  it("follows a club whose id was minted afresh, and never reads the id's new club as it", () => {
    // Started again: Aces Gold pulled back as S-ACES5, its old id now another club's.
    const again = [
      ACES,
      { id: "S-ACES2", name: "Aces Academy", gcTeams: [link("gcAcesAca")] },
      { ...ACES_GOLD, id: "S-ACES5" },
    ];
    expect(readClub({ id: "S-ACES2", gc: "gcAcesGld" }, clubLookupOf(again))).toEqual({
      id: "S-ACES5",
    });
  });

  it("is moved where the id names another club and no one club carries the GameChanger id", () => {
    const again = [ACES, { id: "S-ACES2", name: "Aces Academy", gcTeams: [link("gcAcesAca")] }];
    expect(readClub({ id: "S-ACES2", gc: "gcAcesGld" }, clubLookupOf(again))).toEqual({
      moved: "S-ACES2",
    });
    // Two clubs carrying it is no answer either.
    const twice = [...again, { ...ACES_GOLD, id: "S-ACES6" }, { ...ACES_GOLD, id: "S-ACES7" }];
    expect(readClub({ id: "S-ACES2", gc: "gcAcesGld" }, clubLookupOf(twice))).toEqual({
      moved: "S-ACES2",
    });
  });

  it("is as it always was without a GameChanger id, or for a club absent and carried by none", () => {
    expect(readClub({ id: "S-ACES2" }, clubLookupOf([ACES]))).toEqual({ id: "S-ACES2" });
    expect(readClub({ id: "S-GONE", gc: "gcNobody1" }, clubLookupOf(roster))).toEqual({
      id: "S-GONE",
    });
  });

  it("reads on what a device holds of the clubs, which is enough to know its own club", () => {
    // A member's device holds My Team's card alone: a look kept under another id of one of its
    // GameChanger teams is its own, and one of another team kept under its id is not.
    const mine = clubLookupOf([ACES]);
    expect(readClub({ id: "S-OLD9", gc: "gcAces001" }, mine)).toEqual({ id: "S-ACES" });
    expect(readClub({ id: "S-ACES", gc: "gcAcesGld" }, mine)).toEqual({ moved: "S-ACES" });
  });

  it("is the rule League picks are read by, to the result", () => {
    const again = [
      ACES,
      { id: "S-ACES2", name: "Aces Academy", gcTeams: [link("gcAcesAca")] },
      { ...ACES_GOLD, id: "S-ACES5" },
    ];
    const byId = new Map(again.map((team) => [team.id, team]));
    const carriersOf = gcCarriersOf(again);
    const lookup = clubLookupOf(again);
    const cases: TeamBase[] = [
      { id: "A", name: "A" },
      { id: "B", name: "B", scoutTeamId: NO_SCOUT_TEAM },
      { id: "C", name: "C", scoutTeamId: "S-ACES2" },
      { id: "D", name: "D", scoutTeamId: "S-ACES2", scoutGcTeamId: "gcAcesGld" },
      { id: "E", name: "E", scoutTeamId: "S-ACES2", scoutGcTeamId: "gcNobody1" },
      { id: "F", name: "F", scoutTeamId: "S-GONE", scoutGcTeamId: "gcNobody1" },
      { id: "G", name: "G", scoutTeamId: "S-ACES", scoutGcTeamId: "gcAces001" },
    ];
    expect(cases.map((team) => readPick(team, byId, carriersOf))).toEqual([
      {},
      { pick: NO_SCOUT_TEAM },
      { pick: "S-ACES2" },
      { pick: "S-ACES5" },
      { moved: "S-ACES2" },
      { pick: "S-GONE" },
      { pick: "S-ACES" },
    ]);
    // And readClub, read the same way, gives each pick of a club the same.
    for (const team of cases.slice(2)) {
      const read = readClub(
        { id: team.scoutTeamId ?? "", ...(team.scoutGcTeamId ? { gc: team.scoutGcTeamId } : {}) },
        lookup
      );
      const pick = readPick(team, byId, carriersOf);
      expect("moved" in read ? { moved: read.moved } : { pick: read.id }).toEqual(pick);
    }
  });
});

describe("clubLookupOf", () => {
  it("is one lookup for one roster, worked out once however many stores read it", () => {
    const roster = [ACES, BEARS];
    expect(clubLookupOf(roster)).toBe(clubLookupOf(roster));
    expect(clubLookupOf([...roster])).not.toBe(clubLookupOf(roster));
  });
});

describe("pageGcId", () => {
  const groups: AgeGroup[] = [
    { id: "ag10_2026", name: "10U 2026", seasonIds: [], ageLevel: 10, year: 2026 },
    { id: "ag10_2027", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  ];
  const club: ScoutTeam = {
    id: "S-ACES",
    name: "Aces",
    gcTeams: [link("gcAcesOld", "ag10_2026"), link("gcAcesNew", "ag10_2027")],
  };

  it("is the club's GameChanger team on the page, as a pick keeps the season's own", () => {
    expect(pageGcId(club, "ag10_2026", groups)).toBe("gcAcesOld");
    expect(pageGcId(club, "ag10_2027", groups)).toBe("gcAcesNew");
  });

  it("is none for a club GameChanger has no id for", () => {
    const duck: ScoutTeam = { id: "S-DUCK", name: "Ducks", nameOnly: true };
    expect(pageGcId(duck, "ag10_2027", groups)).toBe(undefined);
  });
});

describe("stampPicks", () => {
  const roster = [ACES, BEARS, { ...ACES_GOLD, gcTeams: [link("gcAcesGld"), link("gcAcesGl2")] }];

  it("gives an old pick its club's GameChanger id where the club carries exactly one", () => {
    const teams: TeamBase[] = [
      { id: "A", name: "A", scoutTeamId: "S-ACES" },
      { id: "B", name: "B", scoutTeamId: "S-BEAR", scoutGcTeamId: "gcBears01" },
      { id: "C", name: "C", scoutTeamId: "S-ACES2" },
      { id: "D", name: "D", scoutTeamId: NO_SCOUT_TEAM },
      { id: "E", name: "E", scoutTeamId: "S-GONE" },
      { id: "F", name: "F" },
    ];
    const stamped = stampPicks(teams, clubLookupOf(roster));
    expect(stamped).toEqual([
      { id: "A", name: "A", scoutTeamId: "S-ACES", scoutGcTeamId: "gcAces001" },
      ...teams.slice(1),
    ]);
    // Every team it leaves is the same object, so a save writes only the one it changed.
    stamped.slice(1).forEach((team, at) => expect(team).toBe(teams[at + 1]));
  });

  it("is the same array where no pick takes one", () => {
    const teams: TeamBase[] = [
      { id: "B", name: "B", scoutTeamId: "S-BEAR", scoutGcTeamId: "gcBears01" },
      { id: "C", name: "C", scoutTeamId: "S-ACES2" },
    ];
    expect(stampPicks(teams, clubLookupOf(roster))).toBe(teams);
  });
});
