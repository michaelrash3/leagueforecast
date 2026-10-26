import { describe, expect, it } from "vitest";
import type { GcGame, GcTeamProfile } from "../gameChangerApi";
import {
  groupOrgTeams,
  orgDraft,
  orgGames,
  orgStartPage,
  readGcOrgTeams,
  type GcOrgTeam,
  type PulledOrgTeam,
} from "../gcOrgSchedule";
import { startChoices } from "../leagueStart";

/*
 * A League Standings season from a GameChanger organization's own teams and schedules (the
 * owner's ask of 26 October 2026): the organization's team list read in whatever wrapping it
 * comes in, its divisions told apart, and the games between two of its teams paired across the two
 * schedules that list them, away first, as a start from Team Rankings drafts them.
 */

describe("reading an organization's teams", () => {
  it("reads a bare list, the public id over an internal one, and each team once", () => {
    const body = JSON.stringify([
      {
        id: "6f1c2a7e-0b1d-4c58-9e8f-3a2b1c0d9e8f",
        public_id: "AbCdEfGhIjKl",
        name: "Wolves",
        age_group: "9U",
        season: { name: "Fall", year: 2026 },
        location: { city: "Edgewood", state: "KY" },
      },
      { id: "MnOpQrStUvWx", name: "Bears 9U", season_name: "fall", season_year: "2026" },
      { id: "AbCdEfGhIjKl", name: "Wolves again" },
      { name: "No id at all" },
    ]);
    const reading = readGcOrgTeams(body);
    expect(reading).toEqual({
      ok: true,
      teams: [
        {
          id: "AbCdEfGhIjKl",
          name: "Wolves",
          season: { name: "fall", year: 2026 },
          ageLabel: "9U",
          ageLevel: 9,
          city: "Edgewood",
          state: "KY",
        },
        // No age group given: the age in the name.
        { id: "MnOpQrStUvWx", name: "Bears 9U", season: { name: "fall", year: 2026 }, ageLevel: 9 },
      ],
    });
  });

  it("reads the id a team page uses where an entry carries another of the same shape", () => {
    const body = JSON.stringify([
      { id: "internal0001", public_id: "PublicId0001", name: "Wolves" },
    ]);
    expect(readGcOrgTeams(body)).toEqual({
      ok: true,
      teams: [{ id: "PublicId0001", name: "Wolves" }],
    });
  });

  it("reads a list wrapped in an object, and entries wrapped as search hits", () => {
    const body = JSON.stringify({
      teams: [{ result: { public_id: "AbCdEfGhIjKl", name: "Wolves", season: "Spring 2027" } }],
    });
    expect(readGcOrgTeams(body)).toEqual({
      ok: true,
      teams: [{ id: "AbCdEfGhIjKl", name: "Wolves", season: { name: "spring", year: 2027 } }],
    });
  });

  it("says what came back when it is not JSON, or holds no list", () => {
    expect(readGcOrgTeams("<html>")).toMatchObject({ ok: false, message: /not JSON/ });
    expect(readGcOrgTeams(JSON.stringify({ organization: {}, count: 0 }))).toEqual({
      ok: false,
      message: expect.stringMatching(/no list of teams/),
      keys: ["organization", "count"],
    });
  });
});

describe("an organization's divisions", () => {
  const team = (id: string, name: string, more: Partial<GcOrgTeam> = {}): GcOrgTeam => ({
    id,
    name,
    ...more,
  });

  it("puts the newest season first, the youngest age first in it, and the unknown last", () => {
    const groups = groupOrgTeams([
      team("a", "Old 9U", { season: { name: "spring", year: 2026 }, ageLevel: 9 }),
      team("b", "Wolves", { season: { name: "fall", year: 2026 }, ageLevel: 10 }),
      team("c", "Bears", { season: { name: "fall", year: 2026 }, ageLevel: 9 }),
      team("d", "Aces", { season: { name: "fall", year: 2026 }, ageLevel: 9 }),
      team("e", "Somebody"),
    ]);
    expect(groups.map((group) => [group.label, group.teams.map((one) => one.name)])).toEqual([
      ["Fall 2026 · 9U", ["Aces", "Bears"]],
      ["Fall 2026 · 10U", ["Wolves"]],
      ["Spring 2026 · 9U", ["Old 9U"]],
      ["Season and age not given", ["Somebody"]],
    ]);
  });
});

/** A pulled team: its profile and its schedule's games. */
const pulled = (
  teamId: string,
  name: string,
  games: GcGame[],
  profile: Partial<GcTeamProfile> = {}
): PulledOrgTeam => ({
  teamId,
  schedule: { profile: { id: teamId, name, ...profile }, games, fetchedAt: "2026-10-26T12:00:00Z" },
});

let serial = 0;
const played = (
  opponentName: string,
  date: string,
  homeAway: "home" | "away" | undefined,
  runs?: [number, number],
  more: Partial<GcGame> = {}
): GcGame => ({
  id: `e${(serial += 1)}`,
  opponentName,
  date,
  startTs: `${date}T18:00:00Z`,
  ...(homeAway ? { homeAway } : {}),
  ...(runs ? { teamScore: runs[0], opponentScore: runs[1] } : {}),
  status: runs ? "completed" : "scheduled",
  ...more,
});

