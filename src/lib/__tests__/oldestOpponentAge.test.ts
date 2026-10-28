import { describe, expect, it, vi } from "vitest";
import type { GcTeamSchedule } from "../gameChangerApi";
import { importGcSchedule, type GcImportState } from "../gameChangerImport";
import { answerableByOldest, answerableToday } from "../agelessQueue";
import type { AgeUnknownTeam } from "../ageUnknown";
import { gameSideLevels } from "../teamRankings";

/*
 * A team nobody could age, filed at the oldest age its opponents are until they settle one
 * (`oldestOpponentAge`): the owner's rule of 23 October 2026. Placeholder names throughout; the
 * GameChanger ids are made up.
 */

const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
const TODAY = "2026-09-14";

/** A schedule GameChanger gave no age, from a name that writes none. */
const ageless = (
  games: GcTeamSchedule["games"],
  overrides: Partial<GcTeamSchedule["profile"]> = {}
): GcTeamSchedule => ({
  profile: {
    id: "gcWILDCATS00",
    name: "Wildcats",
    season: { season: "fall", year: 2026 },
    ...overrides,
  },
  games,
  fetchedAt: "2026-09-14T12:00:00.000Z",
});

let made = 0;
/** A played game against `opponentName`, a different day each. */
const against = (opponentName: string, more: Partial<GcTeamSchedule["games"][number]> = {}) => {
  made += 1;
  return {
    id: `g${made}`,
    date: `2026-08-${String(made % 28 || 1).padStart(2, "0")}`,
    opponentName,
    status: "completed" as const,
    teamScore: 6,
    opponentScore: 4,
    ...more,
  };
};

const pull = (schedule: GcTeamSchedule, state = empty) =>
  importGcSchedule(schedule, state, { today: TODAY });

/** The level and the rule a pulled club's one link is filed by. */
const filedAs = (state: GcImportState, gcTeamId: string) => {
  const link = state.teams
    .flatMap((team) => team.gcTeams ?? [])
    .find((entry) => entry.teamId === gcTeamId);
  const group = state.ageGroups.find((entry) => entry.id === link?.ageGroupId);
  return { level: group?.ageLevel, ageFrom: link?.ageFrom };
};

