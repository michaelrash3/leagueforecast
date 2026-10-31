import { clubPickOption, type ClubPickOption } from "./leagueLinkOptions";
import { displayName } from "./format";
import type { BuiltSeason } from "./roundRobin";
import { createTeamId } from "./sim";
import {
  ageGroupLevel,
  ageGroupYear,
  clubIsPickable,
  gcAgeLevels,
  isScoutGamePlayed,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "./teamRankings";
import { segmentOn, segmentWindow } from "./teamRankings/seasons";
import { dayOf, tournamentReason } from "./tournamentDays";
import type { GameLog, Matchup, TeamBase } from "./types";
import { blankLog } from "./util";
import { NO_MEMBERSHIP, type OrgMembership } from "./orgMembership";

/**
 * Starting a League Standings season from its clubs on Team Rankings (3.7), beside typing the
 * teams, a CSV and the demo: a page, the league's clubs on it, a stretch of days, and the games the
 * pool holds among those clubs in it, played with their scores and still to play, to be looked
 * over before the season is made.
 *
 * All of it is read off the pool as it stands, so the same code answers on this device's own copy
 * and on the server's (`league.start`), and a member's phone, which holds no pool, gets exactly
 * what a visitor's browser works out. Nothing is written until the season is made, and then only
 * the teams' names and the club each one is (`scoutTeamId`): never a club's coaches, nor anything
 * else about it, which the club's own page already shows.
 */

/** A Team Rankings page a league can be started on: one with an age level and a squad year. */
export type StartPage = { id: string; name: string; ageLevel: number; year: number };

/** The pages a league can start on, the newest year first and the youngest level first in it. */
export const startPages = (ageGroups: readonly AgeGroup[]): StartPage[] =>
  ageGroups
    .flatMap((group) => {
      const ageLevel = ageGroupLevel(group);
      const year = ageGroupYear(group);
      return ageLevel === undefined || year === undefined
        ? []
        : [{ id: group.id, name: group.name, ageLevel, year }];
    })
    .sort((a, b) => b.year - a.year || a.ageLevel - b.ageLevel || a.name.localeCompare(b.name));

/**
 * The clubs a league on `page` could be made of: the ones its picker offers when a league team is
 * linked by hand (`clubIsPickable`), clubs GameChanger knows at the page's level or one below, in
 * its year. By name.
 */
export const startClubs = (
  page: StartPage,
  ageGroups: AgeGroup[],
  teams: readonly ScoutTeam[]
): ClubPickOption[] =>
  teams
    .filter((team) => clubIsPickable(team, [page.ageLevel], [page.year], ageGroups))
    .map((team) => startClub(team, page, ageGroups))
    .sort(byLabel);

/** A club as a start offers it on `page`: at the level it is filed at in the page's year. */
const startClub = (team: ScoutTeam, page: StartPage, ageGroups: AgeGroup[]): ClubPickOption => {
  const ageLevel = gcAgeLevels(team, page.year, ageGroups)[0];
  return clubPickOption(ageLevel === undefined ? team : { ...team, ageLevel });
};

const byLabel = (a: ClubPickOption, b: ClubPickOption) =>
  a.label.localeCompare(b.label) || a.id.localeCompare(b.id);

/** The stretch of days a start looks in first: the half of the baseball year `today` is in. */
export const defaultStartWindow = (today: string): { from: string; to: string } => {
  const { year, segment } = segmentOn(today);
  const { start, end } = segmentWindow(year, segment);
  return { from: start, to: end };
};

/** One game the pool holds between two of the league's clubs. */
export type StartGame = {
  /** The pool game it is, so a review can say which one it ticked. */
  gameId: string;
  /** Its day, as the pool dates it. */
  date: string;
  /**
   * Its two clubs, away first. GameChanger's schedules do not say who was at home in a form the pool
   * keeps, so the side whose schedule it came off goes first and a person swaps them where it is
   * the other way round.
   */
  away: string;
  home: string;
  /** When it starts, where GameChanger said (`ScoutGame.startTs`). */
  startTs?: string;
  /** Its score, in the same order, once it is played. */
  awayRuns?: number;
  homeRuns?: number;
  /**
   * Why it looks like a tournament game rather than a league one: either club played somebody else
   * the same day, or the game was entered under an event. Such a game starts unticked.
   */
  tournament?: string;
  /** Where the two clubs' own schedules disagree about the score, the other club's version. */
  otherRuns?: { awayRuns: number; homeRuns: number };
};

export type StartDraft = {
  games: StartGame[];
  /** Games among the clubs the pool holds outside the days asked about, which are left out. */
  outside: number;
};

/**
 * The games among `clubIds` the pool holds from `from` to `to`, both days in, by day: each with
 * its score once played, the other club's score where the two schedules disagree, and why it looks
 * like a tournament meeting where it does. `games` is the year's pool, every club's games, since
 * whether a club played somebody else that day is read off all of them.
 *
 * A game the club's own schedule has since dropped (`withdrawn`) is left out, as the pool leaves it
 * out of everything; one with no day cannot be placed in a league's schedule and is left out too.
 */
export const draftStart = ({
  clubIds,
  games,
  from,
  to,
}: {
  clubIds: readonly string[];
  games: readonly ScoutGame[];
  from: string;
  to: string;
}): StartDraft => {
  const league = new Set(clubIds);
  const tournamentOf = tournamentReason(games, league);
  const picked: Array<StartGame & { order: string }> = [];
  let outside = 0;
  games.forEach((game) => {
    if (game.withdrawn || !league.has(game.teamAId) || !league.has(game.teamBId)) return;
    if (game.teamAId === game.teamBId) return;
    const day = dayOf(game.date);
    if (!day) return;
    if (day < from || day > to) {
      outside += 1;
      return;
    }
    const played = isScoutGamePlayed(game);
    const other = game.reportedByB;
    const disagree =
      played &&
      other !== undefined &&
      (other.teamAScore !== game.teamAScore || other.teamBScore !== game.teamBScore);
    const tournament = tournamentOf(game);
    picked.push({
      gameId: game.id,
      date: day,
      away: game.teamAId,
      home: game.teamBId,
      ...(game.startTs ? { startTs: game.startTs } : {}),
      ...(played ? { awayRuns: game.teamAScore ?? 0, homeRuns: game.teamBScore ?? 0 } : {}),
      ...(tournament ? { tournament } : {}),
      ...(disagree
        ? { otherRuns: { awayRuns: other.teamAScore, homeRuns: other.teamBScore } }
        : {}),
      order: `${day} ${game.startTs ?? ""} ${game.id}`,
    });
  });
  picked.sort((a, b) => a.order.localeCompare(b.order));
  return { games: picked.map(({ order: _order, ...game }) => game), outside };
};

/** A game of the draft as the review leaves it: kept or not, and the right way round. */
export type StartChoice = { gameId: string; keep: boolean; swap: boolean };

/** A pool day as League Standings writes a date: "9/25". */
const leagueDate = (day: string): string =>
  `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;

/**
 * The season the review makes: a team for each club, named as Team Rankings names it and linked to
 * it (`scoutTeamId`), and a game for each one kept, turned round where the review swapped it, with
 * its score entered and final where it was played. A team named like another gets the other's
 * id with a number, as a typed list does (`createTeamId`). A start whose clubs are not Team
 * Rankings' own (a GameChanger organization's teams, `gcOrgSchedule.ts`) names the club each is
 * through `linkOf`, and a team with none is linked to nothing. `gcOf` is a GameChanger id the club
 * carries, kept beside the link (`TeamBase.scoutGcTeamId`) so the link follows the club should the
 * pool give its id to another.
 */
export const seasonFromStart = (
  clubs: readonly { id: string; name: string }[],
  draft: StartDraft,
  choices: readonly StartChoice[],
  defaultInnings: number,
  linkOf: (clubId: string) => string | undefined = (clubId) => clubId,
  gcOf: (clubId: string) => string | undefined = () => undefined
): BuiltSeason => {
  const taken = new Set<string>();
  const teamOf = new Map<string, TeamBase>();
  const teams: TeamBase[] = clubs.map((club) => {
    const scoutTeamId = linkOf(club.id);
    const scoutGcTeamId = scoutTeamId === undefined ? undefined : gcOf(club.id);
    const team = {
      id: createTeamId(displayName(club.name), taken),
      name: club.name,
      ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
      ...(scoutGcTeamId === undefined ? {} : { scoutGcTeamId }),
    };
    teamOf.set(club.id, team);
    return team;
  });
  const chosen = new Map(choices.map((choice) => [choice.gameId, choice]));
  const matchups: Matchup[] = [];
  const logs: Record<string, GameLog> = {};
  draft.games.forEach((game) => {
    const choice = chosen.get(game.gameId);
    if (!choice?.keep) return;
    const first = teamOf.get(game.away);
    const second = teamOf.get(game.home);
    if (!first || !second) return;
    const [away, home] = choice.swap ? [second, first] : [first, second];
    const id = `game_${String(matchups.length + 1).padStart(3, "0")}_${away.id}_${home.id}`;
    matchups.push({
      id,
      date: leagueDate(game.date),
      away: away.id,
      home: home.id,
      ...(game.startTs ? { startTs: game.startTs } : {}),
    });
    const log = blankLog(String(defaultInnings));
    if (game.awayRuns !== undefined && game.homeRuns !== undefined) {
      const [awayRuns, homeRuns] = choice.swap
        ? [game.homeRuns, game.awayRuns]
        : [game.awayRuns, game.homeRuns];
      logs[id] = { ...log, awayRuns: String(awayRuns), homeRuns: String(homeRuns), isFinal: true };
    } else logs[id] = log;
  });
  return { teams, matchups, logs };
};

/** What the review starts with: every game kept but the likely tournament ones, none swapped. */
export const startChoices = (draft: StartDraft): StartChoice[] =>
  draft.games.map((game) => ({ gameId: game.gameId, keep: !game.tournament, swap: false }));

/** At most this many clubs make a league asked about: more is not a league but a region. */
export const START_CLUBS_MAX = 64;

/**
 * What a start asks, step by step: with no page, the pages; with a page, its clubs as well; with
 * the clubs picked too, the games among them from `from` to `to` (the half `today` is in, unless
 * both are given).
 */
export type StartQuery = {
  /**
   * A GameChanger organization (a league) to start from, by its id: its teams, as the kept
   * Organizations file lists them, found among the pool's clubs, on the page most of them are on,
   * with the draft of their games, in one answer. The page and clubs asked with it are not read.
   */
  org?: string;
  page?: string;
  clubs?: readonly string[];
  from?: string;
  to?: string;
  today: string;
};

export type StartAnswer = {
  pages: StartPage[];
  /** The page's clubs, asked for before any are picked; otherwise not sent again. */
  clubs: ClubPickOption[] | null;
  draft: StartDraft | null;
  /** The page an organization's start settled on; `clubs` above are that page's. */
  page?: string;
  /** The clubs of the organization on that page, picked to begin with. */
  picked?: string[];
  /** What an organization's start found (`StartOrg`). */
  org?: StartOrg;
};

/**
 * An organization asked about: whether the kept Organizations file has it, what it is called, how
 * many teams it lists, and how many of those are clubs the pool has pulled.
 */
export type StartOrg = { found: boolean; name?: string; teams?: number; pulled?: number };

/**
 * A start's answer off a pool, read through `read` as the server's cache or this device's storage
 * holds it. The games are the page's squad year's, which is every day from August to July: a start
 * reaching beyond the year finds nothing there.
 */
export const answerStart = (
  ask: StartQuery,
  read: {
    ageGroups: () => AgeGroup[];
    teams: () => readonly ScoutTeam[];
    gamesForYear: (year: number) => readonly ScoutGame[];
    /** The kept Organizations file, for a start from an organization. */
    orgs?: () => OrgMembership;
  }
): StartAnswer => {
  const ageGroups = read.ageGroups();
  const pages = startPages(ageGroups);
  if (ask.org !== undefined) return answerOrgStart(ask.org, ask, pages, ageGroups, read);
  const page = pages.find((one) => one.id === ask.page);
  if (!page) return { pages, clubs: null, draft: null };
  if (!ask.clubs) return { pages, clubs: startClubs(page, ageGroups, read.teams()), draft: null };
  const window =
    ask.from !== undefined && ask.to !== undefined
      ? { from: ask.from, to: ask.to }
      : defaultStartWindow(ask.today);
  return {
    pages,
    clubs: null,
    draft: draftStart({
      clubIds: ask.clubs,
      games: read.gamesForYear(page.year),
      from: window.from,
      to: window.to,
    }),
  };
};

/**
 * A start from a GameChanger organization (`StartQuery.org`). Its teams are the ones the kept
 * Organizations file lists under it (`MemberOrg.teamIds`); a club is one of them where a GameChanger
 * team linked to it (`gcTeams`) is. The page is the one most of those links are filed on, the
 * newest year first where two tie, as the pages are ordered. The answer is the page's clubs, as its
 * clubs step gives them, with the organization's picked and the draft of their games over the
 * default days, so the review opens at once and a club can still be added or taken out by hand.
 */
const answerOrgStart = (
  orgId: string,
  ask: StartQuery,
  pages: StartPage[],
  ageGroups: AgeGroup[],
  read: Parameters<typeof answerStart>[1]
): StartAnswer => {
  const none = { pages, clubs: null, draft: null };
  const org = (read.orgs?.() ?? NO_MEMBERSHIP).orgs.find((one) => one.orgId === orgId);
  if (!org) return { ...none, org: { found: false } };
  const listed = new Set(org.teamIds);
  const teams = read.teams();
  const onPage = new Map<string, number>();
  const pulled = new Set<string>();
  teams.forEach((team) => {
    if (team.placeholder) return;
    (team.gcTeams ?? []).forEach((link) => {
      if (!listed.has(link.teamId)) return;
      pulled.add(link.teamId);
      onPage.set(link.ageGroupId, (onPage.get(link.ageGroupId) ?? 0) + 1);
    });
  });
  const found = { found: true, name: org.name, teams: listed.size, pulled: pulled.size };
  const most = Math.max(0, ...onPage.values());
  const page = pages.find((one) => most > 0 && onPage.get(one.id) === most);
  if (!page) return { ...none, org: found };
  const mine = teams
    .filter(
      (team) =>
        !team.placeholder &&
        (team.gcTeams ?? []).some((link) => link.ageGroupId === page.id && listed.has(link.teamId))
    )
    .slice(0, START_CLUBS_MAX);
  const options = startClubs(page, ageGroups, teams);
  const offered = new Set(options.map((club) => club.id));
  // A club of the organization the page's picker would not offer (filed a level off in its year)
  // is offered too, since the organization says it is in the league.
  const extra = mine
    .filter((team) => !offered.has(team.id))
    .map((team) => startClub(team, page, ageGroups));
  const window =
    ask.from !== undefined && ask.to !== undefined
      ? { from: ask.from, to: ask.to }
      : defaultStartWindow(ask.today);
  return {
    pages,
    page: page.id,
    clubs: [...options, ...extra].sort(byLabel),
    picked: mine.map((team) => team.id),
    draft: draftStart({
      clubIds: mine.map((team) => team.id),
      games: read.gamesForYear(page.year),
      from: window.from,
      to: window.to,
    }),
    org: found,
  };
};
