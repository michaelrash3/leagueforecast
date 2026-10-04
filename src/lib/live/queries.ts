import { agelessCsvParts } from "../agelessCsv";
import { AGELESS_BATCH, agelessSearch, agelessWaiting, type AgelessAside } from "../agelessQueue";
import { agelessClearPlan, agelessSitting, type AgelessGroup } from "../agelessSitting";
import { agelessClearable, CLEARABLE_RULES } from "../agelessTriage";
import type { AgeUnknownTeam } from "../ageUnknown";
import type { GcImportState } from "../gameChangerImport";
import { dueSummary, type DueSummary } from "../gameChangerSchedule";
import { orgAgesByTeam } from "../orgMembership";
import { poolHealth, settleableNow, type PoolHealth } from "../poolHealth";
import { poolHealthSummary, type PoolHealthSummary } from "../poolHealthSummary";
import { poolLists, TO_PULL_DRAWN, type PoolLists } from "../poolLists";
import { storedRota } from "../storedRota";
import { checkTheModel, type ModelCheckAnswer } from "../scoutBacktest";
import { whatIfCurve, type WhatIfCurve } from "../scoutWhatIf";
import { ageGroupYear, rankingPoolGroupIds, type SeasonSegment } from "../teamRankings/seasons";
import type { ScoutGame, ScoutTeam } from "../teamRankings/types";
import { cleanTeamName, teamNameKey } from "../teamRankings/names";
import { unpulledClubs, unpulledClubsCsv } from "../unpulledClubs";
import { planLeagueScoreFill, type LeagueFillPlan } from "../leagueScoreFill";
import { clubPickOption, pickableClubs, type ClubPickOption } from "../leagueLinkOptions";
import {
  leagueScoutBridge,
  scoutLinkCandidates,
  type LeagueFixture,
  type LeagueTeamLink,
} from "../teamRankings";
import type { Matchup } from "../types";
import type { LeagueBridgeAnswer } from "./leagueAnswers";
import {
  loadAgeGroups,
  loadAgeRightClubs,
  loadAgeUnknown,
  loadDroppedClubs,
  loadKeptApart,
  loadNamedAges,
  loadOrgMembership,
  loadRealClubs,
  loadRefreshLog,
  loadScoutGames,
  loadScoutGamesForSeason,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
  storedGamesByYear,
} from "../teamRankingsStorage";
import { loggedGamesOn } from "../teamRankings/gamesWindow";
import {
  checkNamedGames,
  coerceNamedGames,
  type NamedCheck,
  type NamedGame,
} from "../teamRankings/namedGames";
import { planClubAges, type AgeAsked } from "./agePlan";
import { deriveAllKnown, gamesOnPages, type SeasonReader } from "./allKnown";
import {
  everyOne,
  isClockTime,
  isSquadYear,
  MAX_COMMAND_STEPS,
  oneGame,
  oneTeam,
  sameValue,
} from "./commands";
import { cardGamesOf, panelGame } from "./views/clubs";
import { isCount, isRecord, isString } from "./queryAnswers";
import { findListed, type GameSeen } from "./views/gamesShape";
import type { YearArchivePreview, YearDeletePreview, YearSummary } from "../yearSummary";
import {
  planYearArchive,
  planYearDelete,
  yearArchivePreview,
  yearDeletePreview,
  yearList,
} from "./yearOps";

/** No seasons: what a question that reads League Standings is answered with when none are read. */
const NO_SEASONS: SeasonReader = () => ({ teams: [], matchups: [], logs: {} });

/**
 * Read-only questions a member's device asks of the pool the edit function keeps warm (1.5): what
 * a section has to say before it sends an edit, worked out on the copy rather than on a pool the
 * device no longer needs to hold. Each is answered from the process's store by the code the page
 * answers it with, so the device is told what its own copy would have said. Pure, as the commands
 * are, so it is tested without a server: `runQuery` (`editRun.ts`) brings the pool to the copy and
 * asks.
 */

