/**
 * The tidy's reading of bracket slots: a TBD row settled by the game another club's own schedule
 * holds at that minute (`resolveSlotGames`). Split out of `gameChangerImport.ts`, which re-exports
 * what it always exported.
 */

import {
  filedTeamIds,
  gcRowId,
  nameFitter,
  sameStart,
  type ScoutGame,
  withSchedulesOf,
} from "../teamRankings";
import { inOneRegion } from "../stateBorders";
import { listedByOwn, NO_REFUSALS, type NotThisTeam, refusesName } from "../notThisTeam";
import type { GcImportState } from "./types";
import { isScored } from "./rows";

/**
 * Names the slots that another schedule already answered.
 *
 * A bracket posts "TBD" on one team's schedule and the real fixture on the other's, so the same
 * game arrives twice and disagrees with itself: one row says the club played a placeholder, the
 * other names both sides. Left alone that is a fixture counted twice, and a slot standing where a
 * real opponent belongs. The named row is the better evidence — a schedule that names a club is
 * saying who turned up — so it wins, and the slot's row is folded into it.
 *
 * What makes this safe rather than a guess is where the naming row comes from and when it kicked
 * off. It usually has to come from a *different* GameChanger team's schedule: if a club's own
 * schedule lists both a placeholder and a named opponent that day, those are as a rule two
 * different games it is playing, and neither names the other. Where both rows carry a start time
 * they must agree on it, which is what tells the two halves of a doubleheader apart. Without
 * times, the day has to hold exactly one candidate; anything less certain is left as it is,
 * because a wrong answer here silently moves a result onto a club that never played it.
 *
 * The exception is the clock, and it is not a heuristic. One schedule listing a placeholder and a
 * named opponent at the *same instant* is not two games: nobody plays two at once. That is a
 * bracket slot the club posted before the opponent was known and then posted again once it was,
 * and left alone it stands in the pool as a second result — a phantom extra win or loss on a
 * record that already counts the real one. Every GameChanger row carries the time, because the
 * date is worked out from it, so this costs nothing to ask.
 *
 * The clock also settles a result the two coaches scored differently. A club's own row against a
 * stand-in, and the other club's row naming it at the very same start time, are one game however
 * they were scored, provided the stand-in's name is a shorthand for that other club. On the
 * stand-in fixtures export of 22 September 2026 that held 479 games twice: 358 a single run apart
 * with the same winner, 13 with the winner changed. The named row's result stands and carries the
 * other, as `collapseSameGames` keeps a game two pulled clubs scored apart. Where the names do not
 * fit (303 more) or the slot is a bracket placeholder (143), the two rows stay — unless the named
 * row is one none of the club's own schedules gives a row, which `claimFiledRows` reads later in the
 * tidy by the clock and the scores alone.
 */
