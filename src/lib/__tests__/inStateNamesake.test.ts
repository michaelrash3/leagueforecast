import { describe, expect, it } from "vitest";
import {
  DAY_CHECK_TIDY_RULES,
  refileStandIns,
  resettleOffLevel,
  tidyChangedAnything,
  tidyPool,
  type GcImportState,
  type TidyRules,
} from "../gameChangerImport";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";
import { blastRadius, poolYears } from "../cloud/blastRadius";

/*
 * The one pulled club of a name in the namer's own state, on a day its own schedule skipped: the
 * second model sweep of 27 October 2026 found 7,540 clubs known only by name with one pulled club of
 * the name on their page in a state of the clubs naming them. Choctaw Mudcats of Oklahoma keeps one
 * game on its own GameChanger schedule; two Oklahoma clubs' schedules name it for games it left off.
 */
const groups: AgeGroup[] = [
  { id: "ag9", name: "9U 2027", seasonIds: [], ageLevel: 9, year: 2027 },
  { id: "ag10", name: "10U 2027", seasonIds: [], ageLevel: 10, year: 2027 },
];

const pulled = (id: string, name: string, state: string, gcId: string, level = 9): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: gcId, name, ageGroupId: `ag${level}`, ageLevel: level }],
});

const mudcats = pulled("S-MUDC", "Choctaw Mudcats", "OK", "gcMUDCATS001");
const edmond = pulled("S-EDMO", "Edmond Heat", "OK", "gcEDMOND0001");
const norman = pulled("S-NORM", "Norman Storm", "OK", "gcNORMAN0001");
const plano = pulled("S-PLAN", "Plano Blue", "TX", "gcPLANO00001");
const tulsa = pulled("S-TULS", "Tulsa Drillers", "OK", "gcTULSA00001");
const nobody: ScoutTeam = { id: "S-NOBO", name: "Moore Stars", nameOnly: true };
const named: ScoutTeam = { id: "S-MUDC2", name: "Choctaw Mudcats", nameOnly: true };

/** A row of `club`'s own schedule against `against`, on `date` at `clock`. */
const row = (
  club: ScoutTeam,
  against: string,
  date: string,
  clock = "15:00",
  extra: Partial<ScoutGame> = {}
): ScoutGame => {
  const gcId = club.gcTeams![0]!.teamId;
  return {
    id: `gc_${gcId}_${date}_${clock}`,
    teamAId: club.id,
    teamBId: against,
    ageGroupId: "ag9",
    date,
    startTs: `${date}T${clock}:00.000Z`,
    source: { kind: "gamechanger", teamId: gcId, gameId: `${date}_${clock}` },
    ...extra,
  };
};

/** The Mudcats' own one game, 7-3 over a club nobody pulled. */
const ownGame = row(mudcats, nobody.id, "2026-09-05", "15:00", { teamAScore: 7, teamBScore: 3 });
const fromEdmond = row(edmond, named.id, "2026-09-12", "10:00", { teamAScore: 2, teamBScore: 9 });
const fromNorman = row(norman, named.id, "2026-09-19", "10:00", { teamAScore: 4, teamBScore: 5 });

const pool = (games: ScoutGame[], teams: ScoutTeam[] = []): GcImportState => ({
  ageGroups: groups,
  teams: [mudcats, edmond, norman, plano, tulsa, nobody, named, ...teams],
  games: [ownGame, ...games],
});

const against = (state: GcImportState, id: string): string | undefined =>
  state.games.find((game) => game.id === id)?.teamBId;

const IN_STATE: TidyRules = { inState: { rareAmong: 1, nearLevel: false, vouched: false } };
const NEAR: TidyRules = { inState: { rareAmong: 1, nearLevel: true, vouched: false } };

