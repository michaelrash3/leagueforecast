/**
 * The tidy's settling of stand-ins: rows taken off a club that plays nowhere near that age or that
 * club (`resettleOffLevel`), rows refiled onto the club a name means (`refileStandIns`), and one
 * opponent entered twice made one (`mergeDuplicateStandIns`). Split out of `gameChangerImport.ts`,
 * which re-exports what it always exported.
 */

import { ageFromGradYearInName } from "../gameChangerApi";
import {
  ageGroupLevel,
  ageGroupYear,
  buildScoutTeam,
  filedTeamIds,
  isPlaceholderName,
  looseNameKey,
  minutesApart,
  nameFitter,
  namesNobody,
  ONE_GAME_WINDOW_MINUTES,
  sameStart,
  type ScoutGame,
  type ScoutTeam,
  startsWithinTheHour,
  teamNameKey,
  withFiledRepointed,
} from "../teamRankings";
import { borderingStates, farApart } from "../stateBorders";
import { listedByOwn, NO_REFUSALS, type NotThisTeam, refusesName } from "../notThisTeam";
import type { MintedIds } from "../teamRankings/retiredIds";
import {
  answeredIn,
  inStateNamesakes,
  oneNamesake,
  pulledNamesOf,
  type RefileRefusal,
  SHIPPED_TIDY_RULES,
  soleNamesakes,
  type TidyRules,
} from "./namesakes";
import { aroundDay, isScored, ownRowDays } from "./rows";
import { buildPoolKeyOf, levelFits, push } from "./poolIndex";
import { filedInto } from "./folds";
import type { GcImportState } from "./types";
import { stateFits, townKey } from "./filing";

/**
 * Takes a game off a club that does not play anywhere near the age it was played at.
 *
 * The arrival-time rule that let this happen is fixed — `resolveOwnTeam` no longer hands a club
 * the sole stand-in of its name at whatever level somebody else filed it under — but a pool
 * already holding the result keeps it, and no other step can shift it: every one of them asks the
 * real club's own schedule to hold the row, and the row is there precisely because it does not.
 * One club's 9U squad was carrying a 15U loss to a club its players have never faced.
 *
 * The level is what settles it, and only when it disagrees by a lot: `PLAYS_UP_TO` is two, which
 * over this app's own nationwide pool covers 99.7% of the sides resting on a club pulled by id.
 * Beyond that the row is somebody else's. Where exactly one namesake in the same squad year does
 * play near that level, the row goes there. Where none does, or several do, it goes to a stand-in
 * instead — which is what the importer makes of a club it cannot identify, and is honest in a way
 * that leaving it is not: the game happened, the club it names is not this one, and a stand-in is
 * kept out of the rankings rather than ranked on somebody else's result.
 *
 * Only a row filed by name. A row a club put on its own GameChanger schedule says what level that
 * club played at, whatever its listing claims, and is never moved.
 *
 * Two levels off is inside `PLAYS_UP_TO`, and still somebody else's where the age was typed into
 * the name and nothing of the club's own says it plays there: every listing it has two off, none of
 * its own rows within a level of it, and no row of its own that day. On the pool of 24 September
 * 2026, of the scored games filed on a pulled club two levels from its own, GameChanger's own record
 * left out 82% of those it decided, against 14% at the club's own level. Those rows go to a
 * stand-in and to no namesake, which only the game itself can pick: on the pool of 26 September
 * the move took 522 rows off, 164 clubs' records moved toward GameChanger's own, 106 of them onto
 * it, and 14 away, 5 of those off it — a squad that did play up, and a namesake the game was then
 * matched to.
 *
 * And a row filed by name onto a pulled club in a region its filer does not play in — two states on
 * the border map that neither match nor meet (`farApart`) — where nothing of the two clubs' own
 * backs it: no game both their schedules have a row in, and no pulled club each has met in a game
 * both sides' schedules have. Two Texas clubs' games against "Braves" sat on a Florida Braves as
 * two wins its own schedules do not have, 2-4 on its page against 0-4 on its own rows. They go to
 * a stand-in, which the refile then files onto the one club of the name in the filer's state, or
 * next door. On the pool of 26 September 2026 at 18:40 the tidy took 121 rows off and 31 clubs'
 * records changed: 30 toward GameChanger's own, 13 of them onto it, and one away — a loss its
 * club's schedule has not scored yet, whose row the move let join the club's own copy of the game.
 * Met on either club's own schedules alone, where one misfile can vouch for another, five of those
 * records stayed further from their own schedules'.
 *
 * Neither the region nor the level takes off a row the named club's own schedule has a row of too,
 * still standing apart from it (`ownCopyOf`): the same game, its result mirrored, starting within
 * the hour. Read only off rows already folded into the game, the reclaim moved an Ohio club's 9-2
 * onto the Texas club whose own 2-9 stood at the very start, this step took it off again before the
 * collapse could make the two rows one game, the refile put it on the Texas club's namesake next
 * door to Ohio, and every tidy ran its six passes with the game counted twice, once for a club that
 * never played it (the sweep of 30 October 2026: 27 of 400 small pools with a state far from the
 * rest never settled, 40 of 480 games both clubs listed counted twice, none with neighbours only).
 *
 * And any row filed by name onto a pulled club whose own schedules have no game that day or the day
 * either side (`unlisted`): the double check the user asked for on 28 September 2026, a name being
 * where to look rather than who played. An Illinois club's 8 August loss to "Eagles" sat on the
 * Eagles of Independence, Kentucky, whose own schedule opened on 3 September. On the pool of 26
 * September 2026 at 18:40 the tidy took 23,282 rows off, and 4,700 single-link records changed: 4,395
 * toward GameChanger's own record, 3,094 onto it, and 278 away, 106 off it — 191 of those a club
 * whose GameChanger record counts more games than its own rows in the pool, a game the pull did not
 * bring back that the name had stood in for. Except a name no other club carries, which can only be
 * its one club (`soleNamesakes`), and which the refile files onto it.
 */
