import type { AgeGroup, ScoutGame } from "../../teamRankings";
import type { NamedAges } from "../../namedAges";
import { clubAgeOf } from "../../teamRankings/clubAge";
import type { BoardsBuilt } from "./board";
import {
  clubBucketOf,
  clubKey,
  encodeClubCard,
  type ClubBucketWire,
  type ClubCard,
} from "./clubShape";

/**
 * A game as a club's panel reads it: who played, where it is filed, the scores and side B's own
 * report of them, whether it is set not to count or its runaway score was confirmed, its day, and
 * its event and each side's level. What a stored game says beyond that (its start, its source, the
 * rows folded into it, notes and the marks a tidy leaves) is the pool's, which no panel line reads
 * (`teamRecordInPool`, `countedInWindow`, `scoreSeenBy`, `countsTowardRating`): a game counts as
 * played ahead by its day alone (`isDatedAhead`).
 */
export const panelGame = (game: ScoutGame): ScoutGame => ({
  id: game.id,
  teamAId: game.teamAId,
  teamBId: game.teamBId,
  ageGroupId: game.ageGroupId,
  ...(game.teamAScore === undefined ? {} : { teamAScore: game.teamAScore }),
  ...(game.teamBScore === undefined ? {} : { teamBScore: game.teamBScore }),
  ...(game.reportedByB ? { reportedByB: game.reportedByB } : {}),
  ...(game.excluded ? { excluded: true } : {}),
  ...(game.scoreConfirmed === undefined ? {} : { scoreConfirmed: game.scoreConfirmed }),
  ...(game.date === undefined ? {} : { date: game.date }),
  ...(game.event === undefined ? {} : { event: game.event }),
  ...(game.ageLevelA === undefined ? {} : { ageLevelA: game.ageLevelA }),
  ...(game.ageLevelB === undefined ? {} : { ageLevelB: game.ageLevelB }),
});

/**
 * A club's games of the year as its card lists them (`clubViews`, which makes every club's list in
 * one pass over the year): those it is on either side of, in the pool's order, each once.
 */
export const cardGamesOf = (games: readonly ScoutGame[], teamId: string): ScoutGame[] =>
  games.filter((game) => game.teamAId === teamId || game.teamBId === teamId);

/**
 * Every club card of every squad year with a page, as views to publish, a year's cards in buckets
 * by club id (`clubBucketOf`). Built from what the boards' build already derived for each year
 * (`BoardsBuilt.known`), so a card holds the very club and games the page's panel reads off its
 * own derivation: the year's roster, League Standings' teams included, and the year's games, League
 * Standings' included. A year's cards are its clubs with a game in it, the only ones its pages
 * list; a bucket with no club is not published.
 *
 * `namedAges` is the copy's list of ages a person named (`loadNamedAges`), which the panel's age
 * reads beside the club's GameChanger links (`clubAgeOf`).
 */
export const clubViews = ({
  ageGroups,
  built,
  namedAges,
}: {
  ageGroups: AgeGroup[];
  built: Pick<BoardsBuilt, "known">;
  namedAges: NamedAges;
}): Array<{ key: string; value: ClubBucketWire }> => {
  const views: Array<{ key: string; value: ClubBucketWire }> = [];
  for (const [year, known] of built.known) {
    const teams = new Map(known.teams.map((team) => [team.id, team]));
    // Each club's games in the pool's order, as `gamesForTeam` lists them: a game a club plays
    // against its own name is listed once.
    const gamesOf = new Map<string, ScoutGame[]>();
    const add = (teamId: string, game: ScoutGame) => {
      const list = gamesOf.get(teamId);
      if (list) list.push(game);
      else gamesOf.set(teamId, [game]);
    };
    for (const stored of known.games) {
      const game = panelGame(stored);
      add(game.teamAId, game);
      if (game.teamBId !== game.teamAId) add(game.teamBId, game);
    }
    // The pages each club's League Standings games are filed on (`leagueTeamIdsOn`, page by page).
    const leaguePages = new Map<string, Set<string>>();
    for (const game of known.derivedGames) {
      for (const teamId of [game.teamAId, game.teamBId]) {
        const pages = leaguePages.get(teamId) ?? new Set<string>();
        pages.add(game.ageGroupId);
        leaguePages.set(teamId, pages);
      }
    }
    const buckets = new Map<number, ClubBucketWire["clubs"]>();
    for (const [teamId, games] of gamesOf) {
      const team = teams.get(teamId);
      if (!team) continue;
      const names: Record<string, string> = {};
      for (const game of games) {
        const opponent = game.teamAId === teamId ? game.teamBId : game.teamAId;
        const name = teams.get(opponent)?.name;
        if (name !== undefined) names[opponent] = name;
      }
      const pages = leaguePages.get(teamId);
      const age = clubAgeOf(team, year, ageGroups, namedAges);
      // The star is the owner's, as on a board (`withMine`): no member's device reads it here.
      const { isMine: _mine, ...club } = team;
      const card: ClubCard = {
        team: club,
        games,
        names,
        ...(pages ? { leaguePages: [...pages].sort() } : {}),
        ...(known.pickedOnly.has(teamId) ? { picked: true as const } : {}),
        ...(age ? { age } : {}),
      };
      const bucket = clubBucketOf(teamId);
      const clubs = buckets.get(bucket) ?? {};
      clubs[teamId] = encodeClubCard(card);
      buckets.set(bucket, clubs);
    }
    for (const [bucket, clubs] of [...buckets].sort(([a], [b]) => a - b)) {
      views.push({ key: clubKey(year, bucket), value: { clubs } });
    }
  }
  return views;
};
