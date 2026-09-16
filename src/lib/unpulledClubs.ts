import type { GcImportState } from "./gameChangerImport";
import {
  ageGroupLevel,
  ageGroupYear,
  isScoutGamePlayed,
  teamNameKey,
  type ScoutGame,
} from "./teamRankings";
import type { GcTeamListEntry } from "./gameChangerApi";
import { csvEscape } from "./csv";

/**
 * The clubs worth pulling next.
 *
 * A pool fed from GameChanger ends up holding two kinds of team: the clubs whose schedules were
 * pulled, and the clubs those schedules merely named. The second kind is an opponent with no
 * schedule of its own — its results exist only from one side, it can never be ranked, and every
 * game against it stays filed against a stand-in.
 *
 * On a real pool of forty thousand such clubs, all but a few hundred were simply absent from the
 * team list that had been pulled. No amount of better matching reaches them: there is nothing in
 * the pool to match them to. The only thing that does is pulling their schedules, and this is the
 * list of which — ordered by how much each one would be worth, since a club standing in for twenty
 * results is worth twenty times one standing in for a single game.
 *
 * What it carries is what it takes to find the team on GameChanger: the name as its opponents
 * wrote it, where those opponents are from, the age level and season its games were filed under,
 * and who named it.
 */

export type UnpulledClub = {
  teamId: string;
  name: string;
  /** Games it appears in, and how many of those have a result. */
  games: number;
  played: number;
  /** States of the pulled clubs that named it — a club is nearly always named by neighbours. */
  states: string[];
  /** Age levels its games are filed under, as "11U". Usually one. */
  levels: number[];
  /** Season years its games are filed under. */
  years: number[];
  /** A pulled club that played it, by name — somewhere to look its schedule up from. */
  namedBy: string[];
};

/** How many naming clubs to keep per entry. Enough to find the team; not a second list. */
const NAMED_BY_LIMIT = 3;

const sortedUnique = <T>(values: Iterable<T>): T[] => [...new Set(values)].sort();

export const unpulledClubs = (state: GcImportState): UnpulledClub[] => {
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const levelOf = new Map(
    state.ageGroups.map((group) => [group.id, ageGroupLevel(group)] as const)
  );
  const yearOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)] as const));

  /** Only a club named by somebody: a placeholder names nobody and cannot be looked up. */
  const wanted = new Set(
    state.teams.filter((team) => team.nameOnly && !team.placeholder).map((team) => team.id)
  );
  if (wanted.size === 0) return [];

  const found = new Map<
    string,
    {
      games: number;
      played: number;
      states: Set<string>;
      levels: Set<number>;
      years: Set<number>;
      namedBy: Set<string>;
    }
  >();

  const note = (id: string, game: ScoutGame, otherId: string) => {
    if (!wanted.has(id)) return;
    const entry =
      found.get(id) ??
      (() => {
        const fresh = {
          games: 0,
          played: 0,
          states: new Set<string>(),
          levels: new Set<number>(),
          years: new Set<number>(),
          namedBy: new Set<string>(),
        };
        found.set(id, fresh);
        return fresh;
      })();
    entry.games += 1;
    if (isScoutGamePlayed(game)) entry.played += 1;
    const level = levelOf.get(game.ageGroupId);
    if (level !== undefined) entry.levels.add(level);
    const year = yearOf.get(game.ageGroupId);
    if (year !== undefined) entry.years.add(year);
    const other = byId.get(otherId);
    // Where it is from, borrowed from the clubs that named it: a club plays its neighbours.
    if (other && !other.nameOnly && !other.placeholder) {
      if (other.state) entry.states.add(other.state);
      if (entry.namedBy.size < NAMED_BY_LIMIT) entry.namedBy.add(other.name);
    }
  };

  state.games.forEach((game) => {
    note(game.teamAId, game, game.teamBId);
    note(game.teamBId, game, game.teamAId);
  });

  return (
    [...found.entries()]
      .map(([teamId, entry]) => ({
        teamId,
        name: byId.get(teamId)?.name ?? "",
        games: entry.games,
        played: entry.played,
        states: sortedUnique(entry.states),
        levels: sortedUnique(entry.levels),
        years: sortedUnique(entry.years),
        namedBy: [...entry.namedBy],
      }))
      .filter((club) => club.name !== "")
      // Worth most first: a stand-in holding twenty results costs twenty games, not one.
      .sort((a, b) => b.played - a.played || b.games - a.games || a.name.localeCompare(b.name))
  );
};

const CSV_HEADERS = [
  "Team Name",
  "Results Waiting",
  "Games",
  "States",
  "Age Levels",
  "Seasons",
  "Named By",
] as const;

/**
 * The list as a file, for working through outside the app.
 *
 * Deliberately a to-do list rather than an import format: GameChanger has no id for any of these —
 * that is the whole reason they are here — so the columns are what somebody needs to find the team
 * on GameChanger and paste its id into the next pull.
 */
export const unpulledClubsCsv = (clubs: UnpulledClub[]): string =>
  [
    CSV_HEADERS.join(","),
    ...clubs.map((club) =>
      [
        club.name,
        club.played,
        club.games,
        club.states.join(" "),
        club.levels.map((level) => `${level}U`).join(" "),
        club.years.join(" "),
        club.namedBy.join("; "),
      ]
        .map(csvEscape)
        .join(",")
    ),
  ].join("\n");

/** What a team list would do for the clubs the pool only knows by name. */
export type ListCoverage = {
  /** Entries naming a club that is currently a stand-in here. */
  standIns: number;
  /** Results those stand-ins are holding — what pulling them would turn into real games. */
  resultsWaiting: number;
  /** Entries naming a club nothing here has heard of at all. New ground rather than backlog. */
  unheardOf: number;
};

/**
 * How much of the backlog a team list clears.
 *
 * The clubs-to-pull list cannot be worked through automatically: GameChanger has no id for any of
 * them, which is why they are on it, and turning a name into an id means somebody searching. What
 * can be automatic is saying what a list is worth before it is pulled — how many of its entries
 * are clubs already standing in for results here, and how many results that would settle.
 *
 * Matching is by name alone, which is right for this and wrong for identity: here a wrong match
 * costs an estimate being a little off, where in the pool it would cost a club its history.
 */
export const listCoverage = (
  entries: readonly GcTeamListEntry[],
  clubs: readonly UnpulledClub[]
): ListCoverage => {
  const waiting = new Map<string, number>();
  clubs.forEach((club) => {
    const key = teamNameKey(club.name);
    if (!key) return;
    waiting.set(key, (waiting.get(key) ?? 0) + club.played);
  });

  let standIns = 0;
  let resultsWaiting = 0;
  let unheardOf = 0;
  const counted = new Set<string>();
  entries.forEach((entry) => {
    const key = entry.name ? teamNameKey(entry.name) : "";
    if (!key || !waiting.has(key)) {
      unheardOf += 1;
      return;
    }
    standIns += 1;
    // A name counts its waiting results once, however many listings carry it.
    if (counted.has(key)) return;
    counted.add(key);
    resultsWaiting += waiting.get(key) ?? 0;
  });
  return { standIns, resultsWaiting, unheardOf };
};
