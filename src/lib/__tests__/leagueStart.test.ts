import { describe, expect, it } from "vitest";
import {
  answerStart,
  defaultStartWindow,
  draftStart,
  seasonFromStart,
  startChoices,
  startClubs,
  startPages,
  type StartDraft,
} from "../leagueStart";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * Starting a League Standings season from its clubs on Team Rankings (3.7). Placeholder names and
 * coaches throughout.
 */

const GROUPS: AgeGroup[] = [
  { id: "ag_9u_2027", name: "9U 2027", ageLevel: 9, year: 2027, seasonIds: [] },
  { id: "ag_10u_2027", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "ag_9u_2026", name: "9U 2026", ageLevel: 9, year: 2026, seasonIds: [] },
  // A page with no year is no page to start a league on.
  { id: "ag_old", name: "Old page", seasonIds: [] },
];

const club = (id: string, extra: Partial<ScoutTeam> = {}): ScoutTeam => ({
  id,
  name: `Placeholder ${id}`,
  gcTeams: [{ teamId: `gc-${id}`, name: `Placeholder ${id}`, ageGroupId: "ag_9u_2027" }],
  ...extra,
});

const game = (
  id: string,
  date: string | undefined,
  teamAId: string,
  teamBId: string,
  score?: [number, number],
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  ageGroupId: "ag_9u_2027",
  teamAId,
  teamBId,
  ...(date === undefined ? {} : { date }),
  ...(score ? { teamAScore: score[0], teamBScore: score[1] } : {}),
  ...extra,
});

describe("the pages a league can start on", () => {
  it("are the ones with a level and a year, the newest year first and the youngest level in it", () => {
    expect(startPages(GROUPS).map((page) => page.id)).toEqual([
      "ag_9u_2027",
      "ag_10u_2027",
      "ag_9u_2026",
    ]);
    expect(startPages(GROUPS)[0]).toEqual({
      id: "ag_9u_2027",
      name: "9U 2027",
      ageLevel: 9,
      year: 2027,
    });
  });
});

describe("the clubs a league on a page could be made of", () => {
  it("are the clubs GameChanger knows there, by name, as the hand picker offers them", () => {
    const page = startPages(GROUPS)[0]!;
    const teams = [
      club("S-B"),
      club("S-A", {
        gcTeams: [
          {
            teamId: "gc-S-A",
            name: "Placeholder S-A",
            ageGroupId: "ag_9u_2027",
            staff: ["Coach Placeholder"],
          },
        ],
      }),
      // Known only from somebody else's schedule, with nothing to bridge.
      { id: "S-N", name: "Placeholder S-N", nameOnly: true },
    ] as ScoutTeam[];
    const clubs = startClubs(page, GROUPS, teams);
    expect(clubs.map((one) => one.id)).toEqual(["S-A", "S-B"]);
    expect(clubs[1]).toMatchObject({ label: "Placeholder S-B", gcIds: ["gc-S-B"] });
    // Coaches tell two clubs of a name apart in the picker; the season never takes them.
    expect(clubs[0]?.coaches).toEqual(["Coach Placeholder"]);
  });
});

describe("the days a start looks in first", () => {
  it("are the half of the baseball year today is in", () => {
    expect(defaultStartWindow("2026-10-11")).toEqual({ from: "2026-08-01", to: "2026-12-31" });
    expect(defaultStartWindow("2027-04-02")).toEqual({ from: "2027-01-01", to: "2027-07-31" });
  });
});

