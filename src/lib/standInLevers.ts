import { inOneRegion } from "./stateBorders";
import { looseNameWords, standInReport, type StandInWhy } from "./standInReport";
import { ageGroupLevel } from "./teamRankings/seasons";
import { teamNameKey } from "./teamRankings/names";
import {
  ageGroupYear,
  type AgeGroup,
  type RatedScoutGame,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";

/*
 * What the year's share of games on a stand-in is made of, and how far each lever would take it
 * (research, which nothing in the app reads): the owner's target of 27 October 2026, "I need stand
 * in games at or below 15%", against 32.1% that day. A game is on a stand-in when either side is a
 * club known only by name (`nameOnly`) or a bracket slot (`placeholder`). Each such game is counted
 * once, by:
 * - what its stand-in side is: a slot, or a name;
 * - how many games of the year that name holds: a name one coach typed once says almost nothing of
 *   the club that played it, since a stand-in counts only as far as its own record goes;
 * - why the name is not a pulled club's (`StandInWhy`, from `standInReport`): one pulled club of the
 *   name on its page, in the namers' state or another, several, a near spelling, only on another
 *   page, or nothing of the name at all.
 * A game with two stand-in sides is counted by the side holding fewer games.
 */
export type GameCount = "1" | "2" | "3-4" | "5-9" | "10+";
export const GAME_COUNTS: readonly GameCount[] = ["1", "2", "3-4", "5-9", "10+"];
const countOf = (games: number): GameCount =>
  games <= 1 ? "1" : games === 2 ? "2" : games <= 4 ? "3-4" : games <= 9 ? "5-9" : "10+";

export type StandInBreakdown = {
  games: number;
  /** Games with a stand-in or a slot on a side. */
  onStandIn: number;
  /** Of those, games whose stand-in side is a slot (and no name). */
  slots: number;
  /** Of those on a name, by how many games the name holds, and by why it is not a pulled club. */
  byCount: Record<GameCount, number>;
  byWhy: Partial<Record<StandInWhy, number>>;
  /** By why, only the games whose name holds one game. */
  oneOffByWhy: Partial<Record<StandInWhy, number>>;
  /** Both at once, for any lever's sum. */
  byCountWhy: Record<GameCount, Partial<Record<StandInWhy, number>>>;
};

export const standInBreakdown = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  ageGroups: readonly AgeGroup[],
  year: number,
  /** Why each club known only by name is not a pulled club's (`standInReport`'s clubs). */
  whyOf: (teamId: string) => StandInWhy | undefined
): StandInBreakdown => {
  const yearPages = new Set(
    ageGroups.filter((group) => ageGroupYear(group) === year).map((group) => group.id)
  );
  const byId = new Map(teams.map((team) => [team.id, team]));
  const yearGames = games.filter((game) => yearPages.has(game.ageGroupId));
  const held = new Map<string, number>();
  yearGames.forEach((game) =>
    [game.teamAId, game.teamBId].forEach((id) => {
      if (byId.get(id)?.nameOnly) held.set(id, (held.get(id) ?? 0) + 1);
    })
  );
  const breakdown: StandInBreakdown = {
    games: yearGames.length,
    onStandIn: 0,
    slots: 0,
    byCount: { "1": 0, "2": 0, "3-4": 0, "5-9": 0, "10+": 0 },
    byWhy: {},
    oneOffByWhy: {},
    byCountWhy: { "1": {}, "2": {}, "3-4": {}, "5-9": {}, "10+": {} },
  };
  for (const game of yearGames) {
    const sides = [game.teamAId, game.teamBId].map((id) => byId.get(id));
    const names = sides.filter(
      (team): team is ScoutTeam => team?.nameOnly === true && !team.gcTeams?.length
    );
    const slot = sides.some((team) => team?.placeholder === true && !team.gcTeams?.length);
    if (names.length === 0 && !slot) continue;
    breakdown.onStandIn += 1;
    if (names.length === 0) {
      breakdown.slots += 1;
      continue;
    }
    const side = names.reduce((fewest, team) =>
      (held.get(team.id) ?? 0) < (held.get(fewest.id) ?? 0) ? team : fewest
    );
    const count = countOf(held.get(side.id) ?? 0);
    breakdown.byCount[count] += 1;
    const why = whyOf(side.id);
    if (why) {
      breakdown.byWhy[why] = (breakdown.byWhy[why] ?? 0) + 1;
      if (count === "1") breakdown.oneOffByWhy[why] = (breakdown.oneOffByWhy[why] ?? 0) + 1;
      const cell = breakdown.byCountWhy[count];
      cell[why] = (cell[why] ?? 0) + 1;
    }
  }
  return breakdown;
};

