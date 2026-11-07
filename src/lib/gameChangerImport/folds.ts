/**
 * The tidy's folds of one squad's ids into one club (`mergeSameSquadIds`, `applyFolds`), and the
 * rows filed under the wrong club put back (`reclaimMisfiled`). Split out of
 * `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  ageGroupLevel,
  collapseSameGames,
  filedRowOf,
  isHeldAsOwn,
  nameFitter,
  sameStart,
  type ScoutGame,
  type ScoutTeam,
  squadNameKey,
  startMinuteOf,
  teamNameKey,
  withFiledRepointed,
} from "../teamRankings";
import { inOneRegion } from "../stateBorders";
import { isKeptApart, type KeptApart } from "../keptApart";
import { joinNamedAs, sameNamedAs } from "../teamRankings/namedAs";
import { buildPoolKeyOf, levelFits, push } from "./poolIndex";
import type { GcImportOutcome, GcImportState } from "./types";
import { isScored } from "./rows";

/** The level a report row landed on, read back off the page name it was filed under. */
export const ageLevelOfOutcome = (outcome: GcImportOutcome): number | undefined => {
  const match = /^(\d{1,2})U\b/.exec(outcome.ageGroupName);
  return match ? Number(match[1]) : undefined;
};

/**
 * Folds together the GameChanger ids that turned out to be one squad.
 *
 * A team pulled by id *is* that id, and pairing a club's Fall roster to its Spring one is the
 * user's call — that rule is right and it stays. What it was never meant to cover is one squad
 * holding several ids inside a single rating pool: a nationwide list turned up "Yeager Davis" as
 * a Fall 2026 id and two Spring 2027 ids, all 11U, all landing on the 11U 2027 table, two of them
 * carrying the very same game. The table showed the club twice, each copy 1-0 off one half of its
 * own season. That is not a pairing decision, it is one club the app failed to recognise.
 *
 * What proves it is the game, as ever: two ids that filed the same fixture — same day, same
 * opponent, and the same result from their side of it — played that game, and only one team can
 * have. Two clubs of one name that never met and never shared a result are left alone, which is
 * what keeps this from being the name matching the user threw out.
 *
 * The same opponent is one pulled third club, read by its id. A slot is no opponent anyone can
 * share: every plain "TBD" reads as one name, so two squads of one name, level and state that each
 * beat a TBD 5-3 on one day, hours apart, were folded into one club and one of them left the board
 * (the sweep of 30 October 2026). A stand-in's name is as many teams as wrote it, and so is a pulled
 * club's: two such squads that each beat a different pulled Vipers 5-3 that day, one of Kentucky
 * and one of Ohio, were folded the same way, and so was a tie between the two squads themselves,
 * each row naming the other by the name both carry, which made a club that played itself. Read by
 * the id, each squad's row of that tie names the other squad, and the two rows are two fixtures. A
 * squad pulled twice still folds on a game both its ids filed against one pulled club, and the owner
 * can fold the rest by hand.
 *
 * Nor are two squads the owner has said are two clubs folded, whatever they filed (`apart`, as the
 * season pairing reads it): the tidy passed that answer to the pairing and not to this. And every
 * squad folding into one survivor is asked against the others folding into it in the same pass, as
 * well as against the survivor: asked of the survivor alone, two the owner kept apart, or two of
 * different states and a survivor of none, both folded into it and ended as one club.
 *
 * The survivor is the id with the most games, so the fold is towards whichever copy the pull knows
 * best, and `mergeScoutTeams` carries the games and both ids across.
 */
