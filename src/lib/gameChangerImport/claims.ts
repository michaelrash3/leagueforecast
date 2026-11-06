/**
 * The tidy's claims of a pulled club's own rows into the copies of them other schedules filed
 * (`claimFiledRows`), and the claims let go when the copy they were made into is gone. Split out
 * of `gameChangerImport.ts`, which re-exports what it always exported.
 */

import {
  ageGroupLevel,
  claimInto,
  CLOSE_DISPUTE_RUNS,
  filedRowOf,
  type FoldedRow,
  isHeldAsOwn,
  nameFitter,
  ownPageFor,
  releaseClaim,
  sameStart,
  type ScoutGame,
  startMinuteOf,
  startsWithinTheHour,
} from "../teamRankings";
import { inOneRegion } from "../stateBorders";
import { couldStillBeCopy, isoDayFrom, isScored } from "./rows";
import type { GcImportState } from "./types";
import { PLAYS_UP_TO, push } from "./poolIndex";

/**
 * The most rows, and the most copies, one club's day may hold for `resolveSlotGames` to read the
 * day's stand-in rows against the copies its schedules leave out. Every reading is tried, and five
 * a side is under two thousand of them; a day with more is left as it is.
 */
const MISSING_COPY_MAX = 5;

/**
 * Claims a row a club's own schedule filed by name for the club whose own schedule lists the game.
 *
 * A schedule names its opponent, and the import files the row against a club of that name, or a
 * stand-in where it finds none. The name is a guess; the game is not. Where another pulled club's
 * own schedule lists a game against this club that day that none of this club's own schedules gives
 * a row, that game is on this club's schedule somewhere — under whatever its coach typed. So a row
 * of this club's filed by name, against a stand-in or against a pulled club whose own schedules
 * never list the game, and the other club's copy beside it are one game, and the row goes into that
 * copy as this club's own (`claimInto`).
 *
 * Against a stand-in, whose name says nothing, the clock and the scores decide, as two schedules'
 * copies of one game are read (`ONE_GAME_WINDOW_MINUTES`): within the hour or at the very start
 * with a result still to come or two within `CLOSE_DISPUTE_RUNS`, or the same result. On the pool
 * of 24 September 2026 the stand-in's name shared a word with the club the other schedule named in
 * 68% of the pairs within the hour with a result to come and 67% of those scored close, against 3%
 * to 10% of the pairs the same search makes a week either side; most of the rest were shorthand —
 * "R.E.B." for Rockland Elite Black. Scores further apart shared one in 13% of the pairs within the
 * hour, and are left as two games.
 *
 * Against a pulled club the name did say something, and only scores that agree outweigh it: the
 * same result within the hour, or two within four runs at the very start or within the hour. The
 * same pool held 1,358 rows filed against a pulled club whose schedules never listed them beside
 * another club's copy with the same result within the hour; the two clubs' names shared a word in
 * 81% of them, and 356 more scored within four runs at one start shared one in 90%. Kentucky
 * Athletics' 9-3 over "Dream Chasers Blue" was Hit Dogs Evansville's own 3-9 fifteen minutes on:
 * that weekend's opponents all filed the Hit Dogs under the name they played the tournament as, a
 * GameChanger team with no games of its own, and each game stood twice. A result still to come says
 * nothing against a real name — blank rows at one start paired "Rangers" typed with the DBACKS'
 * copy — and waits until the scores are in.
 *
 * Nothing claimed is final. The record keeps the team the row was filed against
 * (`FoldedRow.filedAgainst`), every pass reads each club's day again with its claims stood back up,
 * and a claim the schedules no longer bear out goes back: the other club's copy withdrawn, a score
 * posted that says two games, the club's own schedule naming the other club after all, a better
 * copy pulled since. Kept as a bare fold, a claim outlived every one of those, and the row stood up
 * against the club that had claimed it, a game that club's schedules never listed.
 *
 * Every row and copy of the club's day is read at once: as many pairs as the day allows, then in
 * both schedules' order, then the stronger links — the same result, the very same start, within the
 * hour. Where two readings are as good as each other, only what they agree on is settled: one game
 * off two GameChanger teams of one club, 5-1 at 9:30 on both, is not a choice to make on the order
 * the pool holds them in. A claim already made weighs nothing of its own — preferred, it kept a row
 * in the first of two copies that fitted it as well, where the same clubs pulled in the other order
 * left it standing — so the day reads the same whichever club was pulled first.
 * And the day waits for whatever would answer it better: a club with a row of its own against the
 * other club, that day or the day either side, that no row of theirs is paired with yet and that
 * could yet be the other club's copy is the collapse's to pair first (`couldStillBeCopy`); a row
 * the club it names answers for, by a copy of its own that fits, is that club's; a team the other
 * club's own schedule plays is not that club — a pulled one only where the result is not the same
 * — nor is an age typed into its name more than `PLAYS_UP_TO` from the one that club played at;
 * and rows naming one team on one day go to one club or none.
 */