/**
 * - `merge.preview`: folding `fromId` into `intoId`, as `teams.merge` does: whether both clubs are
 *   there to fold (the roster's, or one League Standings made, offered in `adopt` as the command
 *   takes it), and the counts `foldCounts` gives.
 * - `rename.preview`: renaming `teamId` to `name`, as the page does: the name as it would be kept,
 *   and the club already under it on the roster, which the rename folds the club into instead
 *   (`renameScoutTeam`), with the counts of that fold. A club League Standings made is not on the
 *   server's roster to be found by its name until it joins it.
 * - `health.summary`: what Pool health shows as it opens, on the device's day `today`
 *   (`poolHealthSummary`), and the answers already given that its lists leave out.
 * - `health.inspect`: what it shows once asked to look harder, as the tidy worker answers it
 *   (`poolHealth`, `settleableNow`, `poolLists`), against the copy's own tidy stamp; of the clubs
 *   worth pulling, only the ones the card draws, and how many there are.
 * - `health.toPull`: every club worth pulling, as the file the card downloads (`unpulledClubsCsv`).
 * - `ages.plan`: Pool health's suggested ages, approved together, as the commands that file them
 *   (`planClubAges`), with page ids from `base`, for the device to send as one edit.
 * - `ageless.queue`: the card of teams waiting on an age at a sitting, on the device's day
 *   (`agelessSitting`), with the ten the device holds pinned: the entries alone, which the device
 *   makes rows of as its own card does (`agelessRowFor`), since every line of a row is worked out
 *   from its entry.
 * - `ageless.search`: the teams on that list answering to `query`, whatever stands between each and
 *   the queue (`agelessSearch`), as entries.
 * - `ageless.file`: the card's file of every team still waiting (`agelessCsvParts`).
 * - `ageless.clearPlan`: what clearing the rows of the rules ticked takes off the list
 *   (`agelessClearPlan`), for the device to ask about and send as one edit.
 */
export type PoolQuery =
  | { kind: "merge.preview"; fromId: string; intoId: string; adopt: ScoutTeam[] }
  | { kind: "rename.preview"; teamId: string; name: string }
  | { kind: "health.summary"; today: string }
  | { kind: "health.inspect"; today: string }
  | { kind: "health.toPull" }
  | { kind: "ages.plan"; clubs: AgeAsked[]; at: string; base: string }
  | { kind: "ageless.queue"; today: string; pinned: string[] }
  | { kind: "ageless.search"; today: string; query: string }
  | { kind: "ageless.file"; today: string }
  | { kind: "ageless.clearPlan"; today: string; rules: string[] }
  /**
   * The id of a game a page's published list shows (`findListed`), which the list does not carry:
   * asked before the Games tab edits one, of the page's games in `year` (null: no year).
   */
  | { kind: "games.find"; year: number | null; page: string; at: number; game: GameSeen }
  /**
   * What the Games tab says of games typed in or pasted before they are added by name
   * (`game.import`): which names are worth a second look, and which games page `page` already has,
   * against the year's clubs and games as the page knows them, League Standings' among them
   * (`checkNamedGames`). Null where there is no such page.
   */
  | { kind: "games.check"; page: string; games: NamedGame[] }
  /**
   * What winning or losing one fixture would do to a club's place on a page's board of `segment`
   * (null: the year's), refitted with the result in it (`whatIfCurve`), as Scouting asks. The
   * fixture is `game` as the club's card holds it (`panelGame`), its id its place on the card,
   * since a card carries no game ids (`cardFixture`).
   */
  | {
      kind: "scouting.whatIf";
      page: string;
      segment: SeasonSegment | null;
      forTeamId: string;
      game: ScoutGame;
      today: string;
    }
  /**
   * Setup's model check for a page (`checkTheModel`): every run in one question, since the runs
   * are compared game by game and each run's errors, kept for that, came to 2.3 MB on 12U of 29
   * September, against 16 KB for the answer the card draws.
   */
  | { kind: "model.check"; page: string }
  /**
   * What the Import tab shows of the copy's refresh: what a refresh at `at` would be for and how
   * much is in it, as the nightly works it out (`storedRota`); when each level was last refreshed;
   * and what the Organizations files kept come to.
   */
  | { kind: "import.status"; at: string }
  /**
   * What archiving squad year `year` would keep and take, for the owner's confirmation, worked out
   * as the archive is (`planYearArchive`), with League Standings' games in the year.
   */
  | { kind: "year.archivePreview"; year: number }
  /** What deleting squad year `year` would take, for the owner's confirmation (`planYearDelete`). */
  | { kind: "year.deletePreview"; year: number }
  /** Every year with anything to archive or delete, as Setup's Archive card lists them. */
  | { kind: "year.list" }
  /**
   * What Team Rankings has for League Standings season `season` (`leagueScoutBridge`), worked out
   * from the season's teams and fixtures as the device holds them: the results its forecast reads,
   * which club each league team is, and the clubs each could be (`scoutLinkCandidates`). A member's
   * device holds no pool to work it out from (1.6e).
   */
  | { kind: "league.bridge"; season: string; teams: LeagueTeamLink[]; fixtures: LeagueFixture[] }
  /** Every club a team of season `season` could be picked as by hand (`pickableClubs`). */
  | { kind: "league.clubs"; season: string }
  /**
   * The scores the pool could fill in for season `season`'s games (`planLeagueScoreFill`), from the
   * season's teams, games and the runs recorded for each, as the device holds them, on `today`.
   */
  | {
      kind: "league.fill";
      season: string;
      teams: LeagueTeamLink[];
      matchups: Matchup[];
      runs: LeagueRuns[];
      today: string;
    };

