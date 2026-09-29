import { describe, expect, it } from "vitest";
import {
  refileStandIns,
  resettleOffLevel,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
} from "../gameChangerImport";
import { mergeScoutTeams, type AgeGroup, type ScoutGame, type ScoutTeam } from "../teamRankings";

/*
 * A name no other club carries, on a day its one club's own schedule has no game yet: the three
 * entries of "513 Force - Bouley" the user found on 29 September 2026. The club's own schedule had
 * one game, on 25 September; a Kentucky club's and an Ohio club's schedules each named it for a
 * game in October, and both rows sat on stand-ins of the name.
 */
const groups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
  { id: "ag12", name: "12U 2026", seasonIds: [], ageLevel: 12, year: 2026 },
];

/** Letters only, so no name reads as an age: 0 → "a", 26 → "ba". */
const letters = (n: number): string => {
  let out = "";
  let left = n;
  do {
    out = String.fromCharCode(97 + (left % 26)) + out;
    left = Math.floor(left / 26);
  } while (left > 0);
  return out;
};

/**
 * Pulled clubs enough, each under a name of its own, for a word in one name to be rare among them
 * (`RARE_WORD_AMONG`): a nationwide pool. In a club's own pool of a few dozen names every word is
 * in one name, and the rule has nothing to go on.
 */
const nationwide: ScoutTeam[] = Array.from({ length: 18_000 }, (_, n) => ({
  id: `S-N${n}`,
  name: `${letters(n)}ton Squad`,
  state: "TX",
  gcTeams: [
    {
      teamId: `gcN${String(n).padStart(9, "0")}`,
      name: `${letters(n)}ton Squad 12U`,
      ageGroupId: "ag12",
      ageLevel: 12,
    },
  ],
}));

const pulled = (id: string, name: string, state: string | undefined, gcId: string): ScoutTeam => ({
  id,
  name,
  ...(state ? { state } : {}),
  gcTeams: [{ teamId: gcId, name, ageGroupId: "ag9", ageLevel: 9 }],
});

const force = {
  ...pulled("S-FORCE", "513 FORCE - BOULEY", "OH", "gcFORCE00001"),
  city: "Cincinnati",
};
const trace = pulled("S-KY", "Trace Blue", "KY", "gcTRACE00001");
const yeager = pulled("S-OH", "Yeager Gold", "OH", "gcYEAGER0001");
const flames: ScoutTeam = { id: "S-FLAMES", name: "Cincy Flames", nameOnly: true };
const namedFromKy: ScoutTeam = { id: "S-513F12", name: "513 Force - Bouley", nameOnly: true };
const namedFromOh: ScoutTeam = { id: "S-513F13", name: "513 Force - Bouley", nameOnly: true };

