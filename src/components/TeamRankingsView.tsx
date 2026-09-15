import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  advancedAgeGroup,
  ageGroupChain,
  ageGroupLevel,
  ageGroupSeason,
  ageGroupYear,
  buildScoutingReport,
  createAgeGroupId,
  dedupeLeagueFixtures,
  deriveLeagueScoutGames,
  findAgeGroupForSeason,
  findDuplicateGame,
  formatAgeGroupName,
  isRankedAgeLevel,
  isScoutGamePlayed,
  mergeScoutTeams,
  MAX_AGE_LEVEL,
  MIN_RANKED_AGE_LEVEL,
  MIN_SEASON_YEAR,
  nextSeason,
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
  loadLogsForSeason,
  loadMatchupsForSeason,
  loadTeamsForSeason,
  type SeasonMeta,
} from "../lib/storage";
import {
  clearPullProgress,
  clearTeamRankings,
  loadAgeGroups,
  loadPullProgress,
  loadRefreshLog,
  loadScoutGames,
  loadScoutTeams,
  saveAgeGroups,
  savePullProgress,
  saveRefreshLog,
  saveScoutGames,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";
import {
  readTeamRankingsBackup,
  summarizeTeamRankingsBackup,
  teamRankingsCsvSections,
} from "../lib/teamRankingsBackup";
import { DEFAULT_RANKINGS_SECTION, type RankingsSection } from "../lib/rankingsRoute";
import { GameChangerImportPanel } from "./GameChangerImportPanel";
import { TeamDetailPanel } from "./TeamDetailPanel";
import { GamesSection, EMPTY_ADD_GAME_DRAFT, type AddGameDraft } from "./teamRankings/GamesSection";
import {
  NATIONAL_TOP,
  RankingsSection as RankingsBoards,
  STATE_TOP,
} from "./teamRankings/RankingsSection";
import { ScoutingSection } from "./teamRankings/ScoutingSection";
import { SectionNav, SECTION_PANEL_ID, sectionTabId } from "./teamRankings/SectionNav";
import { SetupSection, type AgeGroupDraft } from "./teamRankings/SetupSection";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import { useRankingsRoute } from "../hooks/useRankingsRoute";
import { useRankingsWorker } from "../hooks/useRankingsWorker";
import type { ToastTone } from "../hooks/useToast";
import { button, card, tab } from "../styles/tokens";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type TeamRankingsViewProps = {
  seasons: SeasonMeta[];
  activeSeasonId: string;
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
export function TeamRankingsView({
  seasons,
  activeSeasonId,
  showToast,
  requestConfirmation,
  onDataChange,
}: TeamRankingsViewProps) {
  const { route, push, replace } = useRankingsRoute();
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(() => loadAgeGroups());
  const [pickedGroupId, setPickedGroupId] = useState(() => ageGroups[0]?.id ?? "");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  /**
   * The age-group form. Opens on the youngest level that actually ranks: 8U stays selectable — its
   * games are evidence about the 9U teams that played down — but it is not what accepting the
   * defaults gives you.
   */
  const [groupDraft, setGroupDraft] = useState<AgeGroupDraft>(() => ({
    ageLevel: MIN_RANKED_AGE_LEVEL,
    year: MIN_SEASON_YEAR,
    seasonIds: activeSeasonId ? [activeSeasonId] : [],
    continuesFromId: "",
  }));

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

  const persistTeams = (teams: ScoutTeam[]) => {
    setScoutTeams(teams);
    if (!saveScoutTeams(teams))
      showToast("Could not save teams (storage full).", { tone: "error" });
    onDataChange?.();
  };
  const persistGames = (games: ScoutGame[]) => {
    setScoutGames(games);
    if (!saveScoutGames(games))
      showToast("Could not save games (storage full).", { tone: "error" });
    onDataChange?.();
  };
  const persistAgeGroups = (groups: AgeGroup[]) => {
    setAgeGroups(groups);
    if (!saveAgeGroups(groups))
      showToast("Could not save age groups (storage full).", { tone: "error" });
    onDataChange?.();
  };

  // ---------- Age group management ----------

  const yearOptions = useMemo(() => seasonYearOptions(ageGroups), [ageGroups]);

  const patchGroupDraft = (patch: Partial<AgeGroupDraft>) =>
    setGroupDraft((prev) => ({ ...prev, ...patch }));

  const startEditGroup = (group: AgeGroup) => {
    // A group saved before the season picker existed has only the name the user typed, so read
    // what can be read from it and leave the rest at the defaults rather than blanking the form.
    const season = ageGroupSeason(group);
    setEditingGroupId(group.id);
    setGroupDraft({
      ageLevel: season.ageLevel ?? MIN_RANKED_AGE_LEVEL,
      year: season.year ?? MIN_SEASON_YEAR,
      seasonIds: group.seasonIds,
      continuesFromId: group.continuesFromId ?? "",
    });
  };

  const resetGroupForm = () => {
    setEditingGroupId(null);
    setGroupDraft({
      ageLevel: MIN_RANKED_AGE_LEVEL,
      year: MIN_SEASON_YEAR,
      seasonIds: activeSeasonId ? [activeSeasonId] : [],
      continuesFromId: "",
    });
  };

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
    setPickedGroupId(result.group.id);
    showToast(
      result.created
        ? `${result.group.name} created, with your league season on it.`
        : `League season added to ${result.group.name}.`,
      { tone: "success" }
    );
  };

  const saveAgeGroup = () => {
    const season = { ageLevel: groupDraft.ageLevel, year: groupDraft.year };
    // Two age groups for the same 10U 2028 would split one squad's schedule across two rankings,
    // and neither would be right. The picker can't produce a typo, so this can only be a repeat.
    const clash = findAgeGroupForSeason(season, ageGroups);
    if (clash && clash.id !== editingGroupId) {
      showToast(`${clash.name} already exists.`, { tone: "error" });
      return;
    }
    const name = formatAgeGroupName(season.ageLevel, season.year);
    // Pointing an age group at itself would make the chain meaningless, so drop that choice.
    const continuesFromId =
      groupDraft.continuesFromId && groupDraft.continuesFromId !== editingGroupId
        ? groupDraft.continuesFromId
        : "";
    if (editingGroupId) {
      persistAgeGroups(
        ageGroups.map((group) =>
          group.id === editingGroupId
            ? {
                ...group,
                name,
                ageLevel: season.ageLevel,
                year: season.year,
                seasonIds: groupDraft.seasonIds,
                ...(continuesFromId ? { continuesFromId } : { continuesFromId: undefined }),
              }
            : group
        )
      );
      showToast("Age group updated.", { tone: "success" });
    } else {
      const newGroup: AgeGroup = {
        id: createAgeGroupId(),
        name,
        ageLevel: season.ageLevel,
        year: season.year,
        seasonIds: groupDraft.seasonIds,
        ...(continuesFromId ? { continuesFromId } : {}),
      };
      persistAgeGroups([...ageGroups, newGroup]);
      setPickedGroupId(newGroup.id);
      showToast("Age group created.", { tone: "success" });
    }
    resetGroupForm();
  };

  /**
   * Rolls a squad into next season: a year older, a year later, continuing from the one it came
   * from so this year's opponents are already suggested when logging next year's games. Results
   * stay behind — a 9U score says nothing about a 10U game — and so do the League Standings
   * seasons, which don't exist yet for a year that hasn't started.
   */
  const advanceSeason = (group: AgeGroup) => {
    const season = ageGroupSeason(group);
    if (season.ageLevel === undefined || season.year === undefined) {
      showToast("Set this group's age and year first, then advance it.", { tone: "error" });
      startEditGroup(group);
      return;
    }
    const next = nextSeason({ ageLevel: season.ageLevel, year: season.year });
    const existing = findAgeGroupForSeason(next, ageGroups);
    if (existing) {
      setPickedGroupId(existing.id);
      showToast(`${existing.name} already exists — switched to it.`);
      return;
    }
    const created = advancedAgeGroup(group, next);
    persistAgeGroups([...ageGroups, created]);
    setPickedGroupId(created.id);
    resetGroupForm();
    showToast(`${created.name} created from ${group.name}.`, { tone: "success" });
  };

  const removeAgeGroup = async (group: AgeGroup) => {
    const confirmed = await requestConfirmation({
      title: `Delete "${group.name}"?`,
      message:
        "This removes the age group and any games logged here that were tagged to it. League Standings data itself is untouched.",
      confirmLabel: "Delete",
    });
    if (!confirmed) return;
    // Anything that carried on from this group now continues from nothing, rather than pointing
    // at an age group that no longer exists.
    const remaining = ageGroups
      .filter((g) => g.id !== group.id)
      .map((g) => (g.continuesFromId === group.id ? { ...g, continuesFromId: undefined } : g));
    persistAgeGroups(remaining);
    persistGames(scoutGames.filter((g) => g.ageGroupId !== group.id));
    if (selectedAgeGroupId === group.id) setPickedGroupId(remaining[0]?.id ?? "");
    showToast(`"${group.name}" deleted.`, { tone: "success" });
  };

  // ---------- Pages: one per age level, within one season year ----------

  /** Which area is on screen. Read from the URL, so every section is a link somebody can send. */
  const section = route.section ?? DEFAULT_RANKINGS_SECTION;

  const byLevel = (a: AgeGroup, b: AgeGroup) =>
    (ageGroupLevel(a) ?? MAX_AGE_LEVEL + 1) - (ageGroupLevel(b) ?? MAX_AGE_LEVEL + 1);

  /**
   * The page the URL names, if it names one that exists. A link giving both halves names one page
   * exactly; a link giving only a level opens it in whichever year has it; a link giving only a
   * year opens that year's youngest page. A link to a page that is not there resolves to nothing
   * and the last picked page stands, with the URL corrected afterwards rather than obeyed.
   */
  const routeGroupId = useMemo(() => {
    if (route.ageLevel === undefined && route.year === undefined) return undefined;
    const matches = ageGroups.filter(
      (group) =>
        (route.ageLevel === undefined || ageGroupLevel(group) === route.ageLevel) &&
        (route.year === undefined || ageGroupYear(group) === route.year)
    );
    return matches.slice().sort(byLevel)[0]?.id;
  }, [route.ageLevel, route.year, ageGroups]);

  /**
   * Which page is open. Derived rather than stored, so Back and Forward move between pages without
   * anything having to notice and write state back. The picked id is the fallback for a URL that
   * names no page, and it is checked against the groups that still exist so a deleted page cannot
   * leave the view pointing at nothing.
   */
  const selectedAgeGroupId =
    routeGroupId ??
    (ageGroups.some((group) => group.id === pickedGroupId)
      ? pickedGroupId
      : (ageGroups[0]?.id ?? ""));

  /**
   * The season years that have a page — the years age groups actually sit in, not a forward run of
   * every year the create form offers, because a year with no age group has nothing to show.
   */
  const pageYears = useMemo(() => {
    const years = new Set<number>();
    ageGroups.forEach((group) => {
      const year = ageGroupYear(group);
      if (year !== undefined) years.add(year);
    });
    return [...years].sort((a, b) => a - b);
  }, [ageGroups]);

  /**
   * Groups whose season year cannot be read — a legacy "Travel squad" named before the season
   * picker existed. They still need somewhere to live, so the year picker gains an entry for them
   * rather than leaving them unreachable.
   */
  const undatedGroups = useMemo(
    () => ageGroups.filter((group) => ageGroupYear(group) === undefined),
    [ageGroups]
  );

  /** Season-picker options, `undefined` standing for the groups with no year of their own. */
  const yearChoices = useMemo<(number | undefined)[]>(
    () => [...pageYears, ...(undatedGroups.length > 0 ? [undefined] : [])],
    [pageYears, undatedGroups]
  );

  const selectedGroup = ageGroups.find((group) => group.id === selectedAgeGroupId);
  const selectedYear = ageGroupYear(selectedGroup);

  /** The tabs: every age group in the season year on screen, youngest level first. */
  const groupsInYear = useMemo(() => {
    const inYear =
      selectedYear === undefined
        ? undatedGroups
        : ageGroups.filter((group) => ageGroupYear(group) === selectedYear);
    return inYear.slice().sort(byLevel);
  }, [ageGroups, selectedYear, undatedGroups]);

  /** The page currently on screen, as a route — every navigation is this with one part changed. */
  const currentRoute = {
    mode: "rankings" as const,
    ...(ageGroupLevel(selectedGroup) === undefined
      ? {}
      : { ageLevel: ageGroupLevel(selectedGroup) }),
    ...(ageGroupYear(selectedGroup) === undefined ? {} : { year: ageGroupYear(selectedGroup) }),
    section,
  };

  const openPage = (groupId: string) => {
    if (!groupId || groupId === selectedAgeGroupId) return;
    setPickedGroupId(groupId);
    const group = ageGroups.find((entry) => entry.id === groupId);
    // Pushed, not replaced: this is a page the user asked for, so Back should return to the last.
    // The section rides along, so changing age level keeps you where you were reading.
    push({
      mode: "rankings",
      ...(ageGroupLevel(group) === undefined ? {} : { ageLevel: ageGroupLevel(group) }),
      ...(ageGroupYear(group) === undefined ? {} : { year: ageGroupYear(group) }),
      section,
    });
  };

  /** Moving between areas is a page in its own right, so Back returns to the one before it. */
  const openSection = (next: RankingsSection) => {
    if (next === section) return;
    push({ ...currentRoute, section: next });
  };

  /**
   * Changing the season year keeps the level on screen where that level exists in the new year —
   * moving from 10U 2028 to 2029 lands on 10U 2029 — and otherwise opens that year's youngest
   * page, which is the closest thing to "the same place" a year without that level has.
   */
  const openYear = (year: number | undefined) => {
    const candidates =
      year === undefined
        ? undatedGroups
        : ageGroups.filter((group) => ageGroupYear(group) === year);
    if (candidates.length === 0) return;
    const sameLevel = candidates.find(
      (group) => ageGroupLevel(group) === ageGroupLevel(selectedGroup)
    );
    const next = sameLevel ?? candidates.slice().sort(byLevel)[0];
    if (next) openPage(next.id);
  };

  /**
   * Keeps the URL honest about the page actually on screen — after a group is deleted, after the
   * first group is created, or when a link asked for a page that is not there. Replaced rather
   * than pushed: the app tidying up after itself is not somewhere Back should land.
   *
   * Only the page is corrected, never the section: a link naming no section is already showing the
   * right one, and writing it in would be the app editing a URL the reader typed.
   */
  useEffect(() => {
    if (!selectedGroup) return;
    const level = ageGroupLevel(selectedGroup);
    const year = ageGroupYear(selectedGroup);
    if (route.ageLevel === level && route.year === year) return;
    replace({
      mode: "rankings",
      ...(level === undefined ? {} : { ageLevel: level }),
      ...(year === undefined ? {} : { year }),
      ...(route.section ? { section: route.section } : {}),
    });
  }, [selectedGroup, route.ageLevel, route.year, route.section, replace]);

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

  const stateOf = useCallback(
    (teamId: string) => rankedTeams.find((team) => team.id === teamId)?.state,
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

  const reportRows = useMemo(() => {
    const forId = reportTeamId || rankings.find((row) => row.isMine)?.teamId || rankings[0]?.teamId;
    if (!forId) return [];
    return buildScoutingReport(forId, rankings);
  }, [reportTeamId, rankings]);
  const reportForId =
    reportTeamId || rankings.find((row) => row.isMine)?.teamId || rankings[0]?.teamId || "";
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
   * Marks (or unmarks) "our" team *for this age group only* — a club running a 9U and an 11U squad
   * at the same time needs one of each, and the old global flag could only hold one. The team is
   * persisted first so the mark survives even if it was only ever a league-derived name.
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
    const preview = mergeScoutTeams(fromId, intoId, scoutTeams, scoutGames);
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

  /** Everyone else rated on this page — who a team could plausibly be the same club as. */
  const mergeCandidatesFor = (teamId: string): ScoutTeam[] =>
    rankedTeams.filter((team) => team.id !== teamId);

  const openTeam = openTeamId ? (allKnown.teams.find((t) => t.id === openTeamId) ?? null) : null;

  /**
   * Renaming onto a name that already exists merges the two teams, so a placeholder or a
   * misspelling can be routed to the real team rather than leaving its games stranded.
   */
  const renameTeam = async (teamId: string, nextName: string) => {
    const preview = renameScoutTeam(teamId, nextName, allKnown.teams, scoutGames);
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
   * The whole pool as one CSV file. The same sections the app's own CSV export appends after a
   * schedule, so importing this file is how the data comes back — which is the only reason the
   * reset below can be offered at all.
   */
  const downloadPoolBackup = () => {
    const csv = teamRankingsCsvSections(readTeamRankingsBackup());
    if (!csv) {
      showToast("Nothing to back up yet.", { tone: "error" });
      return;
    }
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `Team_Rankings_Backup_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("Backup downloaded.", { tone: "success" });
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
    setPickedGroupId("");
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
    resetGroupForm();
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
      <div className={`${card} p-5`}>
        <h1 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
          Team Rankings
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="scout-season-year"
          >
            Season
          </label>
          {yearChoices.length > 1 ? (
            <select
              id="scout-season-year"
              value={selectedYear === undefined ? "" : String(selectedYear)}
              onChange={(event) =>
                openYear(event.target.value === "" ? undefined : Number(event.target.value))
              }
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              {yearChoices.map((year) => (
                <option key={year === undefined ? "" : year} value={year === undefined ? "" : year}>
                  {year === undefined ? "No season set" : year}
                </option>
              ))}
            </select>
          ) : (
            ageGroups.length > 0 && (
              <span
                id="scout-season-year"
                className="text-xs font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200"
              >
                {selectedYear ?? "No season set"}
              </span>
            )
          )}
        </div>

        {/*
          The way in, for a browser with nothing in it yet. Not shown on the two sections it points
          at: on Setup the form it offers is already on screen, and on Import so is the pull.
        */}
        {ageGroups.length === 0 && section !== "setup" && section !== "import" && (
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 dark:border-slate-700">
            <p className="text-sm font-bold text-slate-950 dark:text-white">Nothing ranked yet.</p>
            <p className="mt-1 text-xs text-slate-500">
              Pull a team list from GameChanger and the pages make themselves: every team says which
              age level and season it belongs to, and each one is filed under the page for that
              squad year — created if it is not there yet. Setting a page up by hand is for a league
              you are tracking without GameChanger.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openSection("import")}
                className={button.primary}
              >
                Pull from GameChanger
              </button>
              <button type="button" onClick={() => openSection("setup")} className={button.ghost}>
                Set one up by hand
              </button>
            </div>
          </div>
        )}

        {groupsInYear.length > 0 && (
          <nav aria-label="Age level" className="mt-3 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
            {groupsInYear.map((group) => {
              const level = ageGroupLevel(group);
              const active = group.id === selectedAgeGroupId;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => openPage(group.id)}
                  aria-current={active ? "page" : undefined}
                  className={tab(active)}
                >
                  {level === undefined ? group.name : `${level}U`}
                  {isRankedAgeLevel(level) ? "" : " ·"}
                </button>
              );
            })}
          </nav>
        )}

        <SectionNav current={section} onSelect={openSection} />
      </div>

      <div
        id={SECTION_PANEL_ID}
        role="tabpanel"
        aria-labelledby={sectionTabId(section)}
        className="flex flex-col gap-6"
      >
        {section === "rankings" && (
          <RankingsBoards
            groupName={selectedGroupName}
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
            stateOf={stateOf}
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
            reportRows={reportRows}
            explanation={explanation}
          />
        )}

        {section === "setup" && (
          <SetupSection
            seasons={seasons}
            ageGroups={ageGroups}
            editingGroupId={editingGroupId}
            draft={groupDraft}
            onDraftChange={patchGroupDraft}
            onAssignSeason={assignSeasonToAge}
            yearOptions={yearOptions}
            onSave={saveAgeGroup}
            onCancelEdit={resetGroupForm}
            onEditGroup={startEditGroup}
            onAdvanceGroup={advanceSeason}
            onDeleteGroup={(group) => void removeAgeGroup(group)}
            teamCount={scoutTeams.length}
            gameCount={scoutGames.length}
            onDownloadBackup={downloadPoolBackup}
            onReset={() => void resetEverything()}
          />
        )}
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