/** The runs recorded for a league game, as its two boxes hold them, and whether it is final. */
export type LeagueRuns = { id: string; awayRuns: string; homeRuns: string; isFinal?: true };

/**
 * What folding one club into another touches: the stored games that name the club folded away,
 * and of those the games between the two, which a fold drops since a club cannot play itself
 * (`mergeScoutTeams`). A club's game against its own name is not between the two, the two being
 * two clubs in every question that asks.
 */
export type FoldCounts = { games: number; dropped: number };

export type MergePreview = FoldCounts & { found: boolean };

export type RenamePreview = FoldCounts & {
  /** The name as it would be kept (`cleanTeamName`), empty where none would be. */
  name: string;
  into: { id: string; name: string } | null;
};

/** The answers Pool health's lists leave out, by GameChanger id: each list's as stored. */
export type HealthAnswers = { ageRight: string[]; realClubs: string[]; keptApart: string[] };

export type HealthSummaryAnswer = { summary: PoolHealthSummary; answers: HealthAnswers };

/**
 * What Pool health shows once asked to look harder. The clubs worth pulling are cut to the
 * `TO_PULL_DRAWN` the card draws, with the count of them all: every one of them was 7.5 of the
 * 7.9 MB the answer came to on the copy of 29 September (51,298 clubs), sent on every look for a
 * card that draws five and a file few ask for (`health.toPull`).
 */
export type HealthInspectAnswer = {
  health: PoolHealth;
  settleable: number;
  lists: PoolLists;
  toPullCount: number;
};

/** The file of every club worth pulling, as the card downloads it. */
export type HealthToPullAnswer = { csv: string };

export type AgesPlan = ReturnType<typeof planClubAges>;

export type AgelessQueueAnswer = {
  listed: number;
  waiting: number;
  batch: AgeUnknownTeam[];
  groups: AgelessGroup[];
};

export type AgelessSearchAnswer = {
  total: number;
  hits: { entry: AgeUnknownTeam; aside?: AgelessAside }[];
};

export type AgelessClearPlanAnswer = ReturnType<typeof agelessClearPlan>;

/** The copy's refresh as the Import tab shows it (`import.status`). */
export type ImportStatus = {
  due: DueSummary;
  /** When each level was last refreshed, by level, lowest first: a day key. */
  refreshed: { level: number; day: string }[];
  /**
   * The organizations kept, the teams under them, how many of those an organization's name can
   * age, and how many of the teams waiting on an age are among those.
   */
  orgs: { orgs: number; teams: number; aged: number; waitingAged: number };
};

export type QueryAnswers = {
  "merge.preview": MergePreview;
  "rename.preview": RenamePreview;
  "health.summary": HealthSummaryAnswer;
  "health.inspect": HealthInspectAnswer;
  "health.toPull": HealthToPullAnswer;
  "ages.plan": AgesPlan;
  "ageless.queue": AgelessQueueAnswer;
  "ageless.search": AgelessSearchAnswer;
  "ageless.file": { csv: string };
  "ageless.clearPlan": AgelessClearPlanAnswer;
  "games.find": { gameId: string | null };
  "games.check": { checks: NamedCheck[] | null };
  "scouting.whatIf": { curve: WhatIfCurve | null };
  "model.check": { answer: ModelCheckAnswer | null };
  "import.status": ImportStatus;
  "year.archivePreview": { preview: YearArchivePreview };
  "year.deletePreview": { preview: YearDeletePreview };
  "year.list": { years: YearSummary[] };
  "league.bridge": LeagueBridgeAnswer;
  "league.clubs": { clubs: ClubPickOption[] };
  "league.fill": { plan: LeagueFillPlan };
};

