import { describe, expect, it } from "vitest";
import { unlinkGcTeam, type AgeGroup, type ScoutTeam } from "../teamRankings";
import {
  clubLookupOf,
  gcCarriersOf,
  NO_SCOUT_TEAM,
  readClub,
  readPick,
  stampPicks,
} from "../teamRankings/leagueBridge";
import { GONE_CLUB, KEPT_GC_IDS, keptGcIds, shownClubId } from "../teamRankings/rememberedClub";
import type { TeamBase } from "../types";

/*
 * One resolver for every club the device remembers (`readClub`), on the rule League picks are read
 * by (`readPick`): the club id where it still names a club carrying a GameChanger id kept beside
 * it, else the one club that now carries them, else moved, which a store shows as a club gone.
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
    expect(readClub({ id: "S-ACES2", gc: ["gcAcesGld"] }, clubLookupOf(roster))).toEqual({
      id: "S-ACES2",
    });
  });

  it("follows a club folded into another, which carries its GameChanger ids on", () => {
    // Aces Gold folded into Aces: its id gone, its GameChanger team on Aces.
    const folded = [
      { ...ACES, gcTeams: [...(ACES.gcTeams ?? []), ...(ACES_GOLD.gcTeams ?? [])] },
      BEARS,
    ];
    expect(readClub({ id: "S-ACES2", gc: ["gcAcesGld"] }, clubLookupOf(folded))).toEqual({
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
    expect(readClub({ id: "S-ACES2", gc: ["gcAcesGld"] }, clubLookupOf(again))).toEqual({
      id: "S-ACES5",
    });
  });

  it("is moved where the id names another club and no one club carries the GameChanger id", () => {
    const again = [ACES, { id: "S-ACES2", name: "Aces Academy", gcTeams: [link("gcAcesAca")] }];
    expect(readClub({ id: "S-ACES2", gc: ["gcAcesGld"] }, clubLookupOf(again))).toEqual({
      moved: "S-ACES2",
    });
    // Two clubs carrying it is no answer either.
    const twice = [...again, { ...ACES_GOLD, id: "S-ACES6" }, { ...ACES_GOLD, id: "S-ACES7" }];
    expect(readClub({ id: "S-ACES2", gc: ["gcAcesGld"] }, clubLookupOf(twice))).toEqual({
      moved: "S-ACES2",
    });
  });

  it("is as it always was without a GameChanger id, or for a club absent and carried by none", () => {
    expect(readClub({ id: "S-ACES2" }, clubLookupOf([ACES]))).toEqual({ id: "S-ACES2" });
    expect(readClub({ id: "S-GONE", gc: ["gcNobody1"] }, clubLookupOf(roster))).toEqual({
      id: "S-GONE",
    });
  });

  it("reads on what a device holds of the clubs, which is enough to know its own club", () => {
    // A member's device holds My Team's card alone: a look kept under another id of one of its
    // GameChanger teams is its own, and one of another team kept under its id is not.
    const mine = clubLookupOf([ACES]);
    expect(readClub({ id: "S-OLD9", gc: ["gcAces001"] }, mine)).toEqual({ id: "S-ACES" });
    expect(readClub({ id: "S-ACES", gc: ["gcAcesGld"] }, mine)).toEqual({ moved: "S-ACES" });
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
        { id: team.scoutTeamId ?? "", ...(team.scoutGcTeamId ? { gc: [team.scoutGcTeamId] } : {}) },
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

describe("keptGcIds", () => {
  const groups: AgeGroup[] = [
    { id: "ag10_2026", name: "10U 2026", seasonIds: [], ageLevel: 10, year: 2026 },
    { id: "ag10_2027", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  ];
  const club: ScoutTeam = {
    id: "S-ACES",
    name: "Aces",
    gcTeams: [link("gcAcesOld", "ag10_2026"), link("gcAcesNew", "ag10_2027")],
  };

  it("is the club's GameChanger teams, its team on the page first, as a pick keeps the season's own", () => {
    expect(keptGcIds(club, "ag10_2026", groups)).toEqual(["gcAcesOld", "gcAcesNew"]);
    expect(keptGcIds(club, "ag10_2027", groups)).toEqual(["gcAcesNew", "gcAcesOld"]);
  });

  it("is a few of them at most", () => {
    const many: ScoutTeam = {
      ...club,
      gcTeams: ["gcAces001", "gcAces002", "gcAces003", "gcAces004", "gcAces005"].map((id) =>
        link(id, "ag10_2027")
      ),
    };
    expect(keptGcIds(many, "ag10_2027", groups)).toHaveLength(KEPT_GC_IDS);
  });

  it("is none for a club GameChanger has no id for", () => {
    const duck: ScoutTeam = { id: "S-DUCK", name: "Ducks", nameOnly: true };
    expect(keptGcIds(duck, "ag10_2027", groups)).toEqual([]);
  });
});

/*
 * A link undone (Unlink) takes one GameChanger id off a club still on the board, most likely the
 * page's newest, which is the one a store kept first. Kept by one id, the club then read as gone
 * (the review of 1 November 2026); kept by a few, it is itself while it carries any of them.
 */
describe("a remembered club one of whose GameChanger teams is unlinked", () => {
  const groups: AgeGroup[] = [
    { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  ];
  const pool: ScoutTeam[] = [
    {
      id: "S-ACES",
      name: "Aces",
      gcTeams: [link("gcAces001"), { ...link("gcAces002"), name: "Aces Gold" }],
    },
    BEARS,
  ];

  it("is still itself, read by the ids kept with it", () => {
    const [aces] = pool;
    if (!aces) throw new Error("no club");
    const gc = keptGcIds(aces, "ag10", groups);
    expect(gc[0]).toBe("gcAces002");
    const after = unlinkGcTeam("S-ACES", "gcAces002", pool);
    expect(shownClubId({ id: "S-ACES", gc }, clubLookupOf(after))).toBe("S-ACES");
    // And where the link undone was another club's, and is on that club now.
    const moved = after.map((club) =>
      club.id === "S-BEAR"
        ? { ...club, gcTeams: [...(club.gcTeams ?? []), link("gcAces002")] }
        : club
    );
    expect(shownClubId({ id: "S-ACES", gc }, clubLookupOf(moved))).toBe("S-ACES");
  });

  it("is gone once it carries none of them and no one club carries them", () => {
    const after = unlinkGcTeam("S-ACES", "gcAces001", unlinkGcTeam("S-ACES", "gcAces002", pool));
    expect(shownClubId({ id: "S-ACES", gc: ["gcAces002", "gcAces001"] }, clubLookupOf(after))).toBe(
      `${GONE_CLUB}S-ACES`
    );
  });

  it("follows the one club carrying them, and no club where two carry one each", () => {
    // Started again: its id another club's, and its teams on one club, or split across two.
    const again: ScoutTeam[] = [
      { id: "S-ACES", name: "Aces Academy", gcTeams: [link("gcAcesAca")] },
      { id: "S-ACES5", name: "Aces", gcTeams: [link("gcAces001")] },
      BEARS,
    ];
    expect(readClub({ id: "S-ACES", gc: ["gcAces002", "gcAces001"] }, clubLookupOf(again))).toEqual(
      { id: "S-ACES5" }
    );
    const acesGold: ScoutTeam = { id: "S-ACES6", name: "Aces Gold", gcTeams: [link("gcAces002")] };
    const split = clubLookupOf([...again.slice(0, 2), acesGold]);
    expect(readClub({ id: "S-ACES", gc: ["gcAces002", "gcAces001"] }, split)).toEqual({
      moved: "S-ACES",
    });
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
