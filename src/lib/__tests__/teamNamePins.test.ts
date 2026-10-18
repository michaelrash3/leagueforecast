import { describe, expect, it } from "vitest";
import { parseGcTeamList, type GcTeamSchedule } from "../gameChangerApi";
import {
  importGcSchedules,
  tidyPool,
  type GcImportState,
  type PoolTidy,
} from "../gameChangerImport";
import type { AgeGroup, GcTeamLink, ScoutGame, ScoutTeam } from "../teamRankings";
import { NO_REMOVALS } from "../autoRemoved";
import { sweepMarks } from "../obviousFakes";
import { agelessRowFor, agelessSearch, refusedAsSchool } from "../agelessQueue";
import { AGELESS_RULES } from "../agelessTriage";
import type { AgelessEvidence } from "../agelessEvidence";
import type { AgeUnknownTeam } from "../ageUnknown";
import { unpulledClubs } from "../unpulledClubs";

/*
 * What the import, the tidy, the nightly sweep's name sign and the waiting list make of names that
 * say a page is not a team (a practice, a scrimmage, a test, an old page marked do not use) and of
 * softball names, pinned on small fixtures before the rules that read them change, so the change
 * can be seen to move only what it means to: every line here that is not one of those names stays
 * exactly as it is.
 *
 * The names are invented; none is a club in the export or the pool. "Test Red Kestrelmoor" is
 * written the way the Austin organisation called TEST writes its squads, which the test rule
 * leaves alone by that shape.
 */

const page: AgeGroup = { id: "p12", name: "12U 2027", ageLevel: 12, year: 2027, seasonIds: [] };

const club = (id: string, name: string, links: [string, string][]): ScoutTeam => ({
  id,
  name,
  gcTeams: links.map(([teamId, linkName]): GcTeamLink => ({
    teamId,
    name: linkName,
    ageGroupId: page.id,
    ageLevel: 12,
    season: "fall",
    seasonYear: 2026,
  })),
});

/** A scored game off `gcId`'s own schedule, `a` beating or losing to `b`, the picture naming `b`. */
const row = (
  id: string,
  a: string,
  b: string,
  runs: [number, number],
  date: string,
  gcId: string,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  ageGroupId: page.id,
  teamAId: a,
  teamBId: b,
  teamAScore: runs[0],
  teamBScore: runs[1],
  date,
  source: { kind: "gamechanger", teamId: gcId, gameId: id },
  ...more,
});

const describePool = (state: GcImportState) => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const label = (team: ScoutTeam | undefined) =>
    team === undefined
      ? "(nobody)"
      : `${team.name}${team.placeholder ? " [slot]" : ""}${team.nameOnly ? " [stand-in]" : ""}${
          team.gcTeams?.length ? " [pulled]" : ""
        }`;
  return {
    teams: state.teams.map((team) => label(team)).sort(),
    games: state.games
      .map(
        (game) =>
          `${game.date ?? "?"} ${label(byId.get(game.teamAId))} ${game.teamAScore ?? "-"}-${
            game.teamBScore ?? "-"
          } ${label(byId.get(game.teamBId))}${game.alsoRows?.length ? ` +${game.alsoRows.length} folded` : ""}`
      )
      .sort(),
  };
};

/** The tidy's counts that are not nothing, without the pool. */
const counts = (tidy: PoolTidy) =>
  Object.fromEntries(Object.entries(tidy).filter(([key, value]) => key !== "state" && value !== 0));

