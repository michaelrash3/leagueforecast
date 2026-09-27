import { normalizeDateInput } from "./date";
import {
  ageGroupYear,
  findSimilarTeam,
  isScoutGamePlayed,
  LEAGUE_GAME_PREFIX,
  scoreSeenBy,
  teamNameKey,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import type { GameLog, Matchup, TeamBase } from "./types";
import { blankLog, isFinal } from "./util";
import { isDatedAhead } from "./deletedGames";
import { todayIsoDay } from "./date";

/**
 * Filling a League Standings schedule from results already in the Team Rankings pool — in
 * practice, from a GameChanger pull.
 *
 * League Standings has always fed Team Rankings: a season assigned to an age group brings its
 * whole schedule across. This is the return trip for scores, and it exists because the two halves
 * now describe the same games from opposite ends. A club that pulls its own GameChanger team has
 * every result of its league season sitting in the pool, and typing those same scores a second
 * time into the league schedule is work the app can do.
 *
 * Two teams and a day is what makes a league game and a pool result the same game. The day is the
 * part that matters: the same two clubs meeting on another date played each other outside league
 * play, and that game belongs to the pool alone.
 *
 * What this will not do is guess silently. Every row is shown before anything is written, a score
 * that disagrees with one already entered is never quietly replaced, and a game the evidence
 * cannot single out is reported rather than resolved — because the cost of a wrong score here is a
 * wrong standings table, and the person reading it has no way to tell.
 */

/** What filling one league game from the pool would do. */
export type LeagueFillAction =
  /** Nothing recorded here yet, and the two sides are named the same; the result goes in. */
  | "fill"
  /**
   * The same, except a club is spelled differently on the two sides — "Trash Pandas" here,
   * "Trash Pandas Baseball Club" on GameChanger. Offered, never applied unasked, because the
   * difference between a longer name and a different team is a judgement only the reader can make.
   */
  | "suggested"
  /**
   * The club's own schedule has the game against a slot, "TBD- 09/25/26, 7:15 PM", because it was
   * never told the opponent: the same club and day, and its only league game that day. Offered,
   * never applied unasked, since a slot names nobody and the reader is the one who knows.
   */
  | "slot"
  /**
   * The two clubs' own schedules disagree about who won, or one has a tie the other does not.
   * Both versions are offered and neither is applied unasked.
   */
  | "disputed"
  /** A different score is already recorded. Never applied unless it is asked for by name. */
  | "overwrite"
  /** The same score is already recorded, so there is nothing to do. */
  | "unchanged"
  /** More than one result could be this game, and nothing distinguishes them. */
  | "ambiguous";

export type LeagueFillRow = {
  matchupId: string;
  /** The league's own date for the game, as it stores it. */
  date: string;
  awayTeamId: string;
  awayName: string;
  homeTeamId: string;
  homeName: string;
  /** The pool's runs, already turned around to the league's away/home order. */
  awayRuns: number;
  homeRuns: number;
  /**
   * Where the two clubs' own schedules give different scores: whose version the runs above are,
   * and the other club's, in the same away/home order, which a person can fill instead.
   */
  reportedBy?: string;
  alternative?: { awayRuns: number; homeRuns: number; reportedBy: string };
  action: LeagueFillAction;
  /** Why, whenever the action is not a plain fill. */
  detail?: string;
  /** What the pool calls each side, given only when it differs from the league's own name. */
  poolAwayName?: string;
  poolHomeName?: string;
  /** The pool game the runs came from. Absent when nothing could be singled out. */
  scoutGameId?: string;
  /** GameChanger's own ids, when the result came from a pull rather than something typed. */
  gcTeamId?: string;
  gcGameId?: string;
  /** What the league already has, so a disagreement can be shown rather than asserted. */
  currentAwayRuns?: string;
  currentHomeRuns?: string;
  event?: string;
};

export type LeagueFillPlan = {
  rows: LeagueFillRow[];
  /** League games with nothing in the pool to fill them — the normal case mid-season. */
  unmatched: number;
  /** Results in the pool that no league game claimed. */
  unusedResults: number;
  /**
   * Whether any age group claims this season. Nothing can match when none does, and that is a
   * setup problem rather than an empty result, so the panel says which it is.
   */
  seasonLinked: boolean;
};

/** The two teams of a game, in an order that is the same whichever end you look from. */
const pairKey = (a: string, b: string) => [a, b].sort().join("|");

/**
 * The key a league game and a pool result have to agree on to be the same game: both teams and the
 * day. The league stores a date as month and day with no year, so that is the common ground —
 * `normalizeDateInput` reduces an ISO date to the same shape. Two seasons of one age group can
 * therefore collide on a date, which is exactly what the doubleheader handling below is for.
 */
const matchKey = (teamKeyA: string, teamKeyB: string, date: string) =>
  `${pairKey(teamKeyA, teamKeyB)}@${date}`;

const runsText = (log: GameLog | undefined, side: "away" | "home") =>
  (side === "away" ? log?.awayRuns : log?.homeRuns) ?? "";

/** A league game already carries a result when both run boxes hold a number. */
const hasRecordedRuns = (log: GameLog | undefined) =>
  runsText(log, "away").trim() !== "" && runsText(log, "home").trim() !== "";

/**
 * Whether a league team and a pool team are the same club.
 *
 * "exact" is the same name once age labels and case are set aside, which is what the pool already
 * does to every name it stores. "similar" is the case this whole second pass exists for: a league
 * typed as "Trash Pandas" against a GameChanger team called "Trash Pandas Baseball Club". That is
 * `findSimilarTeam`'s judgement, reused rather than re-derived so both halves of the app agree
 * about what counts as close — and it is deliberately stricter than it looks, stopping short of
 * "South Lexington Red" against "…Blue".
 */
const clubMatch = (
  leagueTeam: TeamBase,
  poolTeam: ScoutTeam
): "linked" | "exact" | "similar" | null => {
  // The club a person linked this league team to in Settings is that club, whatever either half
  // calls it: the link was made so a league's "513 Force" is the pool's "513 FORCE - BOULEY".
  if (leagueTeam.scoutTeamId === poolTeam.id) return "linked";
  if (teamNameKey(leagueTeam.name) === teamNameKey(poolTeam.name)) return "exact";
  return findSimilarTeam(leagueTeam.name, [poolTeam]) ? "similar" : null;
};

/** "The Generals’" rather than "The Generals's". */
const possessive = (name: string): string => (/s$/i.test(name) ? `${name}’` : `${name}’s`);

/** Which side is ahead: 1 the away side, -1 the home side, 0 a tie. */
const winnerOf = (away: number, home: number): number => Math.sign(away - home);

export type LeagueScoreFillInput = {
  seasonId: string;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  ageGroups: AgeGroup[];
  scoutTeams: ScoutTeam[];
  scoutGames: ScoutGame[];
  /** Today as an ISO day, so one clock decides what is still to come and a test can say which. */
  today?: string;
};

/** The two sides of a pool result, lined up with a league game's away and home teams. */
type Alignment = {
  awayRuns: number;
  homeRuns: number;
  /** "similar" when either side needed the looser name rule to line up. */
  strength: "exact" | "similar";
  poolAwayName: string;
  poolHomeName: string;
  /** A side lined up by the Settings link rather than its name, which is no reason to check it. */
  awayLinked: boolean;
  homeLinked: boolean;
  /** Whose schedule gave these runs, and the other club's own version where it differs. */
  reportedBy: string;
  alternative?: { awayRuns: number; homeRuns: number; reportedBy: string };
  /** What made it this game, when not the names: the club's own row against a slot. */
  slot?: string;
};

/**
 * Works out what could be filled in, and says so for every league game it can speak to. Pure: it
 * reads both halves and writes nothing, so the panel can show the whole plan before a decision.
 */
export const planLeagueScoreFill = ({
  seasonId,
  teams,
  matchups,
  logs,
  ageGroups,
  scoutTeams,
  scoutGames,
  today = todayIsoDay(),
}: LeagueScoreFillInput): LeagueFillPlan => {
  // The link already exists: an age group names the League Standings seasons that belong to it.
  // Reusing it means the two halves cannot disagree about which games are the same season's.
  const claiming = ageGroups.filter((group) => group.seasonIds.includes(seasonId));
  const seasonLinked = claiming.length > 0;
  const linkedGroups = new Set(claiming.map((group) => group.id));
  /*
   * The other pages of the same squad years, for the clubs a person linked a league team to in
   * Settings and nothing else. A club GameChanger lists at another age files its games on that
   * age's page: the Cincinnati Hornets' fall team is listed at 8U, and its copy of the league's 9U
   * game on 25 September sat on the 8U page, where this never looked. Only a linked club, since the
   * link says which club it is: by name alone, another page's "Aces" is as likely the same
   * organisation's older squad, playing its own game that day.
   */
  const claimedYears = new Set(
    claiming.map(ageGroupYear).filter((year): year is number => year !== undefined)
  );
  const yearGroups = new Set(
    ageGroups
      .filter((group) => {
        const year = ageGroupYear(group);
        return !linkedGroups.has(group.id) && year !== undefined && claimedYears.has(year);
      })
      .map((group) => group.id)
  );
  const linkedClubIds = new Set(
    teams.map((team) => team.scoutTeamId).filter((id): id is string => id !== undefined)
  );

  const leagueNameById = new Map(teams.map((team) => [team.id, team.name]));
  const leagueTeamById = new Map(teams.map((team) => [team.id, team]));
  /** A league team by id, or one standing in for an id the roster has lost, known by the id. */
  const leagueTeamOf = (teamId: string): TeamBase =>
    leagueTeamById.get(teamId) ?? { id: teamId, name: teamId };
  const scoutTeamById = new Map(scoutTeams.map((team) => [team.id, team]));

  /**
   * Results that could fill a league game: played, filed under an age group that claims this
   * season, and not derived from this very schedule in the first place. That last exclusion is the
   * important one — the pool carries the league's own games, and letting those flow back would be
   * the app confirming its own scores.
   */
  const usable: ScoutGame[] = [];
  const poolByKey = new Map<string, ScoutGame[]>();
  const poolByDate = new Map<string, ScoutGame[]>();
  scoutGames.forEach((game) => {
    if (
      !linkedGroups.has(game.ageGroupId) &&
      !(
        yearGroups.has(game.ageGroupId) &&
        (linkedClubIds.has(game.teamAId) || linkedClubIds.has(game.teamBId))
      )
    ) {
      return;
    }
    if (game.id.startsWith(LEAGUE_GAME_PREFIX)) return;
    if (!isScoutGamePlayed(game)) return;
    /*
     * And not a score on a day that has not happened. You cannot score a game early, so a row like
     * that is somebody's mistake or somebody's invention — and offering it here writes it into the
     * league's own book marked final, which is the one place it does real damage. `excluded` is
     * deliberately not checked: a cross-age tournament game is kept out of the ratings and is
     * still a game the league played and wants the score of.
     */
    if (isDatedAhead(game, today)) return;
    const date = normalizeDateInput(game.date ?? "");
    if (!date) return;
    const teamA = scoutTeamById.get(game.teamAId);
    const teamB = scoutTeamById.get(game.teamBId);
    if (!teamA || !teamB || teamA.id === teamB.id) return;

    usable.push(game);
    const key = matchKey(teamNameKey(teamA.name), teamNameKey(teamB.name), date);
    const keyed = poolByKey.get(key);
    if (keyed) keyed.push(game);
    else poolByKey.set(key, [game]);
    // The same results indexed by day alone, for the second pass over the names that did not
    // line up exactly.
    const dated = poolByDate.get(date);
    if (dated) dated.push(game);
    else poolByDate.set(date, [game]);
  });
  // Stable order, so a doubleheader is zipped the same way every time this runs.
  const byId = (a: ScoutGame, b: ScoutGame) => a.id.localeCompare(b.id);
  poolByKey.forEach((bucket) => bucket.sort(byId));
  poolByDate.forEach((bucket) => bucket.sort(byId));

  /** League games grouped the same way, so both sides of a doubleheader can be counted. */
  const leagueByKey = new Map<string, Matchup[]>();
  const leagueDates = new Map<string, string>();
  matchups.forEach((matchup) => {
    const date = normalizeDateInput(matchup.date ?? "");
    if (!date) return;
    const awayName = leagueNameById.get(matchup.away);
    const homeName = leagueNameById.get(matchup.home);
    if (!awayName || !homeName) return;
    const key = matchKey(teamNameKey(awayName), teamNameKey(homeName), date);
    leagueDates.set(matchup.id, date);
    const bucket = leagueByKey.get(key);
    if (bucket) bucket.push(matchup);
    else leagueByKey.set(key, [matchup]);
  });

  const rows: LeagueFillRow[] = [];
  const claimed = new Set<string>();
  /** League games the exact pass could not speak to; the name pass gets a turn at these. */
  const leftovers: Matchup[] = [];
  /** And the ones neither pass could reach — nothing in the pool is this game. */
  const unmatchedLeagueGames: Matchup[] = [];

  /**
   * The other club's own version of a pool result, lined up the same way, where its schedule gives
   * a different score (`ScoutGame.reportedByB`); side A's schedule is the one the row came off.
   */
  const versionsOf = (
    game: ScoutGame,
    awayIsA: boolean,
    teamA: ScoutTeam,
    teamB: ScoutTeam
  ): Pick<Alignment, "reportedBy" | "alternative"> => {
    const byB = game.reportedByB;
    const reportedBy = (game.scoreFromB ? teamB : teamA).name;
    if (!byB || (byB.teamAScore === game.teamAScore && byB.teamBScore === game.teamBScore)) {
      return { reportedBy };
    }
    return {
      reportedBy,
      alternative: {
        awayRuns: awayIsA ? byB.teamAScore : byB.teamBScore,
        homeRuns: awayIsA ? byB.teamBScore : byB.teamAScore,
        reportedBy: teamB.name,
      },
    };
  };

  /** Lines a pool result up with a league game, or says it is not that game. */
  const align = (game: ScoutGame, matchup: Matchup): Alignment | null => {
    const teamA = scoutTeamById.get(game.teamAId);
    const teamB = scoutTeamById.get(game.teamBId);
    if (!teamA || !teamB) return null;
    const away = leagueTeamOf(matchup.away);
    const home = leagueTeamOf(matchup.home);

    // The pool stores the pulled team first, not the home team, so both orders are tried and the
    // sides are decided by who each team is rather than by where it sits.
    const asListed = { away: clubMatch(away, teamA), home: clubMatch(home, teamB) };
    const reversed = { away: clubMatch(away, teamB), home: clubMatch(home, teamA) };
    const awayIsA = Boolean(asListed.away && asListed.home);
    const fit = awayIsA ? asListed : reversed;
    if (!fit.away || !fit.home) return null;

    return {
      awayRuns: (awayIsA ? game.teamAScore : game.teamBScore)!,
      homeRuns: (awayIsA ? game.teamBScore : game.teamAScore)!,
      strength: fit.away !== "similar" && fit.home !== "similar" ? "exact" : "similar",
      poolAwayName: (awayIsA ? teamA : teamB).name,
      poolHomeName: (awayIsA ? teamB : teamA).name,
      awayLinked: fit.away === "linked",
      homeLinked: fit.home === "linked",
      ...versionsOf(game, awayIsA, teamA, teamB),
    };
  };

  /** Turns one aligned result into the row the panel shows. */
  const rowFor = (matchup: Matchup, game: ScoutGame, aligned: Alignment): LeagueFillRow => {
    const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
    const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
    const log = logs[matchup.id];
    const currentAway = runsText(log, "away");
    const currentHome = runsText(log, "home");
    const recorded = hasRecordedRuns(log);
    const isRecorded = (runs: { awayRuns: number; homeRuns: number }) =>
      recorded && Number(currentAway) === runs.awayRuns && Number(currentHome) === runs.homeRuns;
    /*
     * Where the league already has the other club's version, that is the one the row shows: the
     * league agrees with a club's own schedule, and nothing is to be done.
     */
    const fit: Alignment =
      aligned.alternative && !isRecorded(aligned) && isRecorded(aligned.alternative)
        ? {
            ...aligned,
            awayRuns: aligned.alternative.awayRuns,
            homeRuns: aligned.alternative.homeRuns,
            reportedBy: aligned.alternative.reportedBy,
            alternative: {
              awayRuns: aligned.awayRuns,
              homeRuns: aligned.homeRuns,
              reportedBy: aligned.reportedBy,
            },
          }
        : aligned;
    const same = isRecorded(fit);
    const other = fit.alternative;
    /*
     * The two clubs' schedules disagreeing is common and mostly a run either way: 817 of 8,188
     * two-sided games on the 9U 2027 page of 26 September, 633 of them a run apart or less. Where
     * they agree on the winner that only says which score to write, so the fill goes ahead with
     * both shown. A different winner (34) or a tie against a result (33) changes a standings
     * table, and waits for a person to say which.
     */
    const contested =
      other !== undefined &&
      winnerOf(other.awayRuns, other.homeRuns) !== winnerOf(fit.awayRuns, fit.homeRuns);

    // A looser name match only ever holds back a fill. A game already scored still reads as a
    // disagreement or as nothing to do, because that judgement is about the runs, not the names.
    const action: LeagueFillAction = same
      ? "unchanged"
      : recorded
        ? "overwrite"
        : contested
          ? "disputed"
          : fit.slot !== undefined
            ? "slot"
            : fit.strength === "exact"
              ? "fill"
              : "suggested";

    const differing: string[] = [];
    if (
      fit.slot === undefined &&
      !fit.awayLinked &&
      teamNameKey(fit.poolAwayName) !== teamNameKey(awayName)
    ) {
      differing.push(`${awayName} is “${fit.poolAwayName}” in the pool`);
    }
    if (
      fit.slot === undefined &&
      !fit.homeLinked &&
      teamNameKey(fit.poolHomeName) !== teamNameKey(homeName)
    ) {
      differing.push(`${homeName} is “${fit.poolHomeName}” in the pool`);
    }

    const details: string[] = [];
    if (action === "overwrite") {
      details.push(
        `Already recorded as ${currentAway}–${currentHome}${isFinal(log) ? " and marked final" : ""}.`
      );
    } else if (action === "unchanged" && !isFinal(log)) {
      details.push("Same score, not yet marked final.");
    }
    if (fit.slot !== undefined) details.push(fit.slot);
    else if (differing.length > 0 && action !== "overwrite" && action !== "unchanged") {
      details.push(`${differing.join("; ")}. Check this is the same club before filling it.`);
    }
    if (other) {
      details.push(
        `The two clubs’ schedules differ: ${possessive(fit.reportedBy)} has ${fit.awayRuns}–${fit.homeRuns}, ${possessive(other.reportedBy)} ${other.awayRuns}–${other.homeRuns}.`
      );
    }
    const detail = details.length > 0 ? details.join(" ") : undefined;

    return {
      matchupId: matchup.id,
      date: matchup.date,
      awayTeamId: matchup.away,
      awayName,
      homeTeamId: matchup.home,
      homeName,
      awayRuns: fit.awayRuns,
      homeRuns: fit.homeRuns,
      ...(other ? { reportedBy: fit.reportedBy, alternative: other } : {}),
      action,
      ...(detail ? { detail } : {}),
      ...(teamNameKey(fit.poolAwayName) === teamNameKey(awayName)
        ? {}
        : { poolAwayName: fit.poolAwayName }),
      ...(teamNameKey(fit.poolHomeName) === teamNameKey(homeName)
        ? {}
        : { poolHomeName: fit.poolHomeName }),
      scoutGameId: game.id,
      ...(game.source ? { gcTeamId: game.source.teamId, gcGameId: game.source.gameId } : {}),
      ...(recorded ? { currentAwayRuns: currentAway, currentHomeRuns: currentHome } : {}),
      ...(game.event ? { event: game.event } : {}),
    };
  };

  /** How many league games each league team has on each day, for the slot pass below. */
  const leagueGamesOn = new Map<string, number>();
  matchups.forEach((matchup) => {
    const date = leagueDates.get(matchup.id);
    if (!date) return;
    [matchup.away, matchup.home].forEach((teamId) => {
      const key = `${teamId}@${date}`;
      leagueGamesOn.set(key, (leagueGamesOn.get(key) ?? 0) + 1);
    });
  });

  /**
   * The last look at a league game neither pass could see: a club's own row of it against a slot.
   *
   * A GameChanger schedule that was never told the opponent files the game against a slot, "TBD-
   * 09/25/26, 7:15 PM", and when the other club's own schedule is not in the pool nothing names the
   * game at all: 513 Force - Bouley's 0-13 at the Cincinnati Hornets on 25 September looked like a
   * game still to play. The same club — by the Settings link or by its exact name — off its own
   * schedule, on the day, against a slot and nothing else, where that is the club's only league game
   * that day and its only such row: that is offered, never ticked. Slots only: with each real game
   * on the 9U 2027 page hidden in turn, taking stand-ins as well offered a different game in its
   * place 9.1% of the time, slots alone 1.5%.
   *
   * Read per club, as the pool's own pairing is (`leagueCopiesFiledAgainstNobody`): each club's
   * schedule holds its own copy. Both copies agreeing are one row; disagreeing about the winner,
   * both versions are offered as a dispute.
   */
  const slotCopy = (matchup: Matchup, sameDay: readonly ScoutGame[]): boolean => {
    const date = leagueDates.get(matchup.id);
    if (!date) return false;
    type Copy = {
      game: ScoutGame;
      club: ScoutTeam;
      slot: ScoutTeam;
      own: number;
      opponent: number;
    };
    const copiesOf = (leagueTeam: TeamBase): Copy[] | null => {
      if (leagueGamesOn.get(`${leagueTeam.id}@${date}`) !== 1) return [];
      const copies: Copy[] = [];
      sameDay.forEach((game) => {
        (
          [
            [game.teamAId, game.teamBId],
            [game.teamBId, game.teamAId],
          ] as const
        ).forEach(([clubId, otherId]) => {
          const club = scoutTeamById.get(clubId);
          const slot = scoutTeamById.get(otherId);
          if (!club || !slot?.placeholder) return;
          const match = clubMatch(leagueTeam, club);
          if (match !== "linked" && match !== "exact") return;
          const schedule = game.source?.teamId;
          if (!schedule || !(club.gcTeams ?? []).some((link) => link.teamId === schedule)) return;
          const seen = scoreSeenBy(game, clubId);
          if (seen) copies.push({ game, club, slot, own: seen.own, opponent: seen.opponent });
        });
      });
      // Two rows of the club's against slots that day: nothing says which is the league's.
      return copies.length > 1 ? null : copies;
    };
    const awayCopies = copiesOf(leagueTeamOf(matchup.away));
    const homeCopies = copiesOf(leagueTeamOf(matchup.home));
    if (awayCopies === null || homeCopies === null) return false;
    const fromAway = awayCopies[0];
    const fromHome = homeCopies[0];
    const first = fromAway ?? fromHome;
    if (!first) return false;

    const versionOf = (copy: Copy, clubIsAway: boolean) => ({
      awayRuns: clubIsAway ? copy.own : copy.opponent,
      homeRuns: clubIsAway ? copy.opponent : copy.own,
      reportedBy: copy.club.name,
    });
    const main = versionOf(first, first === fromAway);
    const second = fromAway && fromHome ? versionOf(fromHome, false) : undefined;
    const agree =
      !second || (second.awayRuns === main.awayRuns && second.homeRuns === main.homeRuns);
    const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
    const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
    const note = (copy: Copy) =>
      `${possessive(copy.club.name)} own schedule has this game against “${copy.slot.name}”`;
    [fromAway, fromHome].forEach((copy) => copy && claimed.add(copy.game.id));
    rows.push(
      rowFor(matchup, first.game, {
        awayRuns: main.awayRuns,
        homeRuns: main.homeRuns,
        strength: "similar",
        poolAwayName: first === fromAway ? first.club.name : first.slot.name,
        poolHomeName: first === fromAway ? first.slot.name : first.club.name,
        awayLinked: false,
        homeLinked: false,
        reportedBy: main.reportedBy,
        ...(agree ? {} : { alternative: second }),
        slot: `${[fromAway, fromHome]
          .filter((copy): copy is Copy => copy !== undefined)
          .map(note)
          .join(", and ")}: ${
          fromAway && fromHome ? "both clubs’" : "the club’s"
        } only league game that day, and ${
          fromAway && fromHome ? `the one ${awayName} at ${homeName}` : "nothing else names it"
        }.`,
      })
    );
    return true;
  };

  // ---------- First pass: the names agree ----------

  leagueByKey.forEach((leagueGames, key) => {
    const results = poolByKey.get(key) ?? [];
    if (results.length === 0) {
      leftovers.push(...leagueGames);
      return;
    }

    /**
     * A pair can meet twice on one day, and youth baseball schedules doubleheaders constantly.
     * When both sides count the same, the games are paired in order — the only ordering either
     * side offers. When they do not, nothing here can say which result belongs to which game, and
     * a fifty-fifty guess about a score is not worth making.
     */
    if (results.length !== leagueGames.length) {
      leagueGames.forEach((matchup) => {
        rows.push({
          matchupId: matchup.id,
          date: matchup.date,
          awayTeamId: matchup.away,
          awayName: leagueNameById.get(matchup.away) ?? matchup.away,
          homeTeamId: matchup.home,
          homeName: leagueNameById.get(matchup.home) ?? matchup.home,
          awayRuns: 0,
          homeRuns: 0,
          action: "ambiguous",
          detail:
            results.length > leagueGames.length
              ? `${results.length} results for this pairing on this date, but ${leagueGames.length} game${leagueGames.length === 1 ? "" : "s"} on the schedule.`
              : `${leagueGames.length} games for this pairing on this date, but only ${results.length} result${results.length === 1 ? "" : "s"}.`,
        });
      });
      return;
    }

    leagueGames.forEach((matchup, index) => {
      const result = results[index]!;
      const fit = align(result, matchup);
      if (!fit) {
        leftovers.push(matchup);
        return;
      }
      claimed.add(result.id);
      rows.push(rowFor(matchup, result, fit));
    });
  });

  // ---------- Second pass: the same club, spelled differently ----------

  /**
   * The league and GameChanger rarely agree on how long a club's name is, and a league game left
   * unmatched is indistinguishable from one that simply has not been played — which is what makes
   * the silence dangerous. So every leftover gets a second look against the results on its own
   * day, under the looser name rule, and anything that lines up is offered rather than applied.
   */
  leftovers.forEach((matchup) => {
    const date = leagueDates.get(matchup.id);
    const awayName = leagueNameById.get(matchup.away) ?? matchup.away;
    const homeName = leagueNameById.get(matchup.home) ?? matchup.home;
    const sameDay = (date ? (poolByDate.get(date) ?? []) : []).filter(
      (game) => !claimed.has(game.id)
    );

    const candidates = sameDay
      .map((game) => ({ game, fit: align(game, matchup) }))
      .filter((candidate): candidate is { game: ScoutGame; fit: Alignment } =>
        Boolean(candidate.fit)
      );

    if (candidates.length === 0) {
      if (!slotCopy(matchup, sameDay)) unmatchedLeagueGames.push(matchup);
      return;
    }
    if (candidates.length > 1) {
      // Two clubs close enough to this game's names played on this day. Naming which is which is
      // the reader's call, and there is nothing here to make it with.
      rows.push({
        matchupId: matchup.id,
        date: matchup.date,
        awayTeamId: matchup.away,
        awayName,
        homeTeamId: matchup.home,
        homeName,
        awayRuns: 0,
        homeRuns: 0,
        action: "ambiguous",
        detail: `${candidates.length} results on this date could be this game, under names close to these.`,
      });
      return;
    }

    const only = candidates[0]!;
    claimed.add(only.game.id);
    rows.push(rowFor(matchup, only.game, only.fit));
  });

  // Schedule order, so the review reads the way the season does.
  const orderOf = new Map(matchups.map((matchup, index) => [matchup.id, index]));
  rows.sort((a, b) => (orderOf.get(a.matchupId) ?? 0) - (orderOf.get(b.matchupId) ?? 0));

  return {
    rows,
    unmatched: unmatchedLeagueGames.length,
    unusedResults: usable.length - claimed.size,
    seasonLinked,
  };
};

/**
 * The rows this would act on without being asked: a plain fill, and nothing else. A suggestion
 * rests on two names that are not the same string, so it waits to be ticked.
 */
export const defaultFillSelection = (plan: LeagueFillPlan): string[] =>
  plan.rows.filter((row) => row.action === "fill").map((row) => row.matchupId);

/**
 * Writes the chosen rows into the league's logs and returns a new map. Runs and the final flag are
 * all it sets: everything else a log can hold is left exactly as it was, so a game that already
 * had hits or strikeouts typed against it keeps them.
 */
export const applyLeagueScoreFill = (
  plan: LeagueFillPlan,
  selected: Iterable<string>,
  logs: Record<string, GameLog>,
  defaultInnings: number,
  /** Rows to fill with the other club's version (`LeagueFillRow.alternative`) rather than the first. */
  otherVersion: Iterable<string> = []
): { logs: Record<string, GameLog>; filled: number } => {
  const wanted = new Set(selected);
  const theOther = new Set(otherVersion);
  const byMatchup = new Map(plan.rows.map((row) => [row.matchupId, row]));
  const next = { ...logs };
  let filled = 0;

  wanted.forEach((matchupId) => {
    const row = byMatchup.get(matchupId);
    // Ambiguous rows carry no result, so there is nothing to write even if one is asked for.
    if (!row || row.action === "ambiguous") return;
    const current = next[matchupId] ?? blankLog(String(defaultInnings));
    const runs = theOther.has(matchupId) && row.alternative ? row.alternative : row;
    next[matchupId] = {
      ...current,
      awayRuns: String(runs.awayRuns),
      homeRuns: String(runs.homeRuns),
      isFinal: true,
    };
    filled += 1;
  });

  return { logs: next, filled };
};

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** One line for the toast, saying what was written and what was deliberately left alone. */
export const summarizeLeagueFill = (plan: LeagueFillPlan, filled: number): string => {
  const left = plan.rows.filter((row) => row.action === "overwrite").length;
  const offered = plan.rows.filter(
    (row) => row.action === "suggested" || row.action === "slot" || row.action === "disputed"
  ).length;
  const unclear = plan.rows.filter((row) => row.action === "ambiguous").length;
  const parts = [`Filled ${plural(filled, "game")}`];
  if (offered > 0) parts.push(`${offered} still to confirm`);
  if (left > 0) parts.push(`${left} left as entered`);
  if (unclear > 0) parts.push(`${unclear} could not be told apart`);
  if (plan.unmatched > 0) parts.push(`${plan.unmatched} with no result yet`);
  return `${parts.join(" · ")}.`;
};