export const resettleOffLevel = (
  state: GcImportState,
  /**
   * The names the owner has said are not a club (`notThisTeam.ts`): a row of such a name, off the
   * schedule that wrote it, comes off the club as a row the rules refuse it does, and goes onto no
   * namesake it is refused either.
   */
  refused: NotThisTeam = NO_REFUSALS,
  /** The rules still being measured (`TidyRules`), the refile's as well, so the two agree. */
  rules: TidyRules = SHIPPED_TIDY_RULES,
  /** The ids the tidy's run has taken (`tidyPool`), which a stand-in or a slot made here adds to. */
  minted?: MintedIds
): { state: GcImportState; resettled: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));

  /** For each pulled club: the GameChanger ids it filed under, and the levels it plays. */
  const ownIds = new Map<string, Set<string>>();
  const levels = new Map<string, Set<number>>();
  const namesakes = new Map<string, string[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    ownIds.set(team.id, new Set(team.gcTeams.map((link) => link.teamId)));
    const seen = new Set<number>();
    team.gcTeams.forEach((link) => {
      const at = link.ageLevel ?? levelOf.get(link.ageGroupId);
      if (at !== undefined) seen.add(at);
    });
    levels.set(team.id, seen);
    push(namesakes, teamNameKey(team.name), team.id);
  });
  if (namesakes.size === 0) return { state, resettled: 0 };

  const isOwnRow = (game: ScoutGame, teamId: string): boolean =>
    game.source !== undefined && (ownIds.get(teamId)?.has(game.source.teamId) ?? false);
  const within = (seen: ReadonlySet<number> | undefined, level: number, slack: number): boolean =>
    [...(seen ?? [])].some((at) => Math.abs(at - level) <= slack);
  const pulled = pulledNamesOf(state, poolKeyOf);
  const sole = soleNamesakes(state, poolKeyOf, pulled);
  const oneInState = inStateNamesakes(state, poolKeyOf, rules.inState, pulled);
  const theNamesake = oneNamesake(state, poolKeyOf, rules.namesake, pulled);
  const answered = answeredIn(state, (teamId) => teamById.get(teamId), poolKeyOf);

  /**
   * What each pulled club's own schedules say of it: the levels its own rows were played at and the
   * days they fall on, standing, folded into another club's copy, claimed, or on record. Read only
   * once a row two levels off needs it.
   */
  let ownWord:
    | {
        levels: Map<string, Set<number>>;
        days: Map<string, Set<string>>;
        /**
         * The pulled clubs it has met in a game both clubs' own schedules have a row in. A row only
         * one side's schedules hold may be the very misfile being asked about: a Tennessee "White
         * Sox" that named "Cardinals" onto Illinois's, and Illinois's Cardinals that named "White
         * Sox" onto Tennessee's, each read as the other's opponent.
         */
        opponents: Map<string, Set<string>>;
      }
    | undefined;
  const ownWordNow = () => {
    if (ownWord) return ownWord;
    const clubOfSchedule = new Map<string, string>();
    ownIds.forEach((ids, clubId) => ids.forEach((id) => clubOfSchedule.set(id, clubId)));
    const ownLevels = new Map<string, Set<number>>();
    const days = new Map<string, Set<string>>();
    const opponents = new Map<string, Set<string>>();
    const add = <T>(into: Map<string, Set<T>>, key: string, value: T) => {
      const bucket = into.get(key);
      if (bucket) bucket.add(value);
      else into.set(key, new Set([value]));
    };
    state.games.forEach((game) => {
      const clubs = new Set<string>();
      const of = (schedule: string) => {
        const club = clubOfSchedule.get(schedule);
        if (club !== undefined) clubs.add(club);
      };
      if (game.source) of(game.source.teamId);
      game.alsoRows?.forEach((record) => of(record.teamId));
      game.alsoFrom?.forEach(of);
      // Each row on its own day: a row folded into a copy dated a day off keeps its own.
      ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([clubId, day]) =>
        add(days, clubId, day)
      );
      clubs.forEach((clubId) => {
        const side = clubId === game.teamAId ? "A" : clubId === game.teamBId ? "B" : undefined;
        if (side === undefined) return;
        const at = (side === "A" ? game.ageLevelA : game.ageLevelB) ?? levelOf.get(game.ageGroupId);
        if (at !== undefined) add(ownLevels, clubId, at);
      });
      if (clubs.has(game.teamAId) && clubs.has(game.teamBId)) {
        add(opponents, game.teamAId, game.teamBId);
        add(opponents, game.teamBId, game.teamAId);
      }
    });
    ownWord = { levels: ownLevels, days, opponents };
    return ownWord;
  };
  /**
   * A club two levels from an age typed into the name it was filed under, where nothing of its own
   * says it plays there: its listings all two off, none of its own rows within one of it, and no
   * row of its own that day.
   */
  const twoOff = (clubId: string, typed: number | undefined, date: string | undefined): boolean => {
    const listed = levels.get(clubId);
    if (typed === undefined || !listed?.size || within(listed, typed, 1)) return false;
    const own = ownWordNow();
    if (within(own.levels.get(clubId), typed, 1)) return false;
    return date === undefined || !own.days.get(clubId)?.has(date);
  };

  /**
   * A pulled club whose own schedules have no game that day: it did not play that day, so it did
   * not play this game, whatever the name says. The check a name needs before it files a row onto
   * a club (`refileStandIns`, `planOpponent`), asked here of the rows a name filed before it was
   * asked. A row with no day has nothing to be checked against, and stays.
   */
  const unlisted = (clubId: string, date: string | undefined): boolean => {
    if (date === undefined) return false;
    const days = ownWordNow().days.get(clubId);
    return !aroundDay(date).some((day) => days?.has(day));
  };

  /**
   * A row filed by name onto a pulled club in a region the club that filed it does not play in
   * (`farApart`), which nothing of the two clubs' own backs: no game both their schedules have a
   * row in, this or another, and no pulled club each has met in a game both sides' schedules have.
   * A slot's name is left alone, as the import files one onto the one pulled club that carries it.
   */
  const unvouched = (namedId: string, moverId: string): boolean => {
    const named = teamById.get(namedId);
    if (!named || !farApart(teamById.get(moverId)?.state, named.state)) return false;
    if (isPlaceholderName(named.name)) return false;
    const { opponents } = ownWordNow();
    const theirs = opponents.get(namedId);
    if (!theirs) return true;
    if (theirs.has(moverId)) return false;
    const ours = opponents.get(moverId);
    return ![...theirs].some((clubId) => clubId !== namedId && ours?.has(clubId));
  };

  /** Each pulled club's own rows standing as games, by club and day. Read only once a row asks. */
  let ownStanding: Map<string, ScoutGame[]> | undefined;
  const ownStandingNow = () => {
    if (ownStanding) return ownStanding;
    const rows = new Map<string, ScoutGame[]>();
    state.games.forEach((game) => {
      if (!game.date) return;
      [game.teamAId, game.teamBId].forEach((teamId) => {
        if (isOwnRow(game, teamId)) push(rows, `${teamId}\u0000${game.date}`, game);
      });
    });
    ownStanding = rows;
    return rows;
  };
  const fits = nameFitter();
  const runsOf = (game: ScoutGame, teamId: string) =>
    game.teamAId === teamId ? game.teamAScore : game.teamBScore;
  /**
   * The named club's own row of the very game a row filed onto it by name records, where that row
   * is not yet one game with it: a row of the club's own schedules standing as a game of its own
   * that gives the game as this row does. Its day is the row's or the day either side; both rows
   * carry their own result, mirrored, and a start, within the hour of each other, or on the same
   * clock where the two clubs dated the game a day apart (the collapse joins those,
   * `dayApartStrength`); and its other side could be the club that filed this row. That is `mover`
   * where the club's schedule names the filer as the import found it, a slot, a stand-in of the
   * filer's name (`nameFitsWithin`, its own name or a listing's), or any stand-in at this row's very
   * start, which is how the reclaim reads the club's own row when it moves a row onto it
   * (`atTheStart`) — narrower than that, the reclaim moved the row and this step took it off again
   * every pass. A result on one side only, a start more than an hour off or a row against another
   * pulled club is another game as far as anything says, and nothing is read off a name alone. A
   * score either row borrowed is the other's word and proves nothing (`scoreFromB`,
   * `scoreFromTwin`), and a row the user threw out backs nothing.
   *
   * Not the club's row held in this game as a claim, which nothing here needs: it already makes
   * the game one both clubs' schedules have, the meeting the region reads, and gives the club's own
   * word that it plays at this level, which the two-levels test reads (`ownWordNow`); and a claim
   * filed against the filer itself is settled, which `filedInto` reads before any rule.
   */
  const ownCopyOf = (
    game: ScoutGame,
    namedId: string,
    moverId: string
  ): "mover" | "other" | undefined => {
    const mover = teamById.get(moverId);
    if (!mover || !game.date || !isScored(game) || game.scoreFromB || game.scoreFromTwin) {
      return undefined;
    }
    const theirs = runsOf(game, namedId);
    const ours = runsOf(game, moverId);
    const names = [mover.name, ...(mover.gcTeams ?? []).map((link) => link.name)];
    const namesMover = (name: string) =>
      names.some((own) => teamNameKey(own) === teamNameKey(name) || fits(name, own));
    const rows = aroundDay(game.date).flatMap(
      (day) => ownStandingNow().get(`${namedId}\u0000${day}`) ?? []
    );
    let found: "mover" | "other" | undefined;
    rows.forEach((own) => {
      if (found === "mover" || own === game || own.excluded) return;
      if (!isScored(own) || own.scoreFromB || own.scoreFromTwin) return;
      const other = own.teamAId === namedId ? own.teamBId : own.teamAId;
      if (runsOf(own, namedId) !== theirs || runsOf(own, other) !== ours) return;
      const gap = minutesApart(own.startTs, game.startTs);
      if (gap === undefined) return;
      const dayOff = own.date !== game.date && Math.abs(gap - 24 * 60) <= ONE_GAME_WINDOW_MINUTES;
      if (gap > ONE_GAME_WINDOW_MINUTES && !dayOff) return;
      if (other === moverId) {
        found = "mover";
        return;
      }
      const vs = teamById.get(other);
      if (!vs || vs.gcTeams?.length) return;
      if (
        vs.placeholder ||
        (vs.nameOnly && (sameStart(own.startTs, game.startTs) || namesMover(vs.name)))
      ) {
        found = "other";
      }
    });
    return found;
  };

  const used = minted ?? new Set(state.teams.map((team) => team.id));
  const added: ScoutTeam[] = [];
  /**
   * The stand-ins already here by squad year, level and name, and the states of the pulled clubs
   * that named each: read only once a move needs one, since most passes move nothing.
   */
  let standing: { bySlot: Map<string, string[]>; namedFrom: Map<string, Set<string>> } | undefined;
  const standingNow = () => {
    if (standing) return standing;
    const bySlot = new Map<string, string[]>();
    const namedFrom = new Map<string, Set<string>>();
    const note = (game: ScoutGame, side: string, other: string, typed: number | undefined) => {
      const team = teamById.get(side);
      if (!team?.nameOnly || team.placeholder || team.gcTeams?.length) return;
      const at = typed ?? levelOf.get(game.ageGroupId);
      const slot = `${poolKeyOf(game.ageGroupId)}\u0000${at ?? "?"}\u0000${teamNameKey(team.name)}`;
      const bucket = bySlot.get(slot);
      if (!bucket) bySlot.set(slot, [side]);
      else if (!bucket.includes(side)) bucket.push(side);
      const states = namedFrom.get(side) ?? new Set<string>();
      const namer = teamById.get(other);
      if (namer?.gcTeams?.length && namer.state) states.add(namer.state);
      namedFrom.set(side, states);
    };
    state.games.forEach((game) => {
      note(game, game.teamAId, game.teamBId, game.ageLevelA);
      note(game, game.teamBId, game.teamAId, game.ageLevelB);
    });
    standing = { bySlot, namedFrom };
    return standing;
  };
  /**
   * One stand-in per name, level, squad year and state of the club that named it, rather than one
   * per row. A club named on three schedules is one club, and three stand-ins for it would be three
   * unknowns in the fit where there is one; a single stand-in across every level and year would be
   * the opposite mistake, the knot that ties unrelated clubs together, which is why the level and
   * the year are in the key — and the state, as the import keeps one stand-in per state
   * (`planOpponent`): one "Pirates" named from Arizona and New Jersey is nobody's opponent.
   *
   * And one already here, of that name, level and year, named by a club of the mover's state
   * (`stateFits`), before one is made, which is what the import reuses for a name it cannot place.
   * Made afresh, the move stood a second "Pirates" beside the one the import had filed the same
   * state's games against. With the rows it had moved on the backup of 24 September 2026 put back
   * where the import filed them, the step made 64 stand-ins and put one row on a stand-in already
   * here; reusing, it makes 44 and puts 34 rows on the import's, and the tidied pool holds 179
   * stand-ins a pull would have reused another for, not 206.
   */
  const stand = new Map<string, string>();
  const standInFor = (name: string, slot: string, moverState: string | undefined): string => {
    const key = `${slot}\u0000${moverState ?? ""}`;
    const already = stand.get(key);
    if (already !== undefined) return already;
    const { bySlot, namedFrom } = standingNow();
    const found = (bySlot.get(slot) ?? []).find((id) =>
      stateFits(moverState, namedFrom.get(id) ?? new Set())
    );
    if (found !== undefined) {
      stand.set(key, found);
      return found;
    }
    const team = buildScoutTeam(name, used, { nameOnly: true });
    used.add(team.id);
    added.push(team);
    stand.set(key, team.id);
    return team.id;
  };

  let resettled = 0;
  const games = state.games.map((game) => {
    if (!game.source) return game;
    // The side that did not file the row is the side that was attached by name.
    const namedId = isOwnRow(game, game.teamAId)
      ? game.teamBId
      : isOwnRow(game, game.teamBId)
        ? game.teamAId
        : undefined;
    if (namedId === undefined) return game;
    const named = teamById.get(namedId);
    if (!named?.gcTeams?.length) return game;
    // A row the owner said is against this club (Same team as) is, whatever its listings or its
    // state say: nothing here reads more than a name (`ScoutGame.namedByAvatar`).
    if (game.namedByAvatar === namedId) return game;
    // A game the named club's own schedule gave a row too, folded in or settled into it, is on that
    // club's schedule by its own word, as `reclaimMisfiled` reads it. Moved off, the club's own row
    // went with it into a game the club was not in, and the club's next pull filed that row again.
    if (filedInto(game, ownIds.get(namedId))) return game;
    const typed = namedId === game.teamAId ? game.ageLevelA : game.ageLevelB;
    const level = typed ?? levelOf.get(game.ageGroupId);
    const moverId = namedId === game.teamAId ? game.teamBId : game.teamAId;
    /*
     * A pulled club called "Tbd" or "14U" holds a date on its coach's schedule, and a row filed on
     * it by name is some other club's undecided game (`namesNobody`). It goes to a slot of its own,
     * as the import now files one, and out of every rating. One called "Practice" or "Scrimmage" is
     * deleted before this (`dropNotATeam`), unless the owner keeps it, and is then read here too.
     */
    if (namesNobody(named.name)) {
      const slot = buildScoutTeam(named.name, used, { placeholder: true });
      used.add(slot.id);
      added.push(slot);
      resettled += 1;
      return namedId === game.teamAId
        ? { ...game, teamAId: slot.id }
        : { ...game, teamBId: slot.id };
    }
    /*
     * The club the owner said this schedule's name is (`answeredNamesakes`), which the import and the
     * refile file such a row onto, though nothing of its own says it played that day and its region
     * is not the namer's. Not where the owner has said it is not: the refusal of its own name a press
     * of Not this team stores takes the answer back, and the row comes off below.
     */
    const answer = answered(
      {
        schedule: game.source.teamId,
        typed: game.typedAs,
        pool: poolKeyOf(game.ageGroupId),
        level,
        date: game.date,
        start: game.startTs,
        namerId: moverId,
      },
      refused
    );
    if (answer?.id === namedId) return game;
    const farOff = !levelFits(levels.get(namedId), level);
    /*
     * The owner's "Not this team" for the name on this schedule. The pool keeps no row's name, and
     * a name files a row onto a club only where the two read the same, so the club's name is the
     * name: the namer's other rows of it come off with the one the owner took off, which is what
     * the refusal says of them, and a row restored from a copy that never heard it comes off too.
     * Never a game the club's own schedule gave a row, claimed into it or on record: the club says
     * it played that one, and the refusal is about a name (`listedByOwn`).
     */
    const refusedHere =
      refusesName(refused, game.source.teamId, named.name, named) && !listedByOwn(game, named);
    /*
     * The club's own row of the game, standing apart from it, keeps the row where the region or the
     * level would take it off (`ownCopyOf`). More than two levels from the club's own, only its row
     * naming the filer itself does: two rows a name and a slot or a stand-in pair that far apart were
     * false 11.9% of the time (88 pairs) when the namesake join was measured, which reads no pair
     * more than two apart (`PLAYS_UP_TO`). Two levels off, only a copy dated a day off is left for
     * it to keep, since one that day already says the club plays there (`twoOff`); taken off, the
     * row went to a stand-in, the refile put it on a namesake at the typed age that played that day,
     * and the game counted twice.
     */
    let copy: "mover" | "other" | undefined | null = null;
    const copyNow = () => {
      if (copy === null) copy = ownCopyOf(game, namedId, moverId);
      return copy;
    };
    const offByRule =
      refusedHere ||
      (farOff && copyNow() !== "mover") ||
      ((twoOff(namedId, typed, game.date) || unvouched(namedId, moverId)) &&
        copyNow() === undefined);
    // A name no other club carries is the club's though it has no game that day, which is where
    // the refile files it (`soleNamesakes`); so is the one club of it in the namer's state, where
    // the rules read it so (`inStateNamesakes`), and the one of it in the namer's region
    // (`oneNamesake`).
    const meant = () => {
      const row = {
        pool: poolKeyOf(game.ageGroupId),
        key: teamNameKey(named.name),
        level,
        namer: teamById.get(moverId),
        date: game.date,
        start: game.startTs,
      };
      return (
        sole(row)?.id === namedId ||
        oneInState(row)?.id === namedId ||
        theNamesake({ ...row, looseKey: looseNameKey(named.name), typed })?.id === namedId
      );
    };
    if (!offByRule && (!unlisted(namedId, game.date) || meant())) return game;

    /*
     * A club whose name reads as a slot's ("USSSA Cactus Classic") is the one a row names only by
     * being the one pulled club that carries it, which the import no longer reads as that club
     * where it did not play that day (`planOpponent`). The row goes to a slot, as the import files
     * it, and out of every rating.
     */
    if (!offByRule && isPlaceholderName(named.name)) {
      const slot = buildScoutTeam(named.name, used, { placeholder: true });
      used.add(slot.id);
      added.push(slot);
      resettled += 1;
      return namedId === game.teamAId
        ? { ...game, teamAId: slot.id }
        : { ...game, teamBId: slot.id };
    }

    const pool = poolKeyOf(game.ageGroupId);
    const key = teamNameKey(named.name);
    const mover = teamById.get(moverId);
    /*
     * Two off, the row goes to a stand-in and to no namesake on the name alone: the club it was
     * filed on did not play it, and nothing yet says which did. Handed to the namesake at or next to
     * the typed age, the games mostly were not that club's either — on the pool of 26 September
     * 2026, 47 of the 49 clubs that took one moved away from GameChanger's own record, and 30 that
     * matched it stopped matching. A namesake whose own schedule holds the game is the claim step's
     * and the reclaim's to find, on the game.
     */
    const homes = (farOff ? (namesakes.get(key) ?? []) : []).filter((clubId) => {
      if (clubId === namedId || clubId === game.teamAId || clubId === game.teamBId) return false;
      const club = teamById.get(clubId);
      if (refusesName(refused, game.source?.teamId, named.name, club)) return false;
      const inPool = club?.gcTeams?.some((link) => poolKeyOf(link.ageGroupId) === pool);
      return Boolean(inPool) && levelFits(levels.get(clubId), level);
    });
    const to =
      homes.length === 1
        ? homes[0]!
        : standInFor(named.name, `${pool}\u0000${level ?? "?"}\u0000${key}`, mover?.state);
    resettled += 1;
    return namedId === game.teamAId ? { ...game, teamAId: to } : { ...game, teamBId: to };
  });
  if (resettled === 0) return { state, resettled: 0 };

  // A stand-in the move emptied is not a club, and neither is one it never filled.
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = [...state.teams, ...added].filter(
    (team) => !team.nameOnly || stillUsed.has(team.id)
  );
  return { state: { ...state, teams, games }, resettled };
};