describe("the names pinned before the not-a-team rules", () => {
  it("files a schedule list as it did", () => {
    const schedule = (
      id: string,
      name: string,
      games: GcTeamSchedule["games"]
    ): GcTeamSchedule => ({
      profile: { id, name, ageLevel: 12, season: { season: "fall", year: 2026 } },
      games,
      fetchedAt: "2026-10-01T12:00:00.000Z",
    });
    const played = (
      id: string,
      date: string,
      opponentName: string,
      teamScore: number,
      opponentScore: number
    ) => ({
      id,
      date,
      opponentName,
      teamScore,
      opponentScore,
      status: "completed" as const,
    });
    const { state, outcomes } = importGcSchedules(
      [
        schedule("gcQUILL00001", "Quillfeather Quails 12U", [
          played("q1", "2026-09-05", "Brindlewood Badgers 12U", 6, 2),
          played("q2", "2026-09-06", "Practice", 3, 1),
          played("q3", "2026-09-07", "Thornbury Practice Squad 12U", 5, 4),
          played("q4", "2026-09-08", "Hollowmere Hornets DNU", 7, 0),
          played("q5", "2026-09-09", "Elmstead Fastpitch 12U", 8, 1),
          played("q6", "2026-09-10", "Test Red Kestrelmoor 12U", 4, 4),
          played("q7", "2026-09-11", "Copperfield Scrimmage", 2, 9),
          played("q8", "2026-09-12", "Copy of Duskwood Drakes", 3, 0),
        ]),
        schedule("gcTHORN00001", "Thornbury Practice 12U", [
          played("t1", "2026-09-13", "Quillfeather Quails 12U", 1, 5),
        ]),
        schedule("gcGILDE00001", "Gildersleeve Softball 12U", [
          played("s1", "2026-09-14", "Quillfeather Quails 12U", 2, 3),
        ]),
        schedule("gcTESTB00001", "Test Red Kestrelmoor 12U", [
          played("b1", "2026-09-15", "Quillfeather Quails 12U", 6, 5),
        ]),
        schedule("gcWEXCO00001", "Wexcombe Wrens Tryouts 12U", [
          played("w1", "2026-09-16", "Quillfeather Quails 12U", 0, 2),
        ]),
      ],
      { ageGroups: [], teams: [], games: [] },
      { today: "2026-10-11" }
    );

    expect(
      outcomes.map(
        (outcome) =>
          `${outcome.teamName}: ${outcome.skip ?? "filed"}, +${outcome.gamesAdded}, ignored ${
            outcome.gamesIgnored
          }, made ${outcome.opponentsCreated}`
      )
    ).toMatchInlineSnapshot(`
      [
        "Quillfeather Quails 12U: filed, +4, ignored 4, made 4",
        "Thornbury Practice 12U: not-a-team, +0, ignored 0, made 0",
        "Gildersleeve Softball 12U: not-baseball, +0, ignored 0, made 0",
        "Test Red Kestrelmoor 12U: filed, +1, ignored 0, made 1",
        "Wexcombe Wrens Tryouts 12U: not-a-team, +0, ignored 0, made 0",
      ]
    `);
    expect(describePool(state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 6-2 Brindlewood Badgers [stand-in]",
          "2026-09-08 Quillfeather Quails [pulled] 7-0 Hollowmere Hornets DNU [slot]",
          "2026-09-10 Quillfeather Quails [pulled] 4-4 Test Red Kestrelmoor [pulled]",
          "2026-09-12 Quillfeather Quails [pulled] 3-0 Copy of Duskwood Drakes [slot]",
          "2026-09-15 Test Red Kestrelmoor [pulled] 6-5 Quillfeather Quails [stand-in]",
        ],
        "teams": [
          "Brindlewood Badgers [stand-in]",
          "Copy of Duskwood Drakes [slot]",
          "Hollowmere Hornets DNU [slot]",
          "Quillfeather Quails [pulled]",
          "Quillfeather Quails [stand-in]",
          "Test Red Kestrelmoor [pulled]",
        ],
      }
    `);
  });

  it("marks a pasted list as it did", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        "Quillfeather Quails 12U,gcQUILL00001,12U",
        "Thornbury Practice 12U,gcTHORN00001,12U",
        "Copperfield Scrimmage 12U,gcCOPPE00001,12U",
        "Hollowmere Hornets DNU,gcHOLLO00001,12U",
        "Gildersleeve Softball 12U,gcGILDE00001,12U",
        "Kestrelmoor Baseball and Softball 12U,gcKESTR00001,12U",
        "Test Red Kestrelmoor 12U,gcTESTB00001,12U",
        "Marrowby Wiffle 12U,gcMARRO00001,12U",
      ].join("\n")
    );
    expect(list.entries.map(({ teamId: _id, ...rest }) => rest)).toMatchInlineSnapshot(`
      [
        {
          "ageLevel": 12,
          "name": "Quillfeather Quails 12U",
        },
        {
          "ageLevel": 12,
          "name": "Thornbury Practice 12U",
          "notATeam": "practice",
        },
        {
          "ageLevel": 12,
          "name": "Copperfield Scrimmage 12U",
          "notATeam": "scrimmage",
        },
        {
          "ageLevel": 12,
          "name": "Hollowmere Hornets DNU",
          "notATeam": "void",
        },
        {
          "ageLevel": 12,
          "name": "Gildersleeve Softball 12U",
          "notBaseball": true,
        },
        {
          "ageLevel": 12,
          "name": "Kestrelmoor Baseball and Softball 12U",
        },
        {
          "ageLevel": 12,
          "name": "Test Red Kestrelmoor 12U",
        },
        {
          "ageLevel": 12,
          "name": "Marrowby Wiffle 12U",
          "notBaseball": true,
        },
      ]
    `);
  });

  it("tidies a pool as it did", () => {
    const quill = club("quill", "Quillfeather Quails", [
      ["gcQUILL00001", "Quillfeather Quails 12U"],
    ]);
    const brind = club("brind", "Brindlewood Badgers", [
      ["gcBRIND00001", "Brindlewood Badgers 12U"],
    ]);
    const pool: GcImportState = {
      ageGroups: [{ ...page, myTeamId: "copper" }],
      teams: [
        quill,
        brind,
        // A practice page by its club name, and one only GameChanger's own name on the link says.
        club("thorn", "Thornbury Practice", [["gcTHORN00001", "Thornbury Practice 12U"]]),
        club("ashg", "Ashgrove Aces", [["gcASHGR00001", "Ashgrove Aces 12U (Practice Squad)"]]),
        // One link a practice page and one a squad: the club is the squad.
        club("fern", "Fernhollow Falcons", [
          ["gcFERNH00001", "Fernhollow Falcons 12U"],
          ["gcFERNH00002", "Fernhollow Falcons Practice"],
        ]),
        // An old page marked do not use, and one whose link carries no name at all.
        club("hollow", "Hollowmere Hornets DNU", [["gcHOLLO00001", "Hollowmere Hornets DNU"]]),
        club("marrow", "Marrowdale Void", [["gcMARRO00001", ""]]),
        // A page's own team, and the user's own club, whatever they are called.
        club("copper", "Copperfield Test", [["gcCOPPE00001", "Copperfield Test 12U"]]),
        { ...club("dusk", "Duskwood Demo", [["gcDUSKW00001", "Duskwood Demo 12U"]]), isMine: true },
        // Written as the Austin organisation called TEST writes its squads.
        club("testb", "Test Red Kestrelmoor", [["gcTESTB00001", "Test Red Kestrelmoor 12U"]]),
        club("gild", "Gildersleeve Softball", [["gcGILDE00001", "Gildersleeve Softball 12U"]]),
        { id: "rowan", name: "Rowanberry Practice Squad", nameOnly: true },
        { id: "elm", name: "Elmstead Fastpitch", nameOnly: true },
        { id: "pimb", name: "Pimbleton Pikes", nameOnly: true },
        { id: "slot1", name: "Practice", placeholder: true },
      ],
      games: [
        row("gA", "quill", "thorn", [9, 3], "2026-09-05", "gcQUILL00001", {
          namedByAvatar: "thorn",
        }),
        row("gB", "thorn", "pimb", [4, 2], "2026-09-06", "gcTHORN00001"),
        row("gC", "ashg", "brind", [1, 6], "2026-09-07", "gcASHGR00001", {
          namedByAvatar: "brind",
        }),
        row("gD", "fern", "quill", [3, 3], "2026-09-08", "gcFERNH00002", {
          namedByAvatar: "quill",
        }),
        // The kept club's own row, with the old page's own row of it folded in.
        row("gE", "quill", "hollow", [8, 2], "2026-09-09", "gcQUILL00001", {
          namedByAvatar: "hollow",
          alsoFrom: ["gcHOLLO00001"],
          alsoRows: [
            { teamId: "gcHOLLO00001", gameId: "h1", ownScore: 2, opponentScore: 8, onSideB: true },
          ],
          reportedByB: { teamAScore: 8, teamBScore: 2 },
        }),
        // The old page's own row, with the kept club's own row of it folded in.
        row("gF", "hollow", "brind", [5, 1], "2026-09-10", "gcHOLLO00001", {
          namedByAvatar: "brind",
          alsoFrom: ["gcBRIND00001"],
          alsoRows: [
            { teamId: "gcBRIND00001", gameId: "b2", ownScore: 1, opponentScore: 5, onSideB: true },
          ],
          reportedByB: { teamAScore: 5, teamBScore: 1 },
        }),
        // The old page's own row against a team nobody pulled: only the old page says it.
        row("gG", "hollow", "pimb", [6, 0], "2026-09-11", "gcHOLLO00001"),
        row("gH", "brind", "rowan", [7, 5], "2026-09-12", "gcBRIND00001"),
        row("gI", "brind", "slot1", [2, 0], "2026-09-13", "gcBRIND00001"),
        row("gJ", "quill", "copper", [3, 1], "2026-09-14", "gcQUILL00001", {
          namedByAvatar: "copper",
        }),
        row("gK", "dusk", "brind", [4, 1], "2026-09-15", "gcDUSKW00001", {
          namedByAvatar: "brind",
        }),
        row("gL", "testb", "quill", [2, 5], "2026-09-16", "gcTESTB00001", {
          namedByAvatar: "quill",
        }),
        row("gM", "gild", "quill", [1, 10], "2026-09-17", "gcGILDE00001", {
          namedByAvatar: "quill",
        }),
        row("gN", "brind", "elm", [6, 6], "2026-09-18", "gcBRIND00001"),
        row("gO", "marrow", "quill", [0, 4], "2026-09-19", "gcMARRO00001", {
          namedByAvatar: "quill",
        }),
        row("gP", "quill", "marrow", [5, 0], "2026-09-20", "gcQUILL00001", {
          namedByAvatar: "marrow",
        }),
      ],
    };

    const tidy = tidyPool(pool);
    expect(counts(tidy)).toMatchInlineSnapshot(`
      {
        "idle": 1,
        "notATeam": 5,
        "notBaseball": 2,
        "passes": 2,
      }
    `);
    expect(describePool(tidy.state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-08 Fernhollow Falcons [pulled] 3-3 Quillfeather Quails [pulled]",
          "2026-09-09 Quillfeather Quails [pulled] 8-2 Hollowmere Hornets DNU [slot]",
          "2026-09-10 Brindlewood Badgers [pulled] 1-5 Hollowmere Hornets DNU [slot]",
          "2026-09-13 Brindlewood Badgers [pulled] 2-0 Practice [slot]",
          "2026-09-14 Quillfeather Quails [pulled] 3-1 Copperfield Test [pulled]",
          "2026-09-15 Duskwood Demo [pulled] 4-1 Brindlewood Badgers [pulled]",
          "2026-09-16 Test Red Kestrelmoor [pulled] 2-5 Quillfeather Quails [pulled]",
          "2026-09-20 Quillfeather Quails [pulled] 5-0 Marrowdale Void [slot]",
        ],
        "teams": [
          "Brindlewood Badgers [pulled]",
          "Copperfield Test [pulled]",
          "Duskwood Demo [pulled]",
          "Fernhollow Falcons [pulled]",
          "Hollowmere Hornets DNU [slot]",
          "Hollowmere Hornets DNU [slot]",
          "Marrowdale Void [slot]",
          "Practice [slot]",
          "Quillfeather Quails [pulled]",
          "Test Red Kestrelmoor [pulled]",
        ],
      }
    `);
  });
  it("marks the names the nightly sweep marks as it did", () => {
    const names = [
      "Quillfeather Quails 12U",
      "Test Red Kestrelmoor 12U",
      "Skiles Test Nettlefield 12U",
      "Bramblecote Test Prep 12U",
      "Thornbury Test 12U",
      "Hollowmere Hornets DNU",
      "Copperfield Do Not Use",
      "Duskwood Demo 12U",
      "Gildersleeve Demo Dawgs 12U",
      "Elmstead Voided 12U",
      "Wexcombe Practice 12U",
    ];
    const teams = names.map((name, at) =>
      club(`c${at}`, name, [[`gcPIN${String(at).padStart(7, "0")}`, name]])
    );
    const marks = sweepMarks(
      { teams, games: [], ageGroups: [page] },
      { realClubs: new Set(), keptApart: new Set(), namedAges: new Map() },
      NO_REMOVALS,
      "2026-10-11"
    );
    expect([...marks.values()].map((mark) => `${mark.name}: ${mark.word ?? "-"}`).sort())
      .toMatchInlineSnapshot(`
        [
          "Copperfield Do Not Use: do not use",
          "Duskwood Demo 12U: demo",
          "Elmstead Voided 12U: voided",
          "Hollowmere Hornets DNU: dnu",
          "Thornbury Test 12U: test",
        ]
      `);
  });

  it("sorts the waiting list's unlikely names as it did", () => {
    const names = [
      "Quillfeather Quails",
      "Thornbury Practice",
      "Copperfield Scrimmage",
      "Test Red Kestrelmoor",
      "Hollowmere Hornets DNU",
      "Duskwood Tryouts",
      "Elmstead Stats",
      "Wexcombe Old Team",
      "Team 1",
      "Gildersleeve Fastpitch",
    ];
    expect(
      names.map((name) => {
        const row = agelessRowFor({
          teamId: name,
          name,
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-10T00:00:00.000Z",
          tries: 1,
        });
        return `${name}: ${row.standing?.because ?? "-"}`;
      })
    ).toMatchInlineSnapshot(`
      [
        "Quillfeather Quails: -",
        "Thornbury Practice: the name reads as a test, practice or placeholder account",
        "Copperfield Scrimmage: the name reads as a test, practice or placeholder account",
        "Test Red Kestrelmoor: -",
        "Hollowmere Hornets DNU: the name reads as a test, practice or placeholder account",
        "Duskwood Tryouts: the name reads as a test, practice or placeholder account",
        "Elmstead Stats: the name reads as a test, practice or placeholder account",
        "Wexcombe Old Team: the name reads as a test, practice or placeholder account",
        "Team 1: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Gildersleeve Fastpitch: -",
      ]
    `);
  });
});