/**
 * The games of names holding few games, which a lever might leave out of the pool: every game whose
 * every stand-in side is a name holding no more than `most` games of those given (one: a name one
 * coach typed once). A game with a slot is left in, since the slot is another question.
 */
export const oneOffGames = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  most = 1
): Set<string> => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const held = new Map<string, number>();
  games.forEach((game) =>
    [game.teamAId, game.teamBId].forEach((id) => {
      if (byId.get(id)?.nameOnly) held.set(id, (held.get(id) ?? 0) + 1);
    })
  );
  const isName = (id: string) => {
    const team = byId.get(id);
    return team?.nameOnly === true && !team.gcTeams?.length;
  };
  const isSlot = (id: string) => {
    const team = byId.get(id);
    return team?.placeholder === true && !team.gcTeams?.length;
  };
  const out = new Set<string>();
  games.forEach((game) => {
    const sides = [game.teamAId, game.teamBId];
    if (sides.some(isSlot)) return;
    const names = sides.filter(isName);
    if (names.length > 0 && names.every((id) => (held.get(id) ?? 0) <= most)) out.add(game.id);
  });
  return out;
};

/** How far one board's places moved on another's: what leaving games out would do to the lists. */
export type BoardShift = {
  /** Clubs on both boards. */
  compared: number;
  /** Of the first board's top places, how many the second keeps in its top as many. */
  topKept: number;
  top: number;
  /** The middle club's move, in places, and how many moved more than a tenth of the board. */
  medianMove: number;
  movedTenth: number;
};

export const boardShift = (
  before: ReadonlyArray<{ teamId: string; rank: number }>,
  after: ReadonlyArray<{ teamId: string; rank: number }>,
  top = 25
): BoardShift => {
  const placed = new Map(after.map((row) => [row.teamId, row.rank]));
  const moves: number[] = [];
  before.forEach((row) => {
    const now = placed.get(row.teamId);
    if (now !== undefined) moves.push(Math.abs(now - row.rank));
  });
  moves.sort((a, b) => a - b);
  const topBefore = new Set(before.filter((row) => row.rank <= top).map((row) => row.teamId));
  const tenth = before.length / 10;
  return {
    compared: moves.length,
    topKept: after.filter((row) => row.rank <= top && topBefore.has(row.teamId)).length,
    top: topBefore.size,
    medianMove: moves.length === 0 ? 0 : moves[Math.floor((moves.length - 1) / 2)]!,
    movedTenth: moves.filter((move) => move > tenth).length,
  };
};

/**
 * A lever as the model sweep tries it (`ModelVariant.leaveOut`): the games of names holding no more
 * than `most` of the games trained so far, and, with `slots`, every game against a bracket slot
 * nobody resolved, left out of what the fit is trained on.
 */
export const leaveOutStandIns =
  (most: number, slots: boolean) =>
  (teams: readonly ScoutTeam[], trained: readonly RatedScoutGame[]): ReadonlySet<string> => {
    const games = trained.map(({ game }) => game);
    const out = most > 0 ? oneOffGames(teams, games, most) : new Set<string>();
    if (slots) {
      const byId = new Map(teams.map((team) => [team.id, team]));
      const isSlot = (id: string) => {
        const team = byId.get(id);
        return team?.placeholder === true && !team.gcTeams?.length;
      };
      games.forEach((game) => {
        if (isSlot(game.teamAId) || isSlot(game.teamBId)) out.add(game.id);
      });
    }
    return out;
  };

/**
 * How far the namesake levers reach, each taking in the one before: `one`, the one pulled club of
 * the name on a page the stand-in played on, in the namers' state or another; `near`, and where none
 * is of the name, the one spelled near it (`looseNameKey`); `elsewhere`, and where neither is on its
 * pages, the one pulled club of the name in the year on a page within two levels of one it played on
 * (`PLAYS_UP_TO`), since a club plays up.
 */
export type NamesakeReach = "one" | "near" | "elsewhere";
const LEVELS_APART = 2;

/**
 * Each club known only by name, filed onto the pulled club its name points to as far as `reach`
 * goes (`ModelVariant.refile`), from why `standInReport` says it was not. Nothing here says the
 * filing is right: a name is often a club nobody pulled that shares a pulled club's name, which is
 * why the import asks for a game the namesake played that day. The sweep reads whether boards
 * trained on the filing forecast later games better than the boards as they are.
 */
