import { describe, expect, it } from "vitest";
import type { ScoutTeam } from "../../teamRankings";
import type { TeamBase } from "../../types";
import { NO_SCOUT_TEAM } from "../../teamRankings/leagueBridge";
import { seasonToDoc } from "../../live/leagueDocs";
import { DEFAULT_SETTINGS } from "../../types";
import { censusLines, clubCensus, leagueTeamsOf, tapLeagueDocs } from "../clubCensus";

/*
 * How the clubs are known, as the nightly counts them (`clubCensus.ts`): the clubs on the pool by
 * how many GameChanger ids each carries, and the League picks by whether a GameChanger id is kept
 * beside them. Counts only: the Actions log is public, so no club's name or id may reach a line,
 * and the fixture below is held to that. Placeholder names and ids throughout.
 */

const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: "ag10" });

const ROSTER: ScoutTeam[] = [
  { id: "S-ACES", name: "Aces", gcTeams: [link("gcAces001")] },
  { id: "S-BEAR", name: "Bears", gcTeams: [link("gcBears01"), link("gcBears02")] },
  { id: "S-COME", name: "Comets", gcTeams: [link("gcComets1")] },
  { id: "S-DUCK", name: "Ducks", nameOnly: true },
  { id: "S-TBD", name: "TBD", placeholder: true },
  { id: "S-TBD2", name: "TBD", placeholder: true },
  {
    id: "S-EAGL",
    name: "Eagles",
    gcTeams: [link("gcEagles1"), link("gcEagles2"), link("gcEagles3")],
  },
];

const team = (id: string, scoutTeamId?: string, scoutGcTeamId?: string): TeamBase => ({
  id,
  name: id,
  ...(scoutTeamId ? { scoutTeamId } : {}),
  ...(scoutGcTeamId ? { scoutGcTeamId } : {}),
});

const SEASONS: TeamBase[][] = [
  [
    // Kept with its GameChanger id.
    team("ACES", "S-ACES", "gcAces001"),
    // Without one, of a club with exactly one: could take it.
    team("COME", "S-COME"),
    // Without one, of a club with two: could not.
    team("BEAR", "S-BEAR"),
    // An answer, not a pick of a club.
    team("NONE", NO_SCOUT_TEAM),
    // Nobody has said.
    team("OPEN"),
  ],
  [
    // Without one, of a stand-in with none, and of a club the roster no longer holds.
    team("DUCK", "S-DUCK"),
    team("GONE", "S-GONE"),
    team("EAGL", "S-EAGL", "gcEagles2"),
  ],
];

describe("clubCensus", () => {
  it("counts the clubs by GameChanger ids carried and the picks by the id beside them", () => {
    expect(clubCensus(ROSTER, SEASONS)).toEqual({
      clubs: 7,
      oneGcId: 2,
      severalGcIds: 2,
      noGcId: 3,
      slots: 2,
      league: { seasons: 2, withGc: 2, withoutGc: 4, couldTake: 1 },
    });
  });

  it("counts no picks where no season was read", () => {
    expect(clubCensus(ROSTER, null).league).toBeNull();
  });

  it("says counts only, and never a club's name or id", () => {
    const lines = censusLines(clubCensus(ROSTER, SEASONS));
    expect(lines).toEqual([
      "  Clubs by how GameChanger knows them: 7 on the pool; 2 with one GameChanger id, 2 with several (squads and seasons folded together), 3 with none (1 known only by name, 2 bracket slots).",
      "  League picks of a club, in 2 seasons: 2 kept with a GameChanger id beside them, 4 without; of those 4, 1 could take one at its season's next save (the club picked has exactly one).",
    ]);
    const said = lines.join("\n");
    for (const club of ROSTER) {
      expect(said).not.toContain(club.id);
      expect(said).not.toContain(club.name);
      for (const one of club.gcTeams ?? []) expect(said).not.toContain(one.teamId);
    }
    for (const season of SEASONS) for (const one of season) expect(said).not.toContain(one.id);
  });

  it("says where the picks were not counted", () => {
    expect(censusLines(clubCensus(ROSTER, null))[1]).toBe(
      "  League picks were not counted: no season's document was read this run."
    );
  });
});

describe("leagueTeamsOf", () => {
  it("reads each season's teams off its document as a device would", () => {
    const docs = SEASONS.map((teams, at) => ({
      id: `season-${at}`,
      fields: seasonToDoc({
        id: `season-${at}`,
        name: `Season ${at}`,
        createdAt: "2026-09-01T00:00:00.000Z",
        teams,
        matchups: [],
        logs: {},
        bracketLogs: {},
        settings: DEFAULT_SETTINGS,
      }) as unknown as Record<string, unknown>,
    }));
    expect(leagueTeamsOf(docs)).toEqual(SEASONS);
    // One that cannot be read is left out, as the publish would have stopped on it first.
    expect(leagueTeamsOf([...docs, { id: "season-x", fields: { schema: "?" } }])).toEqual(SEASONS);
  });
});

describe("tapLeagueDocs", () => {
  it("hands on every read and keeps the last one's documents, reading nothing itself", async () => {
    let reads = 0;
    const docs = [{ id: "season-1", fields: {} }];
    const tap = tapLeagueDocs(async () => {
      reads += 1;
      return docs;
    });
    expect(tap.last()).toBeNull();
    expect(reads).toBe(0);
    expect(await tap.list()).toBe(docs);
    expect(await tap.list()).toBe(docs);
    expect(reads).toBe(2);
    expect(tap.last()).toBe(docs);
  });
});