/*
 * The same paths over names that are only "Team" and a number or a letter, pinned before that
 * shape joined the not-a-team rules, beside names that open with "Team" and go on to say who the
 * team is, which the shape has to leave alone: all but "Team 12U", which it reads since it took an
 * age on either end (the block after this one). The Team-number names are the shape itself and name
 * nobody; the others are invented.
 */
describe("the Team-number names pinned before the rule", () => {
  const TEAM_NUMBER = ["Team 7", "Team #4", "team 04", "Team B", "My Team", "The Team", "TEAM_9"];
  const TEAM_AND_MORE = [
    "Team Wrenfield 12U",
    "Team Elite Larkspire 12U",
    "Team 1 Alderbrook Academy",
    "Team QXR 12U",
    "Team7Larkspire",
    "Team 12U",
  ];

  it("files a schedule list as it did", () => {
    const schedule = (id: string, name: string, games: GcTeamSchedule["games"]) => ({
      profile: { id, name, ageLevel: 12, season: { season: "fall" as const, year: 2026 } },
      games,
      fetchedAt: "2026-10-01T12:00:00.000Z",
    });
    const played = (id: string, date: string, opponentName: string, runs: [number, number]) => ({
      id,
      date,
      opponentName,
      teamScore: runs[0],
      opponentScore: runs[1],
      status: "completed" as const,
    });
    const { state, outcomes } = importGcSchedules(
      [
        schedule("gcQUILL00001", "Quillfeather Quails 12U", [
          played("q1", "2026-09-05", "Team 7", [6, 2]),
          played("q2", "2026-09-06", "Team #4", [3, 1]),
          played("q3", "2026-09-07", "Team B", [5, 4]),
          played("q4", "2026-09-08", "Team Wrenfield 12U", [7, 0]),
          played("q5", "2026-09-09", "Team 1 Alderbrook Academy", [8, 1]),
        ]),
        ...TEAM_NUMBER.map((name, at) =>
          schedule(`gcTEAMN0000${at}`, name, [
            played(`n${at}`, `2026-09-1${at}`, "Quillfeather Quails 12U", [1, 5]),
          ])
        ),
        schedule("gcTEAMW00001", "Team Wrenfield 12U", [
          played("w1", "2026-09-20", "Quillfeather Quails 12U", [2, 3]),
        ]),
      ],
      { ageGroups: [], teams: [], games: [] },
      { today: "2026-10-11" }
    );
    expect(
      outcomes.map(
        (outcome) =>
          `${outcome.teamName}: ${outcome.skip ?? "filed"}, +${outcome.gamesAdded}, ignored ${
            outcome.gamesIgnored
          }, made ${outcome.opponentsCreated}`
      )
    ).toMatchInlineSnapshot(`
      [
        "Quillfeather Quails 12U: filed, +5, ignored 0, made 5",
        "Team 7: not-a-team, +0, ignored 0, made 0",
        "Team #4: not-a-team, +0, ignored 0, made 0",
        "team 04: not-a-team, +0, ignored 0, made 0",
        "Team B: not-a-team, +0, ignored 0, made 0",
        "My Team: not-a-team, +0, ignored 0, made 0",
        "The Team: not-a-team, +0, ignored 0, made 0",
        "TEAM_9: not-a-team, +0, ignored 0, made 0",
        "Team Wrenfield 12U: filed, +1, ignored 0, made 1",
      ]
    `);
    expect(describePool(state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 6-2 Team 7 [slot]",
          "2026-09-06 Quillfeather Quails [pulled] 3-1 Team #4 [slot]",
          "2026-09-07 Quillfeather Quails [pulled] 5-4 Team B [slot]",
          "2026-09-08 Quillfeather Quails [pulled] 7-0 Team Wrenfield [pulled]",
          "2026-09-09 Quillfeather Quails [pulled] 8-1 Team 1 Alderbrook Academy [stand-in]",
          "2026-09-20 Team Wrenfield [pulled] 2-3 Quillfeather Quails [stand-in]",
        ],
        "teams": [
          "Quillfeather Quails [pulled]",
          "Quillfeather Quails [stand-in]",
          "Team #4 [slot]",
          "Team 1 Alderbrook Academy [stand-in]",
          "Team 7 [slot]",
          "Team B [slot]",
          "Team Wrenfield [pulled]",
        ],
      }
    `);
  });

  it("marks a pasted list as it did", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        ...[...TEAM_NUMBER, ...TEAM_AND_MORE].map(
          (name, at) => `${name},gcLIST${String(at).padStart(6, "0")},12U`
        ),
      ].join("\n")
    );
    expect(list.entries.map(({ name, notATeam }) => `${name}: ${notATeam ?? "-"}`))
      .toMatchInlineSnapshot(`
        [
          "Team 7: team",
          "Team #4: team",
          "team 04: team",
          "Team B: team",
          "My Team: team",
          "The Team: team",
          "TEAM_9: team",
          "Team Wrenfield 12U: -",
          "Team Elite Larkspire 12U: -",
          "Team 1 Alderbrook Academy: -",
          "Team QXR 12U: -",
          "Team7Larkspire: -",
          "Team 12U: team",
        ]
      `);
  });

  it("tidies a pool as it did", () => {
    const quill = club("quill", "Quillfeather Quails", [
      ["gcQUILL00001", "Quillfeather Quails 12U"],
    ]);
    const pool: GcImportState = {
      ageGroups: [page],
      teams: [
        quill,
        // A pulled page named only so, by its club name and by its link's own name.
        club("t3", "Team 3", [["gcTEAM300001", "Team 3"]]),
        club("tb", "Brindlewood Badgers", [["gcTEAMB00001", "Team B"]]),
        // A club with one such link and one real one is the real one.
        club("fern", "Fernhollow Falcons", [
          ["gcFERNH00001", "Fernhollow Falcons 12U"],
          ["gcFERNH00002", "Team 2"],
        ]),
        club("wren", "Team Wrenfield", [["gcWRENF00001", "Team Wrenfield 12U"]]),
        { id: "nine", name: "Team 9", nameOnly: true },
        { id: "qxr", name: "Team QXR", nameOnly: true },
        { id: "slot1", name: "Team 5", placeholder: true },
      ],
      games: [
        row("gA", "quill", "t3", [9, 3], "2026-09-05", "gcQUILL00001", { namedByAvatar: "t3" }),
        row("gB", "tb", "quill", [4, 2], "2026-09-06", "gcTEAMB00001", { namedByAvatar: "quill" }),
        row("gC", "fern", "quill", [3, 3], "2026-09-08", "gcFERNH00002", {
          namedByAvatar: "quill",
        }),
        row("gD", "quill", "nine", [8, 2], "2026-09-09", "gcQUILL00001"),
        row("gE", "quill", "qxr", [5, 1], "2026-09-10", "gcQUILL00001"),
        row("gF", "quill", "slot1", [6, 0], "2026-09-11", "gcQUILL00001"),
        row("gG", "wren", "quill", [2, 5], "2026-09-12", "gcWRENF00001", {
          namedByAvatar: "quill",
        }),
      ],
    };
    const tidy = tidyPool(pool);
    expect(counts(tidy)).toMatchInlineSnapshot(`
      {
        "notATeam": 2,
        "passes": 2,
      }
    `);
    expect(describePool(tidy.state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 9-3 Team 3 [slot]",
          "2026-09-06 Brindlewood Badgers [pulled] 4-2 Quillfeather Quails [pulled]",
          "2026-09-08 Fernhollow Falcons [pulled] 3-3 Quillfeather Quails [pulled]",
          "2026-09-09 Quillfeather Quails [pulled] 8-2 Team 9 [slot]",
          "2026-09-10 Quillfeather Quails [pulled] 5-1 Team QXR [stand-in]",
          "2026-09-11 Quillfeather Quails [pulled] 6-0 Team 5 [slot]",
          "2026-09-12 Team Wrenfield [pulled] 2-5 Quillfeather Quails [pulled]",
        ],
        "teams": [
          "Brindlewood Badgers [pulled]",
          "Fernhollow Falcons [pulled]",
          "Quillfeather Quails [pulled]",
          "Team 3 [slot]",
          "Team 5 [slot]",
          "Team 9 [slot]",
          "Team QXR [stand-in]",
          "Team Wrenfield [pulled]",
        ],
      }
    `);
  });

  it("marks the names the nightly sweep marks as it did", () => {
    const names = [...TEAM_NUMBER, ...TEAM_AND_MORE];
    const teams = names.map((name, at) =>
      club(`c${at}`, name, [[`gcPIN${String(at).padStart(7, "0")}`, name]])
    );
    const marks = sweepMarks(
      { teams, games: [], ageGroups: [page] },
      { realClubs: new Set(), keptApart: new Set(), namedAges: new Map() },
      NO_REMOVALS,
      "2026-10-11"
    );
    expect(
      [...marks.values()].map((mark) => `${mark.name}: ${mark.word ?? "-"}`).sort()
    ).toMatchInlineSnapshot(`[]`);
  });

  it("sorts the waiting list's names as it did", () => {
    expect(
      [...TEAM_NUMBER, ...TEAM_AND_MORE].map((name) => {
        const row = agelessRowFor({
          teamId: name,
          name,
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-10T00:00:00.000Z",
          tries: 1,
        });
        return `${name}: ${row.standing?.because ?? "-"}`;
      })
    ).toMatchInlineSnapshot(`
      [
        "Team 7: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Team #4: the name is only “Team”, with nothing more than a number, a letter or an age",
        "team 04: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Team B: the name is only “Team”, with nothing more than a number, a letter or an age",
        "My Team: the name is only “Team”, with nothing more than a number, a letter or an age",
        "The Team: the name is only “Team”, with nothing more than a number, a letter or an age",
        "TEAM_9: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Team Wrenfield 12U: -",
        "Team Elite Larkspire 12U: -",
        "Team 1 Alderbrook Academy: -",
        "Team QXR 12U: -",
        "Team7Larkspire: -",
        "Team 12U: the name is only “Team”, with nothing more than a number, a letter or an age",
      ]
    `);
  });
});