export type QueryKind = PoolQuery["kind"];

/** An answer, with the kind of question it answers. */
export type QueryAnswer = { [K in QueryKind]: { kind: K } & QueryAnswers[K] }[QueryKind];

/** The question of kind `K`, and its answer. */
export type QueryOf<K extends QueryKind> = Extract<PoolQuery, { kind: K }>;
export type AnswerOf<K extends QueryKind> = { kind: K } & QueryAnswers[K];

export const foldCounts = (
  fromId: string,
  intoId: string,
  games: readonly ScoutGame[]
): FoldCounts => {
  let named = 0;
  let dropped = 0;
  for (const game of games) {
    const sideA = game.teamAId === fromId;
    if (!sideA && game.teamBId !== fromId) continue;
    named += 1;
    if ((sideA ? game.teamBId : game.teamAId) === intoId) dropped += 1;
  }
  return { games: named, dropped };
};

const NO_FOLD: FoldCounts = { games: 0, dropped: 0 };

/** The pool as the page holds it: every page, the roster, and every stored game. */
const storedState = (): GcImportState => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  games: loadScoutGames(),
});

/** The teams still waiting on a person, on `today`, from the process's store. */
const waitingOn = (today: string) =>
  agelessWaiting(loadAgeUnknown(), loadNamedAges(), loadDroppedClubs(), new Date(today)).map(
    (row) => row.entry
  );

/**
 * The game a club's card showed as `shown`, whose id is its place on the card, in the club's games
 * as the card lists them now (`cardGamesOf`): the game at that place while it still reads so on a
 * card (`panelGame`), or else the one game that does, the card having moved since it was
 * published; null when none does, or more than one and none at its place.
 */
export const cardFixture = (games: readonly ScoutGame[], shown: ScoutGame): ScoutGame | null => {
  const reads = (game: ScoutGame) => sameValue({ ...panelGame(game), id: shown.id }, shown);
  const at = /^\d+$/.test(shown.id) ? Number(shown.id) : -1;
  const there = games[at];
  if (there && reads(there)) return there;
  const like = games.filter(reads);
  return like.length === 1 && like[0] ? like[0] : null;
};

/** The questions answered with League Standings' games in the year, as the boards are built. */
const LEAGUE_ASKED: ReadonlySet<QueryKind> = new Set<QueryKind>([
  "scouting.whatIf",
  "model.check",
  "year.archivePreview",
  "games.check",
]);

/** Whether `query` is answered with the copy's League Standings seasons (`answerQuery`'s `seasons`). */
export const asksLeague = (query: PoolQuery): boolean => LEAGUE_ASKED.has(query.kind);

/**
 * Answers `query` from the process's store, as the page would have answered it from its own.
 * `seasons` reads the copy's League Standings seasons, which the boards are built with; a question
 * that refits a year (`asksLeague`) is answered with them, so it agrees with the board on screen.
 */