describe("the games among a league's clubs", () => {
  const LEAGUE = ["S-A", "S-B", "S-C"];
  const draft = (games: ScoutGame[], from = "2026-09-01", to = "2026-10-31") =>
    draftStart({ clubIds: LEAGUE, games, from, to });

  it("are the ones between two of its clubs in those days, by day, played with their score", () => {
    const made = draft([
      game("g2", "2026-09-20", "S-B", "S-C"),
      game("g1", "2026-09-13", "S-A", "S-B", [5, 3]),
      // With a club outside the league, before the days asked about, with no day, or dropped.
      game("g3", "2026-09-13", "S-A", "S-X", [1, 0]),
      game("g4", "2026-08-02", "S-A", "S-C", [2, 2]),
      game("g5", undefined, "S-A", "S-C"),
      game("g6", "2026-09-27", "S-A", "S-C", [4, 1], { withdrawn: true }),
      game("g7", "2026-09-27", "S-A", "S-A"),
    ]);
    expect(made.outside).toBe(1);
    expect(made.games).toEqual([
      {
        gameId: "g1",
        date: "2026-09-13",
        away: "S-A",
        home: "S-B",
        awayRuns: 5,
        homeRuns: 3,
        tournament: "One of the two played somebody else that day, so it was likely a tournament.",
      },
      { gameId: "g2", date: "2026-09-20", away: "S-B", home: "S-C" },
    ]);
  });

  it("call a meeting a tournament's where it was entered under an event, and not a doubleheader", () => {
    const made = draft([
      game("g1", "2026-09-13", "S-A", "S-B", [5, 3]),
      game("g2", "2026-09-13", "S-B", "S-A", [1, 2]),
      game("g3", "2026-09-20", "S-A", "S-C", [7, 0], { event: "Fall Classic" }),
    ]);
    expect(made.games.map((one) => one.tournament)).toEqual([
      undefined,
      undefined,
      "Entered under Fall Classic.",
    ]);
    expect(startChoices(made)).toEqual([
      { gameId: "g1", keep: true, swap: false },
      { gameId: "g2", keep: true, swap: false },
      { gameId: "g3", keep: false, swap: false },
    ]);
  });

  /*
   * A league can play two of its own teams on one day, and every other club a picked club played
   * was counted as "somebody else": both of the day's league games started unticked as a
   * tournament's. Only a club outside the league marks the day.
   */
  it("keep a day a club played two of the league's clubs, and not one it played a club outside", () => {
    const made = draft([
      game("g1", "2026-09-13", "S-A", "S-B", [5, 3]),
      game("g2", "2026-09-13", "S-A", "S-C", [2, 1]),
      game("g3", "2026-09-20", "S-B", "S-C", [4, 4]),
      game("g4", "2026-09-20", "S-B", "S-X", [1, 0]),
    ]);
    expect(made.games.map((one) => [one.gameId, one.tournament])).toEqual([
      ["g1", undefined],
      ["g2", undefined],
      ["g3", "One of the two played somebody else that day, so it was likely a tournament."],
    ]);
    expect(startChoices(made).map((choice) => choice.keep)).toEqual([true, true, false]);
  });

  it("give the other club's score where the two schedules disagree", () => {
    const made = draft([
      game("g1", "2026-09-13", "S-A", "S-B", [5, 3], {
        reportedByB: { teamAScore: 5, teamBScore: 4 },
      }),
      game("g2", "2026-09-14", "S-A", "S-B", [2, 1], {
        reportedByB: { teamAScore: 2, teamBScore: 1 },
      }),
    ]);
    expect(made.games[0]?.otherRuns).toEqual({ awayRuns: 5, homeRuns: 4 });
    expect(made.games[1]?.otherRuns).toBeUndefined();
  });
});