/*
 * The same paths again, pinned before the Team-number shape took a name with an age on either end
 * ("Team 7 12U", "12U Team 7", "Team 12U"), which the import stores as "Team 7" or "Team", and
 * before it stopped reading a letter run straight onto the word ("Teams", "TEAMB"). The names are
 * the shape itself, or a plural nobody's club is called; none is in the export or the pool.
 */
describe("the Team-number names with an age, and the plural, pinned before the rule took them", () => {
  const WITH_AGE = ["Team 7 12U", "Team B 10U", "12U Team 7", "Team 12U", "Team 4 - 11U"];
  const RUN_ON = ["Teams", "TEAMS", "TEAMB"];

  it("files a schedule list as it did", () => {
    const schedule = (id: string, name: string, games: GcTeamSchedule["games"]) => ({
      profile: { id, name, ageLevel: 12, season: { season: "fall" as const, year: 2026 } },
      games,
      fetchedAt: "2026-10-01T12:00:00.000Z",
    });
    const played = (id: string, date: string, opponentName: string, runs: [number, number]) => ({
      id,
      date,
      opponentName,
      teamScore: runs[0],
      opponentScore: runs[1],
      status: "completed" as const,
    });
    const { state, outcomes } = importGcSchedules(
      [
        schedule("gcQUILL00001", "Quillfeather Quails 12U", [
          played("q1", "2026-09-05", "Team 7 12U", [6, 2]),
          played("q2", "2026-09-06", "Team 12U", [3, 1]),
          played("q3", "2026-09-07", "Teams", [5, 4]),
        ]),
        ...[...WITH_AGE, ...RUN_ON].map((name, at) =>
          schedule(`gcAGEN00000${at}`, name, [
            played(`a${at}`, `2026-09-1${at}`, "Quillfeather Quails 12U", [1, 5]),
          ])
        ),
      ],
      { ageGroups: [], teams: [], games: [] },
      { today: "2026-10-11" }
    );
    expect(
      outcomes.map(
        (outcome) =>
          `${outcome.teamName}: ${outcome.skip ?? "filed"}, +${outcome.gamesAdded}, made ${
            outcome.opponentsCreated
          }`
      )
    ).toMatchInlineSnapshot(`
      [
        "Quillfeather Quails 12U: filed, +3, made 3",
        "Team 7 12U: not-a-team, +0, made 0",
        "Team B 10U: not-a-team, +0, made 0",
        "12U Team 7: not-a-team, +0, made 0",
        "Team 12U: not-a-team, +0, made 0",
        "Team 4 - 11U: not-a-team, +0, made 0",
        "Teams: filed, +1, made 1",
        "TEAMS: filed, +1, made 0",
        "TEAMB: filed, +1, made 0",
      ]
    `);
    expect(describePool(state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 6-2 Team 7 [slot]",
          "2026-09-06 Quillfeather Quails [pulled] 3-1 Team [slot]",
          "2026-09-07 Quillfeather Quails [pulled] 5-4 Teams [pulled]",
          "2026-09-15 Teams [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-09-16 TEAMS [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-09-17 TEAMB [pulled] 1-5 Quillfeather Quails [stand-in]",
        ],
        "teams": [
          "Quillfeather Quails [pulled]",
          "Quillfeather Quails [stand-in]",
          "TEAMB [pulled]",
          "TEAMS [pulled]",
          "Team 7 [slot]",
          "Team [slot]",
          "Teams [pulled]",
        ],
      }
    `);
  });

  it("marks a pasted list as it did", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        ...[...WITH_AGE, ...RUN_ON].map(
          (name, at) => `${name},gcAGEL${String(at).padStart(6, "0")},12U`
        ),
      ].join("\n")
    );
    expect(list.entries.map(({ name, notATeam }) => `${name}: ${notATeam ?? "-"}`))
      .toMatchInlineSnapshot(`
        [
          "Team 7 12U: team",
          "Team B 10U: team",
          "12U Team 7: team",
          "Team 12U: team",
          "Team 4 - 11U: team",
          "Teams: -",
          "TEAMS: -",
          "TEAMB: -",
        ]
      `);
  });

  it("tidies a pool as it did", () => {
    const quill = club("quill", "Quillfeather Quails", [
      ["gcQUILL00001", "Quillfeather Quails 12U"],
    ]);
    const pool: GcImportState = {
      ageGroups: [page],
      teams: [
        quill,
        // Stored as the import stores them, the age taken off the name GameChanger gives.
        club("t7", "Team 7", [["gcTEAM700001", "Team 7 12U"]]),
        club("bare", "Team", [["gcTEAMX00001", "Team 12U"]]),
        club("plural", "Teams", [["gcTEAMS00001", "Teams"]]),
      ],
      games: [
        row("gA", "quill", "t7", [9, 3], "2026-09-05", "gcQUILL00001", { namedByAvatar: "t7" }),
        row("gB", "bare", "quill", [4, 2], "2026-09-06", "gcTEAMX00001", {
          namedByAvatar: "quill",
        }),
        row("gC", "plural", "quill", [3, 1], "2026-09-07", "gcTEAMS00001", {
          namedByAvatar: "quill",
        }),
      ],
    };
    const tidy = tidyPool(pool);
    expect(counts(tidy)).toMatchInlineSnapshot(`
      {
        "notATeam": 2,
        "passes": 2,
      }
    `);
    expect(describePool(tidy.state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 9-3 Team 7 [slot]",
          "2026-09-07 Teams [pulled] 3-1 Quillfeather Quails [pulled]",
        ],
        "teams": [
          "Quillfeather Quails [pulled]",
          "Team 7 [slot]",
          "Teams [pulled]",
        ],
      }
    `);
  });

  it("sorts the waiting list's names as it did", () => {
    expect(
      [...WITH_AGE, ...RUN_ON].map((name) => {
        const row = agelessRowFor({
          teamId: name,
          name,
          firstSeen: "2026-09-01T00:00:00.000Z",
          lastTried: "2026-09-10T00:00:00.000Z",
          tries: 1,
        });
        return `${name}: ${row.standing?.because ?? "-"}`;
      })
    ).toMatchInlineSnapshot(`
      [
        "Team 7 12U: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Team B 10U: the name is only “Team”, with nothing more than a number, a letter or an age",
        "12U Team 7: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Team 12U: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Team 4 - 11U: the name is only “Team”, with nothing more than a number, a letter or an age",
        "Teams: -",
        "TEAMS: -",
        "TEAMB: -",
      ]
    `);
  });
});

