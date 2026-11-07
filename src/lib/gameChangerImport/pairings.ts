/**
 * Two GameChanger ids of one squad, and one game counted twice: the twin squads and the season
 * pairings offered for approval, the games another copy already counts, and the TBD rows set not
 * to count. Split out of `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  type AgeGroup,
  ageGroupYear,
  gcRowId,
  gcSeasonLabel,
  type GcTeamLink,
  minutesApart,
  nameFitter,
  namesTbd,
  scoreSeenBy,
  type ScoutGame,
  type ScoutTeam,
  squadNameKey,
  squadYearForGcSeason,
  startMinuteOf,
  startsWithinTheHour,
  teamNameKey,
  withFiledRepointed,
} from "../teamRankings";
import { buildStaffIndex, likelySameSquad, sharedStaff } from "../gcStaff";
import type { GcPairingEvidence } from "../gcPairingEvidence";
import { isKeptApart, type KeptApart } from "../keptApart";
import { joinNamedAs, sameNamedAs } from "../teamRankings/namedAs";
import type { GcImportState, GcSeasonPairing } from "./types";
import { isSameSeason, linkAgeLevel, SEASON_ORDER, seasonStep } from "./ages";
import { isScored } from "./rows";
import { push } from "./poolIndex";
import { townKey } from "./filing";

/** A game two pulled clubs each hold a copy of: one opponent, one start, one result. */
export type GcTwinGame = {
  date: string;
  startTs: string;
  opponentName: string;
  /** From the clubs' seat, which is the same on both copies. */
  ownScore: number;
  opponentScore: number;
};

/** One squad on GameChanger twice, offered for the user to fold or keep apart. */
export type GcTwinSquad = {
  /** Offered as the one folded away: the club with fewer games of its own schedule. */
  fromTeamId: string;
  fromTeamName: string;
  toTeamId: string;
  toTeamName: string;
  /** A GameChanger id of each, which a "not the same" is recorded against (`keptApart.ts`). */
  fromGcId: string;
  toGcId: string;
  /** What GameChanger says each has played, and how many players it lists, where known. */
  fromRecord?: { win: number; loss: number; tie: number };
  toRecord?: { win: number; loss: number; tie: number };
  fromPlayers?: number;
  toPlayers?: number;
  /** The games both clubs hold, oldest first. */
  shared: GcTwinGame[];
};

/**
 * Two pulled clubs that are one squad on GameChanger twice: a tournament desk's copy, a parent's,
 * a coach's second setup under another name. Both post the same games, so every opponent is
 * credited with each of those games twice and the rating counts them twice; and the season pairing
 * above never offers them, since the names need not match at all.
 *
 * The games say it where the names do not. A pair is offered where the two clubs hold at least two
 * games against the same opponent at the same minute with the same result, have never been
 * scheduled against each other, and never had a game within the hour of each other against
 * different opponents, which one squad cannot do. On the pool of 24 September 2026 that was 55
 * pairs, holding 145 of the 283 games two pulled clubs held twice. One game in common is not
 * enough: the same search run with one club's games moved a week, where no such game is, found 68
 * pairs sharing one against 125 on the real dates, and none sharing two a week or a fortnight
 * either way. A pair that played each other is two squads whatever else they share, so is never
 * offered.
 *
 * Offered, never applied: folding keeps one club's name and drops the other, and only the user can
 * say which is the squad's own. "Not the same" is remembered against the GameChanger ids.
 */
