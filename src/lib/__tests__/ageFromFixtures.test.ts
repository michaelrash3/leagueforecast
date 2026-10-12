import { describe, expect, it } from "vitest";
import { createGcImporter, tidyPool, type GcImportState } from "../gameChangerImport";
import type { GcTeamSchedule } from "../gameChangerApi";

/*
 * A club with no age on its GameChanger page, whose opponents write no age in their names either,
 * that three pulled 9U clubs have already met. Each of them filed its half of the game against a
 * stand-in carrying what its coach typed; this club's coach typed its own shorthand for them.
 */

const TODAY = "2026-09-22";
const empty: GcImportState = { ageGroups: [], teams: [], games: [] };
type Played = GcTeamSchedule["games"][number];

const played = (
  id: string,
  opponentName: string,
  date: string,
  teamScore: number | undefined,
  opponentScore: number | undefined,
  startTs?: string
): Played => ({
  id,
  date,
  opponentName,
  status: teamScore === undefined ? "scheduled" : "completed",
  ...(teamScore === undefined ? {} : { teamScore }),
  ...(opponentScore === undefined ? {} : { opponentScore }),
  ...(startTs ? { startTs } : {}),
});

const club = (
  id: string,
  name: string,
  state: string,
  games: Played[],
  ageLevel?: number
): GcTeamSchedule => ({
  profile: {
    id,
    name,
    ...(ageLevel === undefined ? {} : { ageLevel }),
    season: { season: "fall", year: 2026 },
    state,
  },
  games,
  fetchedAt: `${TODAY}T12:00:00.000Z`,
});

const HURRICANES = "gcHURRICANES";
const STIX = club(
  "gcSTIX000001",
  "Cincy Stix 9U Navy",
  "OH",
  [played("s1", "Hurricanes", "2026-09-20", 13, 2, "2026-09-20T17:30:00.000Z")],
  9
);
const MUD_HENS = club(
  "gcMUDHENS001",
  "Toledo Mud Hens 9U",
  "OH",
  [played("m1", "Hurricanes", "2026-09-13", 3, 4, "2026-09-13T15:00:00.000Z")],
  9
);
// Not scored on the Redbirds' side yet: the start time is what says it is the same game.
const REDBIRDS = club(
  "gcREDBIRDS01",
  "Dayton Redbirds 9U",
  "OH",
  [played("r1", "Hurricanes", "2026-09-06", undefined, undefined, "2026-09-06T18:00:00.000Z")],
  9
);

const hurricanes = (options: { state?: string; games?: Played[] } = {}): GcTeamSchedule =>
  club(
    HURRICANES,
    "Hurricanes Baseball",
    options.state ?? "OH",
    options.games ?? [
      played("h1", "Stix", "2026-09-20", 2, 13, "2026-09-20T17:00:00.000Z"),
      played("h2", "Mud Hens", "2026-09-13", 4, 3, "2026-09-13T15:00:00.000Z"),
      played("h3", "Redbirds", "2026-09-06", 5, 5, "2026-09-06T18:00:00.000Z"),
    ]
  );

/** The clubs pulled first, then the club with no age; the outcome of that last one. */
const pull = (clubs: GcTeamSchedule[], last: GcTeamSchedule = hurricanes()) => {
  const importer = createGcImporter(empty, { today: TODAY });
  clubs.forEach((schedule) => importer.add(schedule));
  const outcome = importer.add(last);
  return { outcome, state: importer.state };
};

