/**
 * The league of one club asked about, as its own schedule names it, for the owner (26 October 2026):
 * "pull all of the other teams they play and their records … who you think is in their league vs
 * their potential outside games." The fit's communities put the Longhorns in a group of 60 clubs;
 * the owner's league is 7 or 8. So the league here is the club and every club its own rated games
 * are against, and each of those clubs' games is either against another of them (in the league) or
 * against anybody else (outside it), with the record of each and whether the club's own schedule is
 * pulled. Then, for every one of them with a GameChanger team, what GameChanger itself lists that
 * the pool does not (`compareWithGameChanger`): the games a schedule never pulled would have added,
 * each marked in the league or outside it.
 *
 * Free of Node, so a test can hold it to what it says (`clubLeagueReport.test.ts`).
 */
import type { GcGame, GcTeamResponse } from "../src/lib/gameChangerApi.ts";
import { scoreSeenBy, type ScoutGame, type ScoutTeam } from "../src/lib/teamRankings.ts";
import { teamNameKey } from "../src/lib/teamRankings/names.ts";

export type Tally = { won: number; lost: number; tied: number };

export type LeagueGame = {
  date: string;
  opponent: string;
  /** The club's own runs first, as its schedule (or the other's, where its own has none) gave them. */
  score: string;
  result: "W" | "L" | "T";
  /** Whether the opponent's own schedule is pulled (it has a GameChanger team). */
  opponentPulled: boolean;
};

export type LeagueClub = {
  id: string;
  name: string;
  place: string;
  /** Its GameChanger teams: pulled, so its own schedule is in the pool. */
  gcTeamIds: string[];
  overall: Tally;
  inLeague: Tally;
  outside: Tally;
  outsideGames: LeagueGame[];
  /** In the fit's community of the club asked about. */
  inCommunity: boolean;
};

export type ClubLeagueReport = {
  clubId: string;
  name: string;
  games: LeagueGame[];
  league: LeagueClub[];
  /** The fit's community of the club: its size, and its games with one side outside it. */
  community?: { size: number; outside: number };
};

const tally = (): Tally => ({ won: 0, lost: 0, tied: 0 });
const count = (into: Tally, result: LeagueGame["result"]) => {
  if (result === "W") into.won += 1;
  else if (result === "L") into.lost += 1;
  else into.tied += 1;
};
export const tallyWords = (t: Tally): string =>
  `${t.won}-${t.lost}${t.tied > 0 ? `-${t.tied}` : ""}`;

/**
 * The club asked about, the clubs its rated games are against, and each one's rated games: `games`
 * are the games the board rates (`scoutRatingGames`), so a game it leaves out is left out here too.
 */