export const proposeTwinSquads = (
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  apart: KeptApart = new Set<string>()
): GcTwinSquad[] => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const isPulled = (teamId: string) => Boolean(byId.get(teamId)?.gcTeams?.length);
  const gamesOf = new Map<string, ScoutGame[]>();
  /** Each pulled club's side of each timed, scored game, keyed by opponent, minute and result. */
  const sides = new Map<string, { club: string; game: ScoutGame }[]>();
  const keyOf = (opponent: string, minute: number, own: number, theirs: number) =>
    `${opponent}\u0000${minute}\u0000${own}-${theirs}`;
  games.forEach((game) => {
    push(gamesOf, game.teamAId, game);
    push(gamesOf, game.teamBId, game);
    const minute = startMinuteOf(game.startTs);
    if (minute === undefined || game.excluded) return;
    [game.teamAId, game.teamBId].forEach((club) => {
      if (!isPulled(club)) return;
      const seen = scoreSeenBy(game, club);
      if (!seen) return;
      const opponent = club === game.teamAId ? game.teamBId : game.teamAId;
      push(sides, keyOf(opponent, minute, seen.own, seen.opponent), { club, game });
    });
  });
  /** Every pair of clubs sharing a game, with the copies each holds: one game each, once. */
  const pairs = new Map<string, { a: string; b: string; copies: [ScoutGame, ScoutGame][] }>();
  sides.forEach((bucket) => {
    bucket.forEach((x, i) =>
      bucket.slice(i + 1).forEach((y) => {
        if (x.club === y.club || x.game === y.game) return;
        const [a, b] = x.club < y.club ? [x, y] : [y, x];
        const key = `${a.club}\u0000${b.club}`;
        let pair = pairs.get(key);
        if (!pair) {
          pair = { a: a.club, b: b.club, copies: [] };
          pairs.set(key, pair);
        }
        pair.copies.push([a.game, b.game]);
      })
    );
  });

  const fits = nameFitter();
  const offers: GcTwinSquad[] = [];
  pairs.forEach(({ a, b, copies }) => {
    const usedA = new Set<ScoutGame>();
    const usedB = new Set<ScoutGame>();
    const shared = copies
      .slice()
      .sort((p, q) => (p[0].startTs ?? "").localeCompare(q[0].startTs ?? ""))
      .filter(([x, y]) => {
        if (usedA.has(x) || usedB.has(y)) return false;
        usedA.add(x);
        usedB.add(y);
        return true;
      });
    if (shared.length < 2) return;
    const teamA = byId.get(a)!;
    const teamB = byId.get(b)!;
    const linksA = teamA.gcTeams ?? [];
    const linksB = teamB.gcTeams ?? [];
    if (linksA.some((x) => linksB.some((y) => isKeptApart(apart, x.teamId, y.teamId)))) return;
    const gamesA = gamesOf.get(a) ?? [];
    const gamesB = gamesOf.get(b) ?? [];
    if (gamesA.some((game) => game.teamAId === b || game.teamBId === b)) return;
    /*
     * One squad is in one game at a time: two games within the hour on one day are two squads. Two
     * games, though, and not one game each schedule named its own way — "No Chance Wildthings" and
     * "No Chance Wild Things", 2-6 on both at a quarter past six. So the results have to say two
     * games; unplayed, only two different pulled clubs do. Read off names alone, 17 of the 61 pairs
     * sharing two games on the pool of 24 September 2026 were refused for a clash, most of them
     * over one game typed two ways; read off the results, 6. One result against two pulled clubs is
     * one game too: "Music City Saints - Thompson" and "Music City Saints - Walsh", 3-8 on both at
     * one start, are two squads of one club of which one schedule named the wrong one. Three of
     * the 76 offers on the pool of 26 September 2026 rest on such a game.
     */
    const otherOf = (game: ScoutGame, club: string) =>
      game.teamAId === club ? game.teamBId : game.teamAId;
    const clash = gamesA.some((x) => {
      if (usedA.has(x) || !x.date) return false;
      const ox = byId.get(otherOf(x, a));
      if (!ox || ox.placeholder) return false;
      const seenX = scoreSeenBy(x, a);
      return gamesB.some((y) => {
        if (usedB.has(y) || y.date !== x.date || !startsWithinTheHour(x.startTs, y.startTs)) {
          return false;
        }
        const oy = byId.get(otherOf(y, b));
        if (!oy || oy.placeholder || oy.id === ox.id || fits(ox.name, oy.name)) return false;
        const seenY = scoreSeenBy(y, b);
        if (seenX && seenY) return seenX.own !== seenY.own || seenX.opponent !== seenY.opponent;
        return Boolean(ox.gcTeams?.length) && Boolean(oy.gcTeams?.length);
      });
    });
    if (clash) return;
    const own = (club: ScoutTeam) => {
      const ids = new Set((club.gcTeams ?? []).map((link) => link.teamId));
      return (gamesOf.get(club.id) ?? []).filter(
        (game) => game.source && ids.has(game.source.teamId)
      ).length;
    };
    const [from, to] =
      own(teamA) < own(teamB) || (own(teamA) === own(teamB) && teamA.id > teamB.id)
        ? [teamA, teamB]
        : [teamB, teamA];
    const fromLink = from.gcTeams![0]!;
    const toLink = to.gcTeams![0]!;
    offers.push({
      fromTeamId: from.id,
      fromTeamName: from.name,
      toTeamId: to.id,
      toTeamName: to.name,
      fromGcId: fromLink.teamId,
      toGcId: toLink.teamId,
      ...(fromLink.record ? { fromRecord: fromLink.record } : {}),
      ...(toLink.record ? { toRecord: toLink.record } : {}),
      ...(fromLink.playerCount === undefined ? {} : { fromPlayers: fromLink.playerCount }),
      ...(toLink.playerCount === undefined ? {} : { toPlayers: toLink.playerCount }),
      shared: shared.map(([x]) => {
        const seen = scoreSeenBy(x, a)!;
        return {
          date: x.date ?? "",
          startTs: x.startTs ?? "",
          opponentName: byId.get(otherOf(x, a))?.name ?? "",
          ownScore: seen.own,
          opponentScore: seen.opponent,
        };
      }),
    });
  });
  return offers.sort(
    (p, q) =>
      q.shared.length - p.shared.length ||
      p.fromTeamName.localeCompare(q.fromTeamName) ||
      p.fromTeamId.localeCompare(q.fromTeamId)
  );
};

/** How far from the game both schedules hold a third team's copy of it is read as that game. */
const COPY_REACH_MINUTES = 180;

