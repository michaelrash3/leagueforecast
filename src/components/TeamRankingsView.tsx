import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  advancedAgeGroup,
  AGE_LEVELS,
  ageGroupChain,
  ageGroupLevel,
  ageGroupSeason,
  ageGroupYear,
  buildScoutingReport,
  buildTeamRankings,
  createAgeGroupId,
  deriveLeagueScoutGames,
  findAgeGroupForSeason,
  findDuplicateGame,
  formatAgeGroupName,
  isRankedAgeLevel,
  isScoutGamePlayed,
  MAX_AGE_LEVEL,
  MIN_RANKED_AGE_LEVEL,
  MIN_SEASON_YEAR,
  nextSeason,
  rankingPoolGroupIds,
  resolveOrCreateTeam,
  seasonYearOptions,
  UNKNOWN_STATE,
  filterRankingsByState,
  normalizeState,
  renameScoutTeam,
  statesInUse,
  teamNameSuggestions,
  type AgeGroup,
  type LeagueSeasonSnapshot,
  type MatchupTier,
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
  loadAgeGroups,
  loadPullProgress,
  loadScoutGames,
  loadScoutTeams,
  saveAgeGroups,
  savePullProgress,
  saveScoutGames,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";
import { AiStoryPanel } from "./AiStoryPanel";
import { GameChangerImportPanel } from "./GameChangerImportPanel";
import { ScheduleImportPanel } from "./ScheduleImportPanel";
import { RankingMethodButton, RankingMethodPanel } from "./RankingMethodPanel";
import { TeamDetailPanel } from "./TeamDetailPanel";
import { TeamNameCombobox } from "./TeamNameCombobox";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import { useRankingsRoute } from "../hooks/useRankingsRoute";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill, tab } from "../styles/tokens";

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

const tierTone = (tier: MatchupTier) =>
  tier === "Favored" ? "emerald" : tier === "Underdog" ? "red" : "neutral";