describe("a team below the opponents' bar", () => {
  it("is filed at its one opponent's age, as the oldest it has played", () => {
    const { state, outcome } = pull(ageless([against("Hawks 10U")]));
    expect(outcome.skip).toBeUndefined();
    expect(outcome.ageFromOldest).toBe(10);
    expect(filedAs(state, "gcWILDCATS00")).toEqual({ level: 10, ageFrom: "tentative" });
  });

  it("is filed at the older of two opponents that disagree", () => {
    const { state } = pull(ageless([against("Hawks 9U"), against("Comets 10U")]));
    expect(filedAs(state, "gcWILDCATS00")).toEqual({ level: 10, ageFrom: "tentative" });
  });

  it("is filed by its opponents' rule, not the oldest, once three of them agree", () => {
    const { state, outcome } = pull(
      ageless([
        against("Hawks 9U"),
        against("Comets 9U"),
        against("Rockets 9U"),
        against("Bandits 10U"),
      ])
    );
    expect(outcome.ageFromOldest).toBeUndefined();
    expect(filedAs(state, "gcWILDCATS00")).toEqual({ level: 9, ageFrom: "opponents" });
  });

  it("moves to its opponents' age once they settle one, games and all", () => {
    const hawks = against("Hawks 10U");
    const first = pull(ageless([hawks]));
    expect(filedAs(first.state, "gcWILDCATS00").level).toBe(10);
    const later = pull(
      ageless([hawks, against("Comets 9U"), against("Rockets 9U"), against("Bandits 9U")]),
      first.state
    );
    expect(filedAs(later.state, "gcWILDCATS00")).toEqual({ level: 9, ageFrom: "opponents" });
    const nine = later.state.ageGroups.find((group) => group.ageLevel === 9)!;
    const club = later.state.teams.find((team) => team.gcTeams?.[0]?.teamId === "gcWILDCATS00")!;
    const games = later.state.games.filter(
      (game) => game.teamAId === club.id || game.teamBId === club.id
    );
    expect(games).toHaveLength(4);
    expect(games.every((game) => game.ageGroupId === nine.id)).toBe(true);
  });

  it("takes the level its rows wrote down for it along, not just the page (Codex on #438)", () => {
    const hawks = against("Hawks 10U");
    const first = pull(ageless([hawks]));
    const club = first.state.teams.find((team) => team.gcTeams?.[0]?.teamId === "gcWILDCATS00")!;
    // A row that wrote the club's tentative level down, as a fold stood up again writes it.
    const written: GcImportState = {
      ...first.state,
      games: first.state.games.map((game) =>
        game.teamAId === club.id ? { ...game, ageLevelA: 10 } : game
      ),
    };
    const later = pull(
      ageless([hawks, against("Comets 9U"), against("Rockets 9U"), against("Bandits 9U")]),
      written
    );
    const ownRows = later.state.games.filter((game) => game.teamAId === club.id);
    expect(ownRows).toHaveLength(4);
    expect(ownRows.map((game) => gameSideLevels(game, later.state.ageGroups).a)).toEqual([
      9, 9, 9, 9,
    ]);
  });

  it("reads only ages this app ranks, inside GameChanger's own band", () => {
    expect(pull(ageless([against("Hawks 19U")])).outcome.skip).toBe("no-age");
    // An opponent writing an age above the oldest ranked is no older opponent to file by.
    const ranked = pull(ageless([against("Hawks 10U"), against("Comets 19U")]));
    expect(filedAs(ranked.state, "gcWILDCATS00")).toEqual({ level: 10, ageFrom: "tentative" });
    const under13 = { ageLabel: "Under 13" };
    expect(pull(ageless([against("Hawks 14U")], under13)).outcome.skip).toBe("no-age");
    const { state } = pull(ageless([against("Hawks 12U"), against("Comets 14U")], under13));
    expect(filedAs(state, "gcWILDCATS00")).toEqual({ level: 12, ageFrom: "tentative" });
  });

  it("is not filed where the waiting list would set it aside", () => {
    // A roster short of nine, and a name that is no team's.
    expect(pull(ageless([against("Hawks 10U")], { playerCount: 5 })).outcome.skip).toBe("no-age");
    expect(pull(ageless([against("Hawks 10U")], { name: "AB" })).outcome.skip).toBe("no-age");
    // A full roster is no bar.
    expect(pull(ageless([against("Hawks 10U")], { playerCount: 12 })).outcome.skip).toBeUndefined();
  });

  it("is filed on its own page when another's is made in the same millisecond", () => {
    // CI on #461, 26 October 2026: the Wildcats' 12U page and the Otters' 9U page were made in
    // one millisecond under one random number, so under one id, and the Otters read as 12U. Pages
    // are made under their age and year's id now (`pageIdFor`).
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    try {
      const wildcats = pull(ageless([against("Hawks 12U")]));
      const { state } = pull(
        ageless([against("Cats"), against("Comets 9U")], {
          id: "gcOTTERS0000",
          name: "Otters",
        }),
        wildcats.state
      );
      expect(state.ageGroups.map((group) => group.id)).toEqual(["ag_12u_2027", "ag_9u_2027"]);
      expect(filedAs(state, "gcOTTERS0000")).toEqual({ level: 9, ageFrom: "tentative" });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("is no evidence of another team's age through the games it played either", () => {
    // The Stix are filed at 12U off one opponent. The Hurricanes' game against them is the other
    // half of one the Stix's schedule filed, so the games find the Stix, who at a guess say nothing.
    const game = {
      date: "2026-09-20",
      status: "completed" as const,
      startTs: "2026-09-20T17:30:00.000Z",
    };
    const stix = pull(
      ageless(
        [
          against("Hawks 12U"),
          { ...game, id: "s1", opponentName: "Hurricanes", teamScore: 13, opponentScore: 2 },
        ],
        { id: "gcSTIX000001", name: "Cincy Stix", state: "OH" }
      )
    );
    expect(filedAs(stix.state, "gcSTIX000001").level).toBe(12);
    const { state } = pull(
      ageless(
        [
          { ...game, id: "h1", opponentName: "Cincy Stix", teamScore: 2, opponentScore: 13 },
          against("Comets 9U"),
        ],
        { id: "gcHURRICANE1", name: "Hurricanes", state: "OH" }
      ),
      stix.state
    );
    expect(filedAs(state, "gcHURRICANE1")).toEqual({ level: 9, ageFrom: "tentative" });
  });
});

describe("a waiting row the oldest opponent's age files", () => {
  const row = (tally: [number, number][], more: Partial<AgeUnknownTeam["evidence"]> = {}) =>
    ({
      teamId: "T",
      name: "Wildcats",
      firstSeen: "2026-10-01T00:00:00.000Z",
      lastTried: "2026-10-01T00:00:00.000Z",
      tries: 1,
      evidence: {
        games: 4,
        scored: 4,
        aheadOfToday: 0,
        shutoutBlowouts: 0,
        opponents: 4,
        namedAnAge: tally.reduce((sum, [, count]) => sum + count, 0),
        tally,
        ...more,
      },
    }) satisfies AgeUnknownTeam;

  it("is one with an opponent writing an age it ranks, in its band, that the queue would ask", () => {
    expect(answerableByOldest(row([[10, 1]]))).toBe(true);
    expect(answerableByOldest(row([[19, 1]]))).toBe(false);
    expect(answerableByOldest(row([[14, 1]], { ageLabel: "Under 13" }))).toBe(false);
    expect(answerableByOldest(row([[10, 1]], { playerCount: 5 }))).toBe(false);
    expect(answerableByOldest(row([]))).toBe(false);
  });

  it("jumps the rota as the rules that moved before do", () => {
    expect(answerableToday(row([[10, 1]]))).toBe(true);
    expect(answerableToday(row([]))).toBe(false);
  });
});