/**
 * Sets a club's own row of a game not to count (`ScoutGame.countedElsewhere`) where it is a third
 * copy: the club it names already has the game against another pulled club, and both of those
 * clubs' own schedules hold it.
 *
 * One squad on GameChanger twice posts each game twice, and the second GameChanger team's row of a
 * game its opponent and the squad's first team both list stands as a game of its own, typed against
 * the opponent: the opponent is credited with the one game twice, once from each squad's copy.
 * Folding the two teams into one is the owner's to do (`proposeTwinSquads`), and is offered only
 * where they share two games or more; until then, and for a pair sharing one, the copy is read here.
 * A row of club X against pulled club C that none of C's schedules holds, beside a game of C's
 * against pulled club Y (not X) that both C's and Y's own schedules hold, within the hour, with the
 * same result from C's seat, is that game: C cannot have played two at once to one score, and the
 * game both schedules agree on is the one that counts. Asked of a bare row only, found by its own
 * id and holding nothing else, where one such game fits it, and where X's own schedules hold no
 * other game that hour, which one squad cannot play.
 *
 * On the backup of 11 October 2026, tidied, that sets 678 copies not to count, against 1.75 a shift
 * off with each such row moved one to four weeks either side, where its game is not: 0.26%. On the
 * backup of 25 September 2026, before most of those squads' second teams were pulled, it sets 33
 * against 2.25: about two a pool either way. Pool Health's list of games counted twice
 * (`countedTwice`) went from 957 groups to 279 on the first, 830 to 152 of those within the hour.
 * The row stays where it is, X's own game on X's page, and still feeds the offer to fold X and Y.
 * Nothing set is final: every pass reads the day again, and a copy the schedules stop bearing out —
 * Y's row gone, a score posted apart, a second game that fits as well — counts again.
 *
 * Out to three hours (`COPY_REACH_MINUTES`) where nothing fits within the hour: the squad's second
 * team often lists the game at another clock. Past the hour the rule is weaker, and the owner chose
 * it anyway on 21 October 2026, knowing so. On the 11 October backup, tidied, it sets 52 more copies
 * not to count, 41 of them within two hours, against 0.75 and 0.625 a shift off with each row moved one to four weeks
 * (61 to 120 minutes and 121 to 180). That shift finds few games near a moved row, though, and the
 * truer check is the games themselves: two real games of one club an hour to two apart give it one
 * result 0.69% of the time (226 of 32,913 pairs both sides' own schedules hold), two to three hours
 * apart 0.80% (113 of 14,165), and those copies had 1,007 and 575 such games near them. So as many
 * as seven and five of them, about one in five, may be a real game the club's own schedule left
 * out, now not counted. Within the hour nothing changes: one game that fits there is the game,
 * whatever fits further out, and two that fit there are left alone without looking further.
 * Past the hour the club's own schedules are asked about the game's hour too (below): 14 of the 52
 * were a club's playing a game of its own then, and count again, leaving 38 not to count.
 */
export const markCountedElsewhere = (
  state: GcImportState
): { state: GcImportState; marked: number } => {
  const pulled = new Set<string>();
  const clubOfSchedule = new Map<string, string>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    pulled.add(team.id);
    team.gcTeams.forEach((link) => clubOfSchedule.set(link.teamId, team.id));
  });
  /** The pulled clubs whose own schedules hold a game: the row it stands on and every row in it. */
  const holdersOf = (game: ScoutGame) => {
    const holders = new Set<string>();
    const add = (schedule: string | undefined) => {
      const club = schedule === undefined ? undefined : clubOfSchedule.get(schedule);
      if (club !== undefined) holders.add(club);
    };
    add(game.source?.teamId);
    game.alsoRows?.forEach((record) => add(record.teamId));
    game.alsoFrom?.forEach(add);
    return holders;
  };
  /** Each pulled club's games both its and its opponent's own schedules hold, timed and scored. */
  const confirmed = new Map<string, ScoutGame[]>();
  /** Each pulled club's games its own schedules hold, timed: what it was playing at each hour. */
  const busy = new Map<string, ScoutGame[]>();
  const copies: ScoutGame[] = [];
  state.games.forEach((game) => {
    if (game.excluded || game.withdrawn || !game.date || !game.startTs || !isScored(game)) return;
    const holders = holdersOf(game);
    holders.forEach((club) => push(busy, club, game));
    const { teamAId: a, teamBId: b } = game;
    if (a !== b && pulled.has(a) && pulled.has(b) && holders.has(a) && holders.has(b)) {
      push(confirmed, a, game);
      push(confirmed, b, game);
    }
    const club = game.source ? clubOfSchedule.get(game.source.teamId) : undefined;
    if (club === undefined || club !== a || b === a || !pulled.has(b) || holders.size !== 1) return;
    if (game.alsoRows?.length || game.alsoFrom?.length || game.reportedByB) return;
    if (game.scoreFromB || game.scoreFromTwin || game.joinedFrom !== undefined) return;
    if (game.id !== gcRowId(game.source!.teamId, game.source!.gameId)) return;
    copies.push(game);
  });
  const marks = new Set<string>();
  copies.forEach((copy) => {
    const { teamAId: x, teamBId: c } = copy;
    const sameResult = (confirmed.get(c) ?? []).filter((game) => {
      const y = game.teamAId === c ? game.teamBId : game.teamAId;
      if (y === x) return false;
      const gap = minutesApart(game.startTs, copy.startTs);
      if (gap === undefined || gap > COPY_REACH_MINUTES) return false;
      const seen = scoreSeenBy(game, c);
      return (
        seen !== undefined && seen.own === copy.teamBScore && seen.opponent === copy.teamAScore
      );
    });
    // Within the hour first, as ever; out to three hours only where nothing fits within it.
    const near = sameResult.filter((game) => startsWithinTheHour(game.startTs, copy.startTs));
    const fits = near.length > 0 ? near : sameResult;
    if (fits.length !== 1) return;
    const [fit] = fits;
    /*
     * Past the hour, X's own schedules are asked about the game's hour too, not the copy's alone:
     * a squad playing another game when C played Y did not post that game, and its row against C
     * is a game of its own, C's own row of it missing (found by Codex on #432).
     */
    const elsewhere = (busy.get(x) ?? []).some(
      (game) =>
        game.id !== copy.id &&
        (startsWithinTheHour(game.startTs, copy.startTs) ||
          (near.length === 0 && startsWithinTheHour(game.startTs, fit!.startTs)))
    );
    if (!elsewhere) marks.add(copy.id);
  });
  // A row against a TBD slot is `markTbdGames`'s to set and clear, and never a copy here.
  const tbd = tbdSlotIds(state.teams);
  let marked = 0;
  const games = state.games.map((game) => {
    if (tbd.has(game.teamAId) || tbd.has(game.teamBId)) return game;
    const mark = marks.has(game.id);
    if (mark === (game.countedElsewhere === true)) return game;
    marked += 1;
    if (mark) return { ...game, countedElsewhere: true as const };
    const { countedElsewhere: _counted, ...rest } = game;
    return rest;
  });
  return marked === 0 ? { state, marked: 0 } : { state: { ...state, games }, marked };
};

