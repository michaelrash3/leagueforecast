import {
  buildScoutTeam,
  cleanTeamName,
  isPlaceholderName,
  namesNobody,
  teamNameKey,
} from "./teamRankings/names";
import { ageGroupLevel, ageGroupYear } from "./teamRankings/seasons";
import type { AgeGroup, ScoutGame, ScoutTeam } from "./teamRankings/types";

/**
 * "Not this team": the owner saying a game is not a club's, where the club has it only because a
 * name on another club's schedule was matched to it.
 *
 * GameChanger gives an opponent as the words a coach typed and nothing else, so a name is where to
 * look rather than who played, and the matcher will sometimes look in the wrong place: on 28
 * September 2026 an Illinois club's 8 August loss to "Eagles" sat on a pulled Eagles of another
 * state whose own schedule listed nothing that day. The panel offered Unlink, which could not help,
 * since the row did not come from a link. This is what can: the row goes back to what it would
 * have been had the name matched nothing, the stand-in the import makes for a name it cannot place.
 *
 * Shared by both kinds of page through the command that makes the change (`game.notThisTeam`,
 * `commands.ts`): a visitor's page runs it on its own store, and the live page sends it to the edit
 * function, so the two take the same game off the same club and put it on the same stand-in.
 */

/**
 * Whether `club` has `game` only because a name on another club's schedule was matched to it.
 *
 * The row came off GameChanger (`source`), from a schedule that is not one of the club's own; the
 * club is a pulled one, since a stand-in is the name and nothing more; and nothing of the club's
 * own says the game is its: no row of its schedules folded in or claimed into it, none of them on
 * record (`alsoRows`, `alsoFrom`), and no picture naming it (`namedByAvatar`), which is
 * GameChanger's own identity and, after "Same team as", the owner's word. A game typed in has no
 * source and is the owner's own, and a League Standings game has none either.
 */
export const filedByNameOn = (game: ScoutGame, club: ScoutTeam): boolean => {
  if (game.source?.kind !== "gamechanger" || game.teamAId === game.teamBId) return false;
  if (game.teamAId !== club.id && game.teamBId !== club.id) return false;
  const own = new Set((club.gcTeams ?? []).map((link) => link.teamId));
  if (own.size === 0 || own.has(game.source.teamId)) return false;
  if (game.namedByAvatar === club.id) return false;
  if ((game.alsoRows ?? []).some((record) => own.has(record.teamId))) return false;
  return !(game.alsoFrom ?? []).some((schedule) => own.has(schedule));
};

/**
 * The refusals the owner has given, remembered so that nothing files the name back: each one a
 * schedule, a name as it was written there, and a club that name is not, kept in the pool beside
 * the pairs kept apart (`keptApart.ts`) and travelling with it into backups and the cloud copy.
 *
 * Same team as, the owner saying who played, is kept on the rows it folds (`namedByAvatar`), and
 * this is its opposite; but what it refuses is a name a schedule goes on writing, on rows the pool
 * does not hold yet, so it cannot live on a row. And a row taken off its club needs no mark of its
 * own to stay off on a re-pull, which finds it by id and keeps the opponent it has: what puts it
 * back is a tidy refiling the stand-in onto the club, or the claim step reading the club's copy as
 * the game, and what makes the same mistake again is the next pull's next row of that name. So the
 * key is (schedule, name as written, club), not the game: a game alone would stop the one row and
 * leave the next row of that name to be filed onto the club when the club has a game that day, and
 * a club's league opponent is named over and over. Nor wider: the schedule and the name both stay
 * in it, so the same club is still found by another schedule that names it, or by this one under
 * another name, and a club's own schedule listing the game, and its picture, still say who played.
 *
 * Keyed by GameChanger ids, as the pairs kept apart are and for the same reason: a fold deletes one
 * of this app's team ids and a reset mints new ones for everybody, while GameChanger mints an id
 * once. The refused club by each of its ids when the owner said it, so a club folded into another
 * keeps its refusals under the ids it brings. The name as the import reads it (`teamNameKey`): the
 * pool keeps no row's name, and a name files a row onto a pulled club only where the two read the
 * same, so the club's name is the name the schedule wrote, as the matcher compared it.
 */
export type NotThisTeam = ReadonlySet<string>;

export const NO_REFUSALS: NotThisTeam = new Set();

/** One refusal as it is stored: the schedule's id, the name's key and the club's id. */
export const refusalOf = (schedule: string, name: string, clubGcId: string): string =>
  `${schedule}\u0000${teamNameKey(name)}\u0000${clubGcId}`;

/** Whatever was stored, as a set: anything that is not a schedule, a name and a club is dropped. */
export const coerceNotThisTeam = (raw: unknown): Set<string> => {
  if (!Array.isArray(raw)) return new Set();
  const out = new Set<string>();
  raw.forEach((entry) => {
    if (typeof entry !== "string") return;
    const parts = entry.split("\u0000");
    if (parts.length === 3 && parts.every((part) => part.length > 0)) out.add(entry);
  });
  return out;
};

/** The set as it is stored: a plain array, sorted so a save that changes nothing looks like it. */
export const notThisTeamList = (refused: NotThisTeam): string[] => [...refused].sort();

/**
 * Whether the owner has said `name`, written on schedule `schedule`, is not `club`: by any of the
 * club's GameChanger ids. A stand-in or a slot has none, so nothing is ever refused it.
 */
export const refusesName = (
  refused: NotThisTeam,
  schedule: string | undefined,
  name: string | undefined,
  club: ScoutTeam | undefined
): boolean => {
  if (refused.size === 0 || schedule === undefined || name === undefined || !club?.gcTeams) {
    return false;
  }
  return club.gcTeams.some((link) => refused.has(refusalOf(schedule, name, link.teamId)));
};