/*
 * The same paths over names carrying a lone uppercase "V", pinned before the owner's ruling of 18
 * October 2026 that a lone V means varsity, beside names whose V is no squad word: a lowercase "v"
 * between two names, a V run into letters, and a JV/V the school rule read already. Two state an
 * age, one under the youngest a freshman is and one over it. The names are invented; none is a
 * club in the export or the pool.
 */
describe("the lone-V names pinned before the owner's ruling", () => {
  const LONE_V = [
    "Alder Comets V",
    "Quillmoor V Fall",
    "V Gorsefield Gulls",
    "Wrenhaven V-Rays",
    "Larkspire 16U V",
    "Brackenfield Owls 12U V",
  ];
  const NO_LONE_V = [
    "Fernhollow v Brindlewood",
    "Pimbleton VA Stars",
    "Tamberly Vipers",
    "Gorsefield JV/V",
  ];

  it("files a schedule list as it did", () => {
    const schedule = (id: string, name: string, games: GcTeamSchedule["games"]) => ({
      profile: { id, name, ageLevel: 12, season: { season: "fall" as const, year: 2026 } },
      games,
      fetchedAt: "2026-10-01T12:00:00.000Z",
    });
    const played = (id: string, date: string, opponentName: string, runs: [number, number]) => ({
      id,
      date,
      opponentName,
      teamScore: runs[0],
      opponentScore: runs[1],
      status: "completed" as const,
    });
    const { state, outcomes } = importGcSchedules(
      [
        schedule("gcQUILL00001", "Quillfeather Quails 12U", [
          played("q1", "2026-09-05", "Alder Comets V", [6, 2]),
          played("q2", "2026-09-06", "Brackenfield Owls 12U V", [3, 1]),
          played("q3", "2026-09-07", "Larkspire 16U V", [5, 4]),
          played("q4", "2026-09-08", "Fernhollow v Brindlewood", [7, 0]),
          played("q5", "2026-09-09", "Pimbleton VA Stars", [8, 1]),
        ]),
        ...[...LONE_V, ...NO_LONE_V].map((name, at) =>
          schedule(`gcLONEV0000${at}`, name, [
            played(`v${at}`, `2026-09-1${at}`, "Quillfeather Quails 12U", [1, 5]),
          ])
        ),
      ],
      { ageGroups: [], teams: [], games: [] },
      { today: "2026-10-11" }
    );
    expect(
      outcomes.map(
        (outcome) =>
          `${outcome.teamName}: ${outcome.skip ?? "filed"}, +${outcome.gamesAdded}, ignored ${
            outcome.gamesIgnored
          }, made ${outcome.opponentsCreated}`
      )
    ).toMatchInlineSnapshot(`
      [
        "Quillfeather Quails 12U: filed, +3, ignored 2, made 3",
        "Alder Comets V: high-school, +0, ignored 0, made 0",
        "Quillmoor V Fall: high-school, +0, ignored 0, made 0",
        "V Gorsefield Gulls: high-school, +0, ignored 0, made 0",
        "Wrenhaven V-Rays: high-school, +0, ignored 0, made 0",
        "Larkspire 16U V: high-school, +0, ignored 0, made 0",
        "Brackenfield Owls 12U V: filed, +1, ignored 0, made 1",
        "Fernhollow v Brindlewood: filed, +1, ignored 0, made 0",
        "Pimbleton VA Stars: filed, +1, ignored 0, made 0",
        "Tamberly Vipers: filed, +1, ignored 0, made 0",
        "Gorsefield JV/V: high-school, +0, ignored 0, made 0",
      ]
    `);
    expect(describePool(state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-06 Quillfeather Quails [pulled] 3-1 Brackenfield Owls V [pulled]",
          "2026-09-08 Quillfeather Quails [pulled] 7-0 Fernhollow v Brindlewood [pulled]",
          "2026-09-09 Quillfeather Quails [pulled] 8-1 Pimbleton VA Stars [pulled]",
          "2026-09-15 Brackenfield Owls V [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-09-16 Fernhollow v Brindlewood [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-09-17 Pimbleton VA Stars [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-09-18 Tamberly Vipers [pulled] 1-5 Quillfeather Quails [stand-in]",
        ],
        "teams": [
          "Brackenfield Owls V [pulled]",
          "Fernhollow v Brindlewood [pulled]",
          "Pimbleton VA Stars [pulled]",
          "Quillfeather Quails [pulled]",
          "Quillfeather Quails [stand-in]",
          "Tamberly Vipers [pulled]",
        ],
      }
    `);
  });

  it("marks a pasted list as it did", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        ...[...LONE_V, ...NO_LONE_V].map(
          (name, at) => `${name},gcVLIST${String(at).padStart(5, "0")},`
        ),
      ].join("\n")
    );
    expect(
      list.entries.map(({ name, highSchool }) => `${name}: ${highSchool ? "high school" : "-"}`)
    ).toMatchInlineSnapshot(`
      [
        "Alder Comets V: high school",
        "Quillmoor V Fall: high school",
        "V Gorsefield Gulls: high school",
        "Wrenhaven V-Rays: high school",
        "Larkspire 16U V: high school",
        "Brackenfield Owls 12U V: -",
        "Fernhollow v Brindlewood: -",
        "Pimbleton VA Stars: -",
        "Tamberly Vipers: -",
        "Gorsefield JV/V: high school",
      ]
    `);
  });

  /*
   * Stored as the import stores a club, the age taken off the name GameChanger gives it: what the
   * tidy has to go on is the stored name, the link's name and the level a row named a stand-in at.
   */
  const pool = (): GcImportState => ({
    ageGroups: [page],
    teams: [
      club("quill", "Quillfeather Quails", [["gcQUILL00001", "Quillfeather Quails 12U"]]),
      club("alder", "Alder Comets V", [["gcALDER00001", "Alder Comets V"]]),
      club("lark", "Larkspire V", [["gcLARKS00001", "Larkspire 16U V"]]),
      club("brack", "Brackenfield Owls V", [["gcBRACK00001", "Brackenfield Owls 12U V"]]),
      club("fern", "Fernhollow v Brindlewood", [["gcFERNH00001", "Fernhollow v Brindlewood"]]),
      { id: "quillv", name: "Quillmoor V Fall", nameOnly: true },
      { id: "gorse", name: "Gorsefield Gulls V", nameOnly: true },
      { id: "wren", name: "Wrenhaven V-Rays", nameOnly: true },
      { id: "pimble", name: "Pimbleton VA Stars", nameOnly: true },
    ],
    games: [
      row("gA", "quill", "alder", [9, 3], "2026-09-05", "gcQUILL00001", { namedByAvatar: "alder" }),
      row("gB", "lark", "quill", [4, 2], "2026-09-06", "gcLARKS00001", { namedByAvatar: "quill" }),
      row("gC", "brack", "quill", [3, 1], "2026-09-07", "gcBRACK00001", { namedByAvatar: "quill" }),
      row("gD", "fern", "quill", [2, 5], "2026-09-08", "gcFERNH00001", { namedByAvatar: "quill" }),
      row("gE", "quill", "quillv", [8, 2], "2026-09-09", "gcQUILL00001"),
      // The row named it "Gorsefield Gulls 12U V", whose age the stored name lost.
      row("gF", "quill", "gorse", [5, 1], "2026-09-10", "gcQUILL00001", { ageLevelB: 12 }),
      row("gG", "quill", "wren", [6, 0], "2026-09-11", "gcQUILL00001", { ageLevelB: 15 }),
      row("gH", "quill", "pimble", [7, 3], "2026-09-12", "gcQUILL00001"),
    ],
  });

  it("tidies a pool as it did", () => {
    const tidy = tidyPool(pool());
    expect(counts(tidy)).toMatchInlineSnapshot(`
      {
        "highSchool": 4,
        "passes": 2,
      }
    `);
    expect(describePool(tidy.state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-07 Brackenfield Owls V [pulled] 3-1 Quillfeather Quails [pulled]",
          "2026-09-08 Fernhollow v Brindlewood [pulled] 2-5 Quillfeather Quails [pulled]",
          "2026-09-10 Quillfeather Quails [pulled] 5-1 Gorsefield Gulls V [stand-in]",
          "2026-09-12 Quillfeather Quails [pulled] 7-3 Pimbleton VA Stars [stand-in]",
        ],
        "teams": [
          "Brackenfield Owls V [pulled]",
          "Fernhollow v Brindlewood [pulled]",
          "Gorsefield Gulls V [stand-in]",
          "Pimbleton VA Stars [stand-in]",
          "Quillfeather Quails [pulled]",
        ],
      }
    `);
  });

  it("lists the clubs worth pulling as it did", () => {
    expect(unpulledClubs(pool()).map((entry) => entry.name)).toMatchInlineSnapshot(`
      [
        "Gorsefield Gulls V",
        "Pimbleton VA Stars",
      ]
    `);
  });

  it("reads the waiting list's names as it did", () => {
    const evidence = (sampleOpponents: string[] = []): AgelessEvidence => ({
      games: 4,
      scored: 4,
      aheadOfToday: 0,
      shutoutBlowouts: 0,
      opponents: 4,
      namedAnAge: sampleOpponents.length > 0 ? 0 : 1,
      tally: sampleOpponents.length > 0 ? [] : [[16, 1]],
      sampleOpponents,
    });
    const rows: AgeUnknownTeam[] = [
      ...[...LONE_V, ...NO_LONE_V].map((name) => ({ name, evidence: evidence() })),
      // A side whose schedule is lone-V sides and nobody writing an age.
      { name: "Quillfeather Quails", evidence: evidence(["Alder Comets V", "Quillmoor V Fall"]) },
    ].map(({ name, evidence: kept }) => ({
      teamId: name,
      name,
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastTried: "2026-09-10T00:00:00.000Z",
      tries: 1,
      evidence: kept,
    }));
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(
      rows.map((entry) => {
        const hit = agelessSearch([entry], new Map(), new Set(), now, entry.teamId).hits[0]!;
        const school = AGELESS_RULES.filter(
          (rule) => rule.id.startsWith("school-") && rule.read(entry) !== undefined
        ).map((rule) => rule.id);
        return `${entry.name}: ${hit.aside ?? "on the queue"}; ${
          hit.row.standing?.because ?? "-"
        }; ${"hint" in hit.row ? "a hint" : "no hint"}; ${
          refusedAsSchool(entry) ? "refused as a school" : "not refused"
        }; ${school.join(" ") || "no school rule"}`;
      })
    ).toMatchInlineSnapshot(`
      [
        "Alder Comets V: high-school; -; no hint; refused as a school; school-name",
        "Quillmoor V Fall: high-school; -; no hint; refused as a school; school-name",
        "V Gorsefield Gulls: high-school; -; no hint; refused as a school; school-name",
        "Wrenhaven V-Rays: high-school; -; no hint; refused as a school; school-name",
        "Larkspire 16U V: high-school; -; no hint; refused as a school; school-name",
        "Brackenfield Owls 12U V: on the queue; -; no hint; not refused; no school rule",
        "Fernhollow v Brindlewood: on the queue; -; no hint; not refused; no school rule",
        "Pimbleton VA Stars: on the queue; -; no hint; not refused; no school rule",
        "Tamberly Vipers: on the queue; -; no hint; not refused; no school rule",
        "Gorsefield JV/V: high-school; -; no hint; refused as a school; school-name",
        "Quillfeather Quails: high-school; it plays varsity and JV sides; no hint; not refused; school-by-evidence",
      ]
    `);
  });
});

