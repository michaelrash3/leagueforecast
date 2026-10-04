import { useEffect, useMemo, useState } from "react";
import { EMPTY_ADD_GAME_DRAFT, GamesSection } from "./GamesSection";
import type { Confirmation } from "../../hooks/useConfirmation";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import { useLiveView } from "../../hooks/useLiveView";
import { overlayGames } from "../../lib/live/gamesOverlay";
import type { DecodedViews } from "../../lib/live/liveClient";
import {
  coerceGames,
  findListed,
  gamesKey,
  seenAs,
  type GameSeen,
  type GamesView,
} from "../../lib/live/views/gamesShape";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import {
  isScoutGamePlayed,
  typedScores,
  type AgeGroup,
  type ScoutGame,
} from "../../lib/teamRankings";
import { gamesWindowFor } from "../../lib/teamRankings/gamesWindow";
import { card } from "../../styles/tokens";

/** Lists decoded this page load, by fingerprint: going back to a page's Games is free. */
const decodedGames: DecodedViews<GamesView> = new Map();

/**
 * The games the server has named this page load, by list (`gamesKey`): each id with where its list
 * showed the game and how. Kept apart from the tab, and found again in each list by what it shows
 * (`findListed`), so the edits drawn over a list still find their games in a list published since
 * (of other changes, before the one that carries the edit), after the tab is opened again, or back
 * on the page from another: kept in the tab, with the list they were named in, they were let go
 * with it, and an edit made stopped being drawn until its publish was out.
 */
const named = new Map<string, ReadonlyMap<string, { at: number; seen: GameSeen }>>();

/** Only for tests: forgets the lists decoded so far, and the games named in them. */
export const forgetDecodedGames = (): void => {
  decodedGames.clear();
  named.clear();
};

const NOTHING_KEPT: ReadonlySet<string> = new Set();
const NO_TEAMS: [] = [];
const NO_GAMES: readonly ScoutGame[] = [];
const NO_IDS: ReadonlyMap<string, string> = new Map();
const nothing = () => undefined;

/** Said when the server finds no game the list showed as it was shown. */
export const GAME_MOVED = "That game is no longer as this list shows it, so nothing was changed.";

/** A list's games with the ids the server named for some of them in place of their places. */
const withIds = (games: ScoutGame[], ids: ReadonlyMap<string, string>): readonly ScoutGame[] =>
  ids.size === 0
    ? games
    : games.map((game) => {
        const id = ids.get(game.id);
        return id ? { ...game, id } : game;
      });

/**
 * The Games tab on the cloud's board: the page's published list (`gamesShape.ts`), read through
 * the same checks as a board (`useLiveView`), drawn by Team Rankings' own tab (`GamesSection`).
 * Which games it lists first, today's, it works out on the reader's own day, as the page does
 * (`gamesWindowFor`). A list that cannot be read hands the page to Team Rankings on this device's
 * copy (`onCannot`), as the tab did before there were lists, and so does asking to add a game
 * (`onEditWanted`).
 *
 * Each game's own buttons are the device's (1.5): a score typed, a game kept out of the maths or
 * put back, a game removed (asked first, with an Undo), each sent to the edit function as the edit
 * the device makes, and drawn over the list until a publish carries it (`overlayGames`, by the
 * command the server runs). The list names its games by their places in it, not their ids, so the
 * id of a game about to be edited is asked of the server first, by its place and what the list
 * shows of it (`games.find`), and kept for the list it was asked of: the game is then that id on
 * screen, which is what the edits drawn over the list name it by.
 *
 * Loaded only when the tab is opened, with the tab's own code.
 */