/** The slots listed as TBD (`namesTbd`): a placeholder nobody pulled. */
const tbdSlotIds = (teams: readonly ScoutTeam[]): Set<string> =>
  new Set(
    teams
      .filter((team) => team.placeholder && !team.gcTeams?.length && namesTbd(team.name))
      .map((team) => team.id)
  );

/**
 * Sets a scored game against a TBD slot not to count (`ScoutGame.countedElsewhere`), the owner's
 * rule of 26 October 2026: "That TBD game should be paired with another team that played at that
 * date and time. If it doesn't. It shouldn't count. I mean this only on Placeholder games listed as
 * TBD."
 *
 * A club's schedule lists "TBD- 08/29/26, 3:00 PM" where the opponent was not known when the game
 * went on it, and the import files it against a slot of its own (`ScoutTeam.placeholder`). Where
 * another team's schedule names the club at that start, the slot's row is folded into that game
 * before this (`resolveSlotGames`, `claimFiledRows`), and the game counts once, between the two. A
 * row still against a slot is one no schedule pairs at its start. Either another team's schedule
 * holds the club at about that hour, and that game counts in its place, the slot's row a second copy
 * of it; or nobody's does, and there is no telling who was played. Counted, it was a win or a loss
 * over an ordinary team, one more than the club played in the first case, and in the second a
 * result over nobody that moved the club's rating and its league's link to the rest of the table.
 * The Edgewood Longhorns, 9U in Kentucky, were 9-0 on the board of 26 October 2026, where their
 * league had them 8-0: the ninth was a 20-5 over "TBD- 08/29/26, 3:00 PM".
 *
 * Only a scored row is set, so a game still to come against a slot is the club's next game, and
 * only a slot listed as TBD (`namesTbd`), as the owner held it. The row stays on the club's page,
 * shown as not counted. Nothing set is final: a slot named as the club it was (a rename, which
 * merges the two) is no slot, and `markCountedElsewhere` reads the row again from then on.
 */
export const markTbdGames = (state: GcImportState): { state: GcImportState; marked: number } => {
  const tbd = tbdSlotIds(state.teams);
  if (tbd.size === 0) return { state, marked: 0 };
  let marked = 0;
  const games = state.games.map((game) => {
    if (!tbd.has(game.teamAId) && !tbd.has(game.teamBId)) return game;
    const mark = isScored(game);
    if (mark === (game.countedElsewhere === true)) return game;
    marked += 1;
    if (mark) return { ...game, countedElsewhere: true as const };
    const { countedElsewhere: _counted, ...rest } = game;
    return rest;
  });
  return marked === 0 ? { state, marked: 0 } : { state: { ...state, games }, marked };
};

/**
 * Clubs that look like one club listed twice. Offered, never applied: only the user can say that
 * two rosters are the same team, and merging two clubs that merely share a name would quietly ruin
 * both their ratings.
 *
 * Two shapes, because GameChanger mints an id per team per season and both of its consequences
 * reach the pool. A squad carrying on is the one this started as — a Fall id and the Spring id
 * that follows it, which must be joined or a rating cannot carry across a winter it cannot see.
 * The other is a squad listed *twice in one season*: a club creates an id, abandons it, creates
 * another, and the pool ends up with two entries for one roster — one holding every game, the
 * other holding only what other schedules happened to name it. That one was invisible here until
 * now, because the test for a pairing was that the seasons were consecutive, and these are the
 * same season.
 *
 * Teams already paired onto one entry are not offered again, since they are the same team here
 * already.
 */