export const answerQuery = (query: PoolQuery, seasons?: SeasonReader): QueryAnswer => {
  switch (query.kind) {
    case "scouting.whatIf": {
      const ageGroups = loadAgeGroups();
      const page = ageGroups.find((group) => group.id === query.page);
      if (!page || !seasons) return { kind: "scouting.whatIf", curve: null };
      // The year as the page knows it, League Standings' games in it, and the page's rating pool.
      const known = deriveAllKnown({
        ageGroups,
        teams: loadScoutTeams(),
        yearGames: loadScoutGamesForYear(ageGroupYear(page)),
        readSeason: seasons,
      });
      const games = gamesOnPages(known.games, rankingPoolGroupIds(page.id, ageGroups));
      // Found among the club's games of the year, as its card lists them; fitted on the page's pool.
      const fixture = cardFixture(cardGamesOf(known.games, query.forTeamId), query.game);
      const curve = fixture
        ? whatIfCurve(
            fixture,
            query.forTeamId,
            page.id,
            known.teams,
            games,
            page.myTeamId,
            ageGroups,
            query.segment ?? undefined,
            query.today
          )
        : null;
      // Named as the device named it, its place on the card.
      return { kind: "scouting.whatIf", curve: curve && { ...curve, gameId: query.game.id } };
    }
    case "model.check": {
      const ageGroups = loadAgeGroups();
      const page = ageGroups.find((group) => group.id === query.page);
      if (!page || !seasons) return { kind: "model.check", answer: null };
      // The year as the page knows it, League Standings' games in it, as the page checks it.
      const known = deriveAllKnown({
        ageGroups,
        teams: loadScoutTeams(),
        yearGames: loadScoutGamesForYear(ageGroupYear(page)),
        readSeason: seasons,
      });
      return {
        kind: "model.check",
        answer: checkTheModel(page.id, known.teams, known.games, ageGroups),
      };
    }
    case "year.archivePreview":
      // The time the tables would be stamped with says nothing of what they hold.
      return {
        kind: "year.archivePreview",
        preview: yearArchivePreview(planYearArchive(query.year, seasons ?? NO_SEASONS, "")),
      };
    case "year.deletePreview":
      return { kind: "year.deletePreview", preview: yearDeletePreview(planYearDelete(query.year)) };
    case "year.list":
      return { kind: "year.list", years: yearList() };
    case "import.status": {
      const membership = loadOrgMembership();
      const orgAges = orgAgesByTeam(membership);
      return {
        kind: "import.status",
        due: dueSummary(storedRota(new Date(query.at))),
        refreshed: Object.entries(loadRefreshLog())
          .flatMap(([level, day]) => (/^\d+$/.test(level) ? [{ level: Number(level), day }] : []))
          .sort((a, b) => a.level - b.level),
        orgs: {
          orgs: membership.orgs.length,
          teams: new Set(membership.orgs.flatMap((org) => org.teamIds)).size,
          aged: orgAges.size,
          waitingAged: loadAgeUnknown().filter((entry) => orgAges.has(entry.teamId)).length,
        },
      };
    }
    case "ageless.queue": {
      const sitting = agelessSitting(
        loadAgeUnknown(),
        loadNamedAges(),
        loadDroppedClubs(),
        new Date(query.today),
        query.pinned
      );
      return {
        kind: "ageless.queue",
        listed: sitting.listed,
        waiting: sitting.waiting,
        batch: sitting.batch.map((row) => row.entry),
        groups: sitting.groups,
      };
    }
    case "ageless.search": {
      const found = agelessSearch(
        loadAgeUnknown(),
        loadNamedAges(),
        loadDroppedClubs(),
        new Date(query.today),
        query.query
      );
      return {
        kind: "ageless.search",
        total: found.total,
        hits: found.hits.map(({ row, aside }) => ({
          entry: row.entry,
          ...(aside ? { aside } : {}),
        })),
      };
    }
    case "ageless.file":
      return { kind: "ageless.file", csv: agelessCsvParts(waitingOn(query.today)).join("") };
    case "ageless.clearPlan":
      return {
        kind: "ageless.clearPlan",
        ...agelessClearPlan(agelessClearable(waitingOn(query.today)), new Set(query.rules)),
      };
    case "health.summary":
      return {
        kind: "health.summary",
        summary: poolHealthSummary(storedState(), query.today, storedGamesByYear()),
        answers: {
          ageRight: [...loadAgeRightClubs()],
          realClubs: [...loadRealClubs()],
          keptApart: [...loadKeptApart()],
        },
      };
    case "health.inspect": {
      const state = storedState();
      const health = poolHealth(state, loadTidyStamp() ?? "", query.today);
      const lists = poolLists(state, loadKeptApart(), query.today);
      return {
        kind: "health.inspect",
        health,
        // Only worth asking when something could be settled, as the tidy worker asks it.
        settleable: health.standInPlayed === 0 ? 0 : settleableNow(state),
        lists: { ...lists, toPull: lists.toPull.slice(0, TO_PULL_DRAWN) },
        toPullCount: lists.toPull.length,
      };
    }
    case "health.toPull":
      return { kind: "health.toPull", csv: unpulledClubsCsv(unpulledClubs(storedState())) };
    case "games.find": {
      const listed = loggedGamesOn(loadScoutGamesForYear(query.year ?? undefined), query.page);
      return { kind: "games.find", gameId: findListed(listed, query.at, query.game) };
    }
    case "league.bridge": {
      const ageGroups = loadAgeGroups();
      const teams = loadScoutTeams();
      const games = loadScoutGamesForSeason(query.season);
      return {
        kind: "league.bridge",
        bridge: leagueScoutBridge(
          query.season,
          ageGroups,
          teams,
          games,
          query.teams,
          query.fixtures
        ),
        candidates: query.teams.map((team) => ({
          name: team.name,
          clubs: scoutLinkCandidates(
            team.name,
            query.season,
            ageGroups,
            teams,
            games,
            query.fixtures
          ),
        })),
      };
    }
    case "league.clubs":
      return {
        kind: "league.clubs",
        clubs: pickableClubs(query.season, loadAgeGroups(), loadScoutTeams()).map(clubPickOption),
      };
    case "league.fill":
      return {
        kind: "league.fill",
        plan: planLeagueScoreFill({
          seasonId: query.season,
          teams: query.teams,
          matchups: query.matchups,
          logs: Object.fromEntries(query.runs.map(({ id, ...recorded }) => [id, recorded])),
          ageGroups: loadAgeGroups(),
          scoutTeams: loadScoutTeams(),
          scoutGames: loadScoutGamesForSeason(query.season),
          today: query.today,
        }),
      };
    case "games.check": {
      const ageGroups = loadAgeGroups();
      const page = ageGroups.find((group) => group.id === query.page);
      if (!page || !seasons) return { kind: "games.check", checks: null };
      // The year as the page knows it, and every game on the page, League Standings' included.
      const known = deriveAllKnown({
        ageGroups,
        teams: loadScoutTeams(),
        yearGames: loadScoutGamesForYear(ageGroupYear(page)),
        readSeason: seasons,
      });
      const onPage = known.games.filter((game) => game.ageGroupId === page.id);
      return {
        kind: "games.check",
        checks: checkNamedGames(query.games, known.teams, onPage, page.id),
      };
    }
    case "ages.plan":
      return {
        kind: "ages.plan",
        ...planClubAges(
          { teams: loadScoutTeams(), games: loadScoutGames(), ageGroups: loadAgeGroups() },
          query.clubs,
          query.at,
          query.base
        ),
      };
    case "merge.preview": {
      const held = new Set(loadScoutTeams().map((team) => team.id));
      query.adopt.forEach((team) => held.add(team.id));
      const found =
        query.fromId !== query.intoId && held.has(query.fromId) && held.has(query.intoId);
      return {
        kind: "merge.preview",
        found,
        ...(found ? foldCounts(query.fromId, query.intoId, loadScoutGames()) : NO_FOLD),
      };
    }
    case "rename.preview": {
      const name = cleanTeamName(query.name).trim();
      const key = teamNameKey(name);
      const into = name
        ? loadScoutTeams().find(
            (team) => team.id !== query.teamId && teamNameKey(team.name) === key
          )
        : undefined;
      return {
        kind: "rename.preview",
        name,
        into: into ? { id: into.id, name: into.name } : null,
        ...(into ? foldCounts(query.teamId, into.id, loadScoutGames()) : NO_FOLD),
      };
    }
  }
};

