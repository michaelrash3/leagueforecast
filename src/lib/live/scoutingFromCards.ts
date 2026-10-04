import { refuseOnSight, type WhatIfDeclined } from "../scoutWhatIf";
import type { AgeGroup, ScoutGame, ScoutTeam, SeasonSegment } from "../teamRankings";
import type { ClubCard } from "./views/clubShape";

/**
 * What Scouting reads of the pool, read off club cards instead (`clubShape.ts`), for the live
 * board, which holds no pool. Team Rankings hands Scouting the year's games on the page's rating
 * pool (`gamesOnPages`), and each of its parts reads only the games of the club or two clubs it is
 * about: the upcoming games (`buildUpcomingSchedule`) and the comparison (`compareClubs`). A card
 * holds a club's games of the year in the pool's own order, so the same games, in the same order,
 * come off the cards.
 */

/** A club's games on the rating pool's pages, off its card, in the pool's order. */
export const poolGamesOfCard = (card: ClubCard, poolIds: ReadonlySet<string>): ScoutGame[] =>
  card.games.filter((game) => poolIds.has(game.ageGroupId));

/** The clubs a card names, itself and its opponents, as `buildUpcomingSchedule` names them. */
export const teamsOfCard = (card: ClubCard): ScoutTeam[] => [
  card.team,
  ...Object.entries(card.names).map(([id, name]) => ({ id, name })),
];

const involves = (game: ScoutGame, teamId: string) =>
  game.teamAId === teamId || game.teamBId === teamId;

/**
 * Two clubs' games, each game once, in an order each club's games keep their pool order in, as
 * `compareClubs` reads them: `a`'s games, with `b`'s own between them, a meeting of the two taken
 * from `a`'s list once `b`'s games before it are in. A meeting is on both cards, in the same
 * order, so the k-th of `a`'s is the k-th of `b`'s. Where a game of one and a game of the other
 * fall relative to each other is read by neither club's results, so any such order will do. Ids
 * are made distinct across the two cards, whose ids are each card's own places.
 */
export const gamesOfTwo = (
  a: readonly ScoutGame[],
  aId: string,
  b: readonly ScoutGame[],
  bId: string
): ScoutGame[] => {
  const out: ScoutGame[] = [];
  let next = 0;
  const takeB = (untilMeeting: boolean) => {
    while (next < b.length) {
      const game = b[next];
      if (!game) break;
      if (untilMeeting && involves(game, aId)) {
        next += 1;
        return;
      }
      if (!involves(game, aId)) out.push({ ...game, id: `b${game.id}` });
      next += 1;
    }
  };
  for (const game of a) {
    if (involves(game, bId) && bId !== aId) takeB(true);
    out.push({ ...game, id: `a${game.id}` });
  }
  takeB(false);
  return out;
};

/**
 * Why Scouting would not ask a what-if of each of `forTeamId`'s coming `fixtures`, worked out as
 * Team Rankings works it out (`whatIfDeclines`) as far as the board can: what is refused on sight
 * (`refuseOnSight`, on the URL's half as the page reads it) is refused alike, and an opponent the
 * board does not rank (`rated`, its rows) is declined as one with no counted game. Every club the
 * board ranks has one, so the board never offers a what-if the page would not; but the page rates
 * opponents across its whole pool and over the whole year where the URL names no half, so a club
 * ranked only on another page of the pool, or only in the other half, is declined here though the
 * page would ask. `scoutingParity.test.ts` holds both on the seeded fixture.
 */
export const boardWhatIfDeclines = (
  fixtures: readonly ScoutGame[],
  forTeamId: string,
  rated: ReadonlySet<string>,
  ageGroups: AgeGroup[],
  routeSegment: SeasonSegment | undefined
): Map<string, WhatIfDeclined | null> =>
  new Map(
    fixtures.map((fixture) => {
      const onSight = refuseOnSight(fixture, ageGroups, routeSegment);
      if (onSight) return [fixture.id, onSight];
      const opponentId = fixture.teamAId === forTeamId ? fixture.teamBId : fixture.teamAId;
      return [fixture.id, rated.has(opponentId) ? null : "unrated-opponent"];
    })
  );
