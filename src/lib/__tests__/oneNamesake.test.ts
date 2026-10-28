import { describe, expect, it } from "vitest";
import {
  IN_STATE_TIDY_RULES,
  refileStandIns,
  resettleOffLevel,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { refusalOf } from "../notThisTeam";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

/*
 * A name read as the one pulled club that carries it near the club whose schedule wrote it down,
 * though that club's own schedules have no game that day (`oneNamesake`, rules 34): the owner's
 * "If you can get to 25%, great" of 28 October 2026. Placeholder names throughout.
 */
const groups: AgeGroup[] = [
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
  { id: "ag12", name: "12U 2027", seasonIds: [], ageLevel: 12, year: 2027 },
  { id: "ag13", name: "13U 2027", seasonIds: [], ageLevel: 13, year: 2027 },
];

const pulled = (
  id: string,
  name: string,
  state: string | undefined,
  page = "ag10",
  level = 10
): ScoutTeam => ({
  id,
  name,
  ...(state ? { state } : {}),
  gcTeams: [{ teamId: `gc${id}`, name, ageGroupId: page, ageLevel: level }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });

let made = 0;
/** A row of `club`'s own schedule against `against`, at two in the afternoon. */
const row = (
  club: ScoutTeam,
  against: string,
  date: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id: `g${(made += 1)}`,
  teamAId: club.id,
  teamBId: against,
  ageGroupId: "ag10",
  date,
  startTs: `${date}T14:00:00.000Z`,
  teamAScore: 5,
  teamBScore: 3,
  source: { kind: "gamechanger", teamId: club.gcTeams![0]!.teamId, gameId: `x${made}` },
  ...extra,
});

const namer = pulled("NAMER", "Louisville Sluggers", "KY");
const other = pulled("OTHER", "Frankfort Flyers", "KY");
const bombers = (state: string, page = "ag10", level = 10) =>
  pulled("BOMB", "Bluegrass Bombers", state, page, level);
const named = standIn("S-BOMB", "Bluegrass Bombers");
/** Whom the Bombers' own schedule says they played on the 20th: a name, so no state is read. */
const someone = standIn("S-ELSE", "Somebody Else");

/**
 * The namer's 15 September game against "Bluegrass Bombers", and the Bombers' own schedule with a
 * game on the 20th only: nothing of theirs says they played on the 15th.
 */
const pool = (
  club: ScoutTeam = bombers("KY"),
  more: { teams?: ScoutTeam[]; games?: ScoutGame[]; named?: Partial<ScoutGame> } = {}
): GcImportState => ({
  ageGroups: groups,
  teams: [namer, other, club, named, someone, ...(more.teams ?? [])],
  games: [
    row(namer, named.id, "2026-09-15", more.named ?? {}),
    row(club, someone.id, "2026-09-20", {
      ageGroupId: club.gcTeams![0]!.ageGroupId,
    }),
    ...(more.games ?? []),
  ],
});
const onClub = (state: GcImportState) =>
  state.games.find((game) => game.teamAId === namer.id && game.date === "2026-09-15")!.teamBId;

describe("a name read as the one pulled club of it near the namer", () => {
  it("files the row onto the club though its schedule has no game that day, and leaves it there", () => {
    const filed = refileStandIns(pool());
    expect(filed.refiled).toBe(1);
    expect(onClub(filed.state)).toBe("BOMB");
    expect(filed.state.teams.some((team) => team.id === named.id)).toBe(false);
    expect(resettleOffLevel(filed.state).resettled).toBe(0);
    const tidied = tidyPool(pool());
    expect(onClub(tidied.state)).toBe("BOMB");
    expect(tidyChangedAnything(tidyPool(tidied.state))).toBe(false);
  });

  it("was left on a stand-in by the rules of 27 October", () => {
    expect(refileStandIns(pool(), undefined, IN_STATE_TIDY_RULES).refiled).toBe(0);
  });

  it("reads a club across a border, and a puller of no known state", () => {
    expect(onClub(refileStandIns(pool(bombers("OH"))).state)).toBe("BOMB");
    const stateless = pool(bombers("KY"), {});
    const unknown = {
      ...stateless,
      teams: stateless.teams.map((t) => (t.id === namer.id ? { ...t, state: undefined } : t)),
    };
    expect(onClub(refileStandIns(unknown).state)).toBe("BOMB");
  });

  it("reads a club far off only where the two clubs' own schedules meet", () => {
    expect(refileStandIns(pool(bombers("FL"))).refiled).toBe(0);
    // Both have played the Aces, by both sides' own schedules.
    const aces = pulled("ACES", "Atlanta Aces", "GA");
    const met = (club: ScoutTeam, date: string) => ({
      ...row(club, aces.id, date),
      alsoFrom: [aces.gcTeams![0]!.teamId],
    });
    const far = bombers("FL");
    const backed = pool(far, {
      teams: [aces],
      games: [met(namer, "2026-09-05"), met(far, "2026-09-06")],
    });
    const filed = refileStandIns(backed);
    expect(onClub(filed.state)).toBe("BOMB");
    expect(resettleOffLevel(filed.state).resettled).toBe(0);
    expect(tidyChangedAnything(tidyPool(tidyPool(backed).state))).toBe(false);
  });

  it("reads no club where two of the name are near", () => {
    const twin = {
      ...bombers("OH"),
      id: "BOMB2",
      gcTeams: [{ ...bombers("OH").gcTeams![0]!, teamId: "gcBOMB2" }],
    };
    expect(refileStandIns(pool(bombers("KY"), { teams: [twin] })).refiled).toBe(0);
  });

  it("reads a name spelled near the club's, where none is spelled as it", () => {
    const stars = pulled("STARS", "St. Louis Stars", "MO");
    const loose = standIn("S-STARS", "Saint Louis Stars Baseball");
    const state: GcImportState = {
      ageGroups: groups,
      teams: [namer, other, stars, loose, someone],
      games: [row(namer, loose.id, "2026-09-15"), row(stars, someone.id, "2026-09-20")],
    };
    const filed = refileStandIns(state);
    expect(filed.state.games[0]!.teamBId).toBe("STARS");
    expect(resettleOffLevel(filed.state).resettled).toBe(0);
  });

  it("reads a club within two levels of the row, and none further", () => {
    expect(onClub(refileStandIns(pool(bombers("KY", "ag12", 12))).state)).toBe("BOMB");
    expect(refileStandIns(pool(bombers("KY", "ag13", 13))).refiled).toBe(0);
  });

  it("reads no club two levels from a level typed into the name, as the resettle would not", () => {
    // Typed 11, a level from the club's 12: filed. Typed 12, two from its 10: the resettle would
    // take it off again (`twoOff`), so it is never filed.
    expect(
      refileStandIns(pool(bombers("KY", "ag12", 12), { named: { ageLevelB: 11 } })).refiled
    ).toBe(1);
    expect(refileStandIns(pool(bombers("KY"), { named: { ageLevelB: 12 } })).refiled).toBe(0);
  });

  it("reads no club with a game of its own at that hour, nor before its season", () => {
    // A puller of no known state, which only this rule reads, against a club playing another club
    // at that hour on the day.
    const stateless = { ...namer, state: undefined };
    const club = bombers("KY");
    const busy: GcImportState = {
      ageGroups: groups,
      teams: [stateless, other, club, named],
      games: [
        row(stateless, named.id, "2026-09-20"),
        row(club, other.id, "2026-09-20", { startTs: "2026-09-20T14:30:00.000Z" }),
      ],
    };
    expect(refileStandIns(busy).refiled).toBe(0);
    // A month before its own first game of the year.
    expect(
      refileStandIns(
        pool(club, { named: { date: "2026-08-15", startTs: "2026-08-15T14:00:00.000Z" } })
      ).refiled
    ).toBe(0);
  });

  it("files nothing the owner has said the club's name is not, on that schedule", () => {
    const refused = new Set([refusalOf(namer.gcTeams![0]!.teamId, "Bluegrass Bombers", "gcBOMB")]);
    expect(refileStandIns(pool(), refused).refiled).toBe(0);
    // Nor a club spelled near the name, where the owner has said the club's own name is not it,
    // which the resettle reads off the club once the row is on it.
    const stars = pulled("STARS", "St. Louis Stars", "MO");
    const loose = standIn("S-STARS", "Saint Louis Stars Baseball");
    const state: GcImportState = {
      ageGroups: groups,
      teams: [namer, other, stars, loose, someone],
      games: [row(namer, loose.id, "2026-09-15"), row(stars, someone.id, "2026-09-20")],
    };
    const notStars = new Set([refusalOf(namer.gcTeams![0]!.teamId, "St. Louis Stars", "gcSTARS")]);
    expect(refileStandIns(state, notStars).refiled).toBe(0);
  });
});