/**
 * A day as the device's clock gives one, `YYYY-MM-DD`, and one the calendar has: the parser rolls
 * 30 February over into March rather than refusing it, so the day is read back to be sure.
 */
const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(value);
  return !Number.isNaN(at) && new Date(at).toISOString().slice(0, 10) === value;
};

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every(isString) ? [...(value as string[])] : null;

/** An instant as a device's clock writes one, in a year the app could be used in. */
const isTime = isClockTime;

/** The longest text a question carries: a name, or what is typed in a search box. */
const MAX_TEXT = 200;
const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_TEXT;

/** A club to file at an age, as `ages.plan` takes one: a level the app ranks at, in a squad year. */
const ageAsked = (raw: unknown): AgeAsked | null =>
  isRecord(raw) &&
  isString(raw.teamId) &&
  Number.isInteger(raw.level) &&
  Number.isInteger(raw.year) &&
  Object.keys(raw).length === 3
    ? { teamId: raw.teamId, level: raw.level as number, year: raw.year as number }
    : null;

const isScore = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A game as a page's list shows it (`GameSeen`), every field one the list could have shown. */
const gameSeen = (raw: unknown): GameSeen | null => {
  if (!isRecord(raw) || !isString(raw.teamAId) || !isString(raw.teamBId)) return null;
  const { teamAScore, teamBScore, date, event, excluded } = raw;
  if (teamAScore !== undefined && !isScore(teamAScore)) return null;
  if (teamBScore !== undefined && !isScore(teamBScore)) return null;
  if ((date !== undefined && !isString(date)) || (event !== undefined && !isString(event)))
    return null;
  if (excluded !== undefined && excluded !== true) return null;
  const seen: GameSeen = {
    teamAId: raw.teamAId,
    teamBId: raw.teamBId,
    ...(teamAScore === undefined ? {} : { teamAScore }),
    ...(teamBScore === undefined ? {} : { teamBScore }),
    ...(date === undefined ? {} : { date }),
    ...(event === undefined ? {} : { event }),
    ...(excluded === undefined ? {} : { excluded }),
  };
  return keptWhole(raw, seen) ? seen : null;
};

