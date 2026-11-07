import type { GamesDropped } from "../components/teamRankings/PoolHealthView";
import { setClubAge } from "../lib/clubAge";
import { planClubAges } from "../lib/live/agePlan";
import { type AllKnown, retiredWithPicks } from "../lib/live/allKnown";
import type { PoolCommand } from "../lib/live/commands";
import type { CommandRun } from "../lib/live/runPoolCommand";
import { mintStandInId, takenOffSaid } from "../lib/notThisTeam";
import { readStoredSeason } from "../lib/storage";
import {
  type AgeGroup,
  ageGroupYear,
  ASK_MARGIN,
  filedTeamIds,
  gcLinkSquadYear,
  isScoutGamePlayed,
  normalizeState,
  type ScoutGame,
  type ScoutTeam,
} from "../lib/teamRankings";
import { withRetired } from "../lib/teamRankings/retiredIds";
import { createAgeGroupId } from "../lib/teamRankings/seasons";
import {
  loadNamedAges,
  loadRetiredIds,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
} from "../lib/teamRankingsStorage";
import type { WrongAgeClub } from "../lib/wrongAge";
import type { useConfirmation } from "./useConfirmation";
import type { useToast } from "./useToast";

/**
 * What Team Rankings changes about one team in the pool: the state it plays in; whether it is our
 * team on this page; a game of its, or the whole team, taken off this page, with an Undo that also
 * puts back the clubs a tidy took meanwhile; a GameChanger id taken off it; a game that was never
 * its own; the age it plays at, set or taken back; and games dropped. Each is one command to the
 * pool (`runCommand`) and one step to undo.
 *
 * TeamRankingsView.tsx did all of this among its other handlers. It moved here whole and is called
 * where it was.
 */
export type TeamEditsInputs = {
  ageGroups: AgeGroup[];
  allKnown: AllKnown;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  runCommand: (
    command: PoolCommand,
    options?: { quiet?: boolean; explains?: boolean }
  ) => CommandRun;
  scoutGames: ScoutGame[];
  scoutTeams: ScoutTeam[];
  selectedAgeGroupId: string;
  selectedGroupName: string;
  selectedYear: number | undefined;
  showToast: ReturnType<typeof useToast>["show"];
  teamNameById: Map<string, string>;
  wholePoolGames: ScoutGame[];
};

