import { useMemo, useRef, useState } from "react";
import {
  ageGroupChain,
  buildScoutingReport,
  buildTeamRankings,
  deriveLeagueScoutGames,
  findDuplicateGame,
  isScoutGamePlayed,
  resolveOrCreateTeam,
  renameScoutTeam,
  teamNameSuggestions,
  teamsInAgeGroup,
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
  loadAgeGroups,
  loadScoutGames,
  loadScoutTeams,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
} from "../lib/teamRankingsStorage";
import { AiStoryPanel } from "./AiStoryPanel";
import { ScheduleImportPanel } from "./ScheduleImportPanel";
import { TeamDetailPanel } from "./TeamDetailPanel";
import { TeamNameCombobox } from "./TeamNameCombobox";
import { useLeagueSummary } from "../hooks/useLeagueSummary";
import type { ToastTone } from "../hooks/useToast";
import { button, card, pill } from "../styles/tokens";

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
  const [ageGroups, setAgeGroups] = useState<AgeGroup[]>(() => loadAgeGroups());
  const [selectedAgeGroupId, setSelectedAgeGroupId] = useState(() => ageGroups[0]?.id ?? "");
  const [manageOpen, setManageOpen] = useState(() => ageGroups.length === 0);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
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
  const [openTeamId, setOpenTeamId] = useState<string | null>(null);

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

  const toggleGroupSeason = (seasonId: string) => {
    setGroupSeasonIds((prev) =>
      prev.includes(seasonId) ? prev.filter((id) => id !== seasonId) : [...prev, seasonId]
    );
  };

  const startEditGroup = (group: AgeGroup) => {
    setEditingGroupId(group.id);
    setGroupNameInput(group.name);
    setGroupSeasonIds(group.seasonIds);
    setGroupContinuesFromId(group.continuesFromId ?? "");
    setManageOpen(true);
  };

  const resetGroupForm = () => {
    setEditingGroupId(null);
    setGroupNameInput("");
    setGroupSeasonIds(activeSeasonId ? [activeSeasonId] : []);
    setGroupContinuesFromId("");
  };

  const saveAgeGroup = () => {
    const name = groupNameInput.trim();
    if (!name) {
      showToast("Give the age group a name.", { tone: "error" });
      return;
    }
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
                seasonIds: groupSeasonIds,
                ...(continuesFromId ? { continuesFromId } : { continuesFromId: undefined }),
              }
            : group
        )
      );
      showToast("Age group updated.", { tone: "success" });
    } else {
      const newGroup: AgeGroup = {
        id: `ag_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        name,
        seasonIds: groupSeasonIds,
        ...(continuesFromId ? { continuesFromId } : {}),
      };
      persistAgeGroups([...ageGroups, newGroup]);
      setSelectedAgeGroupId(newGroup.id);
      showToast("Age group created.", { tone: "success" });
    }
    resetGroupForm();
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
    if (selectedAgeGroupId === group.id) setSelectedAgeGroupId(remaining[0]?.id ?? "");
    showToast(`"${group.name}" deleted.`, { tone: "success" });
  };

  // ---------- Ranking data for the selected age group ----------

  // The selected age group, plus the ones it carries on from (last year's squad, and so on). Only
  // the selected group is ever ranked; the rest are here so a squad's opponents keep showing up in
  // the name dropdown as it ages up.
  const chainGroupIds = useMemo(
    () => ageGroupChain(selectedAgeGroupId, ageGroups),
    [selectedAgeGroupId, ageGroups]
  );

  // Every League Standings season bundled into any age group on that chain, read fresh every
  // render — this view never writes back to League Standings data, only reads it.
  const chainLeagueSeasons = useMemo<{ ageGroupId: string; seasons: LeagueSeasonSnapshot[] }[]>(
    () =>
      chainGroupIds.map((ageGroupId) => ({
        ageGroupId,
        seasons: (ageGroups.find((g) => g.id === ageGroupId)?.seasonIds ?? []).map((seasonId) => ({
          seasonId,
          teams: loadTeamsForSeason(seasonId),
          matchups: loadMatchupsForSeason(seasonId),
          logs: loadLogsForSeason(seasonId),
        })),
      })),
    [ageGroups, chainGroupIds]
  );

  // The team roster this view reads from: the persisted scout roster, extended (in-memory, not yet
  // necessarily saved) with any league team names not already in it. Every read in this view uses
  // this — never the raw `scoutTeams` state directly — so a league team is usable immediately,
  // before any save has happened. The roster is threaded through the chain one group at a time so
  // the same club resolves to the same id whether it was first seen at 9U or at 10U.
  const merged = useMemo(() => {
    let teams = scoutTeams;
    const games: ScoutGame[] = [];
    chainLeagueSeasons.forEach((entry) => {
      const derived = deriveLeagueScoutGames(entry.ageGroupId, entry.seasons, teams);
      teams = derived.teams;
      games.push(...derived.games);
    });
    return { teams, games };
  }, [chainLeagueSeasons, scoutTeams]);

  // Everything on the chain — used only for name suggestions, never for ratings.
  const chainGames = useMemo(() => {
    const onChain = new Set(chainGroupIds);
    return [...merged.games, ...scoutGames.filter((game) => onChain.has(game.ageGroupId))];
  }, [merged.games, scoutGames, chainGroupIds]);

  const ageGroupGames = useMemo(
    () => chainGames.filter((game) => game.ageGroupId === selectedAgeGroupId),
    [chainGames, selectedAgeGroupId]
  );

  const leagueGameTeamIds = useMemo(
    () =>
      new Set(
        merged.games
          .filter((game) => game.ageGroupId === selectedAgeGroupId)
          .flatMap((game) => [game.teamAId, game.teamBId])
      ),
    [merged.games, selectedAgeGroupId]
  );

  // Only teams with a game in this age group are ranked here. The roster itself is shared across
  // age groups (so the same club stays one entity as it ages up), but a team logged under a
  // different age group doesn't appear in this ranking.
  const ageGroupTeams = useMemo(
    () => teamsInAgeGroup(selectedAgeGroupId, merged.teams, ageGroupGames),
    [selectedAgeGroupId, merged.teams, ageGroupGames]
  );

  const myTeamId = ageGroups.find((g) => g.id === selectedAgeGroupId)?.myTeamId;

  const rankings = useMemo(
    () => buildTeamRankings(selectedAgeGroupId, ageGroupTeams, ageGroupGames, myTeamId),
    [selectedAgeGroupId, ageGroupTeams, ageGroupGames, myTeamId]
  );

  const teamNameById = useMemo(
    () => new Map(merged.teams.map((team) => [team.id, team.name])),
    [merged.teams]
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
  const setMyTeam = (teamId: string) => {
    if (!selectedAgeGroupId) return;
    if (!scoutTeams.some((team) => team.id === teamId)) {
      persistTeams([...scoutTeams, ...merged.teams.filter((t) => t.id === teamId)]);
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

  const openTeam = openTeamId ? (merged.teams.find((t) => t.id === openTeamId) ?? null) : null;

  /**
   * Renaming onto a name that already exists merges the two teams, so a placeholder or a
   * misspelling can be routed to the real team rather than leaving its games stranded.
   */
  const renameTeam = async (teamId: string, nextName: string) => {
    const preview = renameScoutTeam(teamId, nextName, merged.teams, scoutGames);
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
      setOpenTeamId(preview.mergedInto.id);
      if (myTeamId === teamId) {
        persistAgeGroups(
          ageGroups.map((group) =>
            group.id === selectedAgeGroupId ? { ...group, myTeamId: preview.mergedInto!.id } : group
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
    let teams = merged.teams;
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
    () => teamNameSuggestions(selectedAgeGroupId, ageGroups, merged.teams, chainGames),
    [selectedAgeGroupId, ageGroups, merged.teams, chainGames]
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
            htmlFor="scout-age-group"
          >
            Ranking teams for
          </label>
          {ageGroups.length > 0 && (
            <select
              id="scout-age-group"
              value={selectedAgeGroupId}
              onChange={(event) => setSelectedAgeGroupId(event.target.value)}
              className="inline-flex rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
            >
              {ageGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
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
              <input
                type="text"
                value={groupNameInput}
                onChange={(event) => setGroupNameInput(event.target.value)}
                placeholder="e.g. 2027, 10U"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900"
              />
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
            {ageGroups.length === 0
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
          team={openTeam}
          allGames={chainGames}
          ageGroupId={selectedAgeGroupId}
          ageGroupName={selectedGroupName}
          teamNameById={teamNameById}
          fromLeague={leagueGameTeamIds.has(openTeam.id)}
          onRename={(nextName) => void renameTeam(openTeam.id, nextName)}
          onClose={() => setOpenTeamId(null)}
        />
      )}

      {importOpen && selectedAgeGroupId && (
        <ScheduleImportPanel
          ageGroupId={selectedAgeGroupId}
          ageGroupName={selectedGroupName}
          teams={merged.teams}
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
        <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">Full rankings</h2>
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
              {rankings.map((row) => (
                <tr key={row.teamId} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-3 font-black">#{row.rank}</td>
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
                    {!leagueGameTeamIds.has(row.teamId) && (
                      <button
                        type="button"
                        onClick={() => {
                          const team = merged.teams.find((t) => t.id === row.teamId);
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
              No teams yet for this age group.
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