/** Whether every key `raw` carries is one `read` kept: what a reader drops was never meant. */
const keptWhole = (raw: Record<string, unknown>, read: object): boolean =>
  Object.keys(raw).every((key) => Object.prototype.hasOwnProperty.call(read, key));

/**
 * The most teams and games of one League Standings season a question carries: past any league's,
 * as `MAX_COMMAND_STEPS` is past any edit's, so a question cannot hold the one edit worker long.
 */
export const LEAGUE_TEAMS_MAX = 200;
export const LEAGUE_GAMES_MAX = 3000;

/** A run total as a fixture carries one: any number of runs, none or more. */
const isRuns = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** A league team as the bridge reads it: its id, its name, and the club a person picked, if any. */
const leagueTeamLink = (raw: unknown): LeagueTeamLink | null => {
  if (!isRecord(raw) || !isString(raw.id) || !isText(raw.name)) return null;
  const { scoutTeamId } = raw;
  if (scoutTeamId !== undefined && !isString(scoutTeamId)) return null;
  const link: LeagueTeamLink = {
    id: raw.id,
    name: raw.name,
    ...(scoutTeamId === undefined ? {} : { scoutTeamId }),
  };
  return keptWhole(raw, link) ? link : null;
};

/** A fixture as the bridge reads it: the two teams' names, the league's day, and runs once final. */
const leagueFixture = (raw: unknown): LeagueFixture | null => {
  if (!isRecord(raw) || !isText(raw.away) || !isText(raw.home) || !isText(raw.date)) return null;
  const { awayRuns, homeRuns } = raw;
  if (
    (awayRuns !== undefined && !isRuns(awayRuns)) ||
    (homeRuns !== undefined && !isRuns(homeRuns))
  )
    return null;
  const fixture: LeagueFixture = {
    away: raw.away,
    home: raw.home,
    date: raw.date,
    ...(awayRuns === undefined ? {} : { awayRuns }),
    ...(homeRuns === undefined ? {} : { homeRuns }),
  };
  return keptWhole(raw, fixture) ? fixture : null;
};

/** A league game as the fill reads it: its id, its day, and its two teams' ids. */
const leagueMatchup = (raw: unknown): Matchup | null => {
  if (!isRecord(raw) || !isString(raw.id) || !isText(raw.date)) return null;
  if (!isString(raw.away) || !isString(raw.home)) return null;
  const matchup: Matchup = { id: raw.id, date: raw.date, away: raw.away, home: raw.home };
  return keptWhole(raw, matchup) ? matchup : null;
};

/** What the two run boxes of a league game hold: a score as typed, no longer than one could be. */
const isRunsText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 8;

const leagueRuns = (raw: unknown): LeagueRuns | null => {
  if (!isRecord(raw) || !isString(raw.id)) return null;
  if (!isRunsText(raw.awayRuns) || !isRunsText(raw.homeRuns)) return null;
  // An `isFinal` that is not `true` is not kept, so the whole is refused.
  const runs: LeagueRuns = {
    id: raw.id,
    awayRuns: raw.awayRuns,
    homeRuns: raw.homeRuns,
    ...(raw.isFinal === true ? { isFinal: true } : {}),
  };
  return keptWhole(raw, runs) ? runs : null;
};

/**
 * A question read back exactly, as a command is (`coerceCommand`): one with a field this build does
 * not read, or one it would have to change to read, is refused rather than half answered.
 */
