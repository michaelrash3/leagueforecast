import { buildScoutTeam, namesNobody } from "./teamRankings/rosterNames";
import { cleanTeamName, isPlaceholderName, teamNameKey } from "./teamRankings/names";
import type { TakenIds } from "./teamRankings/retiredIds";
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
 * Whether `club` has `game` only because a name on another club's schedule was matched to it. The
 * team on the game's other side, the namer, is looked up in whatever roster the caller holds
 * (`teamOf`).
 *
 * The row came off GameChanger (`source`), off a schedule of the namer's own: that is the schedule
 * that wrote the name, and the club is the side it named. A row off a schedule nobody holds any
 * more is not one: an Unlink leaves a club's own rows of the link it took off on the club, as side
 * A, and offered there the button put the schedule's own side on a stand-in of its own name. The
 * club is a pulled one, since a stand-in is the name and nothing more; and nothing of the club's
 * own says the game is its: no row of its schedules folded in or claimed into it, none of them on
 * record (`alsoRows`, `alsoFrom`), and no "Same team as" naming it (`namedByAvatar`), which is the
 * owner's word. A game typed in has no
 * source and is the owner's own, and a League Standings game has none either.
 */
export const filedByNameOn = (
  game: ScoutGame,
  club: ScoutTeam,
  teamOf: (teamId: string) => ScoutTeam | undefined
): boolean => {
  const source = game.source;
  if (source?.kind !== "gamechanger" || game.teamAId === game.teamBId) return false;
  const otherId =
    game.teamAId === club.id ? game.teamBId : game.teamBId === club.id ? game.teamAId : undefined;
  if (otherId === undefined || !club.gcTeams?.length) return false;
  if (!teamOf(otherId)?.gcTeams?.some((link) => link.teamId === source.teamId)) return false;
  if (game.namedByAvatar === club.id) return false;
  return !listedByOwn(game, club);
};

/**
 * Whether one of `club`'s own GameChanger schedules gave `game` a row: the row it stands on, one
 * folded or claimed into it (`alsoRows`), or one on record (`alsoFrom`). What a refusal never
 * stands against: the owner's "Not this team" is about a name another schedule wrote, and a club's
 * own schedule listing the game is the club saying it played it, which no reading of a name
 * outweighs. A stand-in or a slot has no schedule, so nothing is its own.
 */