export const proposeSeasonPairings = (
  teams: ScoutTeam[],
  games: readonly ScoutGame[] = [],
  apart: KeptApart = new Set<string>(),
  /**
   * The pool's pages, so a link is read in the squad year it was filed in. A winter label names
   * either year it straddles (`squadYearOfGcTeam`), and read off the label a Winter 2027 squad
   * playing from November 2026 was a year after its own Fall 2026 and Spring 2027.
   */
  ageGroups: readonly AgeGroup[] = []
): GcSeasonPairing[] => {
  const linked = teams.flatMap((team) => (team.gcTeams ?? []).map((link) => ({ team, link })));
  if (linked.length === 0) return [];
  const pageYear = new Map(ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const linkYear = (link: GcTeamLink): number =>
    pageYear.get(link.ageGroupId) ?? squadYearForGcSeason(link.season, link.seasonYear ?? 0);

  /**
   * Who each team has played, so "a club in common" can be asked without scanning the games. Only
   * pulled clubs count as an opponent in common: a stand-in called "Warriors" that two schedules
   * both named is two clubs' rec-league neighbours, not one club both of them met.
   */
  const pulledIds = new Set(teams.filter((team) => team.gcTeams?.length).map((team) => team.id));
  const opponents = new Map<string, Set<string>>();
  const note = (teamId: string, opponentId: string) => {
    if (!pulledIds.has(opponentId)) return;
    const met = opponents.get(teamId);
    if (met) met.add(opponentId);
    else opponents.set(teamId, new Set([opponentId]));
  };
  games.forEach((game) => {
    note(game.teamAId, game.teamBId);
    note(game.teamBId, game.teamAId);
  });
  const shareAnOpponent = (a: string, b: string): boolean => {
    const mine = opponents.get(a);
    const theirs = opponents.get(b);
    if (!mine || !theirs) return false;
    for (const opponent of mine) {
      if (theirs.has(opponent)) return true;
    }
    return false;
  };

  /*
   * Only a shared name can make a pairing, so those are the only ids worth looking at for each
   * team. Comparing every id with every other was fine for one club's list and several seconds for
   * a nationwide one, at the end of every pull.
   */
  const byName = new Map<string, typeof linked>();
  linked.forEach((entry) => {
    const key = teamNameKey(entry.link.name);
    const bucket = byName.get(key);
    if (bucket) bucket.push(entry);
    else byName.set(key, [entry]);
  });
  const candidatesFor = (from: (typeof linked)[number]): typeof linked =>
    byName.get(teamNameKey(from.link.name)) ?? [];

  /**
   * Who coaches each team, over every GameChanger id it is linked to.
   *
   * The staff comes off the user's own team list — GameChanger's public API returns none — so a
   * pool built by hand, or pulled before the list carried it, simply has no staff and everything
   * that reads this falls back on what it always used. Where it is there it is the best thing in
   * the data: `gcStaff.ts` has the measurements.
   */
  const staffIndex = buildStaffIndex(
    teams.map((team) => ({
      teamId: team.id,
      staff: [...new Set((team.gcTeams ?? []).flatMap((link) => link.staff ?? []))],
    }))
  );

  /**
   * How many games each GameChanger id put into the pool off its own schedule.
   *
   * Zero is the tell. An id somebody created and never used still collects games — every club that
   * played it lists the fixture, and those arrive filed against it from the other side — so it
   * looks like a team with a record until you ask which of those games it listed itself. None of
   * them. A club's real second squad at one age level has its own schedule; an abandoned duplicate
   * cannot have one, because nobody ever put a game on it.
   */
  const ownSchedule = new Map<string, number>();
  games.forEach((game) => {
    const listed = game.source?.teamId;
    if (listed === undefined) return;
    ownSchedule.set(listed, (ownSchedule.get(listed) ?? 0) + 1);
  });
  const ownGames = (link: GcTeamLink): number => ownSchedule.get(link.teamId) ?? 0;

  /**
   * The offers, each with the two things the filters below need and the caller does not: whether
   * it crosses into the next squad year, and how far into that year the target season sits.
   */
  const candidates: { pairing: GcSeasonPairing; crossing: boolean; at: number }[] = [];
  for (const from of linked) {
    for (const to of candidatesFor(from)) {
      if (from.team.id === to.team.id) continue;
      if (isKeptApart(apart, from.link.teamId, to.link.teamId)) continue;
      const sameSeason = isSameSeason(from.link, to.link);
      const carriesOn = sameSeason ? null : seasonStep(from.link, to.link, linkYear);
      if (!sameSeason && carriesOn === null) continue;
      /*
       * The ages, which mean different things either side of a season boundary.
       *
       * Inside one season a squad is one age, so two ids at two ages are two squads and there is
       * nothing to discuss. Across seasons the age is exactly what changes: a club's 10U in Spring
       * 2026 is its 11U in Fall 2026 and still its 11U in Spring 2027, and refusing the pairing
       * whenever the levels differed — which is what this did — broke the carry-over at every
       * birthday and left the rating with nothing to follow across the winter. One year, forward
       * only: a squad ages up or stays, it never gets younger, and a two-year jump is somebody
       * else's team.
       *
       * Both ages have to be known. An age nobody wrote down is not an age two ids have in
       * common, and treating two blanks as a match is how "same name, different age" pairs were
       * being offered at all. Where GameChanger gave no level the name usually did, and
       * `relevelFromNames` has already read it by the time anything gets here.
       */
      const fromLevel = linkAgeLevel(from.link);
      const toLevel = linkAgeLevel(to.link);
      if (fromLevel === undefined || toLevel === undefined) continue;
      if (toLevel - fromLevel !== (carriesOn === "ages-up" ? 1 : 0)) continue;
      /*
       * One direction only, for a pair in one season. There is no earlier and later to order them
       * by, so both directions qualify and the pair would be offered twice, pointing opposite
       * ways. The one folded away is the one with less of a schedule of its own — which in the
       * case this was written for is the one with none at all — and the id settles a tie so the
       * list does not depend on which team the loop reached first.
       */
      if (sameSeason) {
        const mine = ownGames(from.link);
        const theirs = ownGames(to.link);
        if (mine > theirs) continue;
        if (mine === theirs && from.link.teamId >= to.link.teamId) continue;
      }

      /*
       * The listings' own key, not the club key. `teamNameKey` drops a parenthetical, because
       * "Heat 9U (Ealey)" and "Heat 9U" are one club for an opponent to have played — but they
       * are two squads, and this is the question of whether two ids are one roster. Matching on
       * the club key was offering "(Ealey)" against "(Brown)" as the same team under a chip that
       * said "same name", which is exactly the kind of wrong that gets approved in bulk.
       */
      const sameName = squadNameKey(from.link.name) === squadNameKey(to.link.name);
      const evidence: GcPairingEvidence[] = [];
      if (sharedStaff(from.team.id, to.team.id, staffIndex).length >= 2) evidence.push("staff");
      // A town is evidence only in its own state: Lawrenceburg IN is not Lawrenceburg KY.
      const city = townKey(from.team.city);
      if (city && city === townKey(to.team.city) && from.team.state === to.team.state) {
        evidence.push("city");
      }
      if (from.team.state && from.team.state === to.team.state) evidence.push("state");
      if (shareAnOpponent(from.team.id, to.team.id)) evidence.push("shared-opponent");
      if (sameSeason && (ownGames(from.link) === 0 || ownGames(to.link) === 0)) {
        evidence.push("no-schedule");
      }

      /**
       * A shared name is not enough on its own, and this is where that used to be the whole test.
       * A pool pulled from a nationwide list holds dozens of clubs called the same thing, so a
       * name-only rule offered a page of pairings that were mostly wrong, which is worse than
       * offering none: read enough of them and they all start looking approvable.
       */
      /*
       * The name and the state are asked of every pairing, not weighed against the rest.
       *
       * Not a picture: GameChanger does not keep a club's badge across seasons. Over a nationwide
       * pull 7,948 teams carried 7,948 distinct pictures and not one was shared by two of them. The
       * state is the cheapest thing that is true of a club and not of its namesake three states
       * away.
       */
      if (!sameName) continue;
      if (!evidence.includes("state")) continue;
      /*
       * Two GameChanger accounts a season apart with one name in one state are, as often as not,
       * two rec-league teams in two towns. A town in common, a pulled club in common, or two
       * coaches is what makes one squad out of them.
       */
      if (evidence.every((item) => item === "state")) continue;

      /*
       * A single season asks for all of it, because inside one season the innocent explanation is
       * a real one: a club running an A and a B squad at 9U names them the same thing, in the same
       * town, in the same state, and merging those two destroys both. So a same-season offer needs
       * the listings to agree on everything there is to agree on — the name exactly, the age, the
       * town and the state — and then the coaches on top, which is the only field in the data that
       * says anything about an organisation. Two in common is the same town 89% of the time
       * against 43% for one; `likelySameSquad` is that rule written down with the age level and
       * the season it needs.
       */
      if (sameSeason) {
        const squadOf = (teamId: string) => {
          const link = teamId === from.team.id ? from.link : to.link;
          return {
            ...(link.ageLevel === undefined ? {} : { ageLevel: link.ageLevel }),
            ...(link.season === undefined || link.seasonYear === undefined
              ? {}
              : { season: { season: link.season, year: link.seasonYear } }),
          };
        };
        if (!evidence.includes("city")) continue;
        if (!likelySameSquad(from.team.id, to.team.id, staffIndex, squadOf)) continue;
      }

      candidates.push({
        crossing: carriesOn === "ages-up",
        at: SEASON_ORDER.indexOf((to.link.season ?? "") as (typeof SEASON_ORDER)[number]),
        pairing: {
          fromTeamId: from.team.id,
          fromTeamName: from.team.name,
          fromSeason: gcSeasonLabel(from.link) || "an unlabelled season",
          toTeamId: to.team.id,
          toTeamName: to.team.name,
          toSeason: gcSeasonLabel(to.link) || "an unlabelled season",
          fromGcId: from.link.teamId,
          toGcId: to.link.teamId,
          evidence,
          sameName,
          /*
           * The name and the state are asked of everything here now, so neither can grade
           * anything: counting them made every offer "strong", which is a grading that says
           * nothing. What is left is what a pairing actually rests on beyond them — two coaches in
           * common, or the same town — against a club in common or an empty id, which get this far
           * and are worth reading but not worth approving in bulk.
           */
          confidence: evidence.includes("staff") || evidence.includes("city") ? "strong" : "likely",
          kind: sameSeason ? "same-season" : "next-season",
        },
      });
    }
  }

  /**
   * A squad carries on into exactly one next season. Where two clubs both qualify as the one this
   * team became, neither is offered: the whole point of asking is that the answer is not obvious,
   * and a list that offers both invites picking whichever was read first.
   */
  const outgoing = new Map<string, number>();
  candidates.forEach(({ pairing }) => {
    const key = `${pairing.fromTeamId}\u0000${pairing.toSeason}`;
    outgoing.set(key, (outgoing.get(key) ?? 0) + 1);
  });

  /**
   * And into exactly one next squad *year*, at the first season of it that is here.
   *
   * A club that ran Spring 2026, Fall 2026 and Spring 2027 qualifies twice over on the crossing:
   * the Spring 2026 squad became the Fall 2026 one, and by the same arithmetic it became the
   * Spring 2027 one. Both are true and only the first is worth offering — the second is the same
   * fold arrived at the long way round, and folding along the chain reaches it anyway. Offering
   * both is two rows for one decision, which is precisely the noise that makes a list stop being
   * read.
   */
  const earliest = new Map<string, number>();
  candidates.forEach(({ pairing, crossing, at }) => {
    if (!crossing) return;
    const seen = earliest.get(pairing.fromTeamId);
    if (seen === undefined || at < seen) earliest.set(pairing.fromTeamId, at);
  });

  return (
    candidates
      .filter(
        ({ pairing, crossing, at }) =>
          outgoing.get(`${pairing.fromTeamId}\u0000${pairing.toSeason}`) === 1 &&
          (!crossing || at === earliest.get(pairing.fromTeamId))
      )
      .map(({ pairing }) => pairing)
      // Strongest first, so the ones worth approving in bulk are together at the top.
      .sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "strong" ? -1 : 1))
  );
};