export const coerceQuery = (raw: unknown): PoolQuery | null => {
  if (!isRecord(raw)) return null;
  let query: PoolQuery | null = null;
  switch (raw.kind) {
    case "merge.preview": {
      const adopt = everyOne(raw.adopt, oneTeam);
      // Either club as League Standings made it, and no more.
      if (isString(raw.fromId) && isString(raw.intoId) && adopt && adopt.length <= 2)
        query = { kind: "merge.preview", fromId: raw.fromId, intoId: raw.intoId, adopt };
      break;
    }
    case "rename.preview":
      if (isString(raw.teamId) && isText(raw.name))
        query = { kind: "rename.preview", teamId: raw.teamId, name: raw.name };
      break;
    case "health.summary":
    case "health.inspect":
      if (isDay(raw.today)) query = { kind: raw.kind, today: raw.today };
      break;
    case "health.toPull":
      query = { kind: "health.toPull" };
      break;
    case "ageless.queue": {
      // The ten in front of the person: more would have the answer hold the whole list.
      const pinned = strings(raw.pinned);
      if (isDay(raw.today) && pinned && pinned.length <= AGELESS_BATCH)
        query = { kind: "ageless.queue", today: raw.today, pinned };
      break;
    }
    case "ageless.search":
      if (isDay(raw.today) && isText(raw.query))
        query = { kind: "ageless.search", today: raw.today, query: raw.query };
      break;
    case "ageless.file":
      if (isDay(raw.today)) query = { kind: "ageless.file", today: raw.today };
      break;
    case "ageless.clearPlan": {
      const rules = strings(raw.rules);
      if (isDay(raw.today) && rules && rules.length <= CLEARABLE_RULES.length)
        query = { kind: "ageless.clearPlan", today: raw.today, rules };
      break;
    }
    case "games.find": {
      const game = gameSeen(raw.game);
      const year = raw.year;
      if (
        game &&
        (year === null || Number.isInteger(year)) &&
        isString(raw.page) &&
        isCount(raw.at)
      )
        query = {
          kind: "games.find",
          year: year as number | null,
          page: raw.page,
          at: raw.at,
          game,
        };
      break;
    }
    case "games.check": {
      const games = coerceNamedGames(raw.games);
      if (isString(raw.page) && games) query = { kind: "games.check", page: raw.page, games };
      break;
    }
    case "scouting.whatIf": {
      const segment = raw.segment;
      const game = oneGame(raw.game);
      if (
        isString(raw.page) &&
        (segment === null || segment === "fall" || segment === "spring") &&
        isString(raw.forTeamId) &&
        game &&
        isDay(raw.today)
      )
        query = {
          kind: "scouting.whatIf",
          page: raw.page,
          segment,
          forTeamId: raw.forTeamId,
          game,
          today: raw.today,
        };
      break;
    }
    case "model.check":
      if (isString(raw.page)) query = { kind: "model.check", page: raw.page };
      break;
    case "import.status":
      if (isTime(raw.at)) query = { kind: "import.status", at: raw.at };
      break;
    case "year.archivePreview":
    case "year.deletePreview":
      if (isSquadYear(raw.year)) query = { kind: raw.kind, year: raw.year };
      break;
    case "year.list":
      query = { kind: "year.list" };
      break;
    case "league.bridge": {
      const teams = everyOne(raw.teams, leagueTeamLink);
      const fixtures = everyOne(raw.fixtures, leagueFixture);
      if (
        isString(raw.season) &&
        teams &&
        teams.length <= LEAGUE_TEAMS_MAX &&
        fixtures &&
        fixtures.length <= LEAGUE_GAMES_MAX
      )
        query = { kind: "league.bridge", season: raw.season, teams, fixtures };
      break;
    }
    case "league.clubs":
      if (isString(raw.season)) query = { kind: "league.clubs", season: raw.season };
      break;
    case "league.fill": {
      const teams = everyOne(raw.teams, leagueTeamLink);
      const matchups = everyOne(raw.matchups, leagueMatchup);
      const runs = everyOne(raw.runs, leagueRuns);
      if (
        isString(raw.season) &&
        teams &&
        teams.length <= LEAGUE_TEAMS_MAX &&
        matchups &&
        matchups.length <= LEAGUE_GAMES_MAX &&
        runs &&
        runs.length <= LEAGUE_GAMES_MAX &&
        isDay(raw.today)
      )
        query = {
          kind: "league.fill",
          season: raw.season,
          teams,
          matchups,
          runs,
          today: raw.today,
        };
      break;
    }
    case "ages.plan": {
      // As many as one edit may file (`MAX_COMMAND_STEPS`, a step a club): each is planned against
      // every game in the pool, so an unbounded list held the one edit worker past its time.
      const clubs = everyOne(raw.clubs, ageAsked);
      if (clubs && clubs.length <= MAX_COMMAND_STEPS && isTime(raw.at) && isString(raw.base))
        query = { kind: "ages.plan", clubs, at: raw.at, base: raw.base };
      break;
    }
  }
  return query && keptWhole(raw, query) ? query : null;
};