describe("ageing a club from the games the pool already holds", () => {
  it("files it at the level of the pulled clubs whose own schedules hold its games", () => {
    const { outcome } = pull([STIX, MUD_HENS, REDBIRDS]);
    expect(outcome.skip).toBeUndefined();
    expect(outcome.ageFromFixtures).toBe(9);
    expect(outcome.ageFromOpponents).toBe(9);
    expect(outcome.ageGroupName).toMatch(/^9U/);
  });

  it("leaves no stand-in behind once the tidy has joined the halves", () => {
    const { state } = pull([STIX, MUD_HENS, REDBIRDS]);
    const pool = tidyPool(state).state;
    const busy = new Set(pool.games.flatMap((game) => [game.teamAId, game.teamBId]));
    expect(pool.teams.filter((team) => team.nameOnly && busy.has(team.id))).toEqual([]);
    expect(pool.games).toHaveLength(3);
  });

  it("is still refused with only two clubs to go on", () => {
    expect(pull([STIX, MUD_HENS]).outcome.skip).toBe("no-age");
  });

  it("does not count a game whose result does not mirror at another time", () => {
    const games = [
      played("h1", "Stix", "2026-09-20", 2, 12, "2026-09-20T17:00:00.000Z"),
      played("h2", "Mud Hens", "2026-09-13", 4, 3, "2026-09-13T15:00:00.000Z"),
      played("h3", "Redbirds", "2026-09-06", 5, 5, "2026-09-06T18:00:00.000Z"),
    ];
    expect(pull([STIX, MUD_HENS, REDBIRDS], hurricanes({ games })).outcome.skip).toBe("no-age");
  });

  it("does not count a club this one's coach did not name", () => {
    const games = [
      played("h1", "Stix", "2026-09-20", 2, 13, "2026-09-20T17:00:00.000Z"),
      played("h2", "Mud Hens", "2026-09-13", 4, 3, "2026-09-13T15:00:00.000Z"),
      played("h3", "Sharks", "2026-09-06", 5, 5, "2026-09-06T18:00:00.000Z"),
    ];
    expect(pull([STIX, MUD_HENS, REDBIRDS], hurricanes({ games })).outcome.skip).toBe("no-age");
  });

  it("does not count a club that filed the game against somebody else's name", () => {
    const redbirds = club(
      "gcREDBIRDS01",
      "Dayton Redbirds 9U",
      "OH",
      [played("r1", "Wildcats", "2026-09-06", undefined, undefined, "2026-09-06T18:00:00.000Z")],
      9
    );
    expect(pull([STIX, MUD_HENS, redbirds]).outcome.skip).toBe("no-age");
  });

  it("does not reach across the country for its opponents", () => {
    expect(pull([STIX, MUD_HENS, REDBIRDS], hurricanes({ state: "FL" })).outcome.skip).toBe(
      "no-age"
    );
  });

  it("does not guess between two clubs that could each have been one game", () => {
    // The Stix's Gold squad also beat a "Hurricanes" 13-2 that day.
    const gold = club(
      "gcSTIXGOLD01",
      "Cincy Stix 9U Gold",
      "OH",
      [played("g1", "Hurricanes", "2026-09-20", 13, 2, "2026-09-20T19:30:00.000Z")],
      9
    );
    const fourth = club(
      "gcBEARS00001",
      "Columbus Bears 9U",
      "OH",
      [played("b1", "Hurricanes", "2026-08-30", 1, 6, "2026-08-30T15:00:00.000Z")],
      9
    );
    const games = [
      played("h1", "Stix", "2026-09-20", 2, 13, "2026-09-20T17:00:00.000Z"),
      played("h2", "Mud Hens", "2026-09-13", 4, 3, "2026-09-13T15:00:00.000Z"),
      played("h3", "Redbirds", "2026-09-06", 5, 5, "2026-09-06T18:00:00.000Z"),
      played("h4", "Bears", "2026-08-30", 6, 1, "2026-08-30T15:00:00.000Z"),
    ];
    // Without the Gold squad the four games name four clubs; with it, the Stix game names none.
    expect(
      pull([STIX, MUD_HENS, REDBIRDS, fourth], hurricanes({ games })).outcome.ageFromFixtures
    ).toBe(9);
    const { outcome } = pull([STIX, gold, MUD_HENS, REDBIRDS], hurricanes({ games }));
    expect(outcome.skip).toBe("no-age");
  });

  it("needs as many clubs agreeing on the level as it needs clubs at all", () => {
    // Nine, nine and ten: a majority, but two clubs are not three.
    const redbirds = club("gcREDBIRDS01", "Dayton Redbirds 10U", "OH", REDBIRDS.games, 10);
    expect(pull([STIX, MUD_HENS, redbirds]).outcome.skip).toBe("no-age");
  });

  /** Clubs at these levels, one game each against the club with no age, and its schedule. */
  const clubsAt = (levels: number[]) => {
    const names = ["Stix", "Mud Hens", "Redbirds", "Bears", "Owls", "Tigers", "Foxes"];
    const clubs = levels.map((level, at) => {
      const day = `2026-08-${String(10 + at).padStart(2, "0")}`;
      return club(
        `gcCLUB${String(at).padStart(6, "0")}`,
        `Ohio ${names[at]} ${level}U`,
        "OH",
        [played(`c${at}`, "Hurricanes", day, 3, 4, `${day}T15:00:00.000Z`)],
        level
      );
    });
    const games = levels.map((_, at) => {
      const day = `2026-08-${String(10 + at).padStart(2, "0")}`;
      return played(`h${at}`, names[at]!, day, 4, 3, `${day}T15:00:00.000Z`);
    });
    return pull(clubs, hurricanes({ games })).outcome;
  };

  it("takes the level most of its opponents are at", () => {
    expect(clubsAt([9, 9, 9, 10]).ageFromFixtures).toBe(9);
  });

  it("refuses a level only half of them are at", () => {
    // Three at nine is enough clubs, but three of six is not a majority.
    expect(clubsAt([9, 9, 9, 10, 10, 11]).skip).toBe("no-age");
  });

  it("refuses a tie", () => {
    expect(clubsAt([9, 9, 9, 10, 10, 10]).skip).toBe("no-age");
  });

  it("does not read a game a club pulled under that name has since taken", () => {
    // A "Hurricanes" of its own is pulled after the three, and the stand-in they named is its.
    const other = club("gcHURR9U0001", "Hurricanes 9U", "OH", [], 9);
    expect(pull([STIX, MUD_HENS, REDBIRDS, other]).outcome.skip).toBe("no-age");
  });

  it("reads a result as it stands now, after a club's re-pull corrected it", () => {
    // The Stix first posted 13-2 and then corrected it to 14-2; the 2-13 on this schedule is no
    // longer their game, and at another start time nothing else says it is.
    const importer = createGcImporter(empty, { today: TODAY });
    [STIX, MUD_HENS, REDBIRDS].forEach((schedule) => importer.add(schedule));
    importer.add(
      club(
        "gcSTIX000001",
        "Cincy Stix 9U Navy",
        "OH",
        [played("s1", "Hurricanes", "2026-09-20", 14, 2, "2026-09-20T17:30:00.000Z")],
        9
      )
    );
    expect(importer.add(hurricanes()).skip).toBe("no-age");
  });

  it("counts a club it played three times as one", () => {
    const stix = club(
      "gcSTIX000001",
      "Cincy Stix 9U Navy",
      "OH",
      ["2026-09-18", "2026-09-19", "2026-09-20"].map((day, at) =>
        played(`s${at}`, "Hurricanes", day, 13, 2, `${day}T17:30:00.000Z`)
      ),
      9
    );
    const games = ["2026-09-18", "2026-09-19", "2026-09-20"].map((day, at) =>
      played(`h${at}`, "Stix", day, 2, 13, `${day}T17:00:00.000Z`)
    );
    expect(pull([stix], hurricanes({ games })).outcome.skip).toBe("no-age");
  });

  it("reads nothing from a club listed at two levels", () => {
    const { state } = pull([STIX, MUD_HENS, REDBIRDS], club("gcNOBODY0001", "Nobody", "OH", []));
    const redbirds = state.teams.find((team) =>
      team.gcTeams?.some((link) => link.teamId === "gcREDBIRDS01")
    )!;
    const twice: GcImportState = {
      ...state,
      teams: state.teams.map((team) =>
        team.id === redbirds.id
          ? {
              ...team,
              gcTeams: [
                ...team.gcTeams!,
                { ...team.gcTeams![0]!, teamId: "gcREDBIRDS02", ageLevel: 10 },
              ],
            }
          : team
      ),
    };
    const outcome = createGcImporter(twice, { today: TODAY }).add(hurricanes());
    expect(outcome.skip).toBe("no-age");
  });

  it("does not take a game off a row the club did not file itself", () => {
    const { state } = pull([STIX, MUD_HENS, REDBIRDS], club("gcNOBODY0001", "Nobody", "OH", []));
    const borrowed: GcImportState = {
      ...state,
      games: state.games.map((game) =>
        game.source?.teamId === "gcREDBIRDS01"
          ? { ...game, source: { ...game.source, teamId: "gcSOMEBODY01" } }
          : game
      ),
    };
    expect(createGcImporter(borrowed, { today: TODAY }).add(hurricanes()).skip).toBe("no-age");
  });
});