/**
 * Files a stand-in's rows onto the one pulled club of that name in the puller's state, or failing
 * any there, across a border — where that club's own schedules have a game that day, or the name is
 * one no other club carries (`soleNamesakes`).
 *
 * A stand-in is a name a schedule wrote down before — or instead of — the club being pulled. Once
 * the whole pool is in, most of them have a pulled namesake, and where exactly one of those is in
 * the state of the club that named it, that is the club: right in about nine cases in ten on
 * known pairs, and the tenth is a traveller the game itself will usually settle first. Two in the
 * state stays a stand-in — a guess between namesakes is what made six River City Raptors — unless
 * exactly one is in the puller's own town. None in the state looks next door, because youth clubs
 * play their neighbours: on the stand-in fixtures export of 22 September 2026, a sole namesake in
 * a bordering state (`borderingStates`) was the club the game itself identified 1,174 times in
 * 1,240, and where the file said anything about the other picks it backed about nine in ten.
 * Two across the borders, or one further away, stays a stand-in. Nothing at arrival time could do
 * this, because the namesake was pulled after the mention 70 times in 100.
 */
export const refileStandIns = (
  state: GcImportState,
  /** The names the owner has said are not a club (`notThisTeam.ts`), never refiled onto it. */
  refused: NotThisTeam = NO_REFUSALS,
  /** The rules still being measured (`TidyRules`): a name read as its one club in the namer's state. */
  rules: TidyRules = SHIPPED_TIDY_RULES,
  /**
   * Told of each stand-in row a pulled club's schedule wrote that is left where it was, and why,
   * for a measurement (`scripts/modelSweep.ts`, `--why-unjoined`); the tidy passes none.
   */
  explain?: (game: ScoutGame, why: RefileRefusal) => void
): { state: GcImportState; refiled: number } => {
  const poolKeyOf = buildPoolKeyOf(state.ageGroups);
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  /** Pulled clubs by pool, name and level. */
  const clubs = new Map<string, ScoutTeam[]>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    const key = teamNameKey(team.name);
    new Set(
      team.gcTeams.map((link) => `${poolKeyOf(link.ageGroupId)}\u0000${key}\u0000${link.ageLevel}`)
    ).forEach((slot) => {
      const bucket = clubs.get(slot);
      if (bucket) bucket.push(team);
      else clubs.set(slot, [team]);
    });
  });
  if (clubs.size === 0) return { state, refiled: 0 };

  /** Each pulled club's days with a row of its own schedules, read only once a refile asks. */
  let ownDays: Set<string> | undefined;
  const listsThatDay = (clubId: string, date: string | undefined): boolean => {
    if (!ownDays) {
      const clubOfSchedule = new Map<string, string>();
      state.teams.forEach((team) =>
        team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
      );
      const days = new Set<string>();
      state.games.forEach((game) =>
        ownRowDays(game, (schedule) => clubOfSchedule.get(schedule)).forEach(([club, day]) =>
          days.add(`${club}\u0000${day}`)
        )
      );
      ownDays = days;
    }
    return (
      date !== undefined && aroundDay(date).some((day) => ownDays!.has(`${clubId}\u0000${day}`))
    );
  };

  const pulled = pulledNamesOf(state, poolKeyOf);
  const sole = soleNamesakes(state, poolKeyOf, pulled);
  const oneInState = inStateNamesakes(state, poolKeyOf, rules.inState, pulled);
  const theNamesake = oneNamesake(state, poolKeyOf, rules.namesake, pulled);
  const answered = answeredIn(state, (teamId) => teamById.get(teamId), poolKeyOf);
  let refiled = 0;
  const games = state.games.map((game) => {
    const a = teamById.get(game.teamAId);
    const b = teamById.get(game.teamBId);
    const standIn = a?.nameOnly ? a : b?.nameOnly ? b : undefined;
    const puller = standIn === a ? b : a;
    if (!standIn || !puller?.gcTeams?.length) return game;
    const typed = standIn === a ? game.ageLevelA : game.ageLevelB;
    const level = typed ?? levelOf.get(game.ageGroupId);
    const pool = poolKeyOf(game.ageGroupId);
    const key = teamNameKey(standIn.name);
    /*
     * The club the owner said the name is when this schedule wrote it before ("Same team as",
     * `answeredNamesakes`), ahead of every reading of the name alone, as the import reads it
     * (`planOpponent`); the resettle leaves the row where this files it. By the name the row typed
     * (`typedAs`) and nothing else, as the resettle reads it: a stand-in made for a row taken off a
     * club carries the club's name, not the row's. A row pulled before rows kept their typed name
     * waits for its schedule's next pull to learn it. Read by its stand-in's name, it was filed onto
     * the club here and taken off again by the resettle, which found no answer for it, onto a
     * stand-in of the club's name; where the club held an answer under its own name, this filed it
     * back every pass, and every tidy ran all six.
     */
    const own = puller.gcTeams.some((link) => link.teamId === game.source?.teamId);
    const answer = answered(
      {
        schedule: own ? game.source?.teamId : undefined,
        typed: game.typedAs,
        pool,
        level,
        date: game.date,
        start: game.startTs,
        namerId: puller.id,
      },
      refused
    );
    if (answer) {
      refiled += 1;
      return standIn === a ? { ...game, teamAId: answer.id } : { ...game, teamBId: answer.id };
    }
    const slot = `${pool}\u0000${key}\u0000${level}`;
    // Never the club on the row's other side: a squad naming its own club's other squad ("Texas
    // Takeover" on Texas Takeover 10U's own schedule) would be filed as playing itself.
    // Nor a club the owner has said the name, written on this schedule, is not.
    const namesakes = (clubs.get(slot) ?? []).filter(
      (club) =>
        club.id !== puller.id && !refusesName(refused, game.source?.teamId, standIn.name, club)
    );
    const inState = namesakes.filter((club) => club.state === puller.state);
    // Two in the state: the one in the puller's own town, if exactly one is.
    const pullerTown = townKey(puller.city);
    // None in the state: the one across a border, if exactly one is.
    const near = puller.state ? borderingStates(puller.state) : new Set<string>();
    // A puller of no known state reads none of these, only the one namesake near it below.
    const chosen = !puller.state
      ? []
      : inState.length === 1
        ? inState
        : inState.length > 1
          ? pullerTown
            ? inState.filter((club) => townKey(club.city) === pullerTown)
            : []
          : namesakes.filter((club) => club.state !== undefined && near.has(club.state));
    const row = { pool, key, level, namer: puller, date: game.date, start: game.startTs };
    const pick = chosen.length === 1 ? chosen[0]! : undefined;
    /*
     * ...and only a club whose own schedules have a game that day. A name is where to look, not
     * who played: the club it points at either played that day or did not play this game, and its
     * own schedule says which (`resettleOffLevel` takes off a row filed on one that did not). This
     * was asked only where the name was a club's at another level within reach too; everywhere else
     * the name alone decided, and on the pool of 26 September 2026 an Illinois club's 8 August loss
     * to "Eagles" sat on the Eagles of Independence, Kentucky, the one Eagles at 9U across the
     * border, whose own schedule opened on 3 September. Refiled onto a club that has no game that
     * day, the row would only be taken off again on the next pass.
     *
     * Unless the name can mean no other club (`soleNamesakes`): "513 Force - Bouley" is its club's
     * on a day its coach has not yet put on its schedule.
     */
    const vouched =
      pick !== undefined && (listsThatDay(pick.id, game.date) || sole(row)?.id === pick.id);
    // Or, where the rules read it so, the one club of the name in the namer's own state, which the
    // resettle leaves where this files it (`inStateNamesakes`); or the one of it in the namer's
    // region (`oneNamesake`), which it leaves too, unless the owner has said the club's own name is
    // not the club on this schedule, which the resettle reads off the club once it is filed.
    const why: RefileRefusal = {};
    const inStateClub = vouched
      ? pick
      : puller.state
        ? oneInState(row, (reason) => (why.inState = reason))
        : undefined;
    if (!vouched && !puller.state) why.inState = "noState";
    const namesakeClub = inStateClub
      ? undefined
      : theNamesake(
          { ...row, looseKey: looseNameKey(standIn.name), typed },
          (reason) => (why.namesake = reason)
        );
    const club = inStateClub ?? namesakeClub;
    if (
      !club ||
      club.id === puller.id ||
      refusesName(refused, game.source?.teamId, standIn.name, club) ||
      (namesakeClub !== undefined && refusesName(refused, game.source?.teamId, club.name, club))
    ) {
      if (club) why.refused = true;
      explain?.(game, why);
      return game;
    }
    refiled += 1;
    return standIn === a ? { ...game, teamAId: club.id } : { ...game, teamBId: club.id };
  });
  if (refiled === 0) return { state, refiled: 0 };

  // A stand-in with nothing left on it is not a club and should not linger in the roster.
  // A team a claimed row was filed against is still where that row goes back (`filedTeamIds`).
  const stillUsed = new Set([
    ...games.flatMap((game) => [game.teamAId, game.teamBId]),
    ...filedTeamIds(games),
  ]);
  const teams = state.teams.filter((team) => !team.nameOnly || stillUsed.has(team.id));
  return { state: { ...state, teams, games }, refiled };
};

