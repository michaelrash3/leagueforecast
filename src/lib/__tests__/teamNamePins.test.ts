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
import { agelessRowFor } from "../agelessQueue";

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
        "Quillfeather Quails 12U: filed, +8, ignored 0, made 8",
        "Thornbury Practice 12U: filed, +1, ignored 0, made 0",
        "Gildersleeve Softball 12U: filed, +1, ignored 0, made 1",
        "Test Red Kestrelmoor 12U: filed, +1, ignored 0, made 0",
        "Wexcombe Wrens Tryouts 12U: filed, +1, ignored 0, made 0",
      ]
    `);
    expect(describePool(state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 6-2 Brindlewood Badgers [stand-in]",
          "2026-09-06 Quillfeather Quails [pulled] 3-1 Practice [slot]",
          "2026-09-07 Quillfeather Quails [pulled] 5-4 Thornbury Practice Squad [stand-in]",
          "2026-09-08 Quillfeather Quails [pulled] 7-0 Hollowmere Hornets DNU [stand-in]",
          "2026-09-09 Quillfeather Quails [pulled] 8-1 Elmstead Fastpitch [stand-in]",
          "2026-09-10 Quillfeather Quails [pulled] 4-4 Test Red Kestrelmoor [pulled]",
          "2026-09-11 Quillfeather Quails [pulled] 2-9 Copperfield Scrimmage [stand-in]",
          "2026-09-12 Quillfeather Quails [pulled] 3-0 Copy of Duskwood Drakes [stand-in]",
          "2026-09-13 Thornbury Practice [pulled] 1-5 Quillfeather Quails [pulled]",
          "2026-09-14 Gildersleeve Softball [pulled] 2-3 Quillfeather Quails [stand-in]",
          "2026-09-15 Test Red Kestrelmoor [pulled] 6-5 Quillfeather Quails [stand-in]",
          "2026-09-16 Wexcombe Wrens Tryouts [pulled] 0-2 Quillfeather Quails [stand-in]",
        ],
        "teams": [
          "Brindlewood Badgers [stand-in]",
          "Copperfield Scrimmage [stand-in]",
          "Copy of Duskwood Drakes [stand-in]",
          "Elmstead Fastpitch [stand-in]",
          "Gildersleeve Softball [pulled]",
          "Hollowmere Hornets DNU [stand-in]",
          "Practice [slot]",
          "Quillfeather Quails [pulled]",
          "Quillfeather Quails [stand-in]",
          "Test Red Kestrelmoor [pulled]",
          "Thornbury Practice Squad [stand-in]",
          "Thornbury Practice [pulled]",
          "Wexcombe Wrens Tryouts [pulled]",
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
        "Wiffle Kings 12U,gcWIFFL00001,12U",
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
        },
        {
          "ageLevel": 12,
          "name": "Copperfield Scrimmage 12U",
        },
        {
          "ageLevel": 12,
          "name": "Hollowmere Hornets DNU",
        },
        {
          "ageLevel": 12,
          "name": "Gildersleeve Softball 12U",
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
          "name": "Wiffle Kings 12U",
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
        "passes": 1,
      }
    `);
    expect(describePool(tidy.state)).toMatchInlineSnapshot(`
      {
        "games": [
          "2026-09-05 Quillfeather Quails [pulled] 9-3 Thornbury Practice [pulled]",
          "2026-09-06 Thornbury Practice [pulled] 4-2 Pimbleton Pikes [stand-in]",
          "2026-09-07 Ashgrove Aces [pulled] 1-6 Brindlewood Badgers [pulled]",
          "2026-09-08 Fernhollow Falcons [pulled] 3-3 Quillfeather Quails [pulled]",
          "2026-09-09 Quillfeather Quails [pulled] 8-2 Hollowmere Hornets DNU [pulled] +1 folded",
          "2026-09-10 Hollowmere Hornets DNU [pulled] 5-1 Brindlewood Badgers [pulled] +1 folded",
          "2026-09-11 Hollowmere Hornets DNU [pulled] 6-0 Pimbleton Pikes [stand-in]",
          "2026-09-12 Brindlewood Badgers [pulled] 7-5 Rowanberry Practice Squad [stand-in]",
          "2026-09-13 Brindlewood Badgers [pulled] 2-0 Practice [slot]",
          "2026-09-14 Quillfeather Quails [pulled] 3-1 Copperfield Test [pulled]",
          "2026-09-15 Duskwood Demo [pulled] 4-1 Brindlewood Badgers [pulled]",
          "2026-09-16 Test Red Kestrelmoor [pulled] 2-5 Quillfeather Quails [pulled]",
          "2026-09-17 Gildersleeve Softball [pulled] 1-10 Quillfeather Quails [pulled]",
          "2026-09-18 Brindlewood Badgers [pulled] 6-6 Elmstead Fastpitch [stand-in]",
          "2026-09-19 Marrowdale Void [pulled] 0-4 Quillfeather Quails [pulled]",
          "2026-09-20 Quillfeather Quails [pulled] 5-0 Marrowdale Void [pulled]",
        ],
        "teams": [
          "Ashgrove Aces [pulled]",
          "Brindlewood Badgers [pulled]",
          "Copperfield Test [pulled]",
          "Duskwood Demo [pulled]",
          "Elmstead Fastpitch [stand-in]",
          "Fernhollow Falcons [pulled]",
          "Gildersleeve Softball [pulled]",
          "Hollowmere Hornets DNU [pulled]",
          "Marrowdale Void [pulled]",
          "Pimbleton Pikes [stand-in]",
          "Practice [slot]",
          "Quillfeather Quails [pulled]",
          "Rowanberry Practice Squad [stand-in]",
          "Test Red Kestrelmoor [pulled]",
          "Thornbury Practice [pulled]",
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
        "Bramblecote Test Prep 12U: test",
        "Duskwood Demo 12U: demo",
        "Elmstead Voided 12U: voided",
        "Gildersleeve Demo Dawgs 12U: demo",
        "Skiles Test Nettlefield 12U: test",
        "Test Red Kestrelmoor 12U: test",
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
        "Test Red Kestrelmoor: the name reads as a test, practice or placeholder account",
        "Hollowmere Hornets DNU: -",
        "Duskwood Tryouts: -",
        "Elmstead Stats: -",
        "Wexcombe Old Team: the name reads as a test, practice or placeholder account",
        "Team 1: the name is only “Team” and a number",
        "Gildersleeve Fastpitch: -",
      ]
    `);
  });
});