export const resolveSlotGames = (
  state: GcImportState,
  /**
   * The names the owner has said are not a club (`notThisTeam.ts`): a slot of such a name settles
   * into no row of the day against that club but the club's own.
   */
  refused: NotThisTeam = NO_REFUSALS
): { state: GcImportState; resolved: number } => {
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const fits = nameFitter();
  /*
   * A side nobody has vouched for: a bracket slot, or a club known only because some schedule
   * wrote its name down. Both are stand-ins that a later schedule can turn out to have named
   * properly, and both have to be reconsidered every time a pull adds teams — the club that
   * settles a stand-in may not have been pulled when the stand-in was made.
   */
  const isSlot = (teamId: string) => {
    const team = teamById.get(teamId);
    return team?.placeholder === true || team?.nameOnly === true;
  };

  const slotGames = state.games.filter(
    (game) => isSlot(game.teamAId) !== isSlot(game.teamBId) && Boolean(game.date)
  );
  if (slotGames.length === 0) return { state, resolved: 0 };

  /** Games with two real sides, indexed by the known team and day they could answer for. */
  const namedByTeamDay = new Map<string, ScoutGame[]>();
  const dayKey = (teamId: string, date: string) => `${teamId}@${date}`;
  state.games.forEach((game) => {
    if (!game.date) return;
    if (isSlot(game.teamAId) || isSlot(game.teamBId)) return;
    [game.teamAId, game.teamBId].forEach((teamId) => {
      const key = dayKey(teamId, game.date!);
      const bucket = namedByTeamDay.get(key);
      if (bucket) bucket.push(game);
      else namedByTeamDay.set(key, [game]);
    });
  });
  if (namedByTeamDay.size === 0) return { state, resolved: 0 };

  const sourceOf = (game: ScoutGame) => game.source?.teamId;
  /**
   * Whether a game has a row off the slot row's schedule other than the slot row itself: its own,
   * or one folded into it. The slot row's own record does not count — a refresh of one page files
   * again a row the pool holds folded into a game on another page, and that copy settles back into
   * the game that holds it.
   */
  const holdsSchedule = (game: ScoutGame, slotGame: ScoutGame) => {
    const schedule = sourceOf(slotGame);
    if (schedule === undefined) return false;
    if (sourceOf(game) === schedule) return true;
    const slotRow = gcRowId(schedule, slotGame.source!.gameId);
    const records = (game.alsoRows ?? []).filter((record) => record.teamId === schedule);
    if (records.length > 0) {
      return records.some((record) => gcRowId(record.teamId, record.gameId) !== slotRow);
    }
    return (game.alsoFrom ?? []).includes(schedule);
  };
  /** A named row already used to answer a slot cannot answer a second one. */
  const spoken = new Set<string>();
  /** Slot rows to drop, and the named row each one's scores were folded into. */
  const merges = new Map<string, ScoutGame>();

  /**
   * Settles one slot. `exact` asks for a start time that agrees as well; the exact round runs
   * first over every slot, so that where two slots on one day could both take the same named row
   * — a doubleheader against one club, written as two "TBD"s with the same score — the one whose
   * time matches claims it, and the other is left rather than given the wrong half.
   */
  const settle = (slotGame: ScoutGame, exact: boolean) => {
    if (merges.has(slotGame.id)) return;
    const knownId = isSlot(slotGame.teamAId) ? slotGame.teamBId : slotGame.teamAId;
    const slotKnown = slotGame.teamAId === knownId ? slotGame.teamAScore : slotGame.teamBScore;
    const slotOther = slotGame.teamAId === knownId ? slotGame.teamBScore : slotGame.teamAScore;
    /** The two rows give the same result from the known club's seat. */
    const mirrors = (named: ScoutGame): boolean => {
      if (!isScored(slotGame) || !isScored(named)) return false;
      const namedKnown = named.teamAId === knownId ? named.teamAScore : named.teamBScore;
      const namedOther = named.teamAId === knownId ? named.teamBScore : named.teamAScore;
      return slotKnown === namedKnown && slotOther === namedOther;
    };
    const sameTime = (named: ScoutGame): boolean => sameStart(slotGame.startTs, named.startTs);
    const timeAgrees = (named: ScoutGame): boolean =>
      slotGame.startTs === undefined || named.startTs === undefined || sameTime(named);
    const standIn = teamById.get(
      knownId === slotGame.teamAId ? slotGame.teamBId : slotGame.teamAId
    );
    const refusedAgainst = (slot: ScoutGame, named: ScoutGame): boolean => {
      const club = teamById.get(named.teamAId === knownId ? named.teamBId : named.teamAId);
      return refusesName(refused, sourceOf(slot), standIn?.name, club) && !listedByOwn(named, club);
    };
    /**
     * Asked only of a named row whose result contradicts the slot's: whether it is still this
     * game. It is when the other club's schedule has it at this very start time — the known club
     * cannot have played two games at once — and the stand-in's name is a shorthand for the club
     * that row is against. A bracket slot has no name to hold the row to, and is left as it was.
     */
    const scoredApart = (named: ScoutGame): boolean => {
      if (!sameTime(named) || sourceOf(named) === sourceOf(slotGame)) return false;
      if (!standIn?.nameOnly) return false;
      const namedOther = teamById.get(named.teamAId === knownId ? named.teamBId : named.teamAId);
      return namedOther !== undefined && fits(standIn.name, namedOther.name);
    };

    const candidates = (namedByTeamDay.get(dayKey(knownId, slotGame.date!)) ?? []).filter(
      (named) =>
        !spoken.has(named.id) &&
        /*
         * A game none of whose rows is off this schedule — or one that is, where the two start at
         * the same instant, since a club cannot be playing both of them. One schedule lists one
         * game once: a row settled into a game already holding its own schedule's row was one the
         * tidy's regroup then stood back up against the named club, a result filed against a club
         * that never played it (`collapseSameGames` keeps no stand-in on the record).
         */
        sourceOf(named) !== undefined &&
        (!holdsSchedule(named, slotGame) || sameTime(named)) &&
        /*
         * Not a game against a club the owner has said the stand-in's name is not, unless the
         * club's own schedule gave it a row: then the club says it played this game, and the
         * refusal, which is about a name, has nothing to say (`listedByOwn`).
         */
        !refusedAgainst(slotGame, named) &&
        /*
         * Two results that contradict are two games, unless they are one game scored apart
         * (`scoredApart`). Folding the slot into the one named row of the day regardless was
         * deleting real results: on a pool with no start times to hold it back, that fallback
         * threw away 1,976 scored games in one tidy.
         */
        (!(isScored(slotGame) && isScored(named) && !mirrors(named)) || scoredApart(named))
    );

    /*
     * The score first. The same fixture written down twice agrees on what it finished, from each
     * side's point of view, and that is true even when the two coaches typed different start
     * times — which they do often enough that requiring the time to agree left a thousand
     * settled games standing as stand-ins. Where exactly one named row mirrors the result, that
     * is the one; where several do, the time picks between them. Failing a result on both sides,
     * the day — provided a time on both sides agrees. A pool-play day against one club is two or
     * three games with no times posted, and picking between them by the day alone is the guess
     * this function refuses to make.
     */
    const agreeing = candidates.filter(mirrors);
    const pool = agreeing.length > 0 ? agreeing : candidates;
    const shortlist = exact
      ? pool.filter(sameTime)
      : agreeing.length === 1
        ? agreeing
        : pool.filter(timeAgrees);
    if (shortlist.length !== 1) return;

    const named = shortlist[0]!;
    /*
     * Across regions, the clock alone is not a game (`claimFiledRows` says why): a row with no
     * result on either side settles nowhere there, whatever the stand-in is called. "Blue" is in
     * "Marucci Prospects New York Blue", and an Indiana club of that name is not the team a
     * Connecticut club typed. A refusal and not a filter, so the region never picks between two
     * games the clock could not.
     */
    const otherSide = teamById.get(named.teamAId === knownId ? named.teamBId : named.teamAId);
    if (
      (!isScored(slotGame) || !isScored(named)) &&
      !inOneRegion(teamById.get(knownId)?.state, otherSide?.state)
    ) {
      return;
    }
    spoken.add(named.id);
    merges.set(slotGame.id, named);
  };
  slotGames.forEach((slotGame) => settle(slotGame, true));
  slotGames.forEach((slotGame) => settle(slotGame, false));

  if (merges.size === 0) return { state, resolved: 0 };

  // The named row keeps its id and its side order; only a score it does not have is taken from the
  // slot's row, since a placeholder's schedule can carry a result the other's has not posted yet.
  const filled = new Map<string, ScoutGame>();
  const gamesById = new Map(state.games.map((game) => [game.id, game]));
  merges.forEach((named, slotId) => {
    const slotGame = gamesById.get(slotId);
    if (!slotGame) return;
    const current = filled.get(named.id) ?? named;

    /*
     * Where the settled row came from, remembered on the row that survives.
     *
     * The fold is about to remove a row, and with it the fact that its schedule listed this
     * opponent that day. That fact decides whether a later contradicting result is a second game
     * or a scorekeeping dispute: a club writing one named game and one "TBD" against the same
     * opponent is saying they met twice, and without this the two results are indistinguishable
     * from one game written down differently — which is how a real result came to be deleted.
     */
    const recorded = withSchedulesOf(current, slotGame);

    // A score is only taken from the stand-in's row when the surviving row has none: the other
    // schedule may have posted a result this one has not.
    const fillScore = isScored(slotGame) && !isScored(named);
    const knownId = isSlot(slotGame.teamAId) ? slotGame.teamBId : slotGame.teamAId;
    const knownScore = slotGame.teamAId === knownId ? slotGame.teamAScore : slotGame.teamBScore;
    const otherScore = slotGame.teamAId === knownId ? slotGame.teamBScore : slotGame.teamAScore;
    // Settled against a result it contradicts, at one start time: the named row's result stands
    // and carries the slot's, as `collapseSameGames` keeps a game two pulled clubs scored apart.
    const namedKnownScore = named.teamAId === knownId ? named.teamAScore : named.teamBScore;
    const namedOtherScore = named.teamAId === knownId ? named.teamBScore : named.teamAScore;
    const disputed =
      isScored(slotGame) &&
      isScored(named) &&
      (namedKnownScore !== knownScore || namedOtherScore !== otherScore);
    const [reportedA, reportedB] =
      named.teamAId === knownId ? [knownScore, otherScore] : [otherScore, knownScore];

    /*
     * The slot's row is the known club's own copy. Where that club is the named row's side B, its
     * score goes beside the named row's (`reportedByB`) rather than into a note, as every other
     * copy off the other club's schedule does; where it is side A, it is that club's own schedule
     * scoring the game twice.
     */
    if (named.teamBId === knownId && isScored(slotGame)) {
      const report = { teamAScore: otherScore!, teamBScore: knownScore! };
      // A score taken where the named row had none is only side B's, and is marked so, as
      // `withSideBReport` marks it: side A's own score replaces it when that schedule posts one.
      filled.set(named.id, {
        ...recorded,
        ...(fillScore ? { ...report, scoreFromB: true } : {}),
        reportedByB: report,
      });
      return;
    }
    filled.set(named.id, {
      ...recorded,
      ...(disputed
        ? {
            note: [current.note, `Also reported ${reportedA}-${reportedB}.`]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
      ...(fillScore
        ? named.teamAId === knownId
          ? { teamAScore: knownScore, teamBScore: otherScore }
          : { teamAScore: otherScore, teamBScore: knownScore }
        : {}),
    });
  });

  const games = state.games
    .filter((game) => !merges.has(game.id))
    .map((game) => filled.get(game.id) ?? game);

  // A stand-in nothing references any more is not a club and should not linger in the roster.
  // One carrying GameChanger ids is a club a hand merge left flagged, and is never removed here.
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter(
    (team) =>
      (!team.placeholder && !team.nameOnly) ||
      Boolean(team.gcTeams?.length) ||
      stillUsed.has(team.id)
  );

  return { state: { ...state, teams, games }, resolved: merges.size };
};
