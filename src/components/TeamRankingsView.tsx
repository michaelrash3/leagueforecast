import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ageGroupChain,
  ageGroupLevel,
  ageGroupYear,
  buildScoutingReport,
  EMPTY_SCOUTING_REPORT,
  buildUpcomingSchedule,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  findDuplicateGame,
  isRankedAgeLevel,
  isScoutGamePlayed,
  mergeScoutTeams,
  MIN_RANKED_AGE_LEVEL,
  rankingPoolGroupIds,
  resolveOrCreateTeam,
  seasonAtAge,
  seasonYearOptions,
  filterRankingsByState,
  normalizeState,
  renameScoutTeam,
  statesInUse,
  teamNameSuggestions,
  unlinkGcTeam,
  type AgeGroup,
  type AgeGroupSeason,
  type LeagueSeasonSnapshot,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { buildTeamRankExplanationRequest } from "../lib/teamRankingsSummaryClient";
import {
  describeTidy,
  poolSignature,
  type GcImportState,
  type PoolTidy,
} from "../lib/gameChangerImport";
import { remainingIds } from "../lib/gameChangerPull";
import {
  loadLogsForSeason,
  loadMatchupsForSeason,
  loadTeamsForSeason,
  type SeasonMeta,
} from "../lib/storage";
import {
  clearPullProgress,
  clearTeamRankings,
  loadAgeGroups,
  loadArchiveIndex,
  loadPullProgress,
  loadRefreshLog,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  onPoolChangedElsewhere,
  saveAgeGroups,
  savePullProgress,
  saveArchivedSeasons,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../lib/teamRankingsStorage";
import {
  estimateBackupBytes,
  formatBytes,
  LARGE_BACKUP_BYTES,
  readTeamRankingsBackup,
  summarizeTeamRankingsBackup,
  teamRankingsJsonParts,
} from "../lib/teamRankingsBackup";
import { type RankingsSection } from "../lib/rankingsRoute";
import { archivableYears, archiveSquadYear, type ArchiveEntry } from "../lib/teamRankingsArchive";
import { ArchiveSection } from "./teamRankings/ArchiveSection";
import { isPoolBusy } from "../lib/pullSession";
import { usePoolTidy } from "../hooks/usePoolTidy";
import { ErrorBoundary } from "./ErrorBoundary";
import { GameChangerImportPanel } from "./GameChangerImportPanel";
import { TeamDetailPanel } from "./TeamDetailPanel";
import { GamesSection, EMPTY_ADD_GAME_DRAFT, type AddGameDraft } from "./teamRankings/GamesSection";
import {
  NATIONAL_TOP,
  RankingsSection as RankingsBoards,
  STATE_TOP,
} from "./teamRankings/RankingsSection";
import { ScoutingSection } from "./teamRankings/ScoutingSection";
import { RankingsHeader } from "./teamRankings/RankingsHeader";
import { SECTION_PANEL_ID, sectionTabId } from "./teamRankings/SectionNav";
import { SetupSection } from "./teamRankings/SetupSection";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import { useClubSearch } from "../hooks/useClubSearch";
import { useRankingsPages } from "../hooks/useRankingsPages";
import { useRankingsWorker } from "../hooks/useRankingsWorker";
import type { ToastTone } from "../hooks/useToast";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type TeamRankingsViewProps = {
  seasons: SeasonMeta[];
  showToast: (
    message: string,
    options?: {
      tone?: ToastTone;
      actionLabel?: string;
      onAction?: () => void;
      durationMs?: number;
    }
  ) => void;
  requestConfirmation: (options: ConfirmOptions) => Promise<boolean>;
  /** Called after anything here is saved, so the league side knows to re-read it. */
  onDataChange?: () => void;
};

/**
 * Team Rankings, one area at a time.
 *
 * Everything used to render on a single scroll — the tables, the add-a-game form, the GameChanger
 * pull, the scouting report and the age-group editor — which made the page long enough that the
 * thing you came for was rarely the thing on screen. Each area now lives in its own file under
 * `teamRankings/` and is reached through `?section=`, while this file keeps the state they all
 * read from and the handlers that write it.
 *
 * The season-year picker and the age tabs stay above every section, because they scope all of them
 * alike: a section is a view of one age group in one year, never of the pool at large.
 */
/** What a section is called when a boundary has to say which one could not be drawn. */
const sectionLabel = (section: RankingsSection): string =>
  ({
    rankings: "The rankings",
    games: "The games list",
    import: "The GameChanger import",
    scouting: "The scouting report",
    archive: "The archive",
    setup: "Setup",
  })[section];

export function TeamRankingsView({
  seasons,
  showToast,
  requestConfirmation,
  onDataChange,
}: TeamRankingsViewProps) {
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(() => loadAgeGroups());
  const {
    section,
    selectedAgeGroupId,
    selectedYear,
    groupsInYear,
    yearChoices,
    openPage,
    openSection,
    openYear,
    pickPage,
  } = useRankingsPages(ageGroups);
  const [scoutTeams, setScoutTeams] = useState<ScoutTeam[]>(() => loadScoutTeams());
  const [scoutGames, setScoutGames] = useState<ScoutGame[]>(() => loadScoutGames());
  const [reportTeamId, setReportTeamId] = useState<string>("");

  const [gameDraft, setGameDraft] = useState<AddGameDraft>(EMPTY_ADD_GAME_DRAFT);

  const [importOpen, setImportOpen] = useState(false);
  const [pullProgress, setPullProgress] = useState(() => loadPullProgress());
  const [refreshLog, setRefreshLog] = useState(() => loadRefreshLog());
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  /** Which state the top ten shows; `null` means the one picked for you. */
  const [stateTop, setStateTop] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [editingGameId, setEditingGameId] = useState<string | null>(null);
  const [editScoreA, setEditScoreA] = useState("");
  const [editScoreB, setEditScoreB] = useState("");

  const lastDeletedGameRef = useRef<ScoutGame | null>(null);
  const lastDeletedTeamRef = useRef<{ team: ScoutTeam; games: ScoutGame[] } | null>(null);

  // Stable, so the effects that save through them do not re-run on every render.
  const persistTeams = useCallback(
    (teams: ScoutTeam[]) => {
      setScoutTeams(teams);
      if (!saveScoutTeams(teams))
        showToast("Could not save teams (storage full).", { tone: "error" });
      onDataChange?.();
    },
    [showToast, onDataChange]
  );
  const persistGames = useCallback(
    (games: ScoutGame[]) => {
      setScoutGames(games);
      if (!saveScoutGames(games))
        showToast("Could not save games (storage full).", { tone: "error" });
      onDataChange?.();
    },
    [showToast, onDataChange]
  );
  const persistAgeGroups = useCallback(
    (groups: AgeGroup[]) => {
      setAgeGroups(groups);
      if (!saveAgeGroups(groups))
        showToast("Could not save age groups (storage full).", { tone: "error" });
      onDataChange?.();
    },
    [showToast, onDataChange]
  );

  /**
   * Another tab changed the pool, so what is held here is old.
   *
   * The pool is read once, at mount, into the state above. That is what makes a synchronous read
   * of an asynchronous store possible, and it is also what made two tabs unsafe: open Team
   * Rankings twice, start a pull in one and correct a score in the other, and the second tab saved
   * the pool it read at startup over everything the pull had done, without erroring.
   *
   * Re-reading here closes it. The store has already taken the new value in by the time this runs,
   * so every load below answers with what the other tab wrote, and the next save from this tab
   * builds on that rather than on a pool from an hour ago.
   */
  useEffect(
    () =>
      onPoolChangedElsewhere(() => {
        setAgeGroups(loadAgeGroups());
        setScoutTeams(loadScoutTeams());
        setScoutGames(loadScoutGames());
        setPullProgress(loadPullProgress());
        setRefreshLog(loadRefreshLog());
      }),
    []
  );

  /**
   * Tidies a pool the tidy has not seen. It runs at the end of every pull; opening the app on a
   * pool whose shape differs from the one it last tidied — a restored backup, a pull closed
   * mid-tidy, a pool from before the tidy existed — runs it again, unasked, once the page has
   * painted. Nothing to press: games outside their squad year are deleted, doubles collapsed,
   * stand-ins settled, exactly as at the end of a pull.
   */
  const { tidy: tidyInWorker } = usePoolTidy();
  const tidyingRef = useRef(false);
  useEffect(() => {
    if (scoutGames.length === 0 || tidyingRef.current) return;
    /*
     * A pull still running tidies when it finishes, and a tidy already going is the same work; both
     * write the whole pool, so the one that finished first would be overwritten by the other.
     */
    if (isPoolBusy()) return;
    if (pullProgress && remainingIds(pullProgress).length > 0) return;
    const pool: GcImportState = { ageGroups, teams: scoutTeams, games: scoutGames };
    if (poolSignature(pool) === loadTidyStamp()) return;
    tidyingRef.current = true;
    /*
     * No size limit on this any more. There used to be one — above 20,000 games it was left to a
     * button in Setup — because five passes over two hundred thousand games is twenty-odd seconds
     * on the main thread: the tab freezes, gets reloaded, the cleanup cancels the run, the stamp is
     * never written, and it starts over next time and never finishes. A real pool was found with
     * eleven thousand results still filed against "TBD" for exactly that reason. In the worker
     * there is nothing to freeze, so the pool that most needs tidying is no longer the one that
     * never gets it.
     */
    let live = true;
    void tidyInWorker(pool).then((outcome) => {
      // Something else claimed the pool first, or the view moved on to a different one while this
      // was working. Either way the stamp is untouched, so it comes round again.
      if (!outcome || !live) return;
      const tidy: PoolTidy = { ...outcome.tidy, state: outcome.state };
      saveTidyStamp(poolSignature(tidy.state));
      if (tidy.state.ageGroups !== pool.ageGroups) persistAgeGroups(tidy.state.ageGroups);
      if (tidy.state.teams !== pool.teams) persistTeams(tidy.state.teams);
      if (tidy.state.games !== pool.games) persistGames(tidy.state.games);
      const lines = describeTidy(tidy);
      if (lines.length > 0) showToast(lines.join(" "));
    });
    return () => {
      live = false;
      tidyingRef.current = false;
    };
  }, [
    ageGroups,
    scoutTeams,
    scoutGames,
    pullProgress,
    persistAgeGroups,
    persistTeams,
    persistGames,
    showToast,
    tidyInWorker,
  ]);

  // ---------- Age group management ----------

  const yearOptions = useMemo(() => seasonYearOptions(ageGroups), [ageGroups]);

  /*
   * What has been archived, and whether an archive is running.
   *
   * Only the index — names, dates and counts — is held here. A season's rows are a hundred
   * thousand of them and are read when somebody opens one, which is the whole point of keeping
   * them in a key of their own.
   */
  const [archives, setArchives] = useState<ArchiveEntry[]>(() => loadArchiveIndex());
  const [archiving, setArchiving] = useState(false);

  /**
   * Answers "what age does this league season play?" — the only age-group question left to ask.
   *
   * The pages themselves arrive with the GameChanger pull, so asking somebody to type one in first
   * is asking them to repeat what the import is about to say. What no import can know is which
   * page your own league belongs on: nothing in a GameChanger schedule mentions your league at all.
   */
  const assignSeasonToAge = (seasonId: string, season: AgeGroupSeason | null) => {
    const result = seasonAtAge(seasonId, season, ageGroups);
    persistAgeGroups(result.ageGroups);
    if (!result.group) {
      showToast("League season taken off Team Rankings.");
      return;
    }
    pickPage(result.group.id);
    showToast(
      result.created
        ? `${result.group.name} created, with your league season on it.`
        : `League season added to ${result.group.name}.`,
      { tone: "success" }
    );
  };

  // ---------- Ranking data for the selected age group ----------

  // The selected age group, plus the ones it carries on from (last year's squad, and so on). Only
  // the selected group is ever ranked; the rest are here so a squad's opponents keep showing up in
  // the name dropdown as it ages up.
  const chainGroupIds = useMemo(
    () => ageGroupChain(selectedAgeGroupId, ageGroups),
    [selectedAgeGroupId, ageGroups]
  );

  /**
   * Every team and game the app knows about: the persisted scout roster extended (in memory, not
   * yet necessarily saved) with every league team name not already in it, and every game from
   * every age group, League Standings ones derived alongside. League seasons are read fresh every
   * render — this view never writes back to League Standings data, only reads it.
   *
   * Derived once, over every age group, because a scout id minted for a league team is only unique
   * against the roster it was minted alongside: `mintScoutTeamId` breaks a name collision by
   * counting, so "Lexington Legends" is `S-LEXI` when the 9U season is walked first and `S-LEXI2`
   * when a 10U "Lexington Lions" got there ahead of it. Two passes over different sets of age
   * groups therefore hand the same club two different ids, and anything that looked a row up in
   * the other pass's roster would miss, or worse, hit the wrong club. One pass, one set of ids,
   * and every narrower view below is a filter of it rather than a second derivation.
   *
   * Teams already in the stored roster are matched by name and keep the ids they were saved with,
   * so widening this pass does not renumber anything already on disk.
   */
  const allKnown = useMemo(() => {
    let teams = scoutTeams;
    const derivedGames: ScoutGame[] = [];
    ageGroups.forEach((group) => {
      const seasons: LeagueSeasonSnapshot[] = group.seasonIds.map((seasonId) => ({
        seasonId,
        teams: loadTeamsForSeason(seasonId),
        matchups: loadMatchupsForSeason(seasonId),
        logs: loadLogsForSeason(seasonId),
      }));
      const derived = deriveLeagueScoutGames(group.id, seasons, teams);
      teams = derived.teams;
      derivedGames.push(...derived.games);
    });
    // `derivedGames` stays whole — `leagueGameTeamIds` reads it to decide which teams arrived from
    // the league — while the pool every rating, record and page is built from gets one row per
    // real fixture, so a pulled copy of a league game does not count the game twice.
    return {
      teams,
      derivedGames,
      games: dedupeLeagueFixtures([...derivedGames, ...scoutGames]),
    };
  }, [ageGroups, scoutGames, scoutTeams]);

  const allKnownGames = allKnown.games;

  // Everything on the chain — used only for name suggestions, never for ratings.
  const chainGames = useMemo(() => {
    const onChain = new Set(chainGroupIds);
    return allKnown.games.filter((game) => onChain.has(game.ageGroupId));
  }, [allKnown.games, chainGroupIds]);

  const ageGroupGames = useMemo(
    () => chainGames.filter((game) => game.ageGroupId === selectedAgeGroupId),
    [chainGames, selectedAgeGroupId]
  );

  // Teams whose game here came from a League Standings season rather than being logged by hand.
  // Derived games only, so a manually added game never reads as a league one.
  const leagueGameTeamIds = useMemo(
    () =>
      new Set(
        allKnown.derivedGames
          .filter((game) => game.ageGroupId === selectedAgeGroupId)
          .flatMap((game) => [game.teamAId, game.teamBId])
      ),
    [allKnown.derivedGames, selectedAgeGroupId]
  );

  /**
   * The games the rating pool is fitted over: every counted game in any age group sharing this
   * group's season year. `buildTeamRankings` filters to the pool itself, but it can only rate what
   * it is handed, so the wider list is passed rather than the page-scoped one.
   */
  const poolGames = useMemo(() => {
    const pool = new Set(rankingPoolGroupIds(selectedAgeGroupId, ageGroups));
    return allKnown.games.filter((game) => pool.has(game.ageGroupId));
  }, [allKnown.games, selectedAgeGroupId, ageGroups]);

  const myTeamId = ageGroups.find((g) => g.id === selectedAgeGroupId)?.myTeamId;

  /**
   * Passing `ageGroups` is what rates the whole season year as one pool: every age group sharing
   * this group's year is fitted together, each game carrying the age gap between the two sides, and
   * the rows that come back are the teams whose home level is this page's. A group below
   * `MIN_RANKED_AGE_LEVEL` has no table and comes back empty — its games still count as evidence
   * about the older teams that played down against it.
   */
  const { rows: rankings, stale: rankingsStale } = useRankingsWorker({
    ageGroupId: selectedAgeGroupId,
    teams: allKnown.teams,
    games: poolGames,
    ...(myTeamId === undefined ? {} : { myTeamId }),
    ageGroups,
  });

  /**
   * The teams behind the rows on this page. Taken from the rows rather than from the games filed
   * here, because the pool can list a team whose games were all filed elsewhere — a 10U that spent
   * the year playing down is at home on the 10U page with nothing filed on it — and the state
   * filter has to know about that team or it would drop off the page when a state is chosen.
   */
  const rankedTeams = useMemo(() => {
    const byId = new Map(allKnown.teams.map((team) => [team.id, team]));
    return rankings
      .map((row) => byId.get(row.teamId))
      .filter((team): team is ScoutTeam => team !== undefined);
  }, [rankings, allKnown.teams]);

  const availableStates = useMemo(() => statesInUse(rankedTeams), [rankedTeams]);

  /**
   * The two rankings a page leads with. A nationwide pool is thousands of teams and a table of all
   * of them answers no question anybody has; the ones worth a headline are the best in the country
   * at this age, and the best in one state. The full list is still below, for finding a team.
   */
  const nationalTop = useMemo(() => rankings.slice(0, NATIONAL_TOP), [rankings]);

  /**
   * Which state the top ten is for. Yours if we know it, otherwise whichever state has the most
   * teams on this page — the one most likely to be the reason you are here.
   */
  const defaultState = useMemo(() => {
    const mine = rankedTeams.find((team) => team.id === myTeamId)?.state;
    if (mine) return mine;
    const counts = new Map<string, number>();
    rankedTeams.forEach((team) => {
      if (team.state) counts.set(team.state, (counts.get(team.state) ?? 0) + 1);
    });
    let best = "";
    let most = 0;
    counts.forEach((count, state) => {
      if (count > most) {
        most = count;
        best = state;
      }
    });
    return best;
  }, [rankedTeams, myTeamId]);

  const shownState = stateTop === null ? defaultState : stateTop;

  /**
   * "Prosper, TX" — where a club is from, which is what tells five Rangers apart in a list. The
   * town comes from GameChanger for a pulled club; a stand-in has neither and shows nothing.
   */
  const placeOf = useCallback(
    (teamId: string) => {
      const team = rankedTeams.find((candidate) => candidate.id === teamId);
      if (!team) return undefined;
      return [team.city, team.state].filter(Boolean).join(", ") || undefined;
    },
    [rankedTeams]
  );

  const stateTopRows = useMemo(
    () =>
      shownState
        ? filterRankingsByState(rankings, rankedTeams, shownState).slice(0, STATE_TOP)
        : [],
    [rankings, rankedTeams, shownState]
  );
  const unknownStateCount = rankedTeams.filter((team) => !team.state).length;

  // Filtering is presentational: ratings come from every game, because a team's strength does not
  // depend on which rows are on screen. Only the numbering changes.
  const visibleRankings = useMemo(
    () => filterRankingsByState(rankings, rankedTeams, stateFilter),
    [rankings, rankedTeams, stateFilter]
  );

  const teamNameById = useMemo(
    () => new Map(allKnown.teams.map((team) => [team.id, team.name])),
    [allKnown.teams]
  );

  const reportForId =
    reportTeamId || rankings.find((row) => row.isMine)?.teamId || rankings[0]?.teamId || "";
  /** Opponents asked for by name in the scouting report, beyond the two lists it shows by default. */
  const [pickedOpponentIds, setPickedOpponentIds] = useState<string[]>([]);
  const report = useMemo(
    () =>
      reportForId
        ? buildScoutingReport(reportForId, rankings, rankedTeams, {
            pickedIds: pickedOpponentIds,
          })
        : EMPTY_SCOUTING_REPORT,
    [reportForId, rankings, rankedTeams, pickedOpponentIds]
  );
  /** Everyone the report names, for the panel that has to explain where a rank comes from. */
  const reportRows = useMemo(
    () => [...report.national, ...report.state, ...report.picked],
    [report]
  );

  /**
   * The games still on this team's schedule. Read from the same pool the ratings are fitted over,
   * so a fixture a GameChanger pull brought in with no score yet is already here — nothing has to
   * be entered by hand for the next game to show up.
   */
  const upcomingRows = useMemo(() => {
    if (!reportForId) return [];
    const today = new Date().toISOString().slice(0, 10);
    return buildUpcomingSchedule(reportForId, rankings, poolGames, allKnown.teams, today);
  }, [reportForId, rankings, poolGames, allKnown.teams]);
  const reportRow = rankings.find((row) => row.teamId === reportForId) ?? null;

  const selectedGroupName = ageGroups.find((g) => g.id === selectedAgeGroupId)?.name ?? "";

  /**
   * A level below `MIN_RANKED_AGE_LEVEL` has no table by design, so its page would otherwise read
   * as "no teams yet" however many games were logged on it. Said plainly instead, because the
   * games are not being ignored — they are evidence about the older teams that played down.
   */
  const selectedAgeLevel = ageGroupLevel(ageGroups.find((g) => g.id === selectedAgeGroupId));
  const unrankedLevelNote =
    selectedAgeGroupId && !isRankedAgeLevel(selectedAgeLevel)
      ? `${selectedAgeLevel}U is not ranked — at that age the results say more about which league is machine pitch than about the teams. Games logged here still count as evidence about the ${MIN_RANKED_AGE_LEVEL}U and older teams that played down against them.`
      : null;

  const explanationRequest = useMemo(() => {
    if (!reportRow || reportRow.games === 0) return null;
    return buildTeamRankExplanationRequest(
      reportRow,
      rankings.length,
      reportRows,
      selectedGroupName || "this age group"
    );
  }, [reportRow, rankings.length, reportRows, selectedGroupName]);
  const explanation = useLeagueSummary(explanationRequest);

  const ageGroupManualGames = useMemo(
    () =>
      scoutGames
        .filter((game) => game.ageGroupId === selectedAgeGroupId)
        .slice()
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    [scoutGames, selectedAgeGroupId]
  );

  /**
   * Sets or clears the state a team plays in, which is what the state leaderboard files it under.
   * A team not in the pool at all is ignored rather than created.
   */
  const setTeamState = (teamId: string, nextState: string) => {
    const state = normalizeState(nextState);
    const exists = allKnown.teams.some((team) => team.id === teamId);
    if (!exists) return;
    persistTeams(
      allKnown.teams.map((team) =>
        team.id === teamId ? { ...team, ...(state ? { state } : { state: undefined }) } : team
      )
    );
    showToast(state ? `Set to ${state}.` : "State cleared.", { tone: "success" });
  };

  /**
   * Marks (or unmarks) "our" team *for this age group only* — a club running a 9U and an 11U squad
   * at the same time needs one of each, and the old global flag could only hold one. The team is
   * persisted first so the mark survives even if it was only ever a league-derived name.
   */
  const setMyTeam = (teamId: string) => {
    if (!selectedAgeGroupId) return;
    if (!scoutTeams.some((team) => team.id === teamId)) {
      persistTeams([...scoutTeams, ...allKnown.teams.filter((t) => t.id === teamId)]);
    }
    persistAgeGroups(
      ageGroups.map((group) =>
        group.id === selectedAgeGroupId
          ? { ...group, myTeamId: group.myTeamId === teamId ? undefined : teamId }
          : group
      )
    );
  };

  const removeGame = async (game: ScoutGame) => {
    const played = isScoutGamePlayed(game);
    const confirmed = await requestConfirmation({
      title: "Remove this game?",
      message: played
        ? `${teamNameById.get(game.teamAId) ?? "?"} ${game.teamAScore} – ${
            teamNameById.get(game.teamBId) ?? "?"
          } ${game.teamBScore}`
        : `${teamNameById.get(game.teamAId) ?? "?"} vs ${teamNameById.get(game.teamBId) ?? "?"} (scheduled, no score yet)`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    lastDeletedGameRef.current = game;
    persistGames(scoutGames.filter((g) => g.id !== game.id));
    showToast("Game removed.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => {
        const restored = lastDeletedGameRef.current;
        if (restored) persistGames([...scoutGames.filter((g) => g.id !== restored.id), restored]);
      },
    });
  };

  /**
   * Whether this page has anything of its own to remove for a team. The pool can list a team whose
   * every game is filed under a sibling age group; `removeTeam` only touches games filed here, so
   * for that team it would delete nothing and still say it had. The button is not offered instead.
   */
  const hasGamesFiledHere = (teamId: string): boolean =>
    scoutGames.some(
      (game) =>
        game.ageGroupId === selectedAgeGroupId &&
        (game.teamAId === teamId || game.teamBId === teamId)
    );

  /**
   * Removes a team from *this* age group by dropping the games logged against them here. Their
   * results in other age groups are left alone — the same club can be a 9U opponent and an 11U
   * one, and removing a stray 11U entry shouldn't wipe the 9U history. The team record itself only
   * goes when nothing is left of it anywhere.
   */
  const removeTeam = async (team: ScoutTeam) => {
    const isHere = (game: ScoutGame) =>
      game.ageGroupId === selectedAgeGroupId &&
      (game.teamAId === team.id || game.teamBId === team.id);
    const relatedGames = scoutGames.filter(isHere);
    const playedElsewhere = scoutGames.some(
      (game) => !isHere(game) && (game.teamAId === team.id || game.teamBId === team.id)
    );
    const confirmed = await requestConfirmation({
      title: `Remove ${team.name}?`,
      message: `This removes the ${relatedGames.length === 1 ? "game" : `${relatedGames.length} games`} logged against them in ${selectedGroupName || "this age group"}.${
        playedElsewhere ? " Their games in other age groups stay." : ""
      }`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    lastDeletedTeamRef.current = { team, games: relatedGames };
    if (!playedElsewhere) persistTeams(scoutTeams.filter((t) => t.id !== team.id));
    persistGames(scoutGames.filter((game) => !isHere(game)));
    if (myTeamId === team.id) {
      persistAgeGroups(
        ageGroups.map((group) =>
          group.id === selectedAgeGroupId ? { ...group, myTeamId: undefined } : group
        )
      );
    }
    showToast(`${team.name} removed.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => {
        const restored = lastDeletedTeamRef.current;
        if (!restored) return;
        if (!scoutTeams.some((t) => t.id === restored.team.id)) {
          persistTeams([...scoutTeams, restored.team]);
        }
        persistGames([...scoutGames.filter((game) => !isHere(game)), ...restored.games]);
      },
    });
  };

  /** The team behind a row in the full table, for the Remove button that table offers. */
  const removeTeamById = (teamId: string) => {
    const team = allKnown.teams.find((t) => t.id === teamId);
    if (team) void removeTeam(team);
  };

  /**
   * Takes one GameChanger id off a team. Only the roster changes: the games that id brought in
   * stay where they are, because they happened and still belong to this team until somebody says
   * otherwise.
   */
  const unlinkGc = (teamId: string, gcTeamId: string) => {
    const next = unlinkGcTeam(teamId, gcTeamId, scoutTeams);
    if (next === scoutTeams) return;
    persistTeams(next);
    showToast("Unlinked from GameChanger.", { tone: "success" });
  };

  /**
   * The "same team as" the pull can only ever propose. Folding is confirmed first because it moves
   * every game and removes an entry, and a wrong one is tedious to undo by hand.
   */
  const mergeInto = async (fromId: string, intoId: string) => {
    const from = allKnown.teams.find((team) => team.id === fromId);
    const into = allKnown.teams.find((team) => team.id === intoId);
    if (!from || !into) return;
    const preview = mergeScoutTeams(fromId, intoId, scoutTeams, scoutGames, ageGroups);
    const confirmed = await requestConfirmation({
      title: `Fold ${from.name} into ${into.name}?`,
      message: `Every game moves to ${into.name} and ${from.name} is removed.${
        preview.droppedGames > 0
          ? ` ${preview.droppedGames} game${preview.droppedGames === 1 ? "" : "s"} between the two cannot survive the merge and will be dropped.`
          : ""
      }`,
      confirmLabel: "Fold in",
    });
    if (!confirmed) return;
    persistTeams(preview.teams);
    persistGames(preview.games);
    setOpenTeamId(intoId);
    showToast(`Folded into ${into.name}.`, { tone: "success" });
  };

  const { searchOptions, pageOf, mergeCandidatesFor } = useClubSearch({
    teams: allKnown.teams,
    games: allKnown.games,
    ageGroups,
    rankedTeams,
  });

  /** Goes to the page a team is on and opens it, whichever season and level that turns out to be. */
  const openSearchedTeam = (teamId: string) => {
    const page = pageOf(teamId);
    if (page) openPage(page.ageGroupId);
    setOpenTeamId(teamId);
  };

  const openTeam = openTeamId ? (allKnown.teams.find((t) => t.id === openTeamId) ?? null) : null;

  /**
   * Renaming onto a name that already exists merges the two teams, so a placeholder or a
   * misspelling can be routed to the real team rather than leaving its games stranded.
   */
  const renameTeam = async (teamId: string, nextName: string) => {
    const preview = renameScoutTeam(teamId, nextName, allKnown.teams, scoutGames, ageGroups);
    if (preview.mergedInto) {
      const moved = scoutGames.filter(
        (game) => game.teamAId === teamId || game.teamBId === teamId
      ).length;
      const confirmed = await requestConfirmation({
        title: `Merge into ${preview.mergedInto.name}?`,
        message: `${moved} game${moved === 1 ? "" : "s"} will move to ${preview.mergedInto.name}, and this team will be removed.${
          preview.droppedGames > 0
            ? `\n\n${preview.droppedGames} game${preview.droppedGames === 1 ? " is" : "s are"} between these two teams and will be dropped — a team cannot play itself.`
            : ""
        }`,
        confirmLabel: "Merge",
      });
      if (!confirmed) return;
    }

    persistTeams(preview.teams);
    persistGames(preview.games);
    if (preview.mergedInto) {
      // The merged-away team no longer exists, so follow the games to the one that does.
      const survivor = preview.mergedInto;
      setOpenTeamId(survivor.id);
      // Every age group that pointed at the removed team follows it. Repairing only the selected
      // one would leave another group's star, "use my team" shortcut and default import subject
      // pointing at an id nothing answers to.
      if (ageGroups.some((group) => group.myTeamId === teamId)) {
        persistAgeGroups(
          ageGroups.map((group) =>
            group.myTeamId === teamId ? { ...group, myTeamId: survivor.id } : group
          )
        );
      }
    }
    showToast(preview.mergedInto ? `Merged into ${preview.mergedInto.name}.` : "Team renamed.", {
      tone: "success",
    });
  };

  const myTeamName = rankings.find((row) => row.isMine)?.teamName ?? "";

  const scoresBothBlank = gameDraft.teamAScore.trim() === "" && gameDraft.teamBScore.trim() === "";
  const scoresBothValid =
    gameDraft.teamAScore.trim() !== "" &&
    gameDraft.teamBScore.trim() !== "" &&
    Number.isFinite(Number(gameDraft.teamAScore)) &&
    Number(gameDraft.teamAScore) >= 0 &&
    Number.isFinite(Number(gameDraft.teamBScore)) &&
    Number(gameDraft.teamBScore) >= 0;
  const addGameValid =
    Boolean(selectedAgeGroupId) &&
    gameDraft.teamAName.trim().length > 0 &&
    gameDraft.teamBName.trim().length > 0 &&
    gameDraft.teamAName.trim().toLowerCase() !== gameDraft.teamBName.trim().toLowerCase() &&
    (scoresBothBlank || scoresBothValid);

  const addGame = async () => {
    if (!addGameValid) {
      showToast("Enter both team names, and either both scores or neither.", { tone: "error" });
      return;
    }
    let teams = allKnown.teams;
    const a = resolveOrCreateTeam(gameDraft.teamAName, teams);
    teams = a.teams;
    const b = resolveOrCreateTeam(gameDraft.teamBName, teams);
    teams = b.teams;
    const newGame: ScoutGame = {
      id: `scout_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      teamAId: a.teamId,
      teamBId: b.teamId,
      ageGroupId: selectedAgeGroupId,
      ...(scoresBothValid
        ? { teamAScore: Number(gameDraft.teamAScore), teamBScore: Number(gameDraft.teamBScore) }
        : {}),
      ...(gameDraft.date ? { date: gameDraft.date } : {}),
      ...(gameDraft.event.trim() ? { event: gameDraft.event.trim() } : {}),
    };

    // Same teams, same date, same score as something already here (logged by hand, imported, or
    // pulled from the league schedule) — check before double-counting it into the rating.
    const duplicate = findDuplicateGame(newGame, ageGroupGames);
    if (duplicate) {
      const nameOf = (id: string) =>
        teams.find((team) => team.id === id)?.name ?? teamNameById.get(id) ?? "?";
      const scoreLine = isScoutGamePlayed(duplicate)
        ? `${nameOf(duplicate.teamAId)} ${duplicate.teamAScore} – ${nameOf(duplicate.teamBId)} ${duplicate.teamBScore}`
        : `${nameOf(duplicate.teamAId)} vs ${nameOf(duplicate.teamBId)} (scheduled, no score yet)`;
      const confirmed = await requestConfirmation({
        title: "Already logged?",
        message: `${scoreLine}${duplicate.date ? ` on ${duplicate.date}` : ""} is already in this age group with the same date and score.\n\nAdding it again counts it twice in the rankings.`,
        confirmLabel: "Add anyway",
      });
      if (!confirmed) return;
    }

    persistTeams(teams);
    persistGames([...scoutGames, newGame]);
    setGameDraft(EMPTY_ADD_GAME_DRAFT);
    showToast(scoresBothValid ? "Game added." : "Added to schedule.", { tone: "success" });
  };

  /**
   * Commits a reviewed batch of imported games. The panel has already resolved names
   * through `resolveOrCreateTeam` (so they arrive age-free and linked to existing teams) and has
   * dropped anything already logged here, so this just saves and offers an undo for the lot.
   */
  const importGames = (nextTeams: ScoutTeam[], newGames: ScoutGame[]) => {
    const before = scoutGames;
    persistTeams(nextTeams);
    persistGames([...scoutGames, ...newGames]);
    setImportOpen(false);
    showToast(`Added ${newGames.length} game${newGames.length === 1 ? "" : "s"}.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => persistGames(before),
    });
  };

  /**
   * Keeps a game in the log but out of the maths, or puts it back. Fall tournaments pair a team
   * against the age above or below depending on who entered; those results are real and worth
   * having, but they say nothing about how a team stacks up inside its own age group.
   */
  const toggleGameExcluded = (game: ScoutGame) => {
    const excluded = game.excluded !== true;
    persistGames(
      scoutGames.map((entry) =>
        entry.id === game.id
          ? { ...entry, ...(excluded ? { excluded: true } : { excluded: undefined }) }
          : entry
      )
    );
    showToast(excluded ? "Game no longer counts." : "Game counts again.", { tone: "success" });
  };

  const startEditScore = (gameId: string) => {
    setEditingGameId(gameId);
    setEditScoreA("");
    setEditScoreB("");
  };

  const saveGameScore = (gameId: string) => {
    const a = Number(editScoreA);
    const b = Number(editScoreB);
    if (!Number.isFinite(a) || a < 0 || !Number.isFinite(b) || b < 0) {
      showToast("Enter two non-negative scores.", { tone: "error" });
      return;
    }
    persistGames(
      scoutGames.map((game) =>
        game.id === gameId ? { ...game, teamAScore: a, teamBScore: b } : game
      )
    );
    setEditingGameId(null);
    setEditScoreA("");
    setEditScoreB("");
    showToast("Score saved.", { tone: "success" });
  };

  // ---------- Starting over ----------

  /**
   * The whole pool as one JSON file, which is how the data comes back — and the only reason the
   * reset below can be offered at all.
   *
   * JSON rather than the CSV it used to be because the pool is nested: a team carries a list of
   * GameChanger links, each with its own staff list and season record, and a table has nowhere to
   * put that. Restoring still reads either, because files written before this exist.
   */
  const downloadPoolBackup = async () => {
    const backup = readTeamRankingsBackup();
    const estimate = estimateBackupBytes(backup);

    // A nationwide pool makes a file that takes a moment to put together and will not open in
    // every spreadsheet. Somebody who pressed this meaning to glance at their own league's rows
    // should hear that before waiting for it.
    if (estimate >= LARGE_BACKUP_BYTES) {
      const go = await requestConfirmation({
        title: "That is a large backup",
        message: `${summarizeTeamRankingsBackup(backup)}

The file will be around ${formatBytes(estimate)} and will take a moment to put together.`,
        confirmLabel: "Download anyway",
      });
      if (!go) return;
    }

    /*
     * Written in pieces rather than as one string. At twenty thousand teams the joined copy is
     * tens of megabytes and exists alongside the rows it was built from at the moment of the join,
     * which is exactly the peak a phone cannot afford. A Blob is assembled from parts perfectly
     * well, so the join never happens.
     */
    const savedAt = new Date().toISOString();
    const parts = teamRankingsJsonParts(backup, savedAt);
    if (parts.length === 0) {
      showToast("Nothing to back up yet.", { tone: "error" });
      return;
    }
    const blob = new Blob(parts, { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Team_Rankings_Backup_${savedAt.slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`Backup downloaded (${formatBytes(blob.size)}).`, { tone: "success" });
  };

  /**
   * Empties Team Rankings: every age group, team and game, plus the cursor of any interrupted
   * GameChanger pull and the weekly refresh log. The counts go into the confirmation because the
   * number of games about to disappear is the whole of what makes this decision easy or hard.
   *
   * Afterwards the view is put back to its first-visit state by hand rather than by reloading the
   * page — a reload would throw away a League Standings edit the user has not saved yet, and
   * everything here that came out of storage is named right below.
   */
  /*
   * What each baseball year holds, for the card that offers to freeze one.
   *
   * One pass over the stored games rather than a filter per year: on a nationwide pool there are
   * three hundred thousand of them and half a dozen years, and the card re-renders on every pick.
   * The stored games, because those are the ones a delete can take — the league's fixtures are
   * derived and go from the archive's point of view by the page going, not by being deleted.
   */
  const archivableSummaries = useMemo(() => {
    const yearOf = new Map<string, number>();
    ageGroups.forEach((group) => {
      const year = ageGroupYear(group);
      if (year !== undefined) yearOf.set(group.id, year);
    });
    const pages = new Map<number, number>();
    yearOf.forEach((year) => pages.set(year, (pages.get(year) ?? 0) + 1));
    const games = new Map<number, number>();
    const sides = new Map<number, Set<string>>();
    scoutGames.forEach((game) => {
      const year = yearOf.get(game.ageGroupId);
      if (year === undefined) return;
      games.set(year, (games.get(year) ?? 0) + 1);
      const seen = sides.get(year) ?? new Set<string>();
      seen.add(game.teamAId);
      seen.add(game.teamBId);
      sides.set(year, seen);
    });
    return archivableYears(ageGroups).map((year) => ({
      year,
      pages: pages.get(year) ?? 0,
      games: games.get(year) ?? 0,
      teams: sides.get(year)?.size ?? 0,
    }));
  }, [ageGroups, scoutGames]);

  /**
   * Freezes a baseball year's tables and deletes the games behind them.
   *
   * The tables are built from the merged pool, so what is frozen is what was on screen — the
   * league's own fixtures included, which is why the confirmation says they go too. What is
   * deleted is the stored pool only, because derived fixtures were never stored.
   *
   * Order matters and is the reason this is not two calls: the archive is written and confirmed
   * first, and the games are deleted only if it landed. A half-written archive with the games
   * already gone is the one outcome there is no coming back from.
   */
  const archiveYear = async (year: number) => {
    const shown = { teams: allKnown.teams, games: allKnownGames };
    const stored = { ageGroups, teams: scoutTeams, games: scoutGames };
    const done = archiveSquadYear(year, shown, stored, new Date().toISOString());

    if (done.seasons.length === 0 && done.unranked.length === 0) {
      showToast(`Nothing is filed under ${year}.`, { tone: "error" });
      return;
    }

    const lines = [
      `${done.seasons.length} final table${done.seasons.length === 1 ? "" : "s"} kept: ${done.seasons
        .map((season) => `${season.name} (${season.rows.length.toLocaleString()} teams)`)
        .join(", ")}.`,
      `${done.droppedGames.toLocaleString()} stored game${done.droppedGames === 1 ? "" : "s"} and ${done.droppedTeams.toLocaleString()} team${done.droppedTeams === 1 ? "" : "s"} deleted.`,
    ];
    if (done.archivedLeagueGames > 0) {
      lines.push(
        `${done.archivedLeagueGames.toLocaleString()} league game${done.archivedLeagueGames === 1 ? "" : "s"} are in these tables and will no longer be counted in any live ranking. League Standings keeps its own seasons — this does not touch them.`
      );
    }
    if (done.unranked.length > 0) {
      lines.push(
        `No table for ${done.unranked.map((page) => `${page.name} (${page.games.toLocaleString()} games)`).join(", ")} — those ages are not ranked, so their games informed the tables above and keep no rows of their own.`
      );
    }
    lines.push("The tables become read-only. This cannot be undone.");

    const confirmed = await requestConfirmation({
      title: `Archive ${year} and delete its games?`,
      message: lines.join("\n\n"),
      confirmLabel: `Archive ${year}`,
    });
    if (!confirmed) return;

    setArchiving(true);
    try {
      const kept = await saveArchivedSeasons(done.seasons);
      if (!kept) {
        showToast("Could not write the archive, so nothing was deleted. The pool is unchanged.", {
          tone: "error",
        });
        return;
      }
      // Only now: the tables are on disk, so the games they replace can go.
      persistAgeGroups(done.state.ageGroups);
      persistTeams(done.state.teams);
      persistGames(done.state.games);
      setArchives(loadArchiveIndex());
      pickPage("");
      setOpenTeamId(null);
      setReportTeamId("");
      showToast(
        `${year} archived. ${kept.length} final table${kept.length === 1 ? "" : "s"} kept under Archive; ${done.droppedGames.toLocaleString()} games deleted.`
      );
      onDataChange?.();
    } finally {
      setArchiving(false);
    }
  };

  const resetEverything = async () => {
    const going = readTeamRankingsBackup();
    const confirmed = await requestConfirmation({
      title: "Delete everything in Team Rankings?",
      message: `${summarizeTeamRankingsBackup(going)}

All of it goes, along with where any interrupted GameChanger pull had got to. League Standings — your seasons, schedules and scores — is not touched.

This cannot be undone. Cancel and download the backup first if there is any chance you will want this data again.`,
      confirmLabel: "Delete everything",
    });
    if (!confirmed) return;

    if (!clearTeamRankings()) {
      showToast(
        "Could not clear Team Rankings — this browser cannot reach where the pool is kept.",
        {
          tone: "error",
        }
      );
      return;
    }

    setAgeGroups([]);
    setScoutTeams([]);
    setScoutGames([]);
    setPullProgress(null);
    setRefreshLog({});
    setArchives([]);
    pickPage("");
    setOpenTeamId(null);
    setReportTeamId("");
    setStateFilter("");
    setStateTop(null);
    setShowAll(false);
    setImportOpen(false);
    setEditingGameId(null);
    setEditScoreA("");
    setEditScoreB("");
    setGameDraft(EMPTY_ADD_GAME_DRAFT);
    onDataChange?.();
    showToast("Team Rankings cleared. Nothing left but a blank slate.", { tone: "success" });
  };

  // Scoped to this age group and the ones it continues from: a 9U opponent has no business being
  // suggested while logging an 11U game, even though both squads share one roster store.
  const suggestedTeams = useMemo(
    () => teamNameSuggestions(selectedAgeGroupId, ageGroups, allKnown.teams, chainGames),
    [selectedAgeGroupId, ageGroups, allKnown.teams, chainGames]
  );
  const teamNameOptions = useMemo(() => suggestedTeams.map((team) => team.name), [suggestedTeams]);

  return (
    <div className="flex flex-col gap-6">
      <RankingsHeader
        ageGroups={ageGroups}
        section={section}
        selectedYear={selectedYear}
        selectedAgeGroupId={selectedAgeGroupId}
        groupsInYear={groupsInYear}
        yearChoices={yearChoices}
        onOpenYear={openYear}
        onOpenPage={openPage}
        onOpenSection={openSection}
      />

      <div
        id={SECTION_PANEL_ID}
        role="tabpanel"
        aria-labelledby={sectionTabId(section)}
        className="flex flex-col gap-6"
      >
        {/*
          One boundary per section, keyed by section, so a section that throws leaves the tabs and
          the age picker above it usable — you can still get to Setup and take a backup out. Keying
          it clears the caught error on the way to another section, which is what makes leaving a
          broken one possible at all.
        */}
        <ErrorBoundary key={section} area={sectionLabel(section)}>
          {section === "rankings" && (
            <RankingsBoards
              groupName={selectedGroupName}
              searchOptions={searchOptions}
              onSearchTeam={openSearchedTeam}
              hasAgeGroups={ageGroups.length > 0}
              unrankedLevelNote={unrankedLevelNote}
              rankings={rankings}
              rankingsStale={rankingsStale}
              nationalTop={nationalTop}
              stateTopRows={stateTopRows}
              visibleRankings={visibleRankings}
              availableStates={availableStates}
              shownState={shownState}
              onShownStateChange={setStateTop}
              unknownStateCount={unknownStateCount}
              stateFilter={stateFilter}
              onStateFilterChange={setStateFilter}
              showAll={showAll}
              onToggleShowAll={() => setShowAll((value) => !value)}
              placeOf={placeOf}
              isLeagueTeam={(teamId) => leagueGameTeamIds.has(teamId)}
              hasGamesFiledHere={hasGamesFiledHere}
              onOpenTeam={setOpenTeamId}
              onMarkMine={setMyTeam}
              onRemoveTeam={removeTeamById}
            />
          )}

          {section === "games" && (
            <GamesSection
              groupName={selectedGroupName}
              ageGroupId={selectedAgeGroupId}
              hasAgeGroups={ageGroups.length > 0}
              draft={gameDraft}
              onDraftChange={(patch) => setGameDraft((prev) => ({ ...prev, ...patch }))}
              teamNameOptions={teamNameOptions}
              myTeamName={myTeamName}
              addGameValid={addGameValid}
              onAddGame={() => void addGame()}
              onGoToImport={() => openSection("import")}
              importOpen={importOpen}
              onOpenImport={() => setImportOpen(true)}
              onCloseImport={() => setImportOpen(false)}
              allTeams={allKnown.teams}
              suggestedTeams={suggestedTeams}
              existingGames={ageGroupGames}
              onImportGames={importGames}
              showToast={showToast}
              loggedGames={ageGroupManualGames}
              teamNameById={teamNameById}
              editingGameId={editingGameId}
              editScoreA={editScoreA}
              editScoreB={editScoreB}
              onEditScoreA={setEditScoreA}
              onEditScoreB={setEditScoreB}
              onStartEditScore={startEditScore}
              onSaveScore={saveGameScore}
              onToggleExcluded={toggleGameExcluded}
              onRemoveGame={(game) => void removeGame(game)}
            />
          )}

          {section === "import" && (
            <GameChangerImportPanel
              /*
               * The stored pool only — not the merged roster. League-derived teams and games are
               * rebuilt from League Standings on every render and must never be written back here, or
               * a pull would persist a second copy of every league game it happened to see.
               */
              pool={{ ageGroups, teams: scoutTeams, games: scoutGames }}
              savedProgress={pullProgress}
              onPersist={(next) => {
                const savedGroups = saveAgeGroups(next.ageGroups);
                const savedTeams = saveScoutTeams(next.teams);
                const savedGames = saveScoutGames(next.games);
                setAgeGroups(next.ageGroups);
                setScoutTeams(next.teams);
                setScoutGames(next.games);
                onDataChange?.();
                return savedGroups && savedTeams && savedGames;
              }}
              onSaveProgress={(progress) => {
                setPullProgress(progress);
                savePullProgress(progress);
              }}
              onClearProgress={() => {
                setPullProgress(null);
                clearPullProgress();
              }}
              refreshLog={refreshLog}
              onRefreshLog={(log) => {
                setRefreshLog(log);
                saveRefreshLog(log);
              }}
              /* The panel closes itself when a pull finishes; there is nowhere to close to but the
               tables it has just filled. */
              onClose={() => openSection("rankings")}
              showToast={showToast}
            />
          )}

          {section === "scouting" && (
            <ScoutingSection
              rankings={rankings}
              reportForId={reportForId}
              onReportTeamChange={setReportTeamId}
              reportRow={reportRow}
              report={report}
              onPickOpponent={(id) =>
                setPickedOpponentIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
              }
              onDropOpponent={(id) =>
                setPickedOpponentIds((prev) => prev.filter((entry) => entry !== id))
              }
              upcomingRows={upcomingRows}
              explanation={explanation}
              placeOf={placeOf}
            />
          )}

          {section === "archive" && <ArchiveSection entries={archives} />}

          {section === "setup" && (
            <SetupSection
              seasons={seasons}
              ageGroups={ageGroups}
              onAssignSeason={assignSeasonToAge}
              yearOptions={yearOptions}
              teamCount={scoutTeams.length}
              gameCount={scoutGames.length}
              onDownloadBackup={() => void downloadPoolBackup()}
              /*
              The stored pool, not the merged roster: league-derived games are rebuilt from League
              Standings every render and must never be written back here.
            */
              poolHealth={{
                pool: { ageGroups, teams: scoutTeams, games: scoutGames },
                tidyStamp: loadTidyStamp() ?? "",
                onTidied: ({ state: tidied }) => {
                  saveTidyStamp(poolSignature(tidied));
                  if (tidied.ageGroups !== ageGroups) persistAgeGroups(tidied.ageGroups);
                  if (tidied.teams !== scoutTeams) persistTeams(tidied.teams);
                  if (tidied.games !== scoutGames) persistGames(tidied.games);
                },
              }}
              /*
              The whole known pool, not just this page's rows: the fit is over the season year, so
              a check over anything narrower would be measuring a different model than the one the
              table came from.
            */
              modelCheck={{
                ageGroupId: selectedAgeGroupId,
                groupName: selectedGroupName,
                teams: allKnown.teams,
                games: allKnownGames,
              }}
              onReset={() => void resetEverything()}
              archive={{
                years: archivableSummaries,
                currentYear: selectedYear,
                busy: archiving,
                onArchive: (year) => void archiveYear(year),
              }}
            />
          )}
        </ErrorBoundary>
      </div>

      {openTeam && (
        <TeamDetailPanel
          // Keyed by team, so opening a different one gets a fresh panel. Without this React keeps
          // the instance and its rename draft still holds the previous team's name — which would
          // arm Merge to fold the newly opened team into the one you were just looking at.
          key={openTeam.id}
          team={openTeam}
          allGames={allKnownGames}
          ageGroupId={selectedAgeGroupId}
          ageGroups={ageGroups}
          ageGroupName={selectedGroupName}
          teamNameById={teamNameById}
          fromLeague={leagueGameTeamIds.has(openTeam.id)}
          onRename={(nextName) => void renameTeam(openTeam.id, nextName)}
          onUnlinkGc={(gcTeamId) => unlinkGc(openTeam.id, gcTeamId)}
          onMergeInto={(intoTeamId) => void mergeInto(openTeam.id, intoTeamId)}
          mergeCandidates={mergeCandidatesFor(openTeam.id)}
          onSetState={(state) => setTeamState(openTeam.id, state)}
          onClose={() => setOpenTeamId(null)}
        />
      )}
    </div>
  );
}