/**
 * Makes one of the stand-ins that are one opponent filed twice.
 *
 * A name nobody pulled becomes a stand-in, one per name, level and squad year among the clubs of a
 * state that named it (`planOpponent`). A lookup that missed made a second — a class year looked up
 * at the page's age rather than the class's, a pull run before a rule — and the clubs that named
 * the team found one entry or the other, so one team's games were split over entries of a game or
 * two each and the clubs that played it were rated against strangers. On the pool of 26 September
 * 2026, 173 stand-ins shared a name, a level, a squad year and a naming club's state with one
 * earlier in the roster; ten were "Mojo Gold 2036", named by Oklahoma's 10U clubs.
 *
 * Two kinds are merged without asking: a name that carries a graduating class, and a name no more
 * than one pulled club in the pool carries. A common name is as often two teams — two Arizona
 * clubs' "Pirates" — and is left for the user. Nor are two merged whose games clash, one within
 * the hour of the other against another opponent the same day, which one team cannot do: two
 * "Padres" named by Texas clubs both played at eight on 19 September. The later entry goes into
 * the earlier, its games and the claims filed against it with it. On that pool this merged 127 of
 * the 173 — 50 by class, 77 by a rare name — and moved 226 clubs' ratings by more than a tenth of a
 * run and no record: No Pressure Sports, whose one game against Mojo Gold 2036 had stood against an
 * entry of its own, went from -1.10 to -0.03.
 */