export default function LiveGames({
  source,
  year,
  pageId,
  groupName,
  today,
  groups,
  edits,
  confirm,
  onCannot,
  onEditWanted,
}: {
  source: LiveViewSource;
  year: number | undefined;
  pageId: string;
  groupName: string;
  today: string;
  /** The cloud's pages, which say what year each game is filed in. */
  groups: readonly AgeGroup[];
  edits: LiveEdits;
  confirm: Confirmation["request"];
  onCannot: () => void;
  onEditWanted: () => void;
}) {
  const { view, failed } = useLiveView(source, gamesKey(year, pageId), coerceGames, decodedGames);
  useEffect(() => {
    if (failed) onCannot();
  }, [failed, onCannot]);
  const { pending, edit, ask, say } = edits;
  const squadYear = year ?? null;
  const listKey = gamesKey(year, pageId);
  // The games of this list the server has named: a new map each time it names one, which a
  // render is asked for (`setNamings`) so the list is drawn again with its id.
  const held = named.get(listKey);
  const [, setNamings] = useState(0);
  // The ids the server has named for games of the list on screen, by their places in it.
  const ids = useMemo(() => {
    if (!view || !held) return NO_IDS;
    const byPlace = new Map<string, string>();
    held.forEach(({ at, seen }, gameId) => {
      const place = findListed(view.games, at, seen);
      if (place !== null) byPlace.set(place, gameId);
    });
    return byPlace;
  }, [view, held]);
  const games = useMemo(
    () =>
      view
        ? overlayGames(
            withIds(view.games, ids),
            groups,
            squadYear,
            pending.map(({ command }) => command)
          )
        : NO_GAMES,
    [view, ids, groups, squadYear, pending]
  );
  const shownGames = useMemo(() => [...games], [games]);
  const gamesWindow = useMemo(() => gamesWindowFor({ today, year, games }), [today, year, games]);

  /*
   * The game whose score is being typed, and what is typed, as the device's tab holds them: for
   * the list it was opened on. A game not yet named is its place in the list, and a list published
   * since, or another page's, has another game at that place, which the box then sat on and the
   * typed score was saved to.
   */
  const [editing, setEditing] = useState<{ of: GamesView | null; id: string } | null>(null);
  const editingGameId = editing && editing.of === view ? editing.id : null;
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const startEditScore = (gameId: string) => {
    setEditing({ of: view, id: gameId });
    setScoreA("");
    setScoreB("");
  };

  if (!view)
    return (
      <div className={`${card} p-5`} role="status" aria-live="polite">
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
          Reading the cloud&apos;s games…
        </p>
      </div>
    );

  const names = view.names;
  const listed = view;
  /**
   * The id of a game on screen: its own, once the server has named it, or asked of the server by
   * its place in the list and what the list shows of it; null once it has been said why there is
   * none.
   */
  const idOf = async (game: ScoutGame): Promise<string | null> => {
    const at = listed.games.findIndex((one) => one.id === game.id);
    const shown = listed.games[at];
    if (at < 0 || !shown) return game.id;
    const seen = seenAs(shown);
    const answer = await ask({ kind: "games.find", year: squadYear, page: pageId, at, game: seen });
    if (!answer) return null;
    const { gameId } = answer;
    if (gameId === null) {
      say(GAME_MOVED);
      return null;
    }
    named.set(listKey, new Map(named.get(listKey)).set(gameId, { at, seen }));
    setNamings((times) => times + 1);
    // The score being typed follows the game to its id.
    setEditing((was) =>
      was && was.of === listed && was.id === game.id ? { of: listed, id: gameId } : was
    );
    return gameId;
  };
  const saveScore = async (shownId: string) => {
    const typed = typedScores(scoreA, scoreB);
    const game = games.find((one) => one.id === shownId);
    if (!typed) {
      say("Enter two scores, in whole runs.");
      return;
    }
    const gameId = game ? await idOf(game) : null;
    if (!gameId) return;
    const made = await edit(
      { kind: "game.score", year: squadYear, gameId, ...typed },
      { done: "Score saved." }
    );
    if (made) setEditing(null);
  };
  const toggleExcluded = async (game: ScoutGame) => {
    const excluded = game.excluded !== true;
    const gameId = await idOf(game);
    if (!gameId) return;
    void edit(
      { kind: "game.exclude", year: squadYear, gameId, excluded },
      { done: excluded ? "Game no longer counts." : "Game counts again." }
    );
  };
  const removeGame = async (game: ScoutGame) => {
    const teamA = names.get(game.teamAId) ?? "?";
    const teamB = names.get(game.teamBId) ?? "?";
    const confirmed = await confirm({
      title: "Remove this game?",
      message: isScoutGamePlayed(game)
        ? `${teamA} ${game.teamAScore} – ${teamB} ${game.teamBScore}`
        : `${teamA} vs ${teamB} (scheduled, no score yet)`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;
    const gameId = await idOf(game);
    if (!gameId) return;
    void edit(
      { kind: "game.remove", year: squadYear, gameIds: [gameId] },
      { done: "Game removed.", undo: true }
    );
  };

  return (
    <GamesSection
      groupName={groupName}
      ageGroupId={pageId}
      hasAgeGroups
      draft={EMPTY_ADD_GAME_DRAFT}
      onDraftChange={nothing}
      teamNameOptions={NO_TEAMS}
      myTeamName=""
      addGameValid={false}
      onAddGame={nothing}
      onGoToImport={onEditWanted}
      importOpen={false}
      onOpenImport={nothing}
      onCloseImport={nothing}
      allTeams={NO_TEAMS}
      suggestedTeams={NO_TEAMS}
      existingGames={NO_TEAMS}
      onImportGames={nothing}
      showToast={nothing}
      loggedGames={shownGames}
      gamesWindow={gamesWindow}
      keep={NOTHING_KEPT}
      teamNameById={names}
      editingGameId={editingGameId}
      editScoreA={scoreA}
      editScoreB={scoreB}
      onEditScoreA={setScoreA}
      onEditScoreB={setScoreB}
      onStartEditScore={startEditScore}
      onSaveScore={(gameId) => void saveScore(gameId)}
      onToggleExcluded={(game) => void toggleExcluded(game)}
      onRemoveGame={(game) => void removeGame(game)}
      readOnly
      onEditWanted={onEditWanted}
    />
  );
}