describe("a stand-in of the one pulled club of its name in the namer's state", () => {
  it("stays a stand-in under the day check, its club having no game of its own that day", () => {
    expect(
      refileStandIns(pool([fromEdmond, fromNorman]), undefined, DAY_CHECK_TIDY_RULES).refiled
    ).toBe(0);
  });

  it("is filed onto that club where the rules read it so", () => {
    const { state, refiled } = refileStandIns(pool([fromEdmond, fromNorman]), undefined, IN_STATE);
    expect(refiled).toBe(2);
    expect(against(state, fromEdmond.id)).toBe(mudcats.id);
    expect(against(state, fromNorman.id)).toBe(mudcats.id);
    // The stand-in it emptied goes, so a search finds the club once.
    expect(state.teams.some((team) => team.id === named.id)).toBe(false);
  });

  it("is left there by the step that takes a name's rows off a club with no game that day", () => {
    const { state } = refileStandIns(pool([fromEdmond, fromNorman]), undefined, IN_STATE);
    expect(resettleOffLevel(state, undefined, IN_STATE).resettled).toBe(0);
    // Under the day check the same step takes both off, which is why the two must agree.
    expect(resettleOffLevel(state, undefined, DAY_CHECK_TIDY_RULES).resettled).toBe(2);
  });

  it("stays filed through a whole tidy, and a second tidy changes nothing", () => {
    const first = tidyPool(
      pool([fromEdmond, fromNorman]),
      undefined,
      undefined,
      undefined,
      undefined,
      IN_STATE
    );
    expect(against(first.state, fromEdmond.id)).toBe(mudcats.id);
    expect(against(first.state, fromNorman.id)).toBe(mudcats.id);
    const second = tidyPool(first.state, undefined, undefined, undefined, undefined, IN_STATE);
    expect(tidyChangedAnything(second)).toBe(false);
  });

  it("leaves the nightly's cap no club taken away for the stand-in it retires (blastRadius.ts)", () => {
    // Tidy rules 33 retired stand-ins in bulk: counted as clubs taken away, they would have held
    // the night's save past the 2% line, every night after.
    const before = pool([fromEdmond, fromNorman]);
    const { state } = tidyPool(before, undefined, undefined, undefined, undefined, IN_STATE);
    expect(state.teams.some((team) => team.id === named.id)).toBe(false);
    expect(
      blastRadius(poolYears(before), {
        games: new Set(state.games.map((game) => game.id)),
        clubs: new Set(state.teams.map((team) => team.id)),
      })
    ).toEqual([{ year: 2027, games: 3, gamesRemoved: 0, clubs: 7, clubsRemoved: 0 }]);
  });

  it("stays a stand-in a level off where the club's own schedule has a game within the hour", () => {
    // A club with a game of its own that day is filed on by the rules as shipped; a level off is
    // where only this rule reads the name, and a game of the club's own at the hour says it is not.
    const tenU = pulled("S-MUDC", "Choctaw Mudcats", "OK", "gcMUDCATS001", 10);
    const atTen = (games: ScoutGame[]): GcImportState => ({
      ...pool([fromNorman, ...games]),
      teams: [tenU, edmond, norman, plano, tulsa, nobody, named],
    });
    const busy = { ...row(tenU, tulsa.id, "2026-09-19", "10:30"), ageGroupId: "ag10" };
    expect(refileStandIns(atTen([busy]), undefined, NEAR).refiled).toBe(0);
    // Two hours apart is a second game of the day, which a club plays.
    const later = { ...row(tenU, tulsa.id, "2026-09-19", "12:30"), ageGroupId: "ag10" };
    const { state } = refileStandIns(atTen([later]), undefined, NEAR);
    expect(against(state, fromNorman.id)).toBe(mudcats.id);
  });

  it("stays a stand-in when named from another state", () => {
    const fromPlano = row(plano, named.id, "2026-09-12");
    expect(refileStandIns(pool([fromPlano]), undefined, IN_STATE).refiled).toBe(0);
  });

  it("stays a stand-in when two pulled clubs of the name are in the state", () => {
    const second = pulled("S-MUDC3", "Choctaw Mudcats", "OK", "gcMUDCATS002");
    expect(refileStandIns(pool([fromEdmond], [second]), undefined, IN_STATE).refiled).toBe(0);
  });

  it("stays a stand-in more than a week before the club's own first game of the year", () => {
    const weekBefore = row(edmond, named.id, "2026-08-29");
    const both = refileStandIns(pool([weekBefore]), undefined, IN_STATE);
    expect(against(both.state, weekBefore.id)).toBe(mudcats.id);
    const eightDays = row(edmond, named.id, "2026-08-28");
    expect(refileStandIns(pool([eightDays]), undefined, IN_STATE).refiled).toBe(0);
  });

  it("is filed a level off only where the rules read a level either side", () => {
    const tenU = pulled("S-MUDC", "Choctaw Mudcats", "OK", "gcMUDCATS001", 10);
    const atTen = {
      ...pool([fromEdmond]),
      teams: [tenU, edmond, norman, plano, tulsa, nobody, named],
    };
    expect(refileStandIns(atTen, undefined, IN_STATE).refiled).toBe(0);
    const { state } = refileStandIns(atTen, undefined, NEAR);
    expect(against(state, fromEdmond.id)).toBe(mudcats.id);
    expect(resettleOffLevel(state, undefined, NEAR).resettled).toBe(0);
  });

  it("stays a stand-in where the name's every word is common and the rules ask for a rare one", () => {
    // Enough pulled names that one word in two of them is rare, one in 2,000 of them.
    const many = Array.from({ length: 4_000 }, (_, n) =>
      pulled(`S-X${n}`, `Squad ${n.toString(36)}x`, "FL", `gcX${String(n).padStart(9, "0")}`, 12)
    );
    const commonCats = Array.from({ length: 3 }, (_, n) =>
      pulled(`S-CAT${n}`, `Choctaw Cats ${n}x`, "FL", `gcCAT${String(n).padStart(7, "0")}`, 12)
    );
    const rare: TidyRules = { inState: { rareAmong: 2_000, nearLevel: false, vouched: false } };
    // "mudcats" is in one name of 4,000-odd: rare enough.
    expect(refileStandIns(pool([fromEdmond], many), undefined, rare).refiled).toBe(1);
    // With "choctaw" in four names and "mudcats" in three, neither is one in 2,000.
    const others = ["Blue", "Red"].map((color) =>
      pulled(`S-MUDC${color}`, `Mudcats ${color}`, "FL", `gcMUDC${color.padEnd(6, "0")}`, 12)
    );
    expect(
      refileStandIns(pool([fromEdmond], [...many, ...commonCats, ...others]), undefined, rare)
        .refiled
    ).toBe(0);
  });
});