export const claimFiledRows = (input: GcImportState): { state: GcImportState; claimed: number } => {
  const orphans = releaseOrphanedClaims(input);
  const state = orphans.state;
  const teamById = new Map(state.teams.map((team) => [team.id, team]));
  const fits = nameFitter();
  const clubOfSchedule = new Map<string, string>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => clubOfSchedule.set(link.teamId, team.id))
  );
  /** A side nobody pulled: a bracket slot, or a club known only because a schedule named it. */
  const isStandIn = (teamId: string) => {
    const team = teamById.get(teamId);
    return (team?.placeholder === true || team?.nameOnly === true) && !team.gcTeams?.length;
  };
  const isClub = (teamId: string) => Boolean(teamById.get(teamId)?.gcTeams?.length);
  const mine = (schedule: string | undefined, clubId: string) =>
    schedule !== undefined && clubOfSchedule.get(schedule) === clubId;
  /** Whether any of this club's own schedules gave the game a row: its own, folded in, or on record. */
  const listedBy = (game: ScoutGame, clubId: string): boolean =>
    mine(game.source?.teamId, clubId) ||
    (game.alsoRows ?? []).some((record) => mine(record.teamId, clubId)) ||
    (game.alsoFrom ?? []).some((schedule) => mine(schedule, clubId));
  /**
   * The same, less the rows the game holds as claims: what this club lists of it for itself. A
   * claim settled on the club it faces (`isSettledClaim`) is the club's own row by name, and the
   * namesake join's claim (`isJoinedClaim`) the club's own row the join holds.
   */
  const ownsRowIn = (game: ScoutGame, clubId: string): boolean => {
    if (mine(game.source?.teamId, clubId)) return true;
    const records = game.alsoRows ?? [];
    if (
      records.some(
        (record) =>
          mine(record.teamId, clubId) && (!record.filedAgainst || isHeldAsOwn(game, record))
      )
    ) {
      return true;
    }
    const recorded = new Set(records.map((record) => record.teamId));
    return (game.alsoFrom ?? []).some(
      (schedule) => mine(schedule, clubId) && !recorded.has(schedule)
    );
  };
  /**
   * The same, less a schedule on record with no row of it kept (`alsoFrom` alone): which row that
   * was is not known, so it cannot say the club's row of the game is in it already. Since rows
   * are kept whole, a pull files its row into such a copy and one that files none takes the record
   * off; the record left beside a row of the club's standing against another name is one an older
   * pull left, and the row is the one it stood for. On the pool of 26 September 2026 a club's own
   * row stood so 353 times, the same result within the hour as the copy holding its schedule on
   * record: a game counted twice. Further off than the hour the record may be another meeting that
   * day, so there it still holds (`strength`).
   */
  const keepsRowIn = (game: ScoutGame, clubId: string): boolean =>
    mine(game.source?.teamId, clubId) ||
    (game.alsoRows ?? []).some(
      (record) => mine(record.teamId, clubId) && (!record.filedAgainst || isHeldAsOwn(game, record))
    );
  const dayKey = (teamId: string, date: string) => `${teamId}@${date}`;

  /** A row filed by name: standing, or claimed already and read here as if it stood. */
  type Filed = {
    /** The row as its schedule filed it: its club on side A, the team it named on side B. */
    row: ScoutGame;
    club: string;
    against: string;
    level: number | undefined;
    holder?: ScoutGame;
    record?: FoldedRow;
  };
  const filedByDay = new Map<string, Filed[]>();
  /** What each club's own schedules have played, claims included: a club never plays itself. */
  const played = new Map<string, Set<string>>();
  const plays = (clubId: string, teamId: string) => {
    const bucket = played.get(clubId);
    if (bucket) bucket.add(teamId);
    else played.set(clubId, new Set([teamId]));
  };
  /** Games between two sides that are not stand-ins, by each side and day. */
  const byTeamDay = new Map<string, ScoutGame[]>();
  state.games.forEach((game) => {
    const club = game.source ? clubOfSchedule.get(game.source.teamId) : undefined;
    /*
     * Every schedule that gave the game a row of its own played the game's other side: the row it
     * stands on, and the rows folded in or on record, which are the same game. Read off the row it
     * stands on alone, which of two clubs' copies the collapse happened to keep decided what the
     * other club had played, and a claim it should have refused went through in one pool order.
     */
    const playedIn = (schedule: string) => {
      const own = clubOfSchedule.get(schedule);
      if (own === undefined) return;
      if (game.teamAId === own) plays(own, game.teamBId);
      else if (game.teamBId === own) plays(own, game.teamAId);
    };
    if (game.source) playedIn(game.source.teamId);
    const named = new Set((game.alsoRows ?? []).map((record) => record.teamId));
    game.alsoRows?.forEach((record) => {
      if (record.filedAgainst === undefined) playedIn(record.teamId);
    });
    game.alsoFrom?.forEach((schedule) => {
      if (!named.has(schedule)) playedIn(schedule);
    });
    game.alsoRows?.forEach((record) => {
      const recordClub = clubOfSchedule.get(record.teamId);
      if (record.filedAgainst === undefined || recordClub === undefined) return;
      plays(recordClub, record.filedAgainst);
      // A game the user has thrown out keeps what it holds: a claim released from it stood up as a
      // game of its own, counted, which the user had said not to count. A claim settled on the
      // club it faces has no other team to go to, and read as one it went back against that club
      // beside the club's own copy. And the namesake join's claim is the join's to read again
      // (`joinNamesakeHalves`): weighed here by the claim step's own rules as well, the two steps
      // could each undo what the other had decided.
      if (game.excluded || !teamById.has(record.filedAgainst) || isHeldAsOwn(game, record)) {
        return;
      }
      const row = filedRowOf(game, record);
      if (!row.date || row.teamAId !== recordClub || row.teamBId === recordClub) return;
      push(filedByDay, dayKey(recordClub, row.date), {
        row,
        club: recordClub,
        against: record.filedAgainst,
        level: record.filedLevel,
        holder: game,
        record,
      });
    });
    if (!game.date) return;
    if (!isStandIn(game.teamAId) && !isStandIn(game.teamBId)) {
      push(byTeamDay, dayKey(game.teamAId, game.date), game);
      push(byTeamDay, dayKey(game.teamBId, game.date), game);
    }
    // A club's own row, nothing folded into it, against a team none of whose schedules gives it a
    // row. One the user has thrown out stays as the user left it.
    if (
      club === undefined ||
      game.teamAId !== club ||
      game.excluded ||
      game.alsoRows?.length ||
      game.reportedByB ||
      game.scoreFromB ||
      game.scoreFromTwin
    ) {
      return;
    }
    const against = game.teamBId;
    if (against === club) return;
    // A row the owner said is against its club (Same team as) is not a name to be claimed away from.
    if (
      isStandIn(against) ||
      (isClub(against) && !listedBy(game, against) && game.namedByAvatar !== against)
    ) {
      push(filedByDay, dayKey(club, game.date), {
        row: game,
        club,
        against,
        level: game.ageLevelB,
      });
    }
  });
  if (filedByDay.size === 0) return { state, claimed: orphans.released };

  const pageLevel = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const ownPage = ownPageFor(state.ageGroups);
  const updated = new Map<string, ScoutGame>();
  const current = (game: ScoutGame) => updated.get(game.id) ?? game;
  const removed = new Set<string>();
  const added: ScoutGame[] = [];
  let claimed = 0;
  /** What each day decided for each of its rows: the copy it goes into, or none. */
  const decisions: { entry: Filed; copy: ScoutGame | undefined }[] = [];
  /** Copies a row of their own day could be and went into none: no day either side's to take. */
  const wantedOnTheirDay = new Set<string>();

  filedByDay.forEach((filed, key) => {
    const { club, row: firstRow } = filed[0]!;
    const date = firstRow.date!;
    const otherOf = (game: ScoutGame) => (game.teamAId === club ? game.teamBId : game.teamAId);
    // Another club's own copy of a game against this club, none of this club's own rows in it but
    // claims: that day, and the day either side for a stand-in row with the same result
    // (`strength`). Most days have none, and there is nothing to read.
    const offerable = (game: ScoutGame) =>
      !game.excluded && mine(game.source?.teamId, otherOf(game)) && !keepsRowIn(game, club);
    const offered = [date, isoDayFrom(date, -1), isoDayFrom(date, 1)].flatMap((day) =>
      day === undefined ? [] : (byTeamDay.get(dayKey(club, day)) ?? []).filter(offerable)
    );
    if (offered.length === 0 && filed.every((entry) => !entry.holder)) return;
    /*
     * A copy of a club's with a row of this club's own against that club, that day or the day
     * either side, that no row of theirs is paired with and that could yet be the copy waits:
     * which of its copies that row is, the collapse says (`couldStillBeCopy`).
     */
    const waiting = new Map<string, ScoutGame[]>();
    [-1, 0, 1].forEach((days) => {
      const day = days === 0 ? date : isoDayFrom(date, days);
      if (day === undefined) return;
      (byTeamDay.get(dayKey(club, day)) ?? []).forEach((game) => {
        const otherId = otherOf(game);
        if (ownsRowIn(game, club) && !listedBy(game, otherId)) push(waiting, otherId, game);
      });
    });
    const copies = offered.filter(
      (copy) => !(waiting.get(otherOf(copy)) ?? []).some((row) => couldStillBeCopy(row, copy))
    );

    // A copy's score borrowed from this club's own rows (`scoreFromB`) is this club's word, not the
    // copy's: read as its own, a claim agreed with itself and outweighed a better copy pulled since.
    const seatOf = (game: ScoutGame): [number, number] | undefined =>
      !isScored(game) || (game.scoreFromB && game.teamBId === club)
        ? undefined
        : game.teamAId === club
          ? [game.teamAScore!, game.teamBScore!]
          : [game.teamBScore!, game.teamAScore!];
    /**
     * How strongly a filed row and a copy read as one game; 0 for not at all. A stand-in's name says
     * nothing, so a result still to come is enough on the clock; a pulled club's name does, so only
     * scores that agree outweigh it.
     */
    const strength = (entry: Filed, copy: ScoutGame): number => {
      const otherId = otherOf(copy);
      if (otherId === entry.against) return 0;
      /*
       * A team the other club's own schedule has played is one that club knows as another team. A
       * stand-in's name is then that team's and nobody else's. A pulled club's still gives way to
       * the same result — the NL Vandals' 15-3 against "Downingtown West Wolfpack Blue" was
       * Downingtown Wolfpack Gold's own 3-15 at the very same start, the Blue listing nothing that
       * day, though the Gold play the Blue — but to nothing less. On the pool of 24 September 2026,
       * among rows filed against a pulled club the other club had played, the two clubs' names
       * shared a word in 81% of the 47 with the same result within the hour, and in 13% of the 30
       * scored apart within the hour, about what chance gives.
       */
      const knownApart = played.get(otherId)?.has(entry.against) === true;
      if (knownApart && isStandIn(entry.against)) return 0;
      const typed = entry.level;
      const level =
        (copy.teamAId === otherId ? copy.ageLevelA : copy.ageLevelB) ??
        pageLevel.get(copy.ageGroupId);
      if (typed !== undefined && level !== undefined && Math.abs(typed - level) > PLAYS_UP_TO) {
        return 0;
      }
      const ours = seatOf(entry.row);
      const theirs = seatOf(copy);
      const near = startsWithinTheHour(entry.row.startTs, copy.startTs);
      const same = ours && theirs && ours[0] === theirs[0] && ours[1] === theirs[1];
      /*
       * The very same result against a slot, or a stand-in whose name fits the copy's club, is the
       * copy's game whatever the clock says: "Chicos Augusta" at 16:30 is Chicos Augusta's own
       * 17:35 copy, 10-1 both. On the tidy of the 26 September 2026 backup that joined 44 rows to a
       * copy holding the club's schedule on record more than an hour off, moving 44 records toward
       * the club's own schedule and 43 toward GameChanger's. Any stand-in's name would have joined
       * 15 more on the result alone, where a name for nobody on the copy's side, hours off, may be
       * another meeting that day; a name that fits is the bar.
       */
      const standIn = teamById.get(entry.against);
      const standsForCopy =
        isStandIn(entry.against) &&
        Boolean(same) &&
        standIn !== undefined &&
        (standIn.placeholder === true || fits(standIn.name, teamById.get(otherId)?.name ?? ""));
      // A copy holding this club's schedule on record with no row kept takes a row within the hour
      // only: further off, the record may stand for another meeting that day (`keepsRowIn`).
      if (!near && ownsRowIn(copy, club) && !standsForCopy) return 0;
      /*
       * A day apart, the same result against a name that fits or a slot, and only into a copy not
       * holding the club on record: a schedule dated a day off, as two clubs' own copies are read
       * (`dayApartStrength`). Catoosa Mudcats' 9-16 against "Frost Falcons" on the 12th was Frost
       * Falcons' own copy at the same 13:00 on the 13th. 47 rows on that pool, 45 records toward
       * GameChanger's; a week off, the same search found 2.
       */
      if (copy.date !== entry.row.date) return standsForCopy && !ownsRowIn(copy, club) ? 1 : 0;
      const close =
        ours !== undefined &&
        theirs !== undefined &&
        Math.abs(ours[0] - theirs[0]) + Math.abs(ours[1] - theirs[1]) <= CLOSE_DISPUTE_RUNS;
      const onClock = sameStart(entry.row.startTs, copy.startTs) ? 2 : near ? 1 : 0;
      if (isStandIn(entry.against)) {
        if (same) return near ? 4 : 3;
        if (ours && theirs && !close) return 0;
        return onClock;
      }
      if (same) return near ? 4 : 0;
      return close && !knownApart ? onClock : 0;
    };
    /**
     * A row the club it names answers for, by a copy of its own that fits, is that club's. Its
     * own copy standing, or its own row claimed into somebody else's copy, read as if it stood as
     * every claim is here. Read off the standing copies alone, the answer went back and forth: on
     * the pool of 26 September 2026, Power Baseball 2028 Victus and JR7 Baseball each filed their
     * 3-2 against the other, and each club had a second GameChanger team whose copy named the
     * first. Each pass claimed the row that stood into the second team's copy and gave back the
     * one that was claimed, since the standing row answered it, and every tidy ran to its limit.
     */
    const answered = (entry: Filed) =>
      isClub(entry.against) &&
      [
        ...(byTeamDay.get(key) ?? []).filter((game) => mine(game.source?.teamId, entry.against)),
        ...(filedByDay.get(dayKey(entry.against, date)) ?? []).flatMap((other) =>
          other.holder && other.row.teamBId === club ? [other.row] : []
        ),
      ].some(
        (game) =>
          otherOf(game) === entry.against &&
          strength({ ...entry, against: `${entry.against}\u0000` }, game) > 0
      );
    const rows = filed.filter((entry) => !answered(entry));

    type Link = { row: number; copy: number; strength: number };
    const everyLink: Link[] = rows.flatMap((entry, r) =>
      copies.flatMap((copy, c) => {
        const found = strength(entry, copy);
        return found > 0 ? [{ row: r, copy: c, strength: found }] : [];
      })
    );
    // A row with a copy of its own day is read on that day alone: the day either side is only for
    // a row the day itself has nothing for.
    const sameDay = (link: Link) => copies[link.copy]!.date === rows[link.row]!.row.date;
    const linkedOnItsDay = new Set(everyLink.filter(sameDay).map((link) => link.row));
    const links = everyLink.filter((link) => sameDay(link) || !linkedOnItsDay.has(link.row));
    const byRow = new Map<number, Link[]>();
    links.forEach((link) => push(byRow, link.row, link));
    const chosen = new Map<Filed, ScoutGame>();
    if (
      links.length > 0 &&
      byRow.size <= MISSING_COPY_MAX &&
      new Set(links.map((link) => link.copy)).size <= MISSING_COPY_MAX
    ) {
      const minuteOf = (game: ScoutGame) => startMinuteOf(game.startTs);
      /** Two links whose rows and copies run in opposite orders, all four with a start. */
      const crossed = (a: Link, b: Link): boolean => {
        const [ra, rb, ca, cb] = [
          minuteOf(rows[a.row]!.row),
          minuteOf(rows[b.row]!.row),
          minuteOf(copies[a.copy]!),
          minuteOf(copies[b.copy]!),
        ];
        if (ra === undefined || rb === undefined || ca === undefined || cb === undefined) {
          return false;
        }
        return (ra - rb) * (ca - cb) < 0;
      };
      type Reading = { links: Link[]; crossings: number; strength: number };
      /** More pairs, fewer crossings, then stronger links. */
      const compare = (a: Reading, b: Reading): number =>
        a.links.length - b.links.length || b.crossings - a.crossings || a.strength - b.strength;
      let best: Reading[] = [];
      const picked: Link[] = [];
      const used = new Set<number>();
      const rowOrder = [...byRow.keys()];
      const visit = (at: number) => {
        if (at === rowOrder.length) {
          if (picked.length === 0) return;
          let crossings = 0;
          picked.forEach((a, i) =>
            picked.slice(i + 1).forEach((b) => (crossings += crossed(a, b) ? 1 : 0))
          );
          const reading: Reading = {
            links: picked.slice(),
            crossings,
            strength: picked.reduce((sum, link) => sum + link.strength, 0),
          };
          const order = best.length === 0 ? 1 : compare(reading, best[0]!);
          if (order > 0) best = [reading];
          else if (order === 0) best.push(reading);
          return;
        }
        visit(at + 1);
        byRow.get(rowOrder[at]!)!.forEach((link) => {
          if (used.has(link.copy)) return;
          used.add(link.copy);
          picked.push(link);
          visit(at + 1);
          picked.pop();
          used.delete(link.copy);
        });
      };
      visit(0);
      best[0]?.links
        .filter((link) => best.every((reading) => reading.links.includes(link)))
        .forEach((link) => chosen.set(rows[link.row]!, copies[link.copy]!));
    }
    /*
     * The clock alone, across regions, is not a game. The copy names this club because its coach
     * typed a name the import found here, and a common name is found in many places: a 9U club in
     * Iowa that played "Cubs" was filed against the 11U Cubs of Frisco, Texas, one of 75 teams of
     * that name, and the Texas club's 11-6 over the Diamondbacks at the same 15:45 went into the
     * Iowa club's blank copy as its loss. Of the 3,714 claims in the pool of 26 September 2026, 7
     * joined clubs of two regions, 6 of them on scores that agree or nearly do; the seventh was a
     * blank row naming a New York team claimed into an Indiana club's blank copy. Refused once the
     * day is read rather than weighed in it, so the region never picks between two copies the
     * clock could not.
     */
    chosen.forEach((copy, entry) => {
      if (
        isStandIn(entry.against) &&
        (!seatOf(entry.row) || !seatOf(copy)) &&
        !inOneRegion(teamById.get(club)?.state, teamById.get(otherOf(copy))?.state)
      ) {
        chosen.delete(entry);
      }
    });
    // Rows naming one team on one day go to one club or none: a team is one team.
    const clubsFor = new Map<string, Set<string>>();
    chosen.forEach((copy, entry) => {
      const bucket = clubsFor.get(entry.against);
      if (bucket) bucket.add(otherOf(copy));
      else clubsFor.set(entry.against, new Set([otherOf(copy)]));
    });
    chosen.forEach((_copy, entry) => {
      if ((clubsFor.get(entry.against)?.size ?? 0) > 1) chosen.delete(entry);
    });

    /*
     * A row of the copy's own day that could be it and went into nothing — two copies it could not
     * choose between — wants it as surely as one that did. Read off the decisions alone, the day
     * before took the copy: a 5-3 against a stand-in on the 6th that fits both the Bears' and the
     * Cubs' copies of the 6th went into neither, and the same result on the 5th went into the
     * Bears' as a day-off row.
     */
    rows.forEach((entry, at) => {
      if (chosen.has(entry)) return;
      everyLink.forEach((link) => {
        if (link.row === at && sameDay(link)) wantedOnTheirDay.add(copies[link.copy]!.id);
      });
    });
    filed.forEach((entry) => decisions.push({ entry, copy: chosen.get(entry) }));
  });

  /*
   * A club's own row claimed away this pass is not a copy to claim into this pass. One standing row
   * can be both: the Bears' row against the Aces, which no Aces schedule lists, was the copy an Aces
   * row went into and a row the Bears filed by name that the Yanks' copy took, both decided on the
   * pool as it came in; the Aces' row went into it, it went into the Yanks' copy without that row,
   * and the Aces' row was in the pool nowhere. What went to it waits a pass, and is read again
   * against the day as the claim away leaves it.
   */
  /*
   * A copy offered to the days either side of its own can be chosen from two of them. It goes to
   * the row on its own day, or where there is not exactly one, to none: two days' rows wanting one
   * copy is no reading of either.
   */
  decisions.forEach((decision) => {
    const copy = decision.copy;
    if (copy && copy.date !== decision.entry.row.date && wantedOnTheirDay.has(copy.id)) {
      decision.copy = undefined;
    }
  });
  const byCopy = new Map<string, (typeof decisions)[number][]>();
  decisions.forEach((decision) => {
    if (decision.copy) push(byCopy, decision.copy.id, decision);
  });
  byCopy.forEach((wanting) => {
    if (wanting.length < 2) return;
    const onItsDay = wanting.filter((decision) => decision.entry.row.date === decision.copy!.date);
    wanting.forEach((decision) => {
      if (onItsDay.length === 1 && decision === onItsDay[0]) return;
      decision.copy = undefined;
    });
  });
  const goingAway = new Set(
    decisions.flatMap(({ entry, copy }) => (copy && !entry.holder ? [entry.row.id] : []))
  );
  decisions.forEach(({ entry, copy }) => {
    if (copy && goingAway.has(copy.id)) return;
    if (entry.holder && entry.record) {
      if (copy === entry.holder) return;
      // A claim the day no longer reads that way goes back to the team its row named.
      updated.set(entry.holder.id, releaseClaim(current(entry.holder), entry.record));
      claimed += 1;
      if (!copy) {
        added.push(ownPage(entry.row));
        return;
      }
    } else if (!copy) {
      return;
    } else {
      removed.add(entry.row.id);
      claimed += 1;
    }
    updated.set(copy.id, claimInto(current(copy), entry.row, entry.against, entry.level));
  });

  if (claimed === 0) return { state, claimed: orphans.released };
  const games = [
    ...state.games.flatMap((game) => (removed.has(game.id) ? [] : [updated.get(game.id) ?? game])),
    ...added,
  ];
  return { state: { ...state, games }, claimed: claimed + orphans.released };
};