export const mergeDuplicateStandIns = (
  state: GcImportState
): { state: GcImportState; merged: number } => {
  const groupById = new Map(state.ageGroups.map((group) => [group.id, group]));
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const isStandInTeam = (team: ScoutTeam | undefined): team is ScoutTeam =>
    Boolean(team?.nameOnly) && !team?.placeholder && !team?.gcTeams?.length;
  /** What a stand-in's games say of it: where it was filed, who named it, and when it played. */
  type Seen = {
    slots: Set<string>;
    year: number | undefined;
    namedFrom: Set<string>;
    games: { date: string | undefined; startTs: string | undefined; other: string }[];
  };
  const seen = new Map<string, Seen>();
  const note = (game: ScoutGame, side: string, other: string, typed: number | undefined) => {
    const team = teamById.get(side);
    if (!isStandInTeam(team)) return;
    const group = groupById.get(game.ageGroupId);
    const year = group ? ageGroupYear(group) : undefined;
    const level = typed ?? (group ? ageGroupLevel(group) : undefined);
    let entry = seen.get(side);
    if (!entry) {
      entry = { slots: new Set(), year, namedFrom: new Set(), games: [] };
      seen.set(side, entry);
    }
    entry.slots.add(
      `${year ?? `g:${game.ageGroupId}`}\u0000${level ?? "?"}\u0000${teamNameKey(team.name)}`
    );
    const namer = teamById.get(other);
    if (namer?.gcTeams?.length && namer.state) entry.namedFrom.add(namer.state);
    entry.games.push({ date: game.date, startTs: game.startTs, other });
  };
  state.games.forEach((game) => {
    note(game, game.teamAId, game.teamBId, game.ageLevelA);
    note(game, game.teamBId, game.teamAId, game.ageLevelB);
  });

  // In roster order, so the entry kept is the one the pool has held longest.
  const bySlot = new Map<string, string[]>();
  state.teams.forEach((team) => {
    const entry = seen.get(team.id);
    if (entry?.slots.size === 1) push(bySlot, [...entry.slots][0]!, team.id);
  });
  if (![...bySlot.values()].some((ids) => ids.length > 1)) return { state, merged: 0 };

  const pulledOfName = new Map<string, number>();
  state.teams.forEach((team) => {
    if (!team.gcTeams?.length) return;
    const key = teamNameKey(team.name);
    pulledOfName.set(key, (pulledOfName.get(key) ?? 0) + 1);
  });
  const clash = (a: Seen["games"], b: Seen["games"]) =>
    a.some((x) =>
      b.some(
        (y) =>
          x.date !== undefined &&
          x.date === y.date &&
          x.other !== y.other &&
          startsWithinTheHour(x.startTs, y.startTs)
      )
    );
  const into = new Map<string, string>();
  bySlot.forEach((ids) => {
    if (ids.length < 2) return;
    /*
     * Each entry is held up against every earlier one it was not merged into, not only the slot's
     * first. Held up against the first alone, two entries named from one state stayed two whenever
     * the roster listed an entry named from another state ahead of them: five on the pool of 26
     * September 2026, "Canes National 2031" named from Florida ahead of two named from Virginia
     * among them, which another order of the same roster made one. A merged entry's naming states
     * join its keeper's, as its games do, which is what the next tidy would read off them.
     */
    const keepers: { id: string; namedFrom: Set<string>; games: Seen["games"] }[] = [];
    ids.forEach((id) => {
      const entry = seen.get(id)!;
      const name = teamById.get(id)!.name;
      const byClass =
        entry.year !== undefined && ageFromGradYearInName(name, entry.year) !== undefined;
      const rare = (pulledOfName.get(teamNameKey(name)) ?? 0) <= 1;
      const keeper =
        byClass || rare
          ? keepers.find(
              (kept) =>
                [...entry.namedFrom].some((named) => kept.namedFrom.has(named)) &&
                !clash(kept.games, entry.games)
            )
          : undefined;
      if (!keeper) {
        keepers.push({ id, namedFrom: new Set(entry.namedFrom), games: [...entry.games] });
        return;
      }
      into.set(id, keeper.id);
      keeper.games.push(...entry.games);
      entry.namedFrom.forEach((named) => keeper.namedFrom.add(named));
    });
  });
  if (into.size === 0) return { state, merged: 0 };

  const to = (teamId: string) => into.get(teamId) ?? teamId;
  const games = state.games.map((game) => {
    const a = to(game.teamAId);
    const b = to(game.teamBId);
    const moved =
      a === game.teamAId && b === game.teamBId ? game : { ...game, teamAId: a, teamBId: b };
    return withFiledRepointed(moved, to);
  });
  const teams = state.teams.filter((team) => !into.has(team.id));
  return { state: { ...state, teams, games }, merged: into.size };
};