/*
 * The rule as it ships asks the two clubs to be neighbours by their own schedules: the measurement
 * of 27 October 2026 found the name alone filing a rec league's "Angels" onto the one Angels pulled
 * in Texas, any of a dozen.
 */
describe("the rule as it ships", () => {
  const ownVsTulsa = row(mudcats, tulsa.id, "2026-09-06", "15:00", {
    teamAScore: 3,
    teamBScore: 2,
  });
  const edmondVsTulsa = row(edmond, tulsa.id, "2026-09-07", "15:00", {
    teamAScore: 1,
    teamBScore: 6,
  });

  it("files a name onto the club the namer shares an opponent with on their own schedules", () => {
    const { state } = refileStandIns(pool([fromEdmond, fromNorman, ownVsTulsa, edmondVsTulsa]));
    expect(against(state, fromEdmond.id)).toBe(mudcats.id);
    // The Storm have played nobody the Mudcats have, on either schedule.
    expect(against(state, fromNorman.id)).toBe(named.id);
    // And the resettle leaves it there. (It takes the two games against the Drillers off them,
    // which their own schedule does not hold, as the day check always has.)
    expect(against(resettleOffLevel(state).state, fromEdmond.id)).toBe(mudcats.id);
  });

  it("files it where the club's own schedule has played the namer, on another day", () => {
    const met = row(mudcats, norman.id, "2026-09-26", "15:00", { teamAScore: 6, teamBScore: 1 });
    const { state } = refileStandIns(pool([fromNorman, met]));
    expect(against(state, fromNorman.id)).toBe(mudcats.id);
  });

  it("leaves a name the namer alone vouches for: its own rows against the club say nothing", () => {
    // The Heat's schedule has the Mudcats twice, filed by name; nothing of the Mudcats' own has
    // the Heat or a club the Heat has played.
    const again = row(edmond, mudcats.id, "2026-09-20", "10:00", { teamAScore: 2, teamBScore: 9 });
    expect(refileStandIns(pool([fromEdmond, again])).refiled).toBe(0);
  });
});

/*
 * The owner, 27 October 2026: "When linking teams from Stand Ins. This should clear up all TBD
 * games as well." The Mudcats' own schedule posted the 19 September game as TBD at ten, scored; the
 * Norman Storm's schedule named the Mudcats at the same start with the score mirrored. The tidy as
 * shipped pairs the two already (the very name, mirrored within the hour); the rule leaves that so.
 */
describe("a TBD slot on the club's own schedule", () => {
  const slot: ScoutTeam = { id: "S-TBD", name: "TBD", placeholder: true };
  const tbd = row(mudcats, slot.id, "2026-09-19", "10:00", { teamAScore: 5, teamBScore: 4 });
  const onSlot = (state: GcImportState) =>
    state.games.some((game) => game.teamAId === slot.id || game.teamBId === slot.id);

  it("settles into the row naming the club, with the rule and without", () => {
    for (const rules of [undefined, IN_STATE]) {
      const { state } = tidyPool(
        pool([fromNorman, tbd], [slot]),
        undefined,
        undefined,
        undefined,
        undefined,
        rules
      );
      expect(onSlot(state)).toBe(false);
      expect(state.games.filter((game) => game.date === "2026-09-19")).toHaveLength(1);
    }
  });
});