describe("the season a review makes", () => {
  const DRAFT: StartDraft = {
    games: [
      { gameId: "g1", date: "2026-09-13", away: "S-A", home: "S-B", awayRuns: 5, homeRuns: 3 },
      { gameId: "g2", date: "2026-09-20", away: "S-B", home: "S-C" },
      { gameId: "g3", date: "2026-10-04", away: "S-C", home: "S-A", awayRuns: 7, homeRuns: 0 },
    ],
    outside: 0,
  };
  const CLUBS = [
    { id: "S-A", name: "Hive Baseball" },
    { id: "S-B", name: "Owls Baseball" },
    { id: "S-C", name: "Hive Baseball" },
  ];

  it("links each team to its club, and copies nothing else of it", () => {
    const made = seasonFromStart(CLUBS, DRAFT, startChoices(DRAFT), 6);
    expect(made.teams).toEqual([
      { id: expect.any(String), name: "Hive Baseball", scoutTeamId: "S-A" },
      { id: expect.any(String), name: "Owls Baseball", scoutTeamId: "S-B" },
      { id: expect.any(String), name: "Hive Baseball", scoutTeamId: "S-C" },
    ]);
    // Two clubs of one name are two teams.
    expect(new Set(made.teams.map((team) => team.id)).size).toBe(3);
  });

  it("keeps the games ticked, turned round where swapped, played ones final with their score", () => {
    const [hive, owls, other] = seasonFromStart(CLUBS, DRAFT, startChoices(DRAFT), 6).teams;
    const made = seasonFromStart(
      CLUBS,
      DRAFT,
      [
        { gameId: "g1", keep: true, swap: true },
        { gameId: "g2", keep: false, swap: false },
        { gameId: "g3", keep: true, swap: false },
      ],
      6
    );
    expect(made.matchups).toEqual([
      { id: `game_001_${owls!.id}_${hive!.id}`, date: "9/13", away: owls!.id, home: hive!.id },
      { id: `game_002_${other!.id}_${hive!.id}`, date: "10/4", away: other!.id, home: hive!.id },
    ]);
    const [first, second] = made.matchups;
    expect(made.logs[first!.id]).toMatchObject({
      awayRuns: "3",
      homeRuns: "5",
      innings: "6",
      isFinal: true,
    });
    expect(made.logs[second!.id]).toMatchObject({ awayRuns: "7", homeRuns: "0", isFinal: true });
    // A game still to play goes in with an empty score sheet.
    const toPlay = seasonFromStart(CLUBS, DRAFT, startChoices(DRAFT), 6);
    const unplayed = toPlay.matchups[1]!;
    expect(toPlay.logs[unplayed.id]).toMatchObject({ awayRuns: "", homeRuns: "" });
    expect(toPlay.logs[unplayed.id]?.isFinal).not.toBe(true);
  });
});

describe("a start's answer, a step at a time", () => {
  const read = {
    ageGroups: () => GROUPS,
    teams: () => [club("S-A"), club("S-B")],
    gamesForYear: (year: number) =>
      year === 2027 ? [game("g1", "2026-09-13", "S-A", "S-B", [5, 3])] : [],
  };

  it("is the pages, then a page's clubs, then the games among those picked", () => {
    const pages = startPages(GROUPS);
    expect(answerStart({ today: "2026-10-11" }, read)).toEqual({
      pages,
      clubs: null,
      draft: null,
    });
    expect(answerStart({ today: "2026-10-11", page: "ag_9u_2027" }, read)).toMatchObject({
      clubs: [{ id: "S-A" }, { id: "S-B" }],
      draft: null,
    });
    // The half today is in, unless the days are given.
    const asked = { today: "2026-10-11", page: "ag_9u_2027", clubs: ["S-A", "S-B"] };
    expect(answerStart(asked, read)).toMatchObject({
      clubs: null,
      draft: { games: [{ gameId: "g1" }], outside: 0 },
    });
    expect(answerStart({ ...asked, from: "2026-10-01", to: "2026-10-31" }, read)).toMatchObject({
      draft: { games: [], outside: 1 },
    });
    // A page that is not there is no page.
    expect(answerStart({ ...asked, page: "ag_gone" }, read)).toEqual({
      pages,
      clubs: null,
      draft: null,
    });
  });
});