export const namesakeFilings = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  ageGroups: readonly AgeGroup[],
  year: number,
  reach: NamesakeReach
): Map<string, string> => {
  const report = standInReport(teams, games, ageGroups, year, Number.MAX_SAFE_INTEGER);
  const onto = new Map<string, string>();
  const whys: StandInWhy[] =
    reach === "one"
      ? ["oneSameState", "oneOtherState"]
      : ["oneSameState", "oneOtherState", "nearOne"];
  whys.forEach((why) =>
    report.topWhy[why].forEach((club) => {
      if (club.candidate) onto.set(club.teamId, club.candidate.teamId);
    })
  );
  if (reach !== "elsewhere") return onto;

  const yearPages = new Map(
    ageGroups
      .filter((group) => ageGroupYear(group) === year)
      .map((group) => [group.id, ageGroupLevel(group)] as const)
  );
  const byId = new Map(teams.map((team) => [team.id, team]));
  const levelsOf = new Map<string, Set<number>>();
  games.forEach((game) => {
    const level = yearPages.get(game.ageGroupId);
    if (level === undefined) return;
    [game.teamAId, game.teamBId].forEach((id) => {
      const levels = levelsOf.get(id) ?? new Set<number>();
      levels.add(level);
      levelsOf.set(id, levels);
    });
  });
  const pulledByName = new Map<string, string[]>();
  levelsOf.forEach((_, id) => {
    const team = byId.get(id);
    if (!team || team.nameOnly || team.placeholder) return;
    const key = teamNameKey(team.name);
    pulledByName.set(key, [...(pulledByName.get(key) ?? []), id]);
  });
  const near = (a: ReadonlySet<number>, b: ReadonlySet<number>) =>
    [...a].some((one) => [...b].some((other) => Math.abs(one - other) <= LEVELS_APART));
  report.topWhy.elsewhere.forEach((club) => {
    const own = levelsOf.get(club.teamId) ?? new Set<number>();
    const within = (pulledByName.get(teamNameKey(club.name)) ?? []).filter((id) =>
      near(own, levelsOf.get(id) ?? new Set<number>())
    );
    if (within.length === 1) onto.set(club.teamId, within[0]!);
  });
  return onto;
};

/**
 * Words a schedule adds to a club's name for the season or its year, which say nothing of which club
 * it is: "Sheridan Yellowjacket Fall 2026" is the Sheridan Yellowjacket pulled from GameChanger.
 * (Age labels are already off, `teamNameKey`.)
 */
const SEASON_WORD = /^(?:fall|spring|summer|winter|(?:fall|spring|summer|winter|f|s)?\d{2}|\d{4})$/;
/** Shortenings a schedule writes for a word a club's own name spells out. */
const SPELLED_OUT: Record<string, string> = { mt: "mount", ft: "fort", co: "county" };

/** The words of a name that say which club it is: read loosely, the season off, shortenings spelled out. */
export const coreNameWords = (name: string): Set<string> =>
  new Set(
    looseNameWords(name)
      .filter((word) => !SEASON_WORD.test(word))
      .map((word) => SPELLED_OUT[word] ?? word)
  );

/** How telling the words two names share must be together: about one name in a thousand's. */
export const TELLING_WEIGHT = Math.log(1000);

/**
 * The owner, 28 October 2026: "They are not private on gamechanger. You just aren't matching them
 * appropriately." Laid out by eye, the rows against stand-ins with nothing of their name pulled
 * held names a pulled club's own name sits inside, or that sit inside it: "Sheridan Yellowjacket
 * Fall 2026" and "Sheridan Yellowjacket" (both Arkansas), "Mason Coach Pitch Devine" and "Mason
 * Devine" (both Michigan), "Ghost Valley Dawgs" and "Ghost Valley Dawgs Black" (both Pennsylvania),
 * "Texas Prodigy" and "Prodigy Baseball Texas" — and the club's own schedule, mostly, with no game
 * that day, which is why no step that asks for one ever paired them.
 *
 * So each club known only by name that `filed` leaves, filed onto the one pulled club of the year
 * whose name's words (`coreNameWords`) hold all of its own or are all held in them, the words they
 * share telling together (`TELLING_WEIGHT`, each word weighed by how few pulled clubs' names hold
 * it, so "Hawks" alone never decides), listed within two levels of a page the name played on, never
 * one of the clubs that named it, and, with `region`, in a state of a club that named it or one
 * bordering it, or of no known state. Two such clubs is a guess, and nothing is filed.
 */
