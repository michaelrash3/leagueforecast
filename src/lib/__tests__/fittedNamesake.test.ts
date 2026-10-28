import { describe, expect, it } from "vitest";
import {
  ONE_NAMESAKE_TIDY_RULES,
  SHIPPED_TIDY_RULES,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { refusalOf } from "../notThisTeam";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import { countsTowardRating } from "../teamRankings/games";

/*
 * One game held twice where one club's own schedule has it against a TBD slot and the other's
 * against a name that holds the first club's name with more around it (`fittedNamesake`, rules
 * 35): the owner's "Here is a stand in that didn't need to exist. Both teams have the game" of 28
 * October 2026. Invented clubs, in the shape the owner sent: a 9U club of one word in Kentucky, whose
 * own row is a 4-11 loss to "TBD- 10/25/26, 10:30 AM", and an Ohio club whose own row of the same
 * minute is an 11-4 win over the first club's name with the region before it and an event's tag
 * after it.
 */
const groups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  { id: "ag12", name: "12U 2027", seasonIds: [], ageLevel: 12, year: 2027 },
];
const levelOf = (page: string) => Number(page.slice(2));

const club = (id: string, name: string, state: string, page = "ag9"): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc${id}`, name: `${name} 9U`, ageGroupId: page, ageLevel: levelOf(page) }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string, name: string): ScoutTeam => ({ id, name, placeholder: true });

/** `clubId`'s own row `gameId` against `against`, its own score first. */
const row = (
  clubId: string,
  gameId: string,
  against: string,
  start: string,
  score: [number, number],
  page = "ag9"
): ScoutGame => ({
  id: `gc_gc${clubId}_${gameId}`,
  teamAId: clubId,
  teamBId: against,
  teamAScore: score[0],
  teamBScore: score[1],
  ageGroupId: page,
  date: start.slice(0, 10),
  ageLevelA: levelOf(page),
  season: "Fall 2026",
  startTs: `${start}:00.000Z`,
  source: { kind: "gamechanger", teamId: `gc${clubId}`, gameId },
});

const otters = club("OTTERS", "Otters", "KY");
const comets = club("COMETS", "2036 Riverside Comets", "OH");
const named = standIn("S-OTTERS", "Northern Kentucky Otters -TFX");
const tbd = slot("TBD-1", "TBD- 10/25/26, 10:30 AM");
const START = "2026-10-25T14:30";

/**
 * The two rows as the owner sent them, the club the name fits and the name as given unless a test
 * says otherwise, and whatever more a test adds.
 */
const pool = (
  more: {
    club?: ScoutTeam;
    name?: string;
    theirs?: Partial<ScoutGame>;
    teams?: ScoutTeam[];
    games?: ScoutGame[];
  } = {}
): GcImportState => ({
  ageGroups: groups,
  teams: [
    more.club ?? otters,
    comets,
    more.name ? { ...named, name: more.name } : named,
    tbd,
    ...(more.teams ?? []),
  ],
  games: [
    row("COMETS", "c1", named.id, START, [11, 4]),
    { ...row("OTTERS", "o1", tbd.id, START, [4, 11]), ...more.theirs },
    ...(more.games ?? []),
  ],
});

/** Each game as one line, by its sides' names: what the tidy did, readable in a diff. */
const linesOf = (state: GcImportState): string[] => {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const label = (id: string) => {
    const team = teamById.get(id);
    if (!team) return `${id}?`;
    return `${team.name}${team.gcTeams?.length ? "" : team.placeholder ? " (slot)" : " (stand-in)"}`;
  };
  return state.games
    .map((game) => {
      const held = (game.alsoRows ?? [])
        .map(
          (record) =>
            `${record.teamId}:${record.gameId}` +
            (record.filedAgainst ? ` filed against ${label(record.filedAgainst)}` : "")
        )
        .join("; ");
      return (
        `${game.date} ${label(game.teamAId)} ${game.teamAScore}-${game.teamBScore} ` +
        `${label(game.teamBId)}${countsTowardRating(game) ? "" : " (not counted)"}` +
        (held ? ` [holds ${held}]` : "")
      );
    })
    .sort();
};
const joinedLine =
  "2026-10-25 2036 Riverside Comets 11-4 Otters [holds gcOTTERS:o1 filed against TBD- 10/25/26, 10:30 AM (slot)]";
/** The two rows where nothing joins them: the stand-in's win, and the slot's loss not counted. */
const apartLines = (name = named.name) => [
  `2026-10-25 2036 Riverside Comets 11-4 ${name} (stand-in)`,
  "2026-10-25 Otters 4-11 TBD- 10/25/26, 10:30 AM (slot) (not counted)",
];
const shipped = (state: GcImportState) => linesOf(tidyPool(state).state);

describe("a name holding a club's name with more around it, against that club's TBD slot", () => {
  it("held the game twice under the rules of 28 October: a stand-in's win and a slot's loss", () => {
    expect(
      linesOf(
        tidyPool(pool(), undefined, undefined, undefined, undefined, ONE_NAMESAKE_TIDY_RULES).state
      )
    ).toEqual(apartLines());
  });

  it("holds it once, between the two clubs, and leaves it so", () => {
    const tidied = tidyPool(pool());
    expect(linesOf(tidied.state)).toEqual([joinedLine]);
    expect(tidied.namesakeJoined).toBe(1);
    expect(tidyChangedAnything(tidyPool(tidied.state))).toBe(false);
  });

  it("reads a shorthand the other way round, and the club by a name GameChanger lists it under", () => {
    const longer = club("OTTERS", "Bluegrass Otters", "KY");
    expect(shipped(pool({ name: "Otters", club: longer }))).toEqual([
      joinedLine.replace("11-4 Otters", "11-4 Bluegrass Otters"),
    ]);
    // Renamed here, and listed on GameChanger as it was: the name fits the listing, or is it.
    const renamed = { ...otters, name: "BG Squad" };
    expect(shipped(pool({ club: renamed }))).toEqual([
      joinedLine.replace("11-4 Otters", "11-4 BG Squad"),
    ]);
    expect(shipped(pool({ club: renamed, name: "Otters" }))).toEqual([
      joinedLine.replace("11-4 Otters", "11-4 BG Squad"),
    ]);
  });

  it("joins nothing where the name fits no club", () => {
    expect(shipped(pool({ name: "Northern Kentucky Beavers -TFX" }))).toEqual(
      apartLines("Northern Kentucky Beavers -TFX")
    );
  });

  it("joins nothing where the club's row is against a stand-in rather than a slot", () => {
    // "Riverside Hawks" shares a word with the namer's name, as a stand-in of a club's very name
    // joins on, and does not fit it, as the crossed halves join on.
    const riverside: ScoutTeam = { id: "S-RIVER", name: "Riverside Hawks", nameOnly: true };
    expect(shipped(pool({ teams: [riverside], theirs: { teamBId: riverside.id } }))).toEqual([
      "2026-10-25 2036 Riverside Comets 11-4 Northern Kentucky Otters -TFX (stand-in)",
      "2026-10-25 Otters 4-11 Riverside Hawks (stand-in)",
    ]);
  });

  it("joins nothing where the results do not mirror, or the rows are more than an hour apart", () => {
    expect(shipped(pool({ theirs: { teamAScore: 11, teamBScore: 4 } }))).toEqual([
      apartLines()[0],
      "2026-10-25 Otters 11-4 TBD- 10/25/26, 10:30 AM (slot) (not counted)",
    ]);
    expect(shipped(pool({ theirs: { startTs: "2026-10-25T15:45:00.000Z" } }))).toEqual(
      apartLines()
    );
  });

  it("joins nothing where the name is a pulled club's, though that club has no row of the game", () => {
    // Far off, so no step files the name onto it (`oneNamesake`).
    const listed = club("NKY", "Northern Kentucky Otters", "TX");
    expect(shipped(pool({ name: "Northern Kentucky Otters", teams: [listed] }))).toEqual(
      apartLines("Northern Kentucky Otters")
    );
    // Nor where it is the name GameChanger lists that club under, renamed here.
    const renamed = { ...listed, name: "Lone Star Squad" };
    expect(shipped(pool({ name: "Northern Kentucky Otters", teams: [renamed] }))).toEqual(
      apartLines("Northern Kentucky Otters")
    );
  });

  it("joins nothing where the name is the namer's own", () => {
    // A coach who typed their own club's name has said nothing of whom it played.
    const ownName = "2036 Riverside Comets";
    expect(shipped(pool({ name: ownName, club: club("OTTERS", "Comets", "KY") }))).toEqual(
      apartLines(ownName).map((line) => line.replace(" Otters 4-11", " Comets 4-11"))
    );
  });

  it("joins nothing where a second club the name fits has a row against a slot at that hour", () => {
    // However far off that club is: each club the name fits is a reading before the region is asked.
    const twin = club("OTTERS2", "Otters", "TX");
    const twinSlot = slot("TBD-2", "TBD");
    expect(
      shipped(
        pool({
          teams: [twin, twinSlot],
          games: [row("OTTERS2", "t1", twinSlot.id, "2026-10-25T15:00", [4, 11])],
        })
      )
    ).toEqual([...apartLines(), "2026-10-25 Otters 4-11 TBD (slot) (not counted)"].sort());
    // A club of the name with no such row is no reading at all.
    expect(shipped(pool({ teams: [twin] }))).toEqual([joinedLine]);
  });

  it("joins nothing between clubs of states that share no border, or of a state not known", () => {
    expect(shipped(pool({ club: club("OTTERS", "Otters", "TX") }))).toEqual(apartLines());
    const { state: _state, ...stateless } = otters;
    expect(shipped(pool({ club: stateless }))).toEqual(apartLines());
    // Read anywhere where the rule does not ask the region.
    const anywhere = { ...SHIPPED_TIDY_RULES, fitted: { region: false } };
    expect(
      linesOf(
        tidyPool(
          pool({ club: club("OTTERS", "Otters", "TX") }),
          undefined,
          undefined,
          undefined,
          undefined,
          anywhere
        ).state
      )
    ).toEqual([joinedLine]);
  });

  it("joins nothing the owner has said is not the club, by the club's own name", () => {
    const refused = new Set([refusalOf("gcCOMETS", "Otters", "gcOTTERS")]);
    expect(linesOf(tidyPool(pool(), undefined, undefined, refused).state)).toEqual(apartLines());
  });
});