/**
 * Stands a claim back up where the game holding it no longer has its club on either side.
 *
 * A claim is one club's row inside another club's copy, and the copy can change sides after it is
 * made: `reclaimMisfiled` moves a copy filed against the wrong namesake onto the club of that name
 * whose own schedule lists the game. The claim goes with it, into a game its club is not in, where
 * no reading of that club's day will ever look for it. So before any day is read, such a claim goes
 * back to the team its row was filed against, as a row of its club's own, and the day is read with
 * it standing.
 */
const releaseOrphanedClaims = (
  state: GcImportState
): { state: GcImportState; released: number } => {
  const clubOfSchedule = new Map<string, string>();
  const levelOfSchedule = new Map<string, number>();
  state.teams.forEach((team) =>
    team.gcTeams?.forEach((link) => {
      clubOfSchedule.set(link.teamId, team.id);
      if (link.ageLevel !== undefined) levelOfSchedule.set(link.teamId, link.ageLevel);
    })
  );
  const ownPage = ownPageFor(state.ageGroups);
  const added: ScoutGame[] = [];
  let released = 0;
  const games = state.games.map((game) => {
    let next = game;
    (game.alsoRows ?? []).forEach((record) => {
      const club = clubOfSchedule.get(record.teamId);
      if (
        record.filedAgainst === undefined ||
        club === undefined ||
        club === record.filedAgainst ||
        club === game.teamAId ||
        club === game.teamBId
      ) {
        return;
      }
      next = releaseClaim(next, record);
      // Neither of the game's sides is the club's now, so neither of their levels says anything of
      // it: the row takes its club's own level off the schedule it came from, which files it on its
      // own page, and the level its name gave the team it was filed against.
      // A game the user threw out is still thrown out for the row that leaves it.
      const { ageLevelA: _own, ageLevelB: _other, ...row } = filedRowOf(game, record);
      const level = levelOfSchedule.get(record.teamId);
      added.push(
        ownPage({
          ...row,
          teamAId: club,
          teamBId: record.filedAgainst,
          ...(level === undefined ? {} : { ageLevelA: level }),
          ...(record.filedLevel === undefined ? {} : { ageLevelB: record.filedLevel }),
          ...(game.excluded ? { excluded: true } : {}),
        })
      );
      released += 1;
    });
    return next;
  });
  return released === 0
    ? { state, released: 0 }
    : { state: { ...state, games: [...games, ...added] }, released };
};