export const wordFilings = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  ageGroups: readonly AgeGroup[],
  year: number,
  filed: ReadonlyMap<string, string>,
  region: boolean
): Map<string, string> => {
  const yearPages = new Map(
    ageGroups
      .filter((group) => ageGroupYear(group) === year)
      .map((group) => [group.id, ageGroupLevel(group)] as const)
  );
  const byId = new Map(teams.map((team) => [team.id, team]));
  // The year's pulled clubs, every one listed on a page of the year whether or not it has a game
  // here: a club whose own schedule is empty is still the club a name may mean.
  const clubs = new Map<string, { words: Set<string>; levels: Set<number> }>();
  const holding = new Map<string, number>();
  const byWord = new Map<string, string[]>();
  teams.forEach((team) => {
    if (!team.gcTeams?.length || team.nameOnly || team.placeholder) return;
    const levels = new Set<number>();
    team.gcTeams.forEach((link) => {
      if (!yearPages.has(link.ageGroupId)) return;
      const level = link.ageLevel ?? yearPages.get(link.ageGroupId);
      if (level !== undefined) levels.add(level);
    });
    if (levels.size === 0) return;
    const words = coreNameWords(team.name);
    if (words.size === 0) return;
    clubs.set(team.id, { words, levels });
    words.forEach((word) => {
      holding.set(word, (holding.get(word) ?? 0) + 1);
      const ids = byWord.get(word);
      if (ids) ids.push(team.id);
      else byWord.set(word, [team.id]);
    });
  });
  const weight = (word: string) => Math.log(clubs.size / Math.max(1, holding.get(word) ?? 1));
  const byRarity = (words: Iterable<string>) =>
    [...words].sort((a, b) => (holding.get(a) ?? 0) - (holding.get(b) ?? 0) || a.localeCompare(b));
  // Each club once more, under its rarest word: a club whose words a name holds whole is under one
  // of the name's words here, which keeps the search to a few clubs a name.
  const byRarest = new Map<string, string[]>();
  clubs.forEach(({ words }, clubId) => {
    const rarest = byRarity(words)[0]!;
    const ids = byRarest.get(rarest);
    if (ids) ids.push(clubId);
    else byRarest.set(rarest, [clubId]);
  });

  // Each stand-in's levels in the year, and the clubs and states that named it.
  const levelsOf = new Map<string, Set<number>>();
  const namers = new Map<string, Set<string>>();
  games.forEach((game) => {
    const level = yearPages.get(game.ageGroupId);
    if (!yearPages.has(game.ageGroupId)) return;
    for (const [side, other] of [
      [game.teamAId, game.teamBId],
      [game.teamBId, game.teamAId],
    ] as const) {
      const team = byId.get(side);
      if (!team?.nameOnly || team.placeholder || team.gcTeams?.length || filed.has(side)) continue;
      const levels = levelsOf.get(side) ?? new Set<number>();
      if (level !== undefined) levels.add(level);
      levelsOf.set(side, levels);
      if (byId.get(other)?.gcTeams?.length) {
        const by = namers.get(side) ?? new Set<string>();
        by.add(other);
        namers.set(side, by);
      }
    }
  });

  const onto = new Map<string, string>();
  levelsOf.forEach((levels, standInId) => {
    const words = coreNameWords(byId.get(standInId)?.name ?? "");
    if (words.size === 0) return;
    // Every club the name could mean holds its rarest word, or is held in it whole and so filed
    // under one of its words as that club's rarest.
    const seen = new Set<string>(byWord.get(byRarity(words)[0]!) ?? []);
    words.forEach((word) => (byRarest.get(word) ?? []).forEach((clubId) => seen.add(clubId)));
    const named = namers.get(standInId) ?? new Set<string>();
    const states = new Set(
      [...named].map((id) => byId.get(id)?.state).filter((state): state is string => !!state)
    );
    const fits = [...seen].filter((clubId) => {
      if (named.has(clubId)) return false;
      const club = clubs.get(clubId)!;
      const inside = [...words].every((word) => club.words.has(word));
      const holds = [...club.words].every((word) => words.has(word));
      if (!inside && !holds) return false;
      const shared = inside ? words : club.words;
      if ([...shared].reduce((sum, word) => sum + weight(word), 0) < TELLING_WEIGHT) return false;
      const near = [...club.levels].some((at) =>
        [...levels].some((level) => Math.abs(at - level) <= LEVELS_APART)
      );
      if (levels.size > 0 && !near) return false;
      if (!region) return true;
      const state = byId.get(clubId)?.state;
      return !state || states.size === 0 || [...states].some((one) => inOneRegion(one, state));
    });
    if (fits.length === 1) onto.set(standInId, fits[0]!);
  });
  return onto;
};