export const listedByOwn = (game: ScoutGame, club: ScoutTeam | undefined): boolean => {
  const own = new Set((club?.gcTeams ?? []).map((link) => link.teamId));
  if (own.size === 0) return false;
  if (game.source !== undefined && own.has(game.source.teamId)) return true;
  if ((game.alsoRows ?? []).some((record) => own.has(record.teamId))) return true;
  return (game.alsoFrom ?? []).some((schedule) => own.has(schedule));
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
 * back is a tidy refiling the stand-in onto the club, and what makes the same mistake again is the
 * next pull's next row of that name. So the key is (schedule, name as written, club), not the game:
 * a game alone would stop the one row and leave the next row of that name to be filed onto the club
 * when the club has a game that day, and a club's league opponent is named over and over. Nor
 * wider: the schedule and the name both stay in it, so the same club is still found by another
 * schedule that names it, or by this one under another name, and a club's own schedule listing the
 * game still says who played (`listedByOwn`).
 *
 * Every schedule of the club that wrote the name, not only the one the row came off: a club listed
 * on GameChanger twice, or once for the spring and once for the fall, is one club writing the name,
 * and one listing's row of a game is often folded into the other's. Keyed by the row's schedule
 * alone, the second listing's next row of the name was filed onto the club again, and stayed there.
 * On the backup of 29 September 2026, 47 of the games offered were named by a club with two
 * listings, and in 2 of them the other listing's row was in the very game.
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

/* How the answers are stored is a module of its own, which the pool's store reads at start. */
export { coerceNotThisTeam, notThisTeamList } from "./notThisTeamStored";

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

/**
 * The refusals taking `game` off `club` remembers, with the namer's other rows the one press takes
 * (`taken`, `game` among them; `takenWith`): each name those rows were filed under against each of
 * the club's ids, from the schedule the row came off and every other schedule of the club that
 * wrote it (the namer, the game's other side, looked up through `teamOf`). The club's name, which
 * is the name a row resting on a name alone was filed by; and the name each row typed
 * (`ScoutGame.typedAs`), which is another where the owner's Same team as filed it
 * (`ScoutTeam.namedAs`). Refused by the club's name alone, such a row was refused under a name its
 * coach never typed: once the club was renamed, or folded into a club of another name, the refusal
 * was no longer the club's, and the answer filed the rows back and the coach's next one with them.
 */
export const refusalsFor = (
  game: ScoutGame,
  club: ScoutTeam,
  teamOf: (teamId: string) => ScoutTeam | undefined,
  taken: readonly ScoutGame[] = [game]
): string[] => {
  const source = game.source?.teamId;
  if (source === undefined) return [];
  const namer = teamOf(game.teamAId === club.id ? game.teamBId : game.teamAId);
  const schedules = new Set([source, ...(namer?.gcTeams ?? []).map((link) => link.teamId)]);
  const ids = new Set((club.gcTeams ?? []).map((link) => link.teamId));
  const names = [club.name, ...taken.flatMap((row) => (row.typedAs ? [row.typedAs] : []))];
  const refusals = new Set<string>();
  schedules.forEach((schedule) =>
    names.forEach((name) => ids.forEach((id) => refusals.add(refusalOf(schedule, name, id))))
  );
  return [...refusals];
};

/**
 * Every game one press of Not this team on `game` takes off `club`: `game`, and every other game the
 * same club's schedules filed onto it by a name alone (`filedByNameOn`), in `games`' order. The
 * refusal it stores covers each of them (`refusalsFor`), and the tidy's step that takes a refused
 * name's rows off a club (`resettleOffLevel`) would take them at its next run; taken here, in the
 * one change, its Undo puts every one of them back. Left to the tidy, which a stand-in made for the
 * game sets off at once on a page kept in the browser, the others came off out of the Undo's reach,
 * and it brought back the one game alone.
 */
export const takenWith = (
  game: ScoutGame,
  club: ScoutTeam,
  games: readonly ScoutGame[],
  teamOf: (teamId: string) => ScoutTeam | undefined
): ScoutGame[] => {
  if (!filedByNameOn(game, club, teamOf)) return [];
  const namerId = game.teamAId === club.id ? game.teamBId : game.teamAId;
  return games.filter(
    (each) =>
      (each.teamAId === club.id ? each.teamBId : each.teamBId === club.id ? each.teamAId : "") ===
        namerId && filedByNameOn(each, club, teamOf)
  );
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
export const mintStandInId = (name: string, taken?: TakenIds): string => {
  const read = buildScoutTeam(name, taken ?? new Set()).id;
  return taken
    ? read
    : `${read}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
};

/** Days as a sentence reads them: "a", "a and b", "a, b and c". */
const listed = (days: readonly string[]): string =>
  days.length <= 1
    ? (days[0] ?? "")
    : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;

/**
 * What a person is told once games are taken off a club, on either kind of page: `dates` holds one
 * entry for each game taken off, its day where it has one.
 */
export const takenOffSaid = (
  club: string,
  opponent: string | undefined,
  dates: readonly (string | undefined)[]
): string => {
  const days = dates.filter((date): date is string => date !== undefined).sort();
  const against = opponent ? ` with ${opponent}` : "";
  if (dates.length <= 1) {
    return `Taken off ${club}: the game${against}${days[0] ? ` on ${days[0]}` : ""} stands against the name alone now.`;
  }
  return `Taken off ${club}: ${dates.length} games${against}${
    days.length > 0 ? `, on ${listed(days)},` : ""
  } stand against the name alone now.`;
};

/** What taking a game off a club reads: the roster, the pages, and the games of every squad year. */
export type TakeOff = {
  teams: readonly ScoutTeam[];
  ageGroups: readonly AgeGroup[];
  games: readonly ScoutGame[];
};

/** What taking games off a club did: each game as it was and as it is, and the stand-ins made. */
export type TakenOff = {
  moved: { was: ScoutGame; now: ScoutGame }[];
  standIns: ScoutTeam[];
};

/**
 * `game`, and every other game its namer filed onto `club` by the name (`takenWith`), taken off the
 * club and filed against the stand-in the name would have had: one already here that a pull would
 * reuse (`reusableStandIn`), or, where there is none, a new one, the first made under `standInId`,
 * which whoever asked mints so the change reads no clock, and any more under that id with a count
 * after it, which the roster decides as surely. One stand-in per squad year and level, as the import
 * and the tidy keep one, so games at two levels go to two. A name that can only be a slot ("Tbd",
 * "Practice", a round) is a slot of its own for each game, as the import makes one for every such
 * mention. Null where the game is not the club's by a name alone (`filedByNameOn`), or where a
 * stand-in has to be made and `standInId` is already a team's.
 */
export const takeOffClub = (
  pool: TakeOff,
  game: ScoutGame,
  club: ScoutTeam,
  standInId: string
): TakenOff | null => {
  const teamById = new Map(pool.teams.map((team) => [team.id, team]));
  const teamOf = (id: string) => teamById.get(id);
  if (!filedByNameOn(game, club, teamOf)) return null;
  const others = takenWith(game, club, pool.games, teamOf).filter((each) => each.id !== game.id);
  const namer = teamOf(game.teamAId === club.id ? game.teamBId : game.teamAId);
  const name = cleanTeamName(club.name).trim() || club.name;
  const slot = isPlaceholderName(name) || namesNobody(name);
  const poolOf = poolKeyOf(pool.ageGroups);
  const levelOf = new Map(pool.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const used = new Set(teamById.keys());
  const standIns: ScoutTeam[] = [];
  /** The id the next stand-in made goes under, or none where the one asked for is taken. */
  const mint = (): string | undefined => {
    if (standIns.length === 0) return used.has(standInId) ? undefined : standInId;
    let count = standIns.length + 1;
    while (used.has(`${standInId}-${count}`)) count += 1;
    return `${standInId}-${count}`;
  };
  const onto = new Map<string, string>();
  const moved: TakenOff["moved"] = [];
  // The game pressed first: where one stand-in has to be made, it is made for that game.
  for (const was of [game, ...others]) {
    const onA = was.teamAId === club.id;
    const level = (onA ? was.ageLevelA : was.ageLevelB) ?? levelOf.get(was.ageGroupId);
    const key = `${poolOf(was.ageGroupId)}\u0000${level ?? "?"}`;
    let to = slot ? undefined : onto.get(key);
    if (to === undefined) {
      to = slot
        ? undefined
        : reusableStandIn(pool, { name, ageGroupId: was.ageGroupId, level }, namer?.state);
      if (to === undefined) {
        const id = mint();
        if (id === undefined) return null;
        used.add(id);
        standIns.push(slot ? { id, name, placeholder: true } : { id, name, nameOnly: true });
        to = id;
      }
      if (!slot) onto.set(key, to);
    }
    moved.push({ was, now: onA ? { ...was, teamAId: to } : { ...was, teamBId: to } });
  }
  return { moved, standIns };
};