/** A row of `club`'s own schedule against `against` on `date`. */
const row = (
  club: ScoutTeam,
  against: string,
  date: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => {
  const gcId = club.gcTeams![0]!.teamId;
  return {
    id: `gc_${gcId}_${date}`,
    teamAId: club.id,
    teamBId: against,
    ageGroupId: "ag9",
    date,
    source: { kind: "gamechanger", teamId: gcId, gameId: date },
    ...extra,
  };
};

/** The Force's own one game, 7-3 over a club nobody pulled. */
const ownGame = row(force, flames.id, "2026-09-25", { teamAScore: 7, teamBScore: 3 });
const fromKy = row(trace, namedFromKy.id, "2026-10-02");
const fromOh = row(yeager, namedFromOh.id, "2026-10-16");

const bouley = (games: ScoutGame[], teams: ScoutTeam[] = []): GcImportState => ({
  ageGroups: groups,
  teams: [...nationwide, force, trace, yeager, flames, namedFromKy, namedFromOh, ...teams],
  games: [ownGame, ...games],
});

const against = (state: GcImportState, id: string): string | undefined =>
  state.games.find((game) => game.id === id)?.teamBId;

describe("a stand-in of a name no other club carries", () => {
  it("is filed onto its one club, though its own schedule has no game that day", () => {
    const { state, refiled } = refileStandIns(bouley([fromKy, fromOh]));
    expect(refiled).toBe(2);
    expect(against(state, fromKy.id)).toBe(force.id);
    expect(against(state, fromOh.id)).toBe(force.id);
    // The stand-ins it emptied go, so a search finds the club once.
    expect(state.teams.some((team) => team.id === namedFromKy.id)).toBe(false);
    expect(state.teams.some((team) => team.id === namedFromOh.id)).toBe(false);
  });

  it("is left there by the step that takes a name's rows off a club with no game that day", () => {
    const { state } = refileStandIns(bouley([fromKy, fromOh]));
    expect(resettleOffLevel(state).resettled).toBe(0);
    // And a row the import filed on the club by the name is left on it too.
    const filed = bouley([{ ...fromKy, teamBId: force.id }]);
    expect(resettleOffLevel(filed).resettled).toBe(0);
  });

  it("stays filed through a whole tidy, and a second tidy changes nothing", () => {
    const first = tidyPool(bouley([fromKy, fromOh]));
    expect(against(first.state, fromKy.id)).toBe(force.id);
    expect(against(first.state, fromOh.id)).toBe(force.id);
    expect(tidyChangedAnything(tidyPool(first.state))).toBe(false);
  });

  it("stays a stand-in in a pool too small for a word to be rare", () => {
    const small: GcImportState = {
      ...bouley([fromKy, fromOh]),
      teams: [force, trace, yeager, flames, namedFromKy, namedFromOh],
    };
    expect(refileStandIns(small).refiled).toBe(0);
  });

  it("stays a stand-in when each word of the name is in another club's name", () => {
    // Any one word no other name has is enough: "513", "force" and "bouley" must each be shared.
    const shared = [
      pulled("S-513", "513 Bombers", "FL", "gc513BOMB001"),
      pulled("S-FORCEACAD", "Force Academy", "FL", "gcFORCEACAD1"),
    ];
    const bouleyBombers = pulled("S-BOMB", "Bouley Bombers", "FL", "gcBOMBERS001");
    expect(refileStandIns(bouley([fromKy], shared)).refiled).toBe(1);
    expect(refileStandIns(bouley([fromKy], [...shared, bouleyBombers])).refiled).toBe(0);
  });

  it("stays a stand-in when two pulled clubs carry the name at that age, anywhere", () => {
    const texan = pulled("S-FORCETX", "513 Force - Bouley", "TX", "gcFORCETX001");
    expect(refileStandIns(bouley([fromKy], [texan])).refiled).toBe(0);
  });

  it("is filed onto the other squad of a puller that carries the name itself", () => {
    // The Force's own other squad at the same age, naming the Force: never filed as playing itself.
    const sibling = pulled("S-FORCE2", "513 FORCE - BOULEY", "OH", "gcFORCE00002");
    const named = row(sibling, namedFromOh.id, "2026-10-09");
    const { state } = refileStandIns(bouley([named], [sibling]));
    expect(against(state, named.id)).toBe(force.id);
  });

  it("stays a stand-in when the club is neither in the namer's state nor next door", () => {
    const texan = pulled("S-TX", "Katy Blue", "TX", "gcKATY000001");
    const named = row(texan, namedFromKy.id, "2026-10-02");
    expect(refileStandIns(bouley([named], [texan])).refiled).toBe(0);
    // And a row the import filed on the club by name from there goes back to a stand-in, as the
    // refile would not file it: from Ontario, which no border of Ohio's is, and which the rule for
    // clubs regions apart does not read as far (`farApart`).
    const ontario = pulled("S-ON", "Windsor Stars", "ON", "gcWINDSOR001");
    const filed = row(ontario, force.id, "2026-10-02");
    expect(resettleOffLevel(bouley([filed], [ontario])).resettled).toBe(1);
  });

  it("stays a stand-in where the club, or its namer, has no state", () => {
    const stateless = { ...force, state: undefined };
    const pool = bouley([fromKy]);
    expect(
      refileStandIns({
        ...pool,
        teams: pool.teams.map((team) => (team.id === force.id ? stateless : team)),
      }).refiled
    ).toBe(0);
    // A row the import filed on the club, from a namer of no state, goes back to a stand-in.
    const unplaced = { ...trace, state: undefined };
    const filed = bouley([{ ...fromKy, teamBId: force.id }]);
    expect(
      resettleOffLevel({
        ...filed,
        teams: filed.teams.map((team) => (team.id === trace.id ? unplaced : team)),
      }).resettled
    ).toBe(1);
  });

  it("stays a stand-in more than a week before the club's own first game of the year", () => {
    // The Force's first game of its own is on 25 September: a name a week before that is its.
    const weekBefore = row(trace, namedFromKy.id, "2026-09-18");
    expect(against(refileStandIns(bouley([weekBefore])).state, weekBefore.id)).toBe(force.id);
    const eightDays = row(trace, namedFromKy.id, "2026-09-17");
    expect(refileStandIns(bouley([eightDays])).refiled).toBe(0);
  });

  it("stays a stand-in when the row has no day", () => {
    const { date: _date, ...undated } = fromKy;
    expect(refileStandIns(bouley([undated])).refiled).toBe(0);
  });

  it("stays a stand-in when the name reads as a weekend's rather than a club's", () => {
    const event = pulled("S-MIAMI", "Miami Bulldogs Tournament", "KY", "gcMIAMI00001");
    const slot: ScoutTeam = { id: "S-MIAMI2", name: "Miami Bulldogs Tournament", nameOnly: true };
    const named = row(trace, slot.id, "2026-10-02");
    const own = row(event, flames.id, "2026-09-25");
    expect(refileStandIns(bouley([named, own], [event, slot])).refiled).toBe(0);
  });
});

/*
 * "Eagles" is not a name, it is a hundred clubs: the user said on 29 September 2026 that the vague
 * Eagles can't be combined, however few pulled clubs of the name there are at an age.
 */
describe("a stand-in of a name other clubs' names share a word of", () => {
  const eagles = pulled("S-EAGL", "Eagles", "KY", "gcEAGLESKY01");
  const lakeEagles = { ...pulled("S-LAKE", "Lake Eagles", "FL", "gcLAKEEAGL01") };
  const standIn: ScoutTeam = { id: "S-EAGL2", name: "Eagles", nameOnly: true };
  const theirs = row(eagles, flames.id, "2026-09-25");
  const named = row(yeager, standIn.id, "2026-10-02");
  const pool = (teams: ScoutTeam[]): GcImportState => ({
    ageGroups: groups,
    teams: [...nationwide, eagles, yeager, flames, standIn, ...teams],
    games: [theirs, named],
  });

  it("stays a stand-in, and a row the import filed on the club is taken off it", () => {
    expect(refileStandIns(pool([lakeEagles])).refiled).toBe(0);
    const filed = { ...pool([lakeEagles]), games: [theirs, { ...named, teamBId: eagles.id }] };
    expect(resettleOffLevel(filed).resettled).toBe(1);
  });

  it("is filed when no other pulled club's name has the word, which is what a rare word is", () => {
    expect(refileStandIns(pool([])).refiled).toBe(1);
  });
});

/*
 * "Same team as" on a stand-in: the user naming the club, which the tidy must not undo. On the
 * pool of 29 September 2026 a stand-in folded into its pulled club went back to a stand-in at the
 * next tidy, the club's own schedule having no game that day. In a small pool, so that no rule of
 * names could be what keeps the rows there.
 */
describe("a stand-in folded into a pulled club by hand", () => {
  const eagles = pulled("S-EAGL", "Eagles", "KY", "gcEAGLESKY01");
  const standIn: ScoutTeam = { id: "S-EAGL2", name: "Eagles", nameOnly: true };
  const theirs = row(eagles, flames.id, "2026-09-25");
  const named = row(yeager, standIn.id, "2026-10-02");
  const pool: GcImportState = {
    ageGroups: groups,
    teams: [eagles, yeager, flames, standIn],
    games: [theirs, named],
  };

  it("leaves the stand-in's rows on the club at every tidy after", () => {
    const folded = mergeScoutTeams(standIn.id, eagles.id, pool.teams, pool.games, groups);
    expect(folded.games.find((game) => game.id === named.id)).toMatchObject({
      teamBId: eagles.id,
      namedByAvatar: eagles.id,
    });
    const tidied = tidyPool({ ...pool, teams: folded.teams, games: folded.games });
    expect(against(tidied.state, named.id)).toBe(eagles.id);
    expect(tidyChangedAnything(tidyPool(tidied.state))).toBe(false);
  });

  it("where the name alone would have put the row back on a stand-in", () => {
    const filed = { ...pool, games: [theirs, { ...named, teamBId: eagles.id }] };
    expect(resettleOffLevel(filed).resettled).toBe(1);
  });
});
