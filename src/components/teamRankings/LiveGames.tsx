import { useEffect, useMemo } from "react";
import { EMPTY_ADD_GAME_DRAFT, GamesSection } from "./GamesSection";
import { useLiveView } from "../../hooks/useLiveView";
import type { DecodedViews } from "../../lib/live/liveClient";
import { coerceGames, gamesKey, type GamesView } from "../../lib/live/views/gamesShape";
import type { LiveViewSource } from "../../hooks/useLiveBoard";
import { gamesWindowFor } from "../../lib/teamRankings/gamesWindow";
import { card } from "../../styles/tokens";

/** Lists decoded this page load, by fingerprint: going back to a page's Games is free. */
const decodedGames: DecodedViews<GamesView> = new Map();

/** Only for tests: forgets the lists decoded so far. */
export const forgetDecodedGames = (): void => decodedGames.clear();

const NOTHING_KEPT: ReadonlySet<string> = new Set();
const NO_TEAMS: [] = [];
const nothing = () => undefined;

/**
 * The Games tab on the cloud's board: the page's published list (`gamesShape.ts`), read through
 * the same checks as a board (`useLiveView`), drawn by Team Rankings' own tab with nothing on it to
 * change (`GamesSection` `readOnly`). Which games it lists first, today's, it works out on the
 * reader's own day, as the page does (`gamesWindowFor`). A list that cannot be read hands the page
 * to Team Rankings on this device's copy (`onCannot`), as the tab did before there were lists, and
 * so does asking to add a game (`onEditWanted`).
 *
 * Loaded only when the tab is opened, with the tab's own code.
 */
export default function LiveGames({
  source,
  year,
  pageId,
  groupName,
  today,
  onCannot,
  onEditWanted,
}: {
  source: LiveViewSource;
  year: number | undefined;
  pageId: string;
  groupName: string;
  today: string;
  onCannot: () => void;
  onEditWanted: () => void;
}) {
  const { view, failed } = useLiveView(source, gamesKey(year, pageId), coerceGames, decodedGames);
  useEffect(() => {
    if (failed) onCannot();
  }, [failed, onCannot]);
  const gamesWindow = useMemo(
    () => gamesWindowFor({ today, year, games: view?.games ?? [] }),
    [today, year, view]
  );

  if (!view)
    return (
      <div className={`${card} p-5`} role="status" aria-live="polite">
        <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
          Reading the cloud&apos;s games…
        </p>
      </div>
    );
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
      loggedGames={view.games}
      gamesWindow={gamesWindow}
      keep={NOTHING_KEPT}
      teamNameById={view.names}
      editingGameId={null}
      editScoreA=""
      editScoreB=""
      onEditScoreA={nothing}
      onEditScoreB={nothing}
      onStartEditScore={nothing}
      onSaveScore={nothing}
      onToggleExcluded={nothing}
      onRemoveGame={nothing}
      readOnly
      onEditWanted={onEditWanted}
    />
  );
}