export function useTeamEdits({
  ageGroups,
  allKnown,
  requestConfirmation,
  runCommand,
  scoutGames,
  scoutTeams,
  selectedAgeGroupId,
  selectedGroupName,
  selectedYear,
  showToast,
  teamNameById,
  wholePoolGames,
}: TeamEditsInputs) {
  /**
   * Sets or clears the state a team plays in, which is what the state leaderboard files it under.
   * A team not in the pool at all is ignored rather than created.
   */
  const setTeamState = (teamId: string, nextState: string) => {
    const state = normalizeState(nextState);
    // A club League Standings made joins the roster with its state, and no other club with it:
    // the rest of the league's clubs have ids that hold only for the walk that made them.
    const adopt = scoutTeams.some((team) => team.id === teamId)
      ? undefined
      : allKnown.teams.find((team) => team.id === teamId);
    const run = runCommand({
      kind: "team.state",
      teamId,
      state: state ?? null,
      ...(adopt ? { adopt } : {}),
    });
    if (run.ok && run.writes.length > 0)
      showToast(state ? `Set to ${state}.` : "State cleared.", { tone: "success" });
    return run.ok;
  };

  /**
   * Marks (or unmarks) "our" team *for this age group only* — a club running a 9U and an 11U squad
   * at the same time needs one of each, and the old global flag could only hold one. The team is
   * persisted first so the mark survives even if it was only ever a league-derived name.
   */
  const setMyTeam = (teamId: string) => {
    if (!selectedAgeGroupId) return;
    const marked = ageGroups.find((group) => group.id === selectedAgeGroupId)?.myTeamId;
    const adopt = scoutTeams.some((team) => team.id === teamId)
      ? undefined
      : allKnown.teams.find((team) => team.id === teamId);
    runCommand({
      kind: "page.myTeam",
      ageGroupId: selectedAgeGroupId,
      teamId: marked === teamId ? null : teamId,
      ...(adopt ? { adopt } : {}),
    });
  };

  /**
   * Puts back every team the games an Undo writes name, or had a row filed against, that the roster
   * no longer has, from the roster as it stood when Remove was pressed.
   *
   * Two things take a team away between Remove and Undo. Remove team deletes the club itself when
   * nothing else holds it, and the Undo tested the roster captured at Remove, which still had the
   * club, so it was never written back: its games came back naming an id nobody held, rated for
   * no one, and neither a tidy nor a re-pull repaired them (a re-pull minted the club a new id).
   * And the tidy a removal sets off prunes a stand-in nothing stands on any more, so undoing a
   * game against one brought the game back and not its opponent. The roster is read now, not from
   * the render that showed the toast, so whatever else the tidy did is kept.
   */
  const rosterFor = (games: readonly ScoutGame[], before: readonly ScoutTeam[]): PoolCommand[] => {
    const roster = loadScoutTeams();
    const held = new Set(roster.map((team) => team.id));
    const named = filedTeamIds(games);
    games.forEach((game) => {
      named.add(game.teamAId);
      named.add(game.teamBId);
    });
    return before
      .filter((team) => named.has(team.id) && !held.has(team.id))
      .map((team, index) => ({ kind: "team.insert", team, at: roster.length + index }));
  };

  /**
   * Undoes a removal with its own inverse, which puts back exactly what it took and leaves every
   * change made since; then puts back the clubs a tidy pruned meanwhile that its games name
   * (`rosterFor`), read once the inverse has run, so a club it put back is not put back twice.
   */
  const undoRemoval = (inverse: PoolCommand, games: readonly ScoutGame[], before: ScoutTeam[]) => {
    if (!runCommand(inverse).ok) return;
    const missing = rosterFor(games, before);
    if (missing.length > 0) runCommand({ kind: "batch", commands: missing });
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
    const before = scoutTeams;
    const run = runCommand({ kind: "game.remove", year: selectedYear ?? null, gameIds: [game.id] });
    if (!run.ok) return;
    showToast("Game removed.", {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => undoRemoval(run.inverse, [game], before),
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
    // Every year, not the one on screen: a club with games in another season keeps its record,
    // and one a claimed row elsewhere was filed against stays for that row to go back to.
    const elsewhere = loadScoutGames().filter((game) => !isHere(game));
    const playedElsewhere =
      elsewhere.some((game) => game.teamAId === team.id || game.teamBId === team.id) ||
      filedTeamIds(elsewhere).has(team.id);
    const confirmed = await requestConfirmation({
      title: `Remove ${team.name}?`,
      message: `This removes the ${relatedGames.length === 1 ? "game" : `${relatedGames.length} games`} logged against them in ${selectedGroupName || "this age group"}.${
        playedElsewhere ? " Their games in other age groups stay." : ""
      }`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    const before = scoutTeams;
    const run = runCommand({
      kind: "club.leavePage",
      ageGroupId: selectedAgeGroupId,
      teamId: team.id,
    });
    if (!run.ok) return;
    // The ★ taken off with the club, and the club itself, come back with its games on Undo.
    showToast(`${team.name} removed.`, {
      tone: "undo",
      actionLabel: "Undo",
      onAction: () => undoRemoval(run.inverse, relatedGames, before),
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
    const run = runCommand({ kind: "team.unlinkGc", teamId, gcTeamId });
    if (run.ok && run.writes.length > 0)
      showToast("Unlinked from GameChanger.", { tone: "success" });
  };

  /**
   * The ids a club made on this page is minted under none of: those the pool let go of, and those
   * of the clubs League Standings picks that the pool no longer holds (`retiredWithPicks`), which
   * this device reads where it keeps League Standings.
   */
  const mintRetired = () => retiredWithPicks(loadRetiredIds(), readStoredSeason, scoutTeams);

  /**
   * "Not this team": a game a club has only because a name on another club's schedule was matched
   * to it, taken off the club onto the stand-in of the name (`game.notThisTeam`), in the year its
   * page is in, as storage files it, and with it every other game that club's schedules filed onto
   * it by the name (`takenWith`). The stand-in's id, where one has to be made, is minted against
   * the roster here, as the import mints one.
   */
  const notThisTeam = (teamId: string, game: ScoutGame) => {
    const club = scoutTeams.find((team) => team.id === teamId);
    if (!club) return;
    const year = ageGroupYear(ageGroups.find((group) => group.id === game.ageGroupId)) ?? null;
    const run = runCommand({
      kind: "game.notThisTeam",
      year,
      gameId: game.id,
      teamId,
      standInId: mintStandInId(
        club.name,
        withRetired(new Set(scoutTeams.map((team) => team.id)), mintRetired())
      ),
    });
    if (!run.ok || run.writes.length === 0) return;
    const opponent = teamNameById.get(game.teamAId === teamId ? game.teamBId : game.teamAId);
    // Every game the press took off, in whichever year: its Undo puts each one back as it was.
    const steps = run.inverse.kind === "batch" ? run.inverse.commands : [run.inverse];
    const taken = steps.flatMap((step) => (step.kind === "game.put" ? step.games : []));
    showToast(
      takenOffSaid(
        club.name,
        opponent,
        taken.map((each) => each.date)
      ),
      {
        tone: "undo",
        actionLabel: "Undo",
        onAction: () => runCommand(run.inverse),
      }
    );
  };

  /**
   * Files a pulled club at the age somebody says it plays at, and holds it there.
   *
   * The club's GameChanger ids in this year are pinned in the named ages (`NamedAge.pinned`), so a
   * later pull files its schedule at this level whatever GameChanger or the app's other rules say;
   * `setClubAge` moves what is already filed. The toast's undo puts back exactly what was there.
   *
   * In the year on screen, or in the one named: Pool health lists clubs in the squad year being
   * played, whichever year the board shows, and that year's games are read for the move. Answers
   * whether anything changed, so that list can drop the club.
   */
  const setTeamAge = (teamId: string, level: number, year = selectedYear): boolean => {
    if (year === undefined) return false;
    const games = year === selectedYear ? scoutGames : loadScoutGamesForYear(year);
    const pageId = createAgeGroupId();
    // What the change will move, for the toast; the command makes it (`club.age`).
    const change = setClubAge(
      { teams: scoutTeams, games, ageGroups },
      teamId,
      level,
      year,
      "you",
      undefined,
      pageId
    );
    if (!change) return false;
    const run = runCommand({
      kind: "club.age",
      year,
      teamId,
      level,
      at: new Date().toISOString(),
      pageId,
    });
    if (!run.ok) return false;
    const name = scoutTeams.find((team) => team.id === teamId)?.name ?? "The club";
    showToast(
      `${name} is ${level}U now${change.moved > 0 ? `: ${change.moved} of its games moved to ${change.page.name}` : ""}.`,
      { tone: "undo", actionLabel: "Undo", onAction: () => runCommand(run.inverse) }
    );
    return true;
  };

  /** Applies Pool health's evidence-backed age suggestions as one write and one undo. */
  const setTeamAges = async (clubs: readonly WrongAgeClub[]) => {
    const years = [...new Set(clubs.map((club) => club.year))].sort((a, b) => a - b);
    const confirmed = await requestConfirmation({
      title: `Approve age changes for ${clubs.length.toLocaleString()} ${clubs.length === 1 ? "club" : "clubs"}?`,
      message: `${clubs.length.toLocaleString()} ${clubs.length === 1 ? "club" : "clubs"} will be moved in squad ${
        years.length === 1 ? `year ${years[0]}` : `years ${years.join(", ")}`
      }. Each suggested level comes from the evidence displayed in Pool health. “It plays up/down” remains an individual opt-out.`,
      confirmLabel: "Approve all changes",
    });
    if (!confirmed) return null;

    const { commands, changedTeamIds, moved, failed } = planClubAges(
      { teams: scoutTeams, games: wholePoolGames, ageGroups },
      clubs.map((club) => ({ teamId: club.teamId, level: club.suggested, year: club.year })),
      new Date().toISOString(),
      createAgeGroupId()
    );
    const run = commands.length > 0 ? runCommand({ kind: "batch", commands }) : null;
    if (run && !run.ok) return null;
    const result = `${changedTeamIds.length.toLocaleString()} ${changedTeamIds.length === 1 ? "club" : "clubs"} moved to ${
      changedTeamIds.length === 1 ? "its" : "their"
    } suggested age groups; ${moved.toLocaleString()} ${moved === 1 ? "game" : "games"} refiled.`;
    const failure = failed
      ? ` ${failed.toLocaleString()} ${failed === 1 ? "club could" : "clubs could"} not be changed and remain in the review list.`
      : "";
    showToast(`${result}${failure}`, {
      ...(run?.ok
        ? {
            tone: "undo" as const,
            actionLabel: "Undo",
            onAction: () => runCommand(run.inverse),
          }
        : { tone: "error" as const }),
    });
    return { changedTeamIds, failed };
  };

  /**
   * Takes back an age set on the panel: the pins come off, and each of the club's ids goes back to
   * the level the app had filed it at, until a pull decides again. An id whose earlier level was
   * never known stays where it is, no longer marked as set by you, for the next pull to decide.
   */
  const clearTeamAge = (teamId: string) => {
    if (selectedYear === undefined) return;
    const club = scoutTeams.find((team) => team.id === teamId);
    const ids = (club?.gcTeams ?? [])
      .filter((link) => gcLinkSquadYear(link, ageGroups) === selectedYear)
      .map((link) => link.teamId);
    const pinned = loadNamedAges();
    const back = new Set<number>();
    ids.forEach((id) => {
      const entry = pinned.get(id);
      if (entry?.pinned) back.add(entry.was ?? entry.level);
    });
    const run = runCommand({
      kind: "club.ageClear",
      year: selectedYear,
      teamId,
      pageId: createAgeGroupId(),
    });
    if (!run.ok) return;
    const unknown = ids.some((id) => pinned.get(id)?.pinned && pinned.get(id)?.was === undefined);
    const levels = [...back.keys()].sort((a, b) => a - b).map((level) => `${level}U`);
    const name = club?.name ?? "The club";
    showToast(
      unknown || levels.length === 0
        ? `${name} is the app's to age again at its next pull.`
        : levels.length === 1
          ? `${name} is back at ${levels[0]}, where the app had it.`
          : `${name} is back where the app had it: ${levels.join(" and ")}.`
    );
  };

  /**
   * The "same team as" the pull can only ever propose. Folding is confirmed first because it moves
   * every game and removes an entry, and a wrong one is tedious to undo by hand.
   */
  /** Answers whether the fold happened, so a list offering several can drop just the one. */
  /**
   * Throws out rows that carry a score on a day that has not happened, and remembers them.
   *
   * The tombstones go down before the games do: a pull that starts between the two writes would
   * otherwise file them straight back, and the list is much the cheaper of the two to write. What
   * it costs is that a refused pool write leaves the rows tombstoned but present — the next tidy
   * or pull settles that, and it is the safer way round.
   */
  const dropGames = async (
    ids: readonly string[],
    why: GamesDropped = "ahead"
  ): Promise<boolean> => {
    if (ids.length === 0) return false;
    const games = `${ids.length.toLocaleString()} game${ids.length === 1 ? "" : "s"}`;
    const confirmed = await requestConfirmation({
      title: `Delete ${games}?`,
      message: `${
        why === "ahead"
          ? "Each one carries a score on a date still to come, so it cannot be a result."
          : `Each one has a side winning by ${ASK_MARGIN} runs or more, which you have not said was played that way.`
      } The rows that carried those scores are remembered by their GameChanger id, so pulling those schedules again will not bring them back.`,
      confirmLabel: "Delete them",
    });
    if (!confirmed) return false;
    if (!runCommand({ kind: "games.drop", gameIds: [...ids] }).ok) return false;
    showToast(
      `Deleted ${games} ${why === "ahead" ? "dated ahead" : `won by ${ASK_MARGIN} or more`}.`,
      { tone: "success" }
    );
    return true;
  };

  return {
    clearTeamAge,
    dropGames,
    hasGamesFiledHere,
    mintRetired,
    notThisTeam,
    removeGame,
    removeTeamById,
    setMyTeam,
    setTeamAge,
    setTeamAges,
    setTeamState,
    unlinkGc,
  };
}