export const mergeSameSquadIds = (
  state: GcImportState,
  /** Pairs of GameChanger ids the owner has said are two clubs (`keptApart.ts`). */
  apart: KeptApart = new Set<string>()
): { state: GcImportState; merged: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const pulled = state.teams.filter((team) => team.gcTeams?.length);
  if (pulled.length < 2) return { state, merged: 0 };
  const pulledIds = new Set(pulled.map((team) => team.id));

  /** The GameChanger ids each team is known by, so a row can be told to be its own schedule's. */
  const ownIds = new Map(
    pulled.map((team) => [team.id, new Set((team.gcTeams ?? []).map((link) => link.teamId))])
  );

  /**
   * A game as the club that filed it would describe it: the day, who, and how it went — counted
   * only from the team's own schedule. A row that somebody else's schedule filed against this
   * team by name is the very thing that may be wrong, and reading it as this team's account of
   * the game let a misfiled row "prove" two clubs one squad: ten 8U Dodgers in ten states were
   * folded on fixtures none of them had filed.
   */
  const fixtureKeys = new Map<string, Set<string>>();
  state.games.forEach((game) => {
    if (!game.date || !game.source) return;
    [game.teamAId, game.teamBId].forEach((teamId, side) => {
      if (!ownIds.get(teamId)?.has(game.source!.teamId)) return;
      // A pulled club, never a slot or a stand-in, and by its id rather than its name.
      const otherId = side === 0 ? game.teamBId : game.teamAId;
      if (!pulledIds.has(otherId)) return;
      const mine = side === 0 ? game.teamAScore : game.teamBScore;
      const theirs = side === 0 ? game.teamBScore : game.teamAScore;
      // Unscored rows say only that a fixture is planned, which two clubs can share.
      if (mine === undefined || theirs === undefined) return;
      const key = [poolKeyOf(game.ageGroupId), game.date, otherId, mine, theirs].join(" ");
      const bucket = fixtureKeys.get(teamId);
      if (bucket) bucket.add(key);
      else fixtureKeys.set(teamId, new Set([key]));
    });
  });

  /**
   * Whether two pulled teams could even be one squad: the same level on every id, the same state
   * where both give one, and the same listing name once only the age label is removed. A club's
   * 9U and 10U are two rosters; so are "Heat 9U (Ealey)" and "Heat 9U (Campana)"; and a Chico
   * Aces and a Pansey Aces are two clubs whatever they filed.
   */
  const couldBeOneSquad = (a: ScoutTeam, b: ScoutTeam): boolean => {
    const links = [...(a.gcTeams ?? []), ...(b.gcTeams ?? [])];
    const levels = new Set(links.map((link) => link.ageLevel));
    if (levels.size !== 1 || levels.has(undefined)) return false;
    if (a.state && b.state && a.state !== b.state) return false;
    return new Set(links.map((link) => squadNameKey(link.name))).size === 1;
  };
  const keptApart = (a: ScoutTeam, b: ScoutTeam): boolean =>
    (a.gcTeams ?? []).some((x) =>
      (b.gcTeams ?? []).some((y) => isKeptApart(apart, x.teamId, y.teamId))
    );

  /** Ids to fold, newest-known first, keyed by the id they fold into. */
  const foldInto = new Map<string, string>();
  /** The squads each survivor takes in this pass, each asked against the next as one club. */
  const joining = new Map<string, ScoutTeam[]>();
  // Counted once. Counting by scanning the games for each team made this pass quadratic, and it
  // runs at the end of every pull over the whole pool.
  const gameCounts = new Map<string, number>();
  state.games.forEach((game) => {
    gameCounts.set(game.teamAId, (gameCounts.get(game.teamAId) ?? 0) + 1);
    gameCounts.set(game.teamBId, (gameCounts.get(game.teamBId) ?? 0) + 1);
  });
  const gamesFor = (teamId: string): number => gameCounts.get(teamId) ?? 0;

  const byName = new Map<string, ScoutTeam[]>();
  pulled.forEach((team) => {
    const key = teamNameKey(team.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(team);
    else byName.set(key, [team]);
  });

  byName.forEach((group) => {
    if (group.length < 2) return;
    const ranked = group.slice().sort((a, b) => gamesFor(b.id) - gamesFor(a.id));
    ranked.forEach((team, index) => {
      if (index === 0 || foldInto.has(team.id)) return;
      const mine = fixtureKeys.get(team.id);
      if (!mine || mine.size === 0) return;
      for (const other of ranked.slice(0, index)) {
        if (foldInto.has(other.id)) continue;
        const club = [other, ...(joining.get(other.id) ?? [])];
        if (club.some((one) => !couldBeOneSquad(team, one) || keptApart(team, one))) continue;
        const theirs = fixtureKeys.get(other.id);
        if (!theirs) continue;
        const shared = [...mine].some((key) => theirs.has(key));
        if (shared) {
          foldInto.set(team.id, other.id);
          push(joining, other.id, team);
          break;
        }
      }
    });
  });

  if (foldInto.size === 0) return { state, merged: 0 };
  return { state: applyFolds(foldInto, state), merged: foldInto.size };
};

/**
 * Applies every fold in one pass.
 *
 * `mergeScoutTeams` walks the whole pool for each merge — every game repointed, every team
 * filtered, then a collapse over what came out. One at a time that is right and readable, and on a
 * nationwide pool it is the wrong shape entirely: the cost is the number of folds times the number
 * of games, and the number of folds is itself a measure of how messy the pool is. Measured at two
 * hundred thousand games a single fold is about 20ms, so a thousand of them — which a nationwide
 * pull produces easily — is twenty seconds, per tidy pass, of which there are up to six.
 *
 * Here the games are walked once however many folds there are, and the collapse afterwards is one
 * pass rather than one per fold. The result is the same pool: the merges are independent of each
 * other, because a team folded away is never also a target (the pass above never picks one that is
 * already folding), so there is no order in which they have to be applied.
 */
const applyFolds = (foldInto: ReadonlyMap<string, string>, state: GcImportState): GcImportState => {
  /**
   * Where an id ends up. Flat in practice — the pass above never folds into a team that is itself
   * folding — but followed to a fixed point anyway, with a guard, because a chain arriving here
   * would otherwise leave half the pool pointing at a team that no longer exists.
   */
  const finalOf = (id: string): string => {
    let at = id;
    for (let hops = 0; hops < foldInto.size; hops += 1) {
      const next = foldInto.get(at);
      if (next === undefined || next === at) return at;
      at = next;
    }
    return at;
  };

  /** The teams folding into each survivor, in the order the pass decided them. */
  const sources = new Map<string, ScoutTeam[]>();
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  foldInto.forEach((_intoId, fromId) => {
    const into = finalOf(fromId);
    const team = byId.get(fromId);
    if (!team || into === fromId) return;
    const bucket = sources.get(into);
    if (bucket) bucket.push(team);
    else sources.set(into, [team]);
  });

  const teams = state.teams.flatMap((team): ScoutTeam[] => {
    if (foldInto.has(team.id) && finalOf(team.id) !== team.id) return [];
    const folded = sources.get(team.id);
    if (!folded || folded.length === 0) return [team];

    // Field by field, in the order the folds were decided — the first source to carry something
    // the survivor lacks is the one that fills it, which is what merging them one at a time did.
    let merged = team;
    const linkedIds = new Set((team.gcTeams ?? []).map((link) => link.teamId));
    const gcTeams = [...(team.gcTeams ?? [])];
    folded.forEach((from) => {
      (from.gcTeams ?? []).forEach((link) => {
        if (linkedIds.has(link.teamId)) return;
        linkedIds.add(link.teamId);
        gcTeams.push(link);
      });
      if (!merged.name.trim() && from.name.trim()) merged = { ...merged, name: from.name };
      // A state the owner cleared stays clear (`ScoutTeam.stateCleared`).
      if (!merged.state && !merged.stateCleared && from.state) {
        merged = { ...merged, state: from.state };
      }
      if (!merged.city && from.city) merged = { ...merged, city: from.city };
      // "Our team" is a fact about the club, so it survives whichever half carried it.
      if (!merged.isMine && from.isMine) merged = { ...merged, isMine: true };
    });
    if (gcTeams.length !== (team.gcTeams?.length ?? 0)) merged = { ...merged, gcTeams };
    // The owner's answers for the squads folded away go with the club, as their ids do
    // (`ScoutTeam.namedAs`).
    const namedAs = joinNamedAs([team.namedAs, ...folded.map((from) => from.namedAs)]);
    if (!sameNamedAs(namedAs, team.namedAs)) {
      const { namedAs: _held, ...unnamed } = merged;
      merged = namedAs ? { ...unnamed, namedAs } : unnamed;
    }
    return [merged];
  });

  const repointed: ScoutGame[] = [];
  state.games.forEach((game) => {
    const teamAId = finalOf(game.teamAId);
    const teamBId = finalOf(game.teamBId);
    // Both sides of the game turned out to be the same club: it was never two teams playing. A game
    // some team already had against itself is not the fold's to take (`mergeScoutTeams`): taken
    // here, every scrimmage in the pool went whenever any two squads folded.
    if (teamAId === teamBId && game.teamAId !== game.teamBId) return;
    const moved =
      teamAId === game.teamAId && teamBId === game.teamBId ? game : { ...game, teamAId, teamBId };
    // A row claimed from a squad folded away was filed against the squad it folded into.
    repointed.push(withFiledRepointed(moved, finalOf));
  });

  // One collapse for every fold rather than one each: the rows a fold made into duplicates are all
  // in this array now, and the pass is over the whole array either way.
  const collapsed = collapseSameGames(repointed, state.ageGroups);
  return { ...state, teams, games: collapsed.games };
};

/**
 * Whether one of `schedules` gave `game` a row of its own that `game` holds folded in or on record
 * (`ScoutGame.alsoFrom`): the club they belong to filed the game as surely as its source did. A
 * schedule on record only through rows it filed against somebody else, which `game`'s club claimed
 * (`FoldedRow.filedAgainst`), did not file this game against that club, and does not count. A claim
 * a merge settled on that very club (`isSettledClaim`) is filed against it by name, and does: read
 * as a claim, a namesake pulled later took the copy, and the row stood back up against the club
 * whose copy it had been, one loss counted twice. So does the claim the namesake join holds
 * (`isJoinedClaim`), the club's own row of the game, which only the join takes back.
 */
export const filedInto = (game: ScoutGame, schedules: ReadonlySet<string> | undefined): boolean =>
  (game.alsoFrom ?? []).some((id) => {
    if (!schedules?.has(id)) return false;
    const records = (game.alsoRows ?? []).filter((record) => record.teamId === id);
    return (
      records.length === 0 ||
      records.some((record) => record.filedAgainst === undefined || isHeldAsOwn(game, record))
    );
  });

/**
 * Moves a game filed by name onto the namesake whose own schedule holds it.
 *
 * A schedule names an opponent; the import attaches the row to a pulled club of that name. When
 * a second club of the name is pulled later and *its* own schedule lists this very game — same
 * day, this puller, the result mirrored — the row was on the wrong club, and nothing at arrival
 * time could have known. The fixture beats the name, order-independently: the row moves to the
 * club that filed it, where the collapse then makes one game of the two. Only where exactly one
 * namesake holds it and the club it sits on does not; anything less stays as it is.
 */
export const reclaimMisfiled = (
  state: GcImportState
): { state: GcImportState; reclaimed: number } => {
  const fits = nameFitter();
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const ownIds = new Map<string, Set<string>>();
  /** The levels each pulled club is listed at, as `resettleOffLevel` reads them. */
  const levels = new Map<string, Set<number>>();
  const namesakes = new Map<string, string[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    ownIds.set(team.id, new Set(team.gcTeams.map((link) => link.teamId)));
    const listed = new Set<number>();
    team.gcTeams.forEach((link) => {
      const level = link.ageLevel ?? levelOf.get(link.ageGroupId);
      if (level !== undefined) listed.add(level);
    });
    levels.set(team.id, listed);
    const key = teamNameKey(team.name);
    const bucket = namesakes.get(key);
    if (bucket) bucket.push(team.id);
    else namesakes.set(key, [team.id]);
  });
  if (namesakes.size === 0) return { state, reclaimed: 0 };

  const isOwnRow = (game: ScoutGame, teamId: string): boolean =>
    game.source !== undefined && (ownIds.get(teamId)?.has(game.source.teamId) ?? false);
  /** Each pulled team's own-schedule rows by day. */
  const ownByDay = new Map<string, ScoutGame[]>();
  state.games.forEach((game) => {
    if (!game.date) return;
    [game.teamAId, game.teamBId].forEach((teamId) => {
      if (!isOwnRow(game, teamId)) return;
      const key = `${teamId}\u0000${game.date}`;
      const bucket = ownByDay.get(key);
      if (bucket) bucket.push(game);
      else ownByDay.set(key, [game]);
    });
  });

  const score = (game: ScoutGame, teamId: string) =>
    game.teamAId === teamId ? game.teamAScore : game.teamBScore;
  /**
   * Whether this club's own schedule has a row that day that could be `row`: against the puller
   * itself, or against a stand-in for it.
   *
   * The second is the same game written down by a coach who did not type the puller's name the
   * way GameChanger lists it. A club called "Hurricanes" lost 2-13 to the Cincy Stix 9U Navy on
   * 20 September 2026 and wrote its opponent as "Stix"; with another Ohio club called "Hurricanes"
   * pulled first, the Stix's own row went to that one by name, and nothing could move it, because
   * the real Hurricanes' schedule held the game against a "Stix" stand-in rather than against the
   * Stix. A stand-in whose name is a shorthand for the puller's (`nameFitsWithin`), in the same
   * region, is that row — but only on stronger evidence than the puller's own name needs: the same
   * start time, or at another time both results mirrored. A name that fits is weaker evidence than
   * a name that is the puller's, so it does not get the benefit of a missing score. The same start
   * time holds whatever the two coaches scored: on the stand-in fixtures export of 22 September
   * 2026, 35 rows sat at one instant with results that differed, against 3 in the same search a
   * week either side.
   */
  const holdsAs = (
    clubId: string,
    pullerId: string,
    row: ScoutGame,
    own: ScoutGame,
    exact = false
  ): boolean => {
    // The side of `row` that is not the puller: what the club being asked about would stand in.
    const rowClub = score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId);
    const rowPuller = score(row, pullerId);
    const puller = teamById.get(pullerId);
    {
      const other = own.teamAId === clubId ? own.teamBId : own.teamAId;
      const ownClub = score(own, clubId);
      const ownPuller = score(own, other);
      if (other === pullerId) {
        if (ownClub === undefined || ownPuller === undefined) return true;
        if (rowClub === undefined || rowPuller === undefined) return true;
        return ownClub === rowClub && ownPuller === rowPuller;
      }
      if (exact) return false;
      const stand = teamById.get(other);
      if (!puller || !stand?.nameOnly || !fits(stand.name, puller.name)) return false;
      if (!inOneRegion(puller.state, teamById.get(clubId)?.state)) return false;
      // One start time is one game, whatever the two coaches scored it; at another time only a
      // mirrored result says so.
      if (sameStart(own.startTs, row.startTs)) return true;
      const scored = [ownClub, ownPuller, rowClub, rowPuller].every((value) => value !== undefined);
      return scored && ownClub === rowClub && ownPuller === rowPuller;
    }
  };
  const holds = (clubId: string, pullerId: string, row: ScoutGame, exact = false): boolean =>
    (ownByDay.get(`${clubId}\u0000${row.date}`) ?? []).some((own) =>
      holdsAs(clubId, pullerId, row, own, exact)
    );

  /*
   * Each pulled club's own scored rows, by start minute and the result from the club's own seat:
   * where a club's own row of a game is, found by the game rather than by the club's name. Looking
   * each namesake up by name instead cost about 6 s a pass on the pool of 26 September 2026.
   */
  const ownAtStart = new Map<string, { clubId: string; own: ScoutGame }[]>();
  const atStartKey = (minute: number, club: number, other: number) => `${minute}|${club}-${other}`;
  state.games.forEach((game) => {
    if (!isScored(game) || game.scoreFromB || game.scoreFromTwin) return;
    const minute = startMinuteOf(game.startTs);
    if (minute === undefined || !isOwnRow(game, game.teamAId)) return;
    push(ownAtStart, atStartKey(minute, game.teamAScore!, game.teamBScore!), {
      clubId: game.teamAId,
      own: game,
    });
  });
  /**
   * The clubs whose own schedule has `row` at its very start with the result mirrored, against the
   * puller or against a team that could be the puller by another name: a slot, any stand-in, or a
   * pulled club named like the puller whose own schedules never list the game. What `holds` asks of
   * one club, asked of the game, and without the name: a coach who typed the puller as "TBD", or as
   * a name another club of the puller's name was pulled under, still wrote this game down, at this
   * start, with this score. The puller's own row is among them where the game was a tie against a
   * club of its own name, and is never a holder (below).
   */
  const atTheStart = (row: ScoutGame, pullerId: string, exact = false): Set<string> => {
    const minute = startMinuteOf(row.startTs);
    const rowClub = score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId);
    const rowPuller = score(row, pullerId);
    const puller = teamById.get(pullerId);
    if (minute === undefined || rowClub === undefined || rowPuller === undefined || !puller) {
      return new Set();
    }
    const found = new Set<string>();
    (ownAtStart.get(atStartKey(minute, rowClub, rowPuller)) ?? []).forEach(({ clubId, own }) => {
      if (exact ? own.teamBId === pullerId : standsForPuller(own, pullerId, puller)) {
        found.add(clubId);
      }
    });
    return found;
  };
  /** Whether the other side of a club's own row could be the puller by another name. */
  const standsForPuller = (own: ScoutGame, pullerId: string, puller: ScoutTeam): boolean => {
    const other = own.teamBId;
    const vs = teamById.get(other);
    return (
      other === pullerId ||
      vs?.placeholder === true ||
      vs?.nameOnly === true ||
      (vs !== undefined &&
        Boolean(vs.gcTeams?.length) &&
        (teamNameKey(vs.name) === teamNameKey(puller.name) || fits(vs.name, puller.name)) &&
        !filedInto(own, ownIds.get(other)))
    );
  };
  /** `atTheStart` asked of one row of the club's own: the very start, the result mirrored. */
  const atItsStart = (row: ScoutGame, pullerId: string, own: ScoutGame): boolean => {
    const puller = teamById.get(pullerId);
    const minute = startMinuteOf(row.startTs);
    return (
      puller !== undefined &&
      minute !== undefined &&
      isScored(row) &&
      isScored(own) &&
      startMinuteOf(own.startTs) === minute &&
      own.teamAScore === score(row, row.teamAId === pullerId ? row.teamBId : row.teamAId) &&
      own.teamBScore === score(row, pullerId) &&
      standsForPuller(own, pullerId, puller)
    );
  };

  let reclaimed = 0;
  const games = state.games.map((game) => {
    if (!game.date || !game.source) return game;
    // The puller is the side whose schedule filed the row; the other side was attached by name.
    const pullerId = isOwnRow(game, game.teamAId)
      ? game.teamAId
      : isOwnRow(game, game.teamBId)
        ? game.teamBId
        : undefined;
    if (!pullerId) return game;
    const namedId = pullerId === game.teamAId ? game.teamBId : game.teamAId;
    const named = teamById.get(namedId);
    if (!named?.gcTeams?.length) return game;
    // Named by the owner (Same team as), not attached by name (`ScoutGame.namedByAvatar`).
    if (game.namedByAvatar === namedId) return game;
    // Attached by name only: the club it sits on did not file it, and its own schedule does not
    // hold a row that could be it. A row a join or a slot fold made one of two keeps the other
    // club's schedule in `alsoFrom`, and that club filed it as surely as the puller did: reading
    // `source` alone moved a joined Stix–Hurricanes game onto another Ohio "Hurricanes" in the
    // very tidy that joined it.
    const alsoFiled = filedInto(game, ownIds.get(namedId));
    if (isOwnRow(game, namedId) || alsoFiled || holds(namedId, pullerId, game)) return game;
    /*
     * The club it sits on may hold the game all the same: its own row of it folded in as a claim,
     * filed against a stand-in or a slot (`FoldedRow.filedAgainst`), is out of `ownByDay` and so
     * out of `holds`. Read as no evidence, a namesake whose own row stood against another stand-in
     * of the name took the copy, the claim then stood back up and held the game again, and the two
     * clubs took turns with it on every pass: on the backup of 11 October 2026 four copies did, and
     * every tidy ran to its six-pass limit. Where the claim holds the game, only a namesake whose
     * own row stands against the puller itself has better evidence. Only a claim of the game's day
     * counts, as only a standing row of that day does (`ownByDay`): a claim folded in from a day
     * apart (`FoldedRow.date`) would otherwise keep the copy from a namesake whose own row that day
     * holds it.
     */
    const claimed = (game.alsoRows ?? []).flatMap((record) => {
      if (record.filedAgainst === undefined || !ownIds.get(namedId)?.has(record.teamId)) return [];
      const own = filedRowOf(game, record);
      return own.date === game.date ? [own] : [];
    });
    const heldByClaim = claimed.some(
      (own) => holdsAs(namedId, pullerId, game, own) || atItsStart(game, pullerId, own)
    );
    const atStart = atTheStart(game, pullerId);
    if (atStart.has(namedId)) return game;
    const pool = poolKeyOf(game.ageGroupId);
    const level =
      (namedId === game.teamAId ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
    /*
     * Only a namesake at a level the row could be played at — the test `resettleOffLevel` holds a
     * row to. Without it a "Hurricanes 12U" with a mirrored result against a "Stix" that day took
     * the 9U Stix's game, the next step handed it back for being three levels off, and the two did
     * it again every pass until the tidy gave up at its limit. And never the puller: a tie between
     * two squads of one club mirrors itself, and moved onto its puller the 9U Texas Takeover played
     * itself.
     */
    const placed = (clubId: string) =>
      clubId !== namedId &&
      clubId !== pullerId &&
      Boolean(teamById.get(clubId)?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool)) &&
      levelFits(levels.get(clubId), level);
    const holders = new Set(
      (namesakes.get(teamNameKey(named.name)) ?? []).filter(
        (clubId) => placed(clubId) && holds(clubId, pullerId, game, heldByClaim)
      )
    );
    /*
     * And a club whose own schedule has the game at its very start, the result mirrored (`atTheStart`),
     * named as the row names it or with a name that fits it in one region. The Padres and Marlins of
     * one Texas rec league, pulled several of each, were filed crossed: each club's own row of one
     * 5-9 went to the other club's namesake, and neither namesake's schedule listed the game.
     */
    (heldByClaim ? atTheStart(game, pullerId, true) : atStart).forEach((clubId) => {
      const club = teamById.get(clubId);
      if (!club || !placed(clubId)) return;
      const sameName = teamNameKey(club.name) === teamNameKey(named.name);
      if (sameName || (fits(club.name, named.name) && inOneRegion(club.state, named.state))) {
        holders.add(clubId);
      }
    });
    if (holders.size !== 1) return game;
    reclaimed += 1;
    const [holder] = [...holders] as [string];
    return game.teamAId === namedId ? { ...game, teamAId: holder } : { ...game, teamBId: holder };
  });
  return reclaimed === 0 ? { state, reclaimed: 0 } : { state: { ...state, games }, reclaimed };
};