/*
 * The same paths over names whose capital V something joins to a word, pinned on the first
 * reading of the owner's ruling, which took every one of them for a lone V: a digit against it
 * ("V8", "5V5"), dotted initials ("Q.V.Z."), an apostrophe ("V’rons") and a letter outside A to Z
 * ("Válcor"). Beside them, a V a dot follows and nothing joins, a "J.V.", and two stand-ins
 * carrying a class year whose rows name them under fourteen, one at the age the year gives and one
 * at another. The names are invented; none is a club in the export or the pool.
 */
describe("the joined-V names pinned before a lone V was told from a joined one", () => {
  const JOINED_V = [
    "V8 Thistlewick",
    "Marrowdale V2",
    "Marrowdale 12V",
    "Corvelin 5V5",
    "Q.V.Z. Larkspire 16U",
    "Q.V Larkspire",
    "V.Q.Z. Larkspire",
    "Ondarra Válcor 15U",
    "Thistlewick V’rons",
  ];
  const STILL_SCHOOL = ["Alder Comets V.", "Brezal - V", "Alder Comets J.V."];
  const NAMES = [...JOINED_V, ...STILL_SCHOOL];

  it("files a schedule list as it did", () => {
    const schedule = (id: string, name: string, games: GcTeamSchedule["games"]) => ({
      profile: { id, name, ageLevel: 12, season: { season: "fall" as const, year: 2026 } },
      games,
      fetchedAt: "2026-10-01T12:00:00.000Z",
    });
    const played = (id: string, date: string, opponentName: string, runs: [number, number]) => ({
      id,
      date,
      opponentName,
      teamScore: runs[0],
      opponentScore: runs[1],
      status: "completed" as const,
    });
    const { state, outcomes } = importGcSchedules(
      [
        schedule(
          "gcQUILL00001",
          "Quillfeather Quails 12U",
          NAMES.map((name, at) => played(`q${at}`, `2026-09-${10 + at}`, name, [6, 2]))
        ),
        ...NAMES.map((name, at) =>
          schedule(`gcJOINV${String(at).padStart(5, "0")}`, name, [
            played(`v${at}`, `2026-08-${10 + at}`, "Quillfeather Quails 12U", [1, 5]),
          ])
        ),
      ],
      { ageGroups: [], teams: [], games: [] },
      { today: "2026-10-11" }
    );
    expect(
      outcomes.map(
        (outcome) =>
          `${outcome.teamName}: ${outcome.skip ?? "filed"}, +${outcome.gamesAdded}, ignored ${
            outcome.gamesIgnored
          }`
      )
    ).toMatchInlineSnapshot(`
      [
        "Quillfeather Quails 12U: filed, +9, ignored 3",
        "V8 Thistlewick: filed, +1, ignored 0",
        "Marrowdale V2: filed, +1, ignored 0",
        "Marrowdale 12V: filed, +1, ignored 0",
        "Corvelin 5V5: filed, +1, ignored 0",
        "Q.V.Z. Larkspire 16U: filed, +1, ignored 0",
        "Q.V Larkspire: filed, +1, ignored 0",
        "V.Q.Z. Larkspire: filed, +1, ignored 0",
        "Ondarra Válcor 15U: filed, +1, ignored 0",
        "Thistlewick V’rons: filed, +1, ignored 0",
        "Alder Comets V.: high-school, +0, ignored 0",
        "Brezal - V: high-school, +0, ignored 0",
        "Alder Comets J.V.: high-school, +0, ignored 0",
      ]
    `);
    expect(describePool(state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-08-10 V8 Thistlewick [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-11 Marrowdale V2 [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-12 Marrowdale 12V [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-13 Corvelin 5V5 [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-14 Q.V.Z. Larkspire [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-15 Q.V Larkspire [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-16 V.Q.Z. Larkspire [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-17 Ondarra Válcor [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-08-18 Thistlewick V’rons [pulled] 1-5 Quillfeather Quails [stand-in]",
          "2026-09-10 Quillfeather Quails [pulled] 6-2 V8 Thistlewick [pulled]",
          "2026-09-11 Quillfeather Quails [pulled] 6-2 Marrowdale V2 [pulled]",
          "2026-09-12 Quillfeather Quails [pulled] 6-2 Marrowdale 12V [pulled]",
          "2026-09-13 Quillfeather Quails [pulled] 6-2 Corvelin 5V5 [pulled]",
          "2026-09-14 Quillfeather Quails [pulled] 6-2 Q.V.Z. Larkspire [stand-in]",
          "2026-09-15 Quillfeather Quails [pulled] 6-2 Q.V Larkspire [pulled]",
          "2026-09-16 Quillfeather Quails [pulled] 6-2 V.Q.Z. Larkspire [pulled]",
          "2026-09-17 Quillfeather Quails [pulled] 6-2 Ondarra Válcor [stand-in]",
          "2026-09-18 Quillfeather Quails [pulled] 6-2 Thistlewick V’rons [pulled]",
        ],
        "teams": [
          "Corvelin 5V5 [pulled]",
          "Marrowdale 12V [pulled]",
          "Marrowdale V2 [pulled]",
          "Ondarra Válcor [pulled]",
          "Ondarra Válcor [stand-in]",
          "Q.V Larkspire [pulled]",
          "Q.V.Z. Larkspire [pulled]",
          "Q.V.Z. Larkspire [stand-in]",
          "Quillfeather Quails [pulled]",
          "Quillfeather Quails [stand-in]",
          "Thistlewick V’rons [pulled]",
          "V.Q.Z. Larkspire [pulled]",
          "V8 Thistlewick [pulled]",
        ],
      }
    `);
  });

  it("marks a pasted list as it did", () => {
    const list = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group",
        ...NAMES.map((name, at) => `${name},gcJLIST${String(at).padStart(5, "0")},`),
      ].join("\n")
    );
    expect(
      list.entries.map(({ name, highSchool }) => `${name}: ${highSchool ? "high school" : "-"}`)
    ).toMatchInlineSnapshot(`
      [
        "V8 Thistlewick: -",
        "Marrowdale V2: -",
        "Marrowdale 12V: -",
        "Corvelin 5V5: -",
        "Q.V.Z. Larkspire 16U: -",
        "Q.V Larkspire: -",
        "V.Q.Z. Larkspire: -",
        "Ondarra Válcor 15U: -",
        "Thistlewick V’rons: -",
        "Alder Comets V.: high school",
        "Brezal - V: high school",
        "Alder Comets J.V.: high school",
      ]
    `);
  });

  const pool = (): GcImportState => ({
    ageGroups: [page],
    teams: [
      club("quill", "Quillfeather Quails", [["gcQUILL00001", "Quillfeather Quails 12U"]]),
      club("v8", "V8 Thistlewick", [["gcJOINV00000", "V8 Thistlewick"]]),
      club("qvz", "Q.V.Z. Larkspire", [["gcJOINV00004", "Q.V.Z. Larkspire 16U"]]),
      club("valcor", "Ondarra Válcor", [["gcJOINV00007", "Ondarra Válcor 15U"]]),
      club("alder", "Alder Comets V.", [["gcJOINV00009", "Alder Comets V."]]),
      { id: "marrow", name: "Marrowdale V2", nameOnly: true },
      { id: "corvelin", name: "Corvelin 5V5", nameOnly: true },
      { id: "rons", name: "Thistlewick V’rons", nameOnly: true },
      { id: "jv", name: "Alder Comets J.V.", nameOnly: true },
      // The class of 2033 is 12U in 2027: the row's age is the one its class year gives.
      { id: "year", name: "Quillmoor V 2033", nameOnly: true },
      // The class of 2031 is 14U in 2027: the row's 12 came from an age label the name lost.
      { id: "label", name: "Brezal V 2031", nameOnly: true },
    ],
    games: [
      row("gA", "v8", "quill", [1, 5], "2026-09-05", "gcJOINV00000", { namedByAvatar: "quill" }),
      row("gB", "qvz", "quill", [2, 5], "2026-09-06", "gcJOINV00004", { namedByAvatar: "quill" }),
      row("gC", "valcor", "quill", [3, 5], "2026-09-07", "gcJOINV00007", {
        namedByAvatar: "quill",
      }),
      row("gD", "alder", "quill", [4, 5], "2026-09-08", "gcJOINV00009", { namedByAvatar: "quill" }),
      row("gE", "quill", "marrow", [6, 1], "2026-09-09", "gcQUILL00001"),
      row("gF", "quill", "corvelin", [6, 2], "2026-09-10", "gcQUILL00001"),
      row("gG", "quill", "rons", [6, 3], "2026-09-11", "gcQUILL00001"),
      row("gH", "quill", "jv", [6, 4], "2026-09-12", "gcQUILL00001"),
      row("gI", "quill", "year", [7, 1], "2026-09-13", "gcQUILL00001", { ageLevelB: 12 }),
      row("gJ", "quill", "label", [7, 2], "2026-09-14", "gcQUILL00001", { ageLevelB: 12 }),
    ],
  });

  it("tidies a pool as it did", () => {
    const tidy = tidyPool(pool());
    expect(counts(tidy)).toMatchInlineSnapshot(`
      {
        "highSchool": 3,
        "passes": 2,
      }
    `);
    expect(describePool(tidy.state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 V8 Thistlewick [pulled] 1-5 Quillfeather Quails [pulled]",
          "2026-09-06 Q.V.Z. Larkspire [pulled] 2-5 Quillfeather Quails [pulled]",
          "2026-09-07 Ondarra Válcor [pulled] 3-5 Quillfeather Quails [pulled]",
          "2026-09-09 Quillfeather Quails [pulled] 6-1 Marrowdale V2 [stand-in]",
          "2026-09-10 Quillfeather Quails [pulled] 6-2 Corvelin 5V5 [stand-in]",
          "2026-09-11 Quillfeather Quails [pulled] 6-3 Thistlewick V’rons [stand-in]",
          "2026-09-14 Quillfeather Quails [pulled] 7-2 Brezal V 2031 [stand-in]",
        ],
        "teams": [
          "Brezal V 2031 [stand-in]",
          "Corvelin 5V5 [stand-in]",
          "Marrowdale V2 [stand-in]",
          "Ondarra Válcor [pulled]",
          "Q.V.Z. Larkspire [pulled]",
          "Quillfeather Quails [pulled]",
          "Thistlewick V’rons [stand-in]",
          "V8 Thistlewick [pulled]",
        ],
      }
    `);
  });

  it("lists the clubs worth pulling as it did", () => {
    expect(unpulledClubs(pool()).map((entry) => entry.name)).toMatchInlineSnapshot(`
      [
        "Brezal V 2031",
        "Corvelin 5V5",
        "Marrowdale V2",
        "Thistlewick V’rons",
      ]
    `);
  });

  it("reads the waiting list's names as it did", () => {
    const evidence: AgelessEvidence = {
      games: 4,
      scored: 4,
      aheadOfToday: 0,
      shutoutBlowouts: 0,
      opponents: 4,
      namedAnAge: 1,
      tally: [[16, 1]],
      sampleOpponents: [],
    };
    const rows: AgeUnknownTeam[] = NAMES.map((name) => ({
      teamId: name,
      name,
      firstSeen: "2026-09-01T00:00:00.000Z",
      lastTried: "2026-09-10T00:00:00.000Z",
      tries: 1,
      evidence,
    }));
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(
      rows.map((entry) => {
        const hit = agelessSearch([entry], new Map(), new Set(), now, entry.teamId).hits[0]!;
        return `${entry.name}: ${hit.aside ?? "on the queue"}; ${
          refusedAsSchool(entry) ? "refused as a school" : "not refused"
        }`;
      })
    ).toMatchInlineSnapshot(`
      [
        "V8 Thistlewick: on the queue; not refused",
        "Marrowdale V2: on the queue; not refused",
        "Marrowdale 12V: on the queue; not refused",
        "Corvelin 5V5: on the queue; not refused",
        "Q.V.Z. Larkspire 16U: on the queue; not refused",
        "Q.V Larkspire: on the queue; not refused",
        "V.Q.Z. Larkspire: on the queue; not refused",
        "Ondarra Válcor 15U: on the queue; not refused",
        "Thistlewick V’rons: on the queue; not refused",
        "Alder Comets V.: high-school; refused as a school",
        "Brezal - V: high-school; refused as a school",
        "Alder Comets J.V.: high-school; refused as a school",
      ]
    `);
  });
});
