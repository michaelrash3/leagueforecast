import type { Dispatch, SetStateAction } from "react";
import { type AddGameDraft, EMPTY_ADD_GAME_DRAFT } from "../components/teamRankings/addGameDraft";
import type { AllKnown } from "../lib/live/allKnown";
import type { PoolCommand } from "../lib/live/commands";
import { addOfNamed } from "../lib/live/namedAdd";
import type { CommandRun } from "../lib/live/runPoolCommand";
import {
  findDuplicateGame,
  isScoutGamePlayed,
  resolveOrCreateTeam,
  type ScoutGame,
  type ScoutTeam,
  typedScores,
} from "../lib/teamRankings";
import type { NamedGame } from "../lib/teamRankings/namedGames";
import { mintedIds } from "../lib/teamRankings/retiredIds";
import type { useConfirmation } from "./useConfirmation";
import type { useFindTeam } from "./useFindTeam";
import type { useTeamEdits } from "./useTeamEdits";
import type { useToast } from "./useToast";

/**
 * The games Team Rankings takes by hand: one added on the form, once both teams are named and the
 * scores are both given or both left blank; a reviewed batch imported by its clubs' names; a game
 * kept in the log but left out of the rating, or put back; and a score entered for a game not yet
 * played. Each is one command to the pool, with the heals of the clubs it names. Only a batch
 * imported offers an Undo, on its toast; a game left out is put back with the same control.
 *
 * TeamRankingsView.tsx did all of this among its other handlers. It moved here whole and is called
 * where it was.
 */
export type PoolGameEntryInputs = {
  ageGroupGames: ScoutGame[];
  allKnown: AllKnown;
  editScoreA: string;
  editScoreB: string;
  gameDraft: AddGameDraft;
  heldHeals: ReturnType<typeof useFindTeam>["heldHeals"];
  mintRetired: ReturnType<typeof useTeamEdits>["mintRetired"];
  noteAdded: (ids: string[]) => void;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  runCommand: (
    command: PoolCommand,
    options?: { quiet?: boolean; explains?: boolean }
  ) => CommandRun;
  scoutTeams: ScoutTeam[];
  selectedAgeGroupId: string;
  selectedYear: number | undefined;
  setEditingGameId: Dispatch<SetStateAction<string | null>>;
  setEditScoreA: Dispatch<SetStateAction<string>>;
  setEditScoreB: Dispatch<SetStateAction<string>>;
  setGameDraft: Dispatch<SetStateAction<AddGameDraft>>;
  setImportOpen: Dispatch<SetStateAction<boolean>>;
  showToast: ReturnType<typeof useToast>["show"];
  teamNameById: Map<string, string>;
  withHeals: ReturnType<typeof useFindTeam>["withHeals"];
};

export function usePoolGameEntry({
  ageGroupGames,
  allKnown,
  editScoreA,
  editScoreB,
  gameDraft,
  heldHeals,
  mintRetired,
  noteAdded,
  requestConfirmation,
  runCommand,
  scoutTeams,
  selectedAgeGroupId,
  selectedYear,
  setEditingGameId,
  setEditScoreA,
  setEditScoreB,
  setGameDraft,
  setImportOpen,
  showToast,
  teamNameById,
  withHeals,
}: PoolGameEntryInputs) {
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
    // Against the clubs here and every id the pool let go of, so neither name takes a folded
    // club's id (`retiredIds.ts`), nor one a League Standings pick names (`mintRetired`).
    const ids = mintedIds(
      teams.map((team) => team.id),
      mintRetired()
    );
    const a = resolveOrCreateTeam(gameDraft.teamAName, teams, ids);
    teams = a.teams;
    const b = resolveOrCreateTeam(gameDraft.teamBName, teams, ids);
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

    // The roster takes only the clubs this game names that it does not hold yet: one typed for
    // the first time, or one League Standings made. Every other club League Standings made stays
    // out of it, its id holding only for the walk that minted it.
    const held = new Set(scoutTeams.map((team) => team.id));
    const named = new Set([newGame.teamAId, newGame.teamBId]);
    const adopt = teams.filter((team) => !held.has(team.id) && named.has(team.id));
    const add: PoolCommand = {
      kind: "game.add",
      year: selectedYear ?? null,
      games: [newGame],
      adopt,
    };
    if (!runCommand(withHeals(heldHeals(teams, named), add)).ok) return;
    noteAdded([newGame.id]);
    setGameDraft(EMPTY_ADD_GAME_DRAFT);
    showToast(scoresBothValid ? "Game added." : "Added to schedule.", { tone: "success" });
  };

  /**
   * Commits a reviewed batch of imported games, by their clubs' names. The panel has dropped
   * anything already logged here; the names are resolved here as the server resolves the live
   * page's (`addOfNamed`), so they arrive age-free and linked to the clubs they name, and the lot is
   * saved with an undo.
   */
  const importGames = (named: NamedGame[]) => {
    const add = addOfNamed({
      year: selectedYear ?? null,
      page: selectedAgeGroupId,
      named,
      known: allKnown.teams,
      roster: scoutTeams,
      retired: mintRetired(),
    });
    const run = runCommand(add);
    if (!run.ok) return;
    const newGames = named.map((game) => game.id);
    noteAdded(newGames);
    setImportOpen(false);
    // Undo takes the games back out, and the clubs they brought with them.
    showToast(
      `Added ${newGames.length.toLocaleString()} game${newGames.length === 1 ? "" : "s"}.`,
      {
        tone: "undo",
        actionLabel: "Undo",
        onAction: () => runCommand(run.inverse),
      }
    );
  };

  /**
   * Keeps a game in the log but out of the maths, or puts it back. Fall tournaments pair a team
   * against the age above or below depending on who entered; those results are real and worth
   * having, but they say nothing about how a team stacks up inside its own age group.
   */
  const toggleGameExcluded = (game: ScoutGame) => {
    const excluded = game.excluded !== true;
    const run = runCommand({
      kind: "game.exclude",
      year: selectedYear ?? null,
      gameId: game.id,
      excluded,
    });
    if (run.ok)
      showToast(excluded ? "Game no longer counts." : "Game counts again.", { tone: "success" });
  };

  const startEditScore = (gameId: string) => {
    setEditingGameId(gameId);
    setEditScoreA("");
    setEditScoreB("");
  };

  const saveGameScore = (gameId: string) => {
    const typed = typedScores(editScoreA, editScoreB);
    if (!typed) {
      showToast("Enter two scores, in whole runs.", { tone: "error" });
      return;
    }
    if (!runCommand({ kind: "game.score", year: selectedYear ?? null, gameId, ...typed }).ok)
      return;
    setEditingGameId(null);
    setEditScoreA("");
    setEditScoreB("");
    showToast("Score saved.", { tone: "success" });
  };

  return { addGame, addGameValid, importGames, saveGameScore, startEditScore, toggleGameExcluded };
}
