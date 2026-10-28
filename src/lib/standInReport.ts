import {
  ageGroupYear,
  isScoutGamePlayed,
  teamNameKey,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { looseNameKey, looseNameWords } from "./teamRankings/names";

export { looseNameKey, looseNameWords };

/*
 * The stand-ins of a squad year (the stand-ins plan's Part 3, measured rather than assumed): the
 * clubs a pool holds only because somebody else's schedule named them (`nameOnly`), or a bracket
 * slot (`placeholder`), and the games that lean on them. A stand-in stands in the fit as the
 * opponent it was, and is listed on no board; a game against one counts for the club that played
 * it only as far as the stand-in's own record, a fraction of a season, says.
 *
 * What is left once the nightly's tidy has run, which is the cloud copy as it is: the tidy already
 * folds every stand-in it can prove is a club. So the report asks what it could not: of the clubs
 * known only by name, how many share a name with a club pulled in the same year (a matching gap,
 * where a region or a picture might settle it), and how many have nothing of that name at all.
 */

/**
 * Why a club known only by name was not joined to a pulled club, by what its own page holds:
 * - `oneSameState`: one pulled club of the name on its page, in a state of the clubs naming it (or
 *   either state unknown). The import's own rule joins that (`planOpponent`), so a stand-in here is
 *   one it failed to join, or a mention its other tests refused (the day, a refused name);
 * - `oneOtherState`: one, but in another state, which the import joins only on a game or opponent
 *   in common;
 * - `several`: more than one of the name on its page, which needs something beyond the name;
 * - `nearOne` / `nearSeveral`: none of the name on its page, but one, or several, spelled near it
 *   (`looseNameKey`), which only rules 34 reads (`oneNamesake`);
 * - `elsewhere`: a pulled namesake only on another page of the year;
 * - `unmatched`: nothing of the name or near it: a club nobody has pulled.
 */
export type StandInWhy =
  | "oneSameState"
  | "oneOtherState"
  | "several"
  | "nearOne"
  | "nearSeveral"
  | "elsewhere"
  | "unmatched";
const WHYS: readonly StandInWhy[] = [
  "oneSameState",
  "oneOtherState",
  "several",
  "nearOne",
  "nearSeveral",
  "elsewhere",
  "unmatched",
];

export type StandInClub = {
  teamId: string;
  name: string;
  why: StandInWhy;
  /** The pulled club it would have been joined to, where one alone answers it on its page. */
  candidate?: { teamId: string; name: string };
  /** Games of the year it holds, and how many of them are played. */
  games: number;
  played: number;
  /** Clubs pulled in the year whose name reads the same (`teamNameKey`), and of those, on a page it played on. */
  namesakes: number;
  namesakesOnPage: number;
};

/** Clubs known only by name in one bucket, the games they hold, and how many are played. */
export type StandInBucket = { clubs: number; games: number; played: number };

export type StandInReport = {
  year: number;
  /** The year's games, and how many have a stand-in on at least one side. */
  games: number;
  withStandIn: number;
  played: number;
  playedWithStandIn: number;
  nameOnly: number;
  placeholders: number;
  /** Clubs known only by name with a pulled namesake in the year, and with none. */
  withNamesake: number;
  withoutNamesake: number;
  /**
   * The same clubs by where their namesake is: a pulled club of the name on a page the stand-in
   * played on (most likely the club itself, which the import would not join it to), only on
   * another page, or none at all (a club nobody has pulled). Games are the clubs' own, so a game
   * between two of them is counted for each.
   */
  onPage: StandInBucket;
  elsewhere: StandInBucket;
  unmatched: StandInBucket;
  /** Played games with a bracket slot on a side: a result filed against a slot nobody resolved. */
  slotPlayed: number;
  /** The clubs known only by name holding the most games, most first: these name clubs. */
  top: StandInClub[];
  /** The clubs known only by name by why they were not joined (`StandInWhy`), and the most-held of each. */
  why: Record<StandInWhy, StandInBucket>;
  topWhy: Record<StandInWhy, StandInClub[]>;
};

const isStandIn = (team: ScoutTeam | undefined) =>
  team?.placeholder === true || team?.nameOnly === true;

export const standInReport = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  ageGroups: readonly AgeGroup[],
  year: number,
  top = 25
): StandInReport => {
  const yearPages = new Set(
    ageGroups.filter((group) => ageGroupYear(group) === year).map((group) => group.id)
  );
  const byId = new Map(teams.map((team) => [team.id, team]));
  const yearGames = games.filter((game) => yearPages.has(game.ageGroupId));
  const held = new Map<string, { games: number; played: number }>();
  // The pages each club played on in the year.
  const pagesOf = new Map<string, Set<string>>();
  let slotPlayed = 0;
  let withStandIn = 0;
  let played = 0;
  let playedWithStandIn = 0;
  const inYear = new Set<string>();
  for (const game of yearGames) {
    const isPlayed = isScoutGamePlayed(game);
    if (isPlayed) played += 1;
    let leans = false;
    const slotSide = [game.teamAId, game.teamBId].some((id) => byId.get(id)?.placeholder === true);
    if (isPlayed && slotSide) slotPlayed += 1;
    for (const id of [game.teamAId, game.teamBId]) {
      inYear.add(id);
      const pages = pagesOf.get(id) ?? new Set<string>();
      pages.add(game.ageGroupId);
      pagesOf.set(id, pages);
      if (!isStandIn(byId.get(id))) continue;
      leans = true;
      const tally = held.get(id) ?? { games: 0, played: 0 };
      tally.games += 1;
      if (isPlayed) tally.played += 1;
      held.set(id, tally);
    }
    if (leans) {
      withStandIn += 1;
      if (isPlayed) playedWithStandIn += 1;
    }
  }
  // The states of the pulled clubs whose games name each stand-in.
  const namedFrom = new Map<string, Set<string>>();
  for (const game of yearGames) {
    for (const [side, other] of [
      [game.teamAId, game.teamBId],
      [game.teamBId, game.teamAId],
    ] as const) {
      const state = byId.get(other)?.state;
      if (!isStandIn(byId.get(side)) || isStandIn(byId.get(other)) || !state) continue;
      const states = namedFrom.get(side) ?? new Set<string>();
      states.add(state);
      namedFrom.set(side, states);
    }
  }
  // The year's pulled clubs by name, the ones a stand-in might be, and by name on each page, read
  // exactly and loosely.
  const pulledByName = new Map<string, number>();
  const pulledOnPage = new Map<string, Set<string>>();
  const looselyOnPage = new Map<string, Set<string>>();
  const file = (into: Map<string, Set<string>>, at: string, id: string) => {
    const ids = into.get(at) ?? new Set<string>();
    ids.add(id);
    into.set(at, ids);
  };
  for (const id of inYear) {
    const team = byId.get(id);
    if (!team || isStandIn(team)) continue;
    const key = teamNameKey(team.name);
    const loose = looseNameKey(team.name);
    pulledByName.set(key, (pulledByName.get(key) ?? 0) + 1);
    for (const page of pagesOf.get(id) ?? []) {
      file(pulledOnPage, `${key}|${page}`, id);
      file(looselyOnPage, `${loose}|${page}`, id);
    }
  }
  const onItsPages = (from: Map<string, Set<string>>, key: string, teamId: string) => {
    const ids = new Set<string>();
    for (const page of pagesOf.get(teamId) ?? []) {
      from.get(`${key}|${page}`)?.forEach((id) => ids.add(id));
    }
    return [...ids];
  };
  const fitsState = (teamId: string, candidateId: string) => {
    const states = namedFrom.get(teamId);
    const state = byId.get(candidateId)?.state;
    return !state || !states || states.size === 0 || states.has(state);
  };
  const candidateOf = (id: string | undefined) => {
    const team = id === undefined ? undefined : byId.get(id);
    return team ? { candidate: { teamId: team.id, name: team.name } } : {};
  };
  const clubs: StandInClub[] = [];
  let placeholders = 0;
  for (const [teamId, tally] of held) {
    const team = byId.get(teamId);
    if (!team) continue;
    if (team.placeholder) {
      placeholders += 1;
      continue;
    }
    const key = teamNameKey(team.name);
    const exact = onItsPages(pulledOnPage, key, teamId);
    const near =
      exact.length === 0 ? onItsPages(looselyOnPage, looseNameKey(team.name), teamId) : [];
    const namesakes = pulledByName.get(key) ?? 0;
    const placed: Pick<StandInClub, "why" | "candidate"> =
      exact.length === 1
        ? {
            why: fitsState(teamId, exact[0]!) ? "oneSameState" : "oneOtherState",
            ...candidateOf(exact[0]),
          }
        : exact.length > 1
          ? { why: "several" }
          : near.length === 1
            ? { why: "nearOne", ...candidateOf(near[0]) }
            : near.length > 1
              ? { why: "nearSeveral" }
              : { why: namesakes > 0 ? "elsewhere" : "unmatched" };
    clubs.push({
      teamId,
      name: team.name,
      ...placed,
      ...tally,
      namesakes,
      namesakesOnPage: exact.length,
    });
  }
  clubs.sort((a, b) => b.games - a.games || a.name.localeCompare(b.name));
  const bucket = (keep: (club: StandInClub) => boolean): StandInBucket => {
    const inBucket = clubs.filter(keep);
    return {
      clubs: inBucket.length,
      games: inBucket.reduce((sum, club) => sum + club.games, 0),
      played: inBucket.reduce((sum, club) => sum + club.played, 0),
    };
  };
  return {
    year,
    games: yearGames.length,
    withStandIn,
    played,
    playedWithStandIn,
    nameOnly: clubs.length,
    placeholders,
    withNamesake: clubs.filter((club) => club.namesakes > 0).length,
    withoutNamesake: clubs.filter((club) => club.namesakes === 0).length,
    onPage: bucket((club) => club.namesakesOnPage > 0),
    elsewhere: bucket((club) => club.namesakes > 0 && club.namesakesOnPage === 0),
    unmatched: bucket((club) => club.namesakes === 0),
    slotPlayed,
    top: clubs.slice(0, top),
    why: Object.fromEntries(
      WHYS.map((reason) => [reason, bucket((club) => club.why === reason)])
    ) as Record<StandInWhy, StandInBucket>,
    topWhy: Object.fromEntries(
      WHYS.map((reason) => [reason, clubs.filter((club) => club.why === reason).slice(0, top)])
    ) as Record<StandInWhy, StandInClub[]>,
  };
};