describe("the games between an organization's teams", () => {
  it("pairs a game both schedules list into one, away first, the away side's score", () => {
    const games = orgGames([
      pulled("A", "Aces", [played("Bears", "2026-09-12", "home", [5, 3])]),
      pulled("B", "Bears", [played("Aces", "2026-09-12", "away", [3, 5])]),
    ]);
    expect(games).toHaveLength(1);
    expect(games[0]).toMatchObject({
      teamAId: "B",
      teamBId: "A",
      teamAScore: 3,
      teamBScore: 5,
      date: "2026-09-12",
      reportedByB: { teamAScore: 3, teamBScore: 5 },
    });
  });

  it("keeps the home side's score beside the away side's where they disagree", () => {
    const draft = orgDraft(
      [
        pulled("A", "Aces", [played("Bears", "2026-09-12", "home", [6, 3])]),
        pulled("B", "Bears", [played("Aces", "2026-09-12", "away", [3, 5])]),
      ],
      ["A", "B"]
    );
    expect(draft.games).toEqual([
      expect.objectContaining({
        away: "B",
        home: "A",
        awayRuns: 3,
        homeRuns: 5,
        otherRuns: { awayRuns: 3, homeRuns: 6 },
      }),
    ]);
  });

  it("keeps a doubleheader two games, and a game one schedule lists alone", () => {
    const games = orgGames([
      pulled("A", "Aces", [
        played("Bears", "2026-09-12", "home", [5, 3], { startTs: "2026-09-12T15:00:00Z" }),
        played("Bears", "2026-09-12", "home", [2, 4], { startTs: "2026-09-12T18:00:00Z" }),
        played("Cubs", "2026-09-19", "away"),
      ]),
      pulled("B", "Bears", [
        played("Aces", "2026-09-12", "away", [3, 5], { startTs: "2026-09-12T15:00:00Z" }),
        played("Aces", "2026-09-12", "away", [4, 2], { startTs: "2026-09-12T18:00:00Z" }),
      ]),
      pulled("C", "Cubs", []),
    ]);
    expect(
      games.map((game) => [game.teamAId, game.teamBId, game.teamAScore, game.teamBScore])
    ).toEqual([
      ["B", "A", 3, 5],
      ["B", "A", 4, 2],
      ["A", "C", undefined, undefined],
    ]);
  });

  it("knows an opponent by its avatar where its name is written another way", () => {
    const games = orgGames([
      pulled("A", "Aces", [
        played("NKY Bears 9U Gold", "2026-09-12", "home", [5, 3], { opponentAvatarKey: "bear" }),
      ]),
      pulled("B", "Bears", [], { avatarKey: "bear" }),
    ]);
    expect(games).toEqual([expect.objectContaining({ teamAId: "B", teamBId: "A" })]);
  });

  it("leaves a name two pulled teams share to nobody, and a canceled game out", () => {
    const games = orgGames([
      pulled("A", "Aces", [
        played("Bears", "2026-09-12", "home", [5, 3]),
        played("Cubs", "2026-09-13", "home", undefined, { status: "canceled" }),
      ]),
      pulled("B", "Bears", []),
      pulled("B2", "Bears", []),
      pulled("C", "Cubs", []),
    ]);
    expect(games).toEqual([expect.objectContaining({ teamAId: "A", teamBId: "outside:bears" })]);
    expect(orgDraft([pulled("A", "Aces", [])], ["A"]).games).toEqual([]);
  });

  it("marks a league game likely a tournament's where a side played somebody else that day", () => {
    const draft = orgDraft(
      [
        pulled("A", "Aces", [
          played("Bears", "2026-09-12", "home", [5, 3]),
          played("Ohio Elite", "2026-09-12", "away", [1, 9]),
          played("Bears", "2026-09-19", "away", [2, 1]),
        ]),
        pulled("B", "Bears", []),
      ],
      ["A", "B"]
    );
    expect(startChoices(draft).map((choice) => choice.keep)).toEqual([false, true]);
    expect(draft.games[0]?.tournament).toMatch(/somebody else that day/);
  });

  it("drafts only the teams kept in the league", () => {
    const teams = [
      pulled("A", "Aces", [played("Bears", "2026-09-12", "home", [5, 3])]),
      pulled("B", "Bears", []),
    ];
    expect(orgDraft(teams, ["A", "B"]).games).toHaveLength(1);
    expect(orgDraft(teams, ["A"]).games).toHaveLength(0);
  });
});

describe("the page a season from an organization goes on", () => {
  const draft = orgDraft(
    [
      pulled("A", "Aces", [played("Bears", "2026-09-12", "home", [5, 3])], { ageLevel: 9 }),
      pulled("B", "Bears", [], { ageLevel: 9 }),
    ],
    ["A", "B"]
  );
  const teams = [
    pulled("A", "Aces", [], { ageLevel: 9 }),
    pulled("B", "Bears", [], { ageLevel: 10 }),
  ];

  it("reads the division's age and season: fall 2026 is squad year 2027", () => {
    expect(
      orgStartPage(
        { key: "k", label: "", season: { name: "fall", year: 2026 }, ageLevel: 9, teams: [] },
        teams,
        draft
      )
    ).toEqual({ id: "", name: "9U 2027", ageLevel: 9, year: 2027 });
  });

  it("falls back on the profiles' age and the first game's squad year, else places nothing", () => {
    const unnamed = { key: "k", label: "", teams: [] };
    expect(orgStartPage(unnamed, teams, draft)).toEqual({
      id: "",
      name: "9U 2027",
      ageLevel: 9,
      year: 2027,
    });
    expect(orgStartPage(unnamed, [pulled("A", "Aces", [])], draft)).toBeUndefined();
  });
});