const formatRating = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
const formatPct = (value: number) => `${Math.round(value * 100)}%`;

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
  const [manageOpen, setManageOpen] = useState(() => ageGroups.length === 0);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  // Opens on the youngest level that actually ranks. 8U stays selectable — its games are evidence
  // about the 9U teams that played down — but it is not what accepting the defaults gives you.
  const [groupAgeLevel, setGroupAgeLevel] = useState(MIN_RANKED_AGE_LEVEL);
  const [groupYear, setGroupYear] = useState(MIN_SEASON_YEAR);
  const [groupSeasonIds, setGroupSeasonIds] = useState<string[]>(() =>
    activeSeasonId ? [activeSeasonId] : []
  );
  const [groupContinuesFromId, setGroupContinuesFromId] = useState("");

  const [scoutTeams, setScoutTeams] = useState<ScoutTeam[]>(() => loadScoutTeams());
  const [scoutGames, setScoutGames] = useState<ScoutGame[]>(() => loadScoutGames());
  const [reportTeamId, setReportTeamId] = useState<string>("");

  const [teamAName, setTeamAName] = useState("");
  const [teamAScore, setTeamAScore] = useState("");
  const [teamBName, setTeamBName] = useState("");
  const [teamBScore, setTeamBScore] = useState("");
  const [gameDate, setGameDate] = useState("");
  const [gameEvent, setGameEvent] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [gcOpen, setGcOpen] = useState(false);
  const [pullProgress, setPullProgress] = useState(() => loadPullProgress());
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [methodOpen, setMethodOpen] = useState(false);
  const methodPanelId = useId();

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

  const toggleGroupSeason = (seasonId: string) => {
    setGroupSeasonIds((prev) =>
      prev.includes(seasonId) ? prev.filter((id) => id !== seasonId) : [...prev, seasonId]
    );
  };

  const startEditGroup = (group: AgeGroup) => {
    // A group saved before the season picker existed has only the name the user typed, so read
    // what can be read from it and leave the rest at the defaults rather than blanking the form.
    const season = ageGroupSeason(group);
    setEditingGroupId(group.id);
    setGroupAgeLevel(season.ageLevel ?? MIN_RANKED_AGE_LEVEL);
    setGroupYear(season.year ?? MIN_SEASON_YEAR);
    setGroupSeasonIds(group.seasonIds);
    setGroupContinuesFromId(group.continuesFromId ?? "");
    setManageOpen(true);
  };

  const resetGroupForm = () => {
    setEditingGroupId(null);
    setGroupAgeLevel(MIN_RANKED_AGE_LEVEL);
    setGroupYear(MIN_SEASON_YEAR);
    setGroupSeasonIds(activeSeasonId ? [activeSeasonId] : []);
    setGroupContinuesFromId("");
  };

  const saveAgeGroup = () => {
    const season = { ageLevel: groupAgeLevel, year: groupYear };
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
      groupContinuesFromId && groupContinuesFromId !== editingGroupId ? groupContinuesFromId : "";
    if (editingGroupId) {
      persistAgeGroups(
        ageGroups.map((group) =>
          group.id === editingGroupId
            ? {
                ...group,
                name,
                ageLevel: season.ageLevel,
                year: season.year,
                seasonIds: groupSeasonIds,
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
        seasonIds: groupSeasonIds,
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

  const openPage = (groupId: string) => {
    if (!groupId || groupId === selectedAgeGroupId) return;
    setPickedGroupId(groupId);
    const group = ageGroups.find((entry) => entry.id === groupId);
    // Pushed, not replaced: this is a page the user asked for, so Back should return to the last.
    push({
      mode: "rankings",
      ...(ageGroupLevel(group) === undefined ? {} : { ageLevel: ageGroupLevel(group) }),
      ...(ageGroupYear(group) === undefined ? {} : { year: ageGroupYear(group) }),
    });
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
    });
  }, [selectedGroup, route.ageLevel, route.year, replace]);

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
    return { teams, derivedGames, games: [...derivedGames, ...scoutGames] };
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
  const rankings = useMemo(
    () => buildTeamRankings(selectedAgeGroupId, allKnown.teams, poolGames, myTeamId, ageGroups),
    [selectedAgeGroupId, allKnown.teams, poolGames, myTeamId, ageGroups]
  );

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
   * Removes a team from *this* age group by dropping the games logged against them here. Their
   * results in other age groups are left alone — the same club can be a 9U opponent and an 11U
   * one, and removing a stray 11U entry shouldn't wipe the 9U history. The team record itself only
   * goes when nothing is left of it anywhere.
   */
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

  const scoresBothBlank = teamAScore.trim() === "" && teamBScore.trim() === "";
  const scoresBothValid =
    teamAScore.trim() !== "" &&
    teamBScore.trim() !== "" &&
    Number.isFinite(Number(teamAScore)) &&
    Number(teamAScore) >= 0 &&
    Number.isFinite(Number(teamBScore)) &&
    Number(teamBScore) >= 0;
  const addGameValid =
    Boolean(selectedAgeGroupId) &&
    teamAName.trim().length > 0 &&
    teamBName.trim().length > 0 &&
    teamAName.trim().toLowerCase() !== teamBName.trim().toLowerCase() &&
    (scoresBothBlank || scoresBothValid);

  const addGame = async () => {
    if (!addGameValid) {
      showToast("Enter both team names, and either both scores or neither.", { tone: "error" });
      return;
    }
    let teams = allKnown.teams;
    const a = resolveOrCreateTeam(teamAName, teams);
    teams = a.teams;
    const b = resolveOrCreateTeam(teamBName, teams);
    teams = b.teams;
    const newGame: ScoutGame = {
      id: `scout_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      teamAId: a.teamId,
      teamBId: b.teamId,
      ageGroupId: selectedAgeGroupId,
      ...(scoresBothValid
        ? { teamAScore: Number(teamAScore), teamBScore: Number(teamBScore) }
        : {}),
      ...(gameDate ? { date: gameDate } : {}),
      ...(gameEvent.trim() ? { event: gameEvent.trim() } : {}),
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
    setTeamAName("");
    setTeamAScore("");
    setTeamBName("");
    setTeamBScore("");
    setGameDate("");
    setGameEvent("");
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
        <p className="mt-1 text-sm text-slate-500">
          Separate from League Standings: log any team&apos;s scores as they come up in a tournament
          or another league, and see how everyone stacks up. An age group&apos;s whole League
          Standings schedule (every season you assign to it — Fall, Spring, whatever your club runs)
          is folded in automatically, no need to re-enter those — an upcoming league game shows its
          opponent here right away, and once it&apos;s scored in League Standings it counts here as
          a final result too. Each age group keeps to itself, so a 9U opponent never turns up while
          you&apos;re logging an 11U game; point an age group at last year&apos;s to carry that
          squad&apos;s opponents forward as it ages up. Marking a team &ldquo;mine&rdquo; is just a
          shortcut for the scouting report and for adding your own schedule ahead of time — it never
          changes how any team, including yours, is rated.
        </p>
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
          <button
            type="button"
            onClick={() => setManageOpen((v) => !v)}
            className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
          >
            {manageOpen
              ? "Hide age groups"
              : ageGroups.length === 0
                ? "Set up an age group"
                : "Manage age groups"}
          </button>
        </div>

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

        {manageOpen && (
          <div className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
            {ageGroups.length > 0 && (
              <ul className="mb-3 divide-y divide-slate-100 dark:divide-slate-800">
                {ageGroups.map((group) => (
                  <li
                    key={group.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                  >
                    <span>
                      <span className="font-bold text-slate-950 dark:text-white">{group.name}</span>{" "}
                      <span className="text-slate-500">
                        {group.seasonIds.length
                          ? group.seasonIds
                              .map((id) => seasons.find((s) => s.id === id)?.name ?? id)
                              .join(", ")
                          : "No seasons assigned yet"}
                        {group.continuesFromId
                          ? ` · continues ${
                              ageGroups.find((g) => g.id === group.continuesFromId)?.name ??
                              "an age group that no longer exists"
                            }`
                          : ""}
                      </span>
                    </span>
                    <span className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => advanceSeason(group)}
                        className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Advance to new season
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditGroup(group)}
                        className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeAgeGroup(group)}
                        className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {editingGroupId ? "Edit age group" : "New age group"}
            </p>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <span className="flex flex-col gap-1">
                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                    htmlFor="scout-group-age"
                  >
                    Age
                  </label>
                  <select
                    id="scout-group-age"
                    value={groupAgeLevel}
                    onChange={(event) => setGroupAgeLevel(Number(event.target.value))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    {AGE_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}U{isRankedAgeLevel(level) ? "" : " (not ranked)"}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="flex flex-col gap-1">
                  <label
                    className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                    htmlFor="scout-group-year"
                  >
                    Year
                  </label>
                  <select
                    id="scout-group-year"
                    value={groupYear}
                    onChange={(event) => setGroupYear(Number(event.target.value))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
                  >
                    {yearOptions.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </span>
                <span className="flex flex-col justify-end pb-2 text-sm font-bold text-slate-950 dark:text-white">
                  {formatAgeGroupName(groupAgeLevel, groupYear)}
                </span>
              </div>
              <div className="flex flex-wrap gap-3">
                {seasons.map((season) => (
                  <label
                    key={season.id}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={groupSeasonIds.includes(season.id)}
                      onChange={() => toggleGroupSeason(season.id)}
                    />
                    {season.name}
                  </label>
                ))}
              </div>
              <label
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                htmlFor="scout-continues-from"
              >
                Continues from
              </label>
              <select
                id="scout-continues-from"
                value={groupContinuesFromId}
                onChange={(event) => setGroupContinuesFromId(event.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
              >
                <option value="">Nothing — this is a new squad</option>
                {ageGroups
                  .filter((group) => group.id !== editingGroupId)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
              </select>
              <p className="text-xs text-slate-500">
                Last year&apos;s version of this same squad — a 10U that used to be the 9U. Its
                opponents keep showing up in the name list here, but its results stay out of these
                rankings: a 9U score says nothing about a 10U game.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={saveAgeGroup} className={button.primary}>
                  {editingGroupId ? "Save changes" : "Create age group"}
                </button>
                {editingGroupId && (
                  <button type="button" onClick={resetGroupForm} className={button.ghost}>
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Top 10</h2>
        {rankings.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">
            {unrankedLevelNote
              ? unrankedLevelNote
              : ageGroups.length === 0
                ? "Set up an age group above, then add a game to start ranking teams."
                : "Add a game below to start ranking teams for this age group."}
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
            {rankings.slice(0, 10).map((row) => (
              <li
                key={row.teamId}
                className={`flex items-center justify-between gap-3 px-2 py-2.5 text-sm ${
                  row.isMine ? "rounded-lg bg-blue-50 dark:bg-blue-950/40" : ""
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className={pill(row.rank === 1 ? "amber" : "neutral")}>#{row.rank}</span>
                  <button
                    type="button"
                    onClick={() => setOpenTeamId(row.teamId)}
                    className="text-left font-bold text-slate-950 hover:underline dark:text-white"
                  >
                    {row.teamName}
                    {row.isMine ? " ★" : ""}
                  </button>
                </span>
                <span className="text-slate-500">
                  {row.record} · {formatRating(row.rating)}
                </span>
              </li>
            ))}
          </ol>
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
          onSetState={(state) => setTeamState(openTeam.id, state)}
          onClose={() => setOpenTeamId(null)}
        />
      )}

      {gcOpen && (
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
          onClose={() => setGcOpen(false)}
          showToast={showToast}
        />
      )}

      {importOpen && selectedAgeGroupId && (
        <ScheduleImportPanel
          ageGroupId={selectedAgeGroupId}
          ageGroupName={selectedGroupName}
          teams={allKnown.teams}
          suggestedTeams={suggestedTeams}
          existingGames={ageGroupGames}
          defaultSubjectTeam={myTeamName}
          onImport={importGames}
          onClose={() => setImportOpen(false)}
          showToast={showToast}
        />
      )}

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Add a game</h2>
          {selectedAgeGroupId && !importOpen && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
            >
              Import games
            </button>
          )}
          {!gcOpen && (
            <button
              type="button"
              onClick={() => setGcOpen(true)}
              className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
            >
              Pull from GameChanger
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {ageGroups.length === 0
            ? "Set up an age group above first — every game needs one to know which ranking it belongs to."
            : "Leave both scores blank to log an upcoming/scheduled game (useful for building out your own team's future schedule) — come back and fill in the score once it's played."}
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_90px_1fr_90px]">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <TeamNameCombobox
                id="scout-team-a-name"
                value={teamAName}
                onChange={setTeamAName}
                options={teamNameOptions}
                placeholder="Team name"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
              />
            </div>
            {myTeamName && (
              <button
                type="button"
                onClick={() => setTeamAName(myTeamName)}
                className="shrink-0 whitespace-nowrap text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
              >
                Use my team
              </button>
            )}
          </div>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={teamAScore}
            onChange={(event) => setTeamAScore(event.target.value)}
            placeholder="Score"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <TeamNameCombobox
            id="scout-team-b-name"
            value={teamBName}
            onChange={setTeamBName}
            options={teamNameOptions}
            placeholder="Opponent name"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={teamBScore}
            onChange={(event) => setTeamBScore(event.target.value)}
            placeholder="Score"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            type="date"
            value={gameDate}
            onChange={(event) => setGameDate(event.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
          <input
            type="text"
            value={gameEvent}
            onChange={(event) => setGameEvent(event.target.value)}
            placeholder="Tournament / event (optional)"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
          />
        </div>
        <button
          type="button"
          onClick={() => void addGame()}
          disabled={!addGameValid}
          className={`${button.primary} mt-3`}
        >
          Add Game
        </button>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
            Full rankings
            <RankingMethodButton
              open={methodOpen}
              onToggle={() => setMethodOpen((value) => !value)}
              panelId={methodPanelId}
            />
          </h2>
          {(availableStates.length > 0 || unknownStateCount > 0) && (
            <span className="flex items-center gap-2">
              <label
                className="text-xs font-semibold uppercase tracking-wide text-slate-500"
                htmlFor="scout-state-filter"
              >
                State
              </label>
              <select
                id="scout-state-filter"
                value={stateFilter}
                onChange={(event) => setStateFilter(event.target.value)}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
              >
                <option value="">All states</option>
                {availableStates.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
                {unknownStateCount > 0 && (
                  <option value={UNKNOWN_STATE}>No state set ({unknownStateCount})</option>
                )}
              </select>
            </span>
          )}
        </div>
        {methodOpen && (
          <RankingMethodPanel id={methodPanelId} onClose={() => setMethodOpen(false)} />
        )}
        {stateFilter && (
          <p className="mt-2 text-xs text-slate-500">
            Showing {visibleRankings.length} of {rankings.length} teams. Ratings still come from
            every game — filtering changes who is listed, not how anyone is rated, so the{" "}
            <strong>#</strong> here is the position within this list and the grey number is the
            place in the full table.
          </p>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2">Rank</th>
                <th>Team</th>
                <th>Record</th>
                <th>Rating</th>
                <th>Games</th>
                <th>SOS</th>
                <th className="sr-only">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleRankings.map((row) => (
                <tr key={row.teamId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-3 font-black">
                    #{row.rank}
                    {row.overallRank !== undefined && row.overallRank !== row.rank && (
                      <span className="ml-1 text-xs font-bold text-slate-400">
                        #{row.overallRank}
                      </span>
                    )}
                  </td>
                  <td className="font-bold text-slate-950 dark:text-white">
                    <button
                      type="button"
                      onClick={() => setOpenTeamId(row.teamId)}
                      className="text-left font-bold hover:underline"
                      title="Every game logged for this team"
                    >
                      {row.teamName}
                    </button>
                    {leagueGameTeamIds.has(row.teamId) && (
                      <span className={`ml-2 ${pill("blue")}`}>League</span>
                    )}
                  </td>
                  <td>{row.record}</td>
                  <td>{formatRating(row.rating)}</td>
                  <td>{row.games}</td>
                  <td>{row.sosRank ? `#${row.sosRank}` : "—"}</td>
                  <td className="space-x-2 text-right">
                    <button
                      type="button"
                      onClick={() => setMyTeam(row.teamId)}
                      className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                      aria-pressed={row.isMine}
                      title="Mark as my team"
                    >
                      {row.isMine ? "★ My team" : "☆ Mark mine"}
                    </button>
                    {!leagueGameTeamIds.has(row.teamId) && hasGamesFiledHere(row.teamId) && (
                      <button
                        type="button"
                        onClick={() => {
                          const team = allKnown.teams.find((t) => t.id === row.teamId);
                          if (team) void removeTeam(team);
                        }}
                        className="text-xs font-bold text-red-600 hover:underline dark:text-red-400"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rankings.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              {unrankedLevelNote ?? "No teams yet for this age group."}
            </p>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Ratings only become meaningful once teams&apos; schedules connect, directly or through
          common opponents — a team with no shared opponents will show a plain, less certain rating.
          This model always uses a flat run-margin cap, independent of any one season&apos;s own
          settings.
        </p>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Scouting report
        </h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label
            className="text-xs font-semibold uppercase tracking-wide text-slate-500"
            htmlFor="scout-report-team"
          >
            How would
          </label>
          <select
            id="scout-report-team"
            value={reportForId}
            onChange={(event) => setReportTeamId(event.target.value)}
            className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            {rankings.map((row) => (
              <option key={row.teamId} value={row.teamId}>
                {row.teamName}
              </option>
            ))}
          </select>
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            fare against everyone?
          </span>
        </div>
        {reportRow && (
          <div className="mt-3">
            <AiStoryPanel
              title="Why this ranking"
              text={explanation.status === "ready" ? explanation.summary : ""}
              source={explanation.status === "ready" ? "gemini" : "local"}
              model={explanation.model}
              loading={explanation.status === "loading"}
              loadingLabel="Writing rank explanation…"
              unavailableReason={explanation.reason}
              errorMessage={explanation.message}
              onRetry={explanation.retry}
            />
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="py-2">Opponent</th>
                <th>Opponent rank</th>
                <th>Projected margin</th>
                <th>Win probability</th>
                <th>Outlook</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((preview) => (
                <tr
                  key={preview.opponentId}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="py-3 font-bold text-slate-950 dark:text-white">
                    {preview.opponentName}
                  </td>
                  <td>#{preview.opponentRank}</td>
                  <td>
                    {preview.projectedMargin >= 0 ? "+" : ""}
                    {preview.projectedMargin.toFixed(1)}
                  </td>
                  <td>{formatPct(preview.winProb)}</td>
                  <td>
                    <span className={pill(tierTone(preview.tier))}>{preview.tier}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {reportRows.length === 0 && (
            <p className="py-6 text-center text-sm text-slate-500">
              Add at least two teams to this age group to see scouting projections.
            </p>
          )}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
          Logged games{selectedGroupName ? ` (${selectedGroupName})` : ""}
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Only games you&apos;ve entered here — this age group&apos;s League Standings schedule
          (played and upcoming) appears in the rankings and scouting report above automatically but
          isn&apos;t listed here.
        </p>
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {ageGroupManualGames.map((game) => {
            const played = isScoutGamePlayed(game);
            return (
              <li
                key={game.id}
                className="flex flex-col gap-2 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span>
                  {played ? (
                    <>
                      <span className="font-bold text-slate-950 dark:text-white">
                        {teamNameById.get(game.teamAId) ?? "?"} {game.teamAScore}
                      </span>
                      {" – "}
                      <span className="font-bold text-slate-950 dark:text-white">
                        {teamNameById.get(game.teamBId) ?? "?"} {game.teamBScore}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="font-bold text-slate-950 dark:text-white">
                        {teamNameById.get(game.teamAId) ?? "?"} vs{" "}
                        {teamNameById.get(game.teamBId) ?? "?"}
                      </span>
                      <span className={`ml-2 ${pill("neutral")}`}>Scheduled</span>
                    </>
                  )}
                  {game.excluded && (
                    <span className={`ml-2 ${pill("amber")}`} title="Kept, but not counted">
                      Not counted
                    </span>
                  )}
                  {game.event && <span className="ml-2 text-slate-500">{game.event}</span>}
                  {game.date && <span className="ml-2 text-slate-400">{game.date}</span>}
                </span>
                <span className="flex items-center gap-2">
                  {!played && editingGameId === game.id ? (
                    <span className="flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={editScoreA}
                        onChange={(event) => setEditScoreA(event.target.value)}
                        placeholder="Score"
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                      />
                      <input
                        type="number"
                        min={0}
                        value={editScoreB}
                        onChange={(event) => setEditScoreB(event.target.value)}
                        placeholder="Score"
                        className="w-16 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-800 dark:bg-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => saveGameScore(game.id)}
                        className="text-xs font-bold text-emerald-600 hover:underline dark:text-emerald-400"
                      >
                        Save
                      </button>
                    </span>
                  ) : (
                    !played && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingGameId(game.id);
                          setEditScoreA("");
                          setEditScoreB("");
                        }}
                        className="text-xs font-bold text-blue-600 hover:underline dark:text-blue-400"
                      >
                        Enter score
                      </button>
                    )
                  )}
                  {played && (
                    <button
                      type="button"
                      onClick={() => toggleGameExcluded(game)}
                      className="text-xs font-bold text-amber-700 hover:underline dark:text-amber-500"
                      title={
                        game.excluded
                          ? "Count this game toward the rankings again"
                          : "Keep this game logged, but leave it out of the rankings"
                      }
                    >
                      {game.excluded ? "Count it" : "Don't count"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeGame(game)}
                    className={button.danger}
                  >
                    Remove
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
        {ageGroupManualGames.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No games logged yet.</p>
        )}
      </div>
    </div>
  );
}