/** The refusals taking `game` off `club` remembers: its schedule, the club's name, each of its ids. */
export const refusalsFor = (game: ScoutGame, club: ScoutTeam): string[] => {
  const schedule = game.source?.teamId;
  if (schedule === undefined) return [];
  const ids = new Set((club.gcTeams ?? []).map((link) => link.teamId));
  return [...ids].map((id) => refusalOf(schedule, club.name, id));
};

/** A squad year's pool, as the import keys one: a page with no year is a pool of its own. */
const poolKeyOf = (groups: readonly AgeGroup[]) => {
  const keys = new Map(
    groups.map((group) => {
      const year = ageGroupYear(group);
      return [group.id, year === undefined ? `g:${group.id}` : `y:${year}`];
    })
  );
  return (ageGroupId: string) => keys.get(ageGroupId) ?? `g:${ageGroupId}`;
};

/**
 * The stand-in already here that a pull would reuse for this name, at this level, in this pool,
 * for a club of `namerState`: one of that name filed at that level against a club of the namer's
 * state, or against no pulled club with a state at all, the first the games come to. The rule the
 * import reuses a stand-in by (`planOpponent`) and the tidy moves a row onto one by
 * (`resettleOffLevel`): one per name, level, squad year and naming state, so the row joins the
 * other games its namer's neighbours filed against the name rather than standing beside them.
 */
const reusableStandIn = (
  { teams, games, ageGroups }: TakeOff,
  slot: { name: string; ageGroupId: string; level: number | undefined },
  namerState: string | undefined
): string | undefined => {
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const poolOf = poolKeyOf(ageGroups);
  const levelOf = new Map(ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const slotOf = (ageGroupId: string, level: number | undefined, name: string) =>
    `${poolOf(ageGroupId)}\u0000${level ?? "?"}\u0000${teamNameKey(name)}`;
  const wanted = slotOf(slot.ageGroupId, slot.level, slot.name);
  const found: string[] = [];
  const namedFrom = new Map<string, Set<string>>();
  const note = (game: ScoutGame, side: string, other: string, typed: number | undefined) => {
    const team = teamById.get(side);
    if (!team?.nameOnly || team.placeholder || team.gcTeams?.length) return;
    if (slotOf(game.ageGroupId, typed ?? levelOf.get(game.ageGroupId), team.name) !== wanted)
      return;
    if (!found.includes(side)) found.push(side);
    const states = namedFrom.get(side) ?? new Set<string>();
    const namer = teamById.get(other);
    if (namer?.gcTeams?.length && namer.state) states.add(namer.state);
    namedFrom.set(side, states);
  };
  games.forEach((game) => {
    note(game, game.teamAId, game.teamBId, game.ageLevelA);
    note(game, game.teamBId, game.teamAId, game.ageLevelB);
  });
  return found.find((id) => {
    const states = namedFrom.get(id) ?? new Set<string>();
    return !namerState || states.size === 0 || states.has(namerState);
  });
};

/**
 * An id for the stand-in a club's name may need, minted by whoever asks: the next id the roster
 * (`taken`) does not hold, as the import mints one; or, for a page holding no roster (the live
 * page), one that no roster will, the id the name reads as with when it was asked and a few random
 * letters after it.
 */
export const mintStandInId = (name: string, taken?: ReadonlySet<string>): string => {
  const read = buildScoutTeam(name, taken ?? new Set()).id;
  return taken
    ? read
    : `${read}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};

/** What taking a game off a club reads: the roster, the pages, and the games of its squad year. */
export type TakeOff = {
  teams: readonly ScoutTeam[];
  ageGroups: readonly AgeGroup[];
  games: readonly ScoutGame[];
};

/**
 * `game` taken off `club` and filed against the stand-in its name would have had: one already here
 * that a pull would reuse (`reusableStandIn`), or, where there is none, a new one made under
 * `standInId`, which whoever asked mints so the change reads no clock and makes up no id. A name
 * that can only be a slot ("Tbd", "Practice", a round) is a slot of its own, as the import makes
 * one for every such mention. Null where the game is not the club's by a name alone
 * (`filedByNameOn`), or where a stand-in has to be made and `standInId` is already a team's.
 */
export const takeOffClub = (
  pool: TakeOff,
  game: ScoutGame,
  club: ScoutTeam,
  standInId: string
): { game: ScoutGame; standIn: ScoutTeam | null } | null => {
  if (!filedByNameOn(game, club)) return null;
  const onA = game.teamAId === club.id;
  const namer = pool.teams.find((team) => team.id === (onA ? game.teamBId : game.teamAId));
  const name = cleanTeamName(club.name).trim() || club.name;
  const slot = isPlaceholderName(name) || namesNobody(name);
  const level =
    (onA ? game.ageLevelA : game.ageLevelB) ??
    ageGroupLevel(pool.ageGroups.find((group) => group.id === game.ageGroupId));
  const reused = slot
    ? undefined
    : reusableStandIn(pool, { name, ageGroupId: game.ageGroupId, level }, namer?.state);
  if (reused === undefined && pool.teams.some((team) => team.id === standInId)) return null;
  const standIn: ScoutTeam | null =
    reused !== undefined
      ? null
      : slot
        ? { id: standInId, name, placeholder: true }
        : { id: standInId, name, nameOnly: true };
  const to = reused ?? standInId;
  return { game: onA ? { ...game, teamAId: to } : { ...game, teamBId: to }, standIn };
};