/**
 * A pairing that needs nobody's say-so: the same name, the same town and the same state, a season
 * apart at one level. That is a club, not a coincidence — two Butler Baseballs in one town in one
 * state at 9U, one Fall and one Spring, are the same roster with a new GameChanger id. Anything
 * short of all three is offered rather than applied: a name and a state alone still fit a dozen
 * clubs across a state, and a name and a club in common fits any two teams from one league.
 *
 * Never a pairing inside one season, however much evidence it carries. A season apart, the same
 * name in one town is one roster because a club does not run two squads a season apart under one
 * name at one age; inside a season it is exactly what an A squad and a B squad look like, and the
 * thing telling those apart from one roster listed twice — a side with no schedule of its own, or
 * the coaches — is inference rather than arithmetic. `gcStaff.ts` says it plainly of its own
 * evidence: nothing there merges anything, it proposes. So does this.
 */
export const isSettledPairing = (pairing: GcSeasonPairing): boolean =>
  pairing.kind === "next-season" &&
  pairing.sameName &&
  pairing.evidence.includes("city") &&
  pairing.evidence.includes("state");

/**
 * Applies the settled pairings — earlier squad folded into the later one, as the panel does when
 * a pairing is ticked. A squad paired on into a season that was itself paired on follows the
 * chain to whichever entry survived, so Fall → Winter → Spring ends as one team whatever order
 * the pairs come in.
 */