export const clubLeagueReport = ({
  teams,
  games,
  clubId,
  communityOf,
  communityOutside,
}: {
  teams: readonly ScoutTeam[];
  games: readonly ScoutGame[];
  clubId: string;
  /** The fit's community of each club, where it put one. */
  communityOf?: ReadonlyMap<string, number>;
  /** Games with one side outside each community, by community. */
  communityOutside?: readonly number[];
}): ClubLeagueReport => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const pulled = (id: string) => (byId.get(id)?.gcTeams ?? []).length > 0;
  const seen = (game: ScoutGame, id: string): LeagueGame | undefined => {
    const runs = scoreSeenBy(game, id);
    if (!runs) return undefined;
    const other = game.teamAId === id ? game.teamBId : game.teamAId;
    return {
      date: game.date ?? "?",
      opponent: nameOf(other),
      score: `${runs.own}-${runs.opponent}`,
      result: runs.own > runs.opponent ? "W" : runs.own < runs.opponent ? "L" : "T",
      opponentPulled: pulled(other),
    };
  };
  const mine = games.filter((game) => game.teamAId === clubId || game.teamBId === clubId);
  const league = new Set<string>([clubId]);
  mine.forEach((game) => league.add(game.teamAId === clubId ? game.teamBId : game.teamAId));
  const community = communityOf?.get(clubId);
  const clubs: LeagueClub[] = [...league].map((id) => {
    const team = byId.get(id);
    const overall = tally();
    const inLeague = tally();
    const outside = tally();
    const outsideGames: LeagueGame[] = [];
    games.forEach((game) => {
      if (game.teamAId !== id && game.teamBId !== id) return;
      const read = seen(game, id);
      if (!read) return;
      const other = game.teamAId === id ? game.teamBId : game.teamAId;
      count(overall, read.result);
      if (league.has(other)) count(inLeague, read.result);
      else {
        count(outside, read.result);
        outsideGames.push(read);
      }
    });
    outsideGames.sort((a, b) => a.date.localeCompare(b.date));
    return {
      id,
      name: nameOf(id),
      place: [team?.city, team?.state].filter(Boolean).join(", "),
      gcTeamIds: (team?.gcTeams ?? []).map((link) => link.teamId),
      overall,
      inLeague,
      outside,
      outsideGames,
      inCommunity: community !== undefined && communityOf?.get(id) === community,
    };
  });
  const ownGames = mine
    .flatMap((game) => {
      const read = seen(game, clubId);
      return read ? [read] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  let size = 0;
  communityOf?.forEach((value) => {
    if (value === community) size += 1;
  });
  return {
    clubId,
    name: nameOf(clubId),
    games: ownGames,
    league: [clubs[0]!, ...clubs.slice(1).sort((a, b) => a.name.localeCompare(b.name))],
    ...(community === undefined
      ? {}
      : { community: { size, outside: communityOutside?.[community] ?? 0 } }),
  };
};

/** What GameChanger lists for one GameChanger team of a league club, against what the pool has. */
export type GcComparison = {
  clubId: string;
  club: string;
  gcTeamId: string;
  gcName?: string;
  gcRecord?: string;
  gcGames: number;
  /** Games GameChanger lists, played or not, that the pool has no copy of for this club. */
  missing: { date: string; opponent: string; score?: string; inLeague: boolean }[];
  failed?: string;
};

/**
 * Each league club's GameChanger teams as GameChanger lists them now, against the pool's games of
 * the club: a game of the schedule the pool holds under that schedule's own id, or on its day
 * against an opponent of the same name, is there; any other is missing, and is in the league where
 * its opponent's name is a league club's (by `teamNameKey`), outside it otherwise. A canceled
 * game, or one with no day, is left out.
 */
export const compareWithGameChanger = (
  report: ClubLeagueReport,
  teams: readonly ScoutTeam[],
  games: readonly ScoutGame[],
  pulled: ReadonlyMap<string, GcTeamResponse>
): GcComparison[] => {
  const byId = new Map(teams.map((team) => [team.id, team]));
  const leagueNames = new Set(
    report.league.flatMap((club) => [
      teamNameKey(club.name),
      ...(byId.get(club.id)?.gcTeams ?? []).map((link) => teamNameKey(link.name)),
    ])
  );
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  return report.league.flatMap((club) =>
    club.gcTeamIds.map((gcTeamId): GcComparison => {
      const result = pulled.get(gcTeamId);
      const base = { clubId: club.id, club: club.name, gcTeamId };
      if (!result) return { ...base, gcGames: 0, missing: [], failed: "not pulled" };
      if (!result.ok) return { ...base, gcGames: 0, missing: [], failed: result.message };
      const ids = new Set<string>();
      const dated = new Set<string>();
      games.forEach((game) => {
        if (game.teamAId !== club.id && game.teamBId !== club.id) return;
        if (game.source) ids.add(`${game.source.teamId}|${game.source.gameId}`);
        (game.alsoRows ?? []).forEach((row) => ids.add(`${row.teamId}|${row.gameId}`));
        const other = game.teamAId === club.id ? game.teamBId : game.teamAId;
        dated.add(`${game.date ?? ""}|${teamNameKey(nameOf(other))}`);
      });
      const { profile, games: listed } = result.schedule;
      const kept = listed.filter((game: GcGame) => game.status !== "canceled" && game.date);
      const missing = kept
        .filter(
          (game) =>
            !ids.has(`${gcTeamId}|${game.id}`) &&
            !dated.has(`${game.date}|${teamNameKey(game.opponentName)}`)
        )
        .map((game) => ({
          date: game.date ?? "?",
          opponent: game.opponentName,
          ...(game.teamScore !== undefined && game.opponentScore !== undefined
            ? { score: `${game.teamScore}-${game.opponentScore}` }
            : {}),
          inLeague: leagueNames.has(teamNameKey(game.opponentName)),
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
      return {
        ...base,
        gcName: profile.name,
        ...(profile.record
          ? {
              gcRecord: tallyWords({
                won: profile.record.win,
                lost: profile.record.loss,
                tied: profile.record.tie,
              }),
            }
          : {}),
        gcGames: kept.length,
        missing,
      };
    })
  );
};

/**
 * The report in lines: `lines` numbers only, for the public log; `named` every name, for the
 * sealed file.
 */
export const describeClubLeague = (
  report: ClubLeagueReport,
  comparisons: readonly GcComparison[] | undefined
): { lines: string[]; named: string[] } => {
  const lines: string[] = [];
  const named: string[] = [];
  const club = report.league[0];
  const others = report.league.slice(1);
  lines.push(
    "",
    `The club asked about, its league as its own schedule names it: ${report.league.length} clubs` +
      ` (the club and every club it played), ${others.filter((one) => one.gcTeamIds.length > 0).length}` +
      ` of the others pulled; the fit's group of it holds ${report.community?.size ?? "?"} clubs` +
      ` and ${report.community?.outside ?? "?"} games with one side outside it.`
  );
  if (club) {
    lines.push(
      `  the club: ${tallyWords(club.overall)} (in its league ${tallyWords(club.inLeague)},` +
        ` outside ${tallyWords(club.outside)})`
    );
  }
  const outsideTotal = tally();
  others.forEach((one) => {
    outsideTotal.won += one.outside.won;
    outsideTotal.lost += one.outside.lost;
    outsideTotal.tied += one.outside.tied;
  });
  lines.push(`  the clubs it played, outside the league together: ${tallyWords(outsideTotal)}`);
  named.push("", `${report.name}'s games:`);
  report.games.forEach((game) =>
    named.push(
      `  ${game.date}  ${game.result} ${game.score}  against ${game.opponent}${game.opponentPulled ? "" : "  (its own schedule not pulled)"}`
    )
  );
  named.push(
    "",
    "Its league as its schedule names it, each club's record (in the league; outside):"
  );
  report.league.forEach((one) => {
    named.push(
      `  ${one.name} (${one.place || "?"})${one.gcTeamIds.length > 0 ? "" : "  [not pulled]"}` +
        `${one.inCommunity ? "" : "  [outside the fit's group]"}: ${tallyWords(one.overall)}` +
        ` (${tallyWords(one.inLeague)}; ${tallyWords(one.outside)})`
    );
    one.outsideGames.forEach((game) =>
      named.push(
        `      outside ${game.date}  ${game.result} ${game.score}  against ${game.opponent}${game.opponentPulled ? "" : "  (not pulled)"}`
      )
    );
  });
  if (comparisons) {
    const missing = comparisons.reduce((sum, one) => sum + one.missing.length, 0);
    const missingOutside = comparisons.reduce(
      (sum, one) => sum + one.missing.filter((game) => !game.inLeague).length,
      0
    );
    lines.push(
      `  GameChanger now: ${comparisons.length} schedules asked, ${comparisons.filter((one) => one.failed).length}` +
        ` not had; ${missing} games listed there that the pool lacks, ${missingOutside} of them against` +
        " clubs outside the league."
    );
    named.push("", "What GameChanger lists now that the pool lacks (potential outside games):");
    comparisons.forEach((one) => {
      named.push(
        `  ${one.club} — GameChanger "${one.gcName ?? one.gcTeamId}"${one.gcRecord ? `, record ${one.gcRecord}` : ""},` +
          ` ${one.gcGames} games listed${one.failed ? `; not had: ${one.failed}` : ""}`
      );
      one.missing.forEach((game) =>
        named.push(
          `      ${game.inLeague ? "in league" : "OUTSIDE  "} ${game.date}  ${game.score ?? "to play"}  against ${game.opponent}`
        )
      );
    });
  }
  return { lines, named };
};