describe("a start from a GameChanger organization", () => {
  const ORG = "NRsPUpJj6Eed";
  const orgs =
    (teamIds: string[], orgId = ORG) =>
    () => ({
      orgs: [{ orgId, name: "Placeholder League", teamIds }],
      savedAt: "",
    });
  const on = (id: string, ageGroupId: string, extra: Partial<ScoutTeam> = {}) =>
    club(id, {
      gcTeams: [{ teamId: `gc-${id}`, name: `Placeholder ${id}`, ageGroupId }],
      ...extra,
    });
  const games = (year: number) =>
    year === 2027
      ? [
          game("g1", "2026-09-13", "S-A", "S-B", [5, 3]),
          game("g2", "2026-09-20", "S-A", "S-X", [2, 1]),
          game("g3", "2026-09-27", "S-C", "S-B"),
        ]
      : [];

  it("picks the organization's clubs on its page and drafts their games in one answer", () => {
    const teams = [
      club("S-B"),
      club("S-A"),
      club("S-C"),
      // On the page, but not the organization's: offered, not picked.
      club("S-X"),
      // The organization's, on another page.
      on("S-D", "ag_10u_2027"),
    ];
    const answer = answerStart(
      { today: "2026-10-11", org: ORG },
      {
        ageGroups: () => GROUPS,
        gamesForYear: games,
        teams: () => teams,
        orgs: orgs(["gc-S-A", "gc-S-B", "gc-S-C", "gc-S-D", "gc-unpulled"]),
      }
    );
    expect(answer.page).toBe("ag_9u_2027");
    expect(answer.picked).toEqual(["S-B", "S-A", "S-C"]);
    expect(answer.clubs?.map((one) => one.id)).toEqual(["S-A", "S-B", "S-C", "S-X"]);
    // The games among the picked clubs only, in the half today is in.
    expect(answer.draft?.games.map((one) => one.gameId)).toEqual(["g1", "g3"]);
    expect(answer.org).toEqual({ found: true, name: "Placeholder League", teams: 5, pulled: 4 });
    // The days given are the ones looked in.
    const october = answerStart(
      { today: "2026-10-11", org: ORG, from: "2026-10-01", to: "2026-10-31" },
      {
        ageGroups: () => GROUPS,
        gamesForYear: games,
        teams: () => teams,
        orgs: orgs(["gc-S-A", "gc-S-B"]),
      }
    );
    expect(october.draft).toEqual({ games: [], outside: 1 });
  });

  it("settles on the page most of its teams are on, the newest year first on a tie", () => {
    const teams = [
      on("S-A", "ag_9u_2026"),
      on("S-B", "ag_9u_2026"),
      on("S-C", "ag_10u_2027"),
      on("S-D", "ag_9u_2027"),
    ];
    const read = { ageGroups: () => GROUPS, gamesForYear: games, teams: () => teams };
    const most = answerStart(
      { today: "2026-10-11", org: ORG },
      { ...read, orgs: orgs(["gc-S-A", "gc-S-B", "gc-S-C"]) }
    );
    expect(most.page).toBe("ag_9u_2026");
    expect(most.picked).toEqual(["S-A", "S-B"]);
    const tie = answerStart(
      { today: "2026-10-11", org: ORG },
      { ...read, orgs: orgs(["gc-S-A", "gc-S-C", "gc-S-D"]) }
    );
    expect(tie.page).toBe("ag_9u_2027");
    expect(tie.picked).toEqual(["S-D"]);
  });

  it("offers and picks a club of the organization the page's picker would not", () => {
    // Filed two levels up in the page's year: no club for a 9U league by hand, but the
    // organization says it is in this one.
    const up = club("S-E", {
      gcTeams: [
        { teamId: "gc-S-E", name: "Placeholder S-E", ageGroupId: "ag_9u_2027", ageLevel: 11 },
      ],
    });
    const answer = answerStart(
      { today: "2026-10-11", org: ORG },
      {
        ageGroups: () => GROUPS,
        gamesForYear: games,
        teams: () => [club("S-A"), up],
        orgs: orgs(["gc-S-A", "gc-S-E"]),
      }
    );
    expect(startClubs(startPages(GROUPS)[0]!, GROUPS, [up])).toEqual([]);
    expect(answer.clubs?.map((one) => one.id)).toEqual(["S-A", "S-E"]);
    expect(answer.picked).toEqual(["S-A", "S-E"]);
  });

  it("says so, and nothing else, for one not in the file or with no team pulled", () => {
    const pages = startPages(GROUPS);
    const read = {
      ageGroups: () => GROUPS,
      gamesForYear: games,
      teams: () => [club("S-A"), club("S-P", { placeholder: true })],
    };
    expect(
      answerStart({ today: "2026-10-11", org: "AAAAAAAAAAAA" }, { ...read, orgs: orgs(["gc-S-A"]) })
    ).toEqual({
      pages,
      clubs: null,
      draft: null,
      org: { found: false },
    });
    // A device that keeps no Organizations file has none in it.
    expect(answerStart({ today: "2026-10-11", org: ORG }, read).org).toEqual({ found: false });
    // A placeholder club is no club of the organization's.
    expect(
      answerStart(
        { today: "2026-10-11", org: ORG },
        { ...read, orgs: orgs(["gc-S-P", "gc-elsewhere"]) }
      )
    ).toEqual({
      pages,
      clubs: null,
      draft: null,
      org: { found: true, name: "Placeholder League", teams: 2, pulled: 0 },
    });
  });
});