export const pairSettledSquads = (
  state: GcImportState,
  progress?: (processed: number, total: number, paired: number) => void,
  apart: KeptApart = new Set<string>()
): { state: GcImportState; paired: number } => {
  const settled = proposeSeasonPairings(state.teams, state.games, apart, state.ageGroups).filter(
    isSettledPairing
  );
  if (settled.length === 0) return { state, paired: 0 };

  /*
   * Resolve the graph before touching the pool. Calling `mergeScoutTeams` here used to walk every
   * team and every game once per edge (and collapse games along the way). A nationwide batch has
   * thousands of edges. The map below makes the decision once, then each array is walked once.
   */
  const outgoing = new Map<string, string[]>();
  settled.forEach((pairing, index) => {
    push(outgoing, pairing.fromTeamId, pairing.toTeamId);
    // Frequent enough to prove a large pass is alive without flooding the worker port.
    if (progress && ((index + 1) % 100 === 0 || index + 1 === settled.length))
      progress(index + 1, settled.length, outgoing.size);
  });

  /*
   * A season can have both a direct Fall -> Spring edge and Fall -> Winter -> Spring edges. Follow
   * any branch to its sink; settled branches converge on the same latest squad. Resolving after
   * collecting them makes the answer independent of proposal order.
   */
  const movedTo = new Map<string, string>();
  const survivorOf = (teamId: string, seen = new Set<string>()): string => {
    const known = movedTo.get(teamId);
    if (known) return known;
    if (seen.has(teamId)) return teamId;
    const next = outgoing.get(teamId)?.[0];
    if (!next) return teamId;
    seen.add(teamId);
    const survivor = survivorOf(next, seen);
    movedTo.set(teamId, survivor);
    return survivor;
  };
  outgoing.forEach((_into, from) => survivorOf(from));
  const paired = movedTo.size;
  const byId = new Map(state.teams.map((team) => [team.id, team]));
  const removed = new Set(movedTo.keys());
  const members = new Map<string, ScoutTeam[]>();
  movedTo.forEach((into, from) => {
    const team = byId.get(from);
    if (team) push(members, into, team);
  });
  const teams = state.teams.flatMap((team) => {
    if (removed.has(team.id)) return [];
    const folded = members.get(team.id);
    if (!folded?.length) return [team];
    const links = [...(team.gcTeams ?? [])];
    const linked = new Set(links.map((link) => link.teamId));
    folded.forEach((old) =>
      (old.gcTeams ?? []).forEach((link) => {
        if (!linked.has(link.teamId)) {
          linked.add(link.teamId);
          links.push(link);
        }
      })
    );
    const fallback = (field: "name" | "state" | "city") =>
      folded.map((old) => old[field]).find(Boolean);
    // The owner's answers for the squads paired away go with the squad they pair into
    // (`ScoutTeam.namedAs`), as their links do.
    const { namedAs: _held, ...unnamed } = team;
    const joined = joinNamedAs([team.namedAs, ...folded.map((old) => old.namedAs)]);
    const namedAs = sameNamedAs(joined, team.namedAs) ? team.namedAs : joined;
    return [
      {
        ...unnamed,
        ...(!team.name.trim() && fallback("name") ? { name: fallback("name") } : {}),
        ...(!team.state && fallback("state") ? { state: fallback("state") } : {}),
        ...(!team.city && fallback("city") ? { city: fallback("city") } : {}),
        ...(team.isMine || folded.some((old) => old.isMine) ? { isMine: true } : {}),
        ...(links.length ? { gcTeams: links } : {}),
        ...(namedAs?.length ? { namedAs } : {}),
      },
    ];
  });
  const games = state.games.flatMap((game) => {
    const teamAId = movedTo.get(game.teamAId) ?? game.teamAId;
    const teamBId = movedTo.get(game.teamBId) ?? game.teamBId;
    // A game the pairing made one squad's against itself; one some team already had against itself
    // is not the pairing's to take (`mergeScoutTeams`).
    if (teamAId === teamBId && game.teamAId !== game.teamBId) return [];
    const moved =
      teamAId === game.teamAId && teamBId === game.teamBId ? game : { ...game, teamAId, teamBId };
    // A row claimed from a squad paired away was filed against the squad it pairs into.
    return [withFiledRepointed(moved, (id) => movedTo.get(id) ?? id)];
  });
  return { state: { ...state, teams, games }, paired };
};

/** One side of a pairing, as the user would compare it with the other. */
export type GcPairingSide = {
  teamName: string;
  /** The name exactly as GameChanger has it for this season's id. */
  gcName: string;
  season: string;
  city?: string;
  state?: string;
  record?: { win: number; loss: number; tie: number };
  /** Games this entry holds here. */
  games: number;
  /** Everyone this entry has played, by name. */
  opponents: string[];
};

export type GcPairingComparison = {
  from: GcPairingSide;
  to: GcPairingSide;
  /** Opponents both have played — the strongest thing two rosters a season apart can share. */
  sharedOpponents: string[];
};

/**
 * The two clubs of a pairing side by side: what GameChanger said about each, where each is from,
 * and who each has played. This is what a person looks at before saying two rosters are one — the
 * list offers a pill's worth of evidence, and a pill is not enough to decide an amber one on.
 */
export const comparePairing = (
  pairing: GcSeasonPairing,
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[]
): GcPairingComparison | null => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const side = (teamId: string, season: string): GcPairingSide | null => {
    const team = byId.get(teamId);
    if (!team) return null;
    const link =
      team.gcTeams?.find((candidate) => gcSeasonLabel(candidate) === season) ?? team.gcTeams?.[0];
    const opponents = new Set<string>();
    let count = 0;
    games.forEach((game) => {
      if (game.teamAId !== teamId && game.teamBId !== teamId) return;
      count += 1;
      const other = byId.get(game.teamAId === teamId ? game.teamBId : game.teamAId);
      if (other) opponents.add(other.name);
    });
    return {
      teamName: team.name,
      gcName: link?.name ?? team.name,
      season,
      ...(team.city ? { city: team.city } : {}),
      ...(team.state ? { state: team.state } : {}),
      ...(link?.record ? { record: link.record } : {}),
      games: count,
      opponents: [...opponents].sort((a, b) => a.localeCompare(b)),
    };
  };
  const from = side(pairing.fromTeamId, pairing.fromSeason);
  const to = side(pairing.toTeamId, pairing.toSeason);
  if (!from || !to) return null;
  const theirs = new Set(to.opponents);
  return { from, to, sharedOpponents: from.opponents.filter((name) => theirs.has(name)) };
};
