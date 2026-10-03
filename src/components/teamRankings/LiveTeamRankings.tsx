import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveBoard, type LiveSources } from "../../hooks/useLiveBoard";
import { useRankingsPages } from "../../hooks/useRankingsPages";
import { poolWantsCloud, preparePool, type CloudStatus } from "../../lib/cloud/cloudSession";
import { todayIsoDay } from "../../lib/date";
import { holdLiveBoard, type RankingsHandover } from "../../lib/live/liveBoard";
import { liveLabel } from "../../lib/live/liveLabel";
import { lastWeekOf, withMine } from "../../lib/live/views/boardShape";
import { myTeamGlance } from "../../lib/myTeamGlance";
import { movementOf } from "../../lib/rankMovement";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { ageGroupLevel, segmentLabel } from "../../lib/teamRankings/seasons";
import {
  clubsOfBoard,
  defaultStateOf,
  placesOf,
  unknownStateCountOf,
  unrankedLevelNoteFor,
} from "../../lib/teamRankings/boardDisplay";
import { filterRankingsByState, statesInUse } from "../../lib/teamRankings/names";
import { loadAgeGroups } from "../../lib/teamRankingsStorage";
import { button, card } from "../../styles/tokens";
import { CloudPoolGate } from "../CloudPoolGate";
import { RankingsHeader } from "./RankingsHeader";
import { NATIONAL_TOP, RankingsSection, STATE_TOP } from "./RankingsSection";
import { SECTION_PANEL_ID, sectionTabId } from "./SectionNav";

/**
 * How long the page waits for a board to draw before it goes to this device's copy the old way:
 * the time the cloud's own start is given (`STARTUP_WAIT_MS`).
 */
export const LIVE_WAIT_MS = 4_000;
/** How long with no tap, key or scroll before the board hands over to this device's own copy. */
export const QUIET_MS = 1_000;

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * Team Rankings opened on the cloud's published board (`useLiveBoard`), for a member who turned
 * it on in the Cloud panel: the board the server built, drawn as the page draws it, while this
 * device's copy of the pool is brought in and Team Rankings' own code loads behind it.
 *
 * The board is a stand-in, never the answer. It is handed over to Team Rankings on this device's
 * copy (`renderPage`) once it is drawn, the pool is in, the page's code is loaded, and a second has
 * passed with nobody touching the screen; and at once for anything it cannot do (a team opened, a
 * search, another area of the page) or a board it should not stand in for: none published for the
 * page, one this build cannot read or check, or one built before changes the copy or this device
 * has since made. The page then opens where the board left off, on the same rows (`liveBoard.ts`),
 * until its own fit replaces them. Once handed over it stays handed over.
 */
export function LiveTeamRankings({
  status,
  renderPage,
  preloadPage,
  sources,
  waitMs = LIVE_WAIT_MS,
  quietMs = QUIET_MS,
}: {
  status: CloudStatus;
  /** Team Rankings on this device's own copy, opened where the board left off. */
  renderPage: (handover: RankingsHandover) => ReactNode;
  /** Loads Team Rankings' code, so it is there by the time the board hands over. */
  preloadPage: () => Promise<unknown>;
  sources?: LiveSources;
  /** `LIVE_WAIT_MS` and `QUIET_MS`, but for a test. */
  waitMs?: number;
  quietMs?: number;
}) {
  const today = todayIsoDay();
  const [ageGroups] = useState(() => loadAgeGroups());
  const {
    section,
    selectedAgeGroupId,
    selectedYear,
    groupsInYear,
    yearChoices,
    routeSegment,
    calendarSegment,
    openPage,
    openSection,
    openSegment,
    openYear,
    defaultAge,
    setDefaultAge,
  } = useRankingsPages(ageGroups, today);
  const live = useLiveBoard({
    pageId: selectedAgeGroupId,
    year: selectedYear,
    routeSegment,
    calendarSegment,
    ...(sources ? { sources } : {}),
  });

  const [handover, setHandover] = useState<RankingsHandover | null>(null);
  const [stateTop, setStateTop] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [poolReady, setPoolReady] = useState(() => !poolWantsCloud());
  const [pageLoaded, setPageLoaded] = useState(false);
  const [waitedOut, setWaitedOut] = useState(false);

  // The pool and the page's code come in under the board; the board has a while to draw.
  useEffect(() => {
    let alive = true;
    if (poolWantsCloud())
      void preparePool().finally(() => {
        if (alive) setPoolReady(true);
      });
    const loaded = () => {
      if (alive) setPageLoaded(true);
    };
    void preloadPage().then(loaded, loaded);
    const timer = setTimeout(() => {
      if (alive) setWaitedOut(true);
    }, waitMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [preloadPage, waitMs]);

  const myTeamId = ageGroups.find((group) => group.id === selectedAgeGroupId)?.myTeamId;
  const board = live.board;
  const rows = useMemo(() => (board ? withMine(board.view.rows, myTeamId) : []), [board, myTeamId]);
  // Last week's places, as the page's arrows read them, and the page's own club's rank line.
  const lastWeek = useMemo(() => (board ? lastWeekOf(board.view) : null), [board]);
  const rankHistory =
    board?.view.history && board.view.history.teamId === myTeamId
      ? board.view.history.points
      : undefined;
  const boardMovement = useCallback(
    (row: ScoutRankingRow) => movementOf(row.teamId, row.overallRank ?? row.rank, lastWeek),
    [lastWeek]
  );

  // The board on screen is the one Team Rankings opens on, whenever it hands over.
  useEffect(() => {
    if (board)
      holdLiveBoard(
        { ageGroupId: selectedAgeGroupId, ...(live.segment ? { segment: live.segment } : {}) },
        board.view.rows
      );
  }, [board, selectedAgeGroupId, live.segment]);

  /*
   * Why the page cannot wait for a quiet moment: an area the board does not draw, no page, a meta
   * or board that will not do, nothing drawn in the time allowed, or a board built before changes
   * it does not have. An offline read keeps whatever board was drawn from this device's own keep.
   */
  const offline =
    live.metaMiss === "offline" ||
    live.metaMiss === "no-reader" ||
    live.boardMiss === "offline" ||
    live.link === "cut-off";
  const handOverNow =
    section !== "rankings" ||
    !selectedAgeGroupId ||
    (live.metaMiss !== null && !offline) ||
    (live.boardMiss !== null && live.boardMiss !== "offline") ||
    (offline && !board) ||
    (waitedOut && !board) ||
    live.standing === "behind-copy" ||
    live.standing === "owed";
  const where: RankingsHandover = { stateTop, stateFilter, showAll };
  if (handOverNow && !handover) setHandover(where);

  const handOverWith = (extra: RankingsHandover) => setHandover({ ...where, ...extra });

  // A second with nobody touching the screen, once the board, the pool and the page's code are in.
  const settled = board !== null && poolReady && pageLoaded && handover === null;
  useEffect(() => {
    if (!settled) return;
    const quietly = () => setHandover({ stateTop, stateFilter, showAll });
    let timer = setTimeout(quietly, quietMs);
    const restart = () => {
      clearTimeout(timer);
      timer = setTimeout(quietly, quietMs);
    };
    INPUT_EVENTS.forEach((type) =>
      window.addEventListener(type, restart, { capture: true, passive: true })
    );
    return () => {
      clearTimeout(timer);
      INPUT_EVENTS.forEach((type) => window.removeEventListener(type, restart, { capture: true }));
    };
  }, [settled, stateTop, stateFilter, showAll, quietMs]);

  const clubs = useMemo(() => clubsOfBoard(rows), [rows]);
  const places = useMemo(() => placesOf(clubs), [clubs]);
  const availableStates = useMemo(() => statesInUse(clubs), [clubs]);
  const defaultState = useMemo(() => defaultStateOf(clubs, myTeamId), [clubs, myTeamId]);
  const shownState = stateTop === null ? defaultState : stateTop;
  const stateTopRows = useMemo(
    () => (shownState ? filterRankingsByState(rows, clubs, shownState).slice(0, STATE_TOP) : []),
    [rows, clubs, shownState]
  );
  const visibleRankings = useMemo(
    () => filterRankingsByState(rows, clubs, stateFilter),
    [rows, clubs, stateFilter]
  );
  const stateById = useMemo(() => new Map(clubs.map((club) => [club.id, club.state])), [clubs]);
  const leagueIds = useMemo(
    () => new Set((board?.view.rows ?? []).filter((row) => row.league).map((row) => row.teamId)),
    [board]
  );
  const myTeam = useMemo(
    () => myTeamGlance(rows, myTeamId, (teamId) => stateById.get(teamId), [], lastWeek),
    [rows, myTeamId, stateById, lastWeek]
  );

  const counts = (live.meta && live.meta.pages.halves[selectedAgeGroupId]) ?? {
    fall: 0,
    spring: 0,
  };
  const segment = live.segment;
  const meta = live.meta?.meta;
  const label = meta
    ? liveLabel({
        check: offline ? "offline" : board?.checked ? "checked" : "checking",
        standing: live.standing,
        rules: meta.built["board:"]?.rules,
        boardDay: meta.today,
        today,
        heardAt: live.heardAt,
      })
    : undefined;
  const group = ageGroups.find((one) => one.id === selectedAgeGroupId);

  const view = (strip?: ReactNode) => (
    <div className="flex flex-col gap-6" data-testid="live-board">
      <RankingsHeader
        pulledAt={live.meta?.pages.pulledAt ?? null}
        defaultAge={defaultAge}
        onSetDefaultAge={setDefaultAge}
        ageGroups={ageGroups}
        section={section}
        selectedYear={selectedYear}
        selectedAgeGroupId={selectedAgeGroupId}
        groupsInYear={groupsInYear}
        yearChoices={yearChoices}
        selectedSegment={segment}
        segmentGames={counts}
        onOpenSegment={openSegment}
        onOpenYear={openYear}
        onOpenPage={openPage}
        onOpenSection={openSection}
      />
      {strip}
      <div
        id={SECTION_PANEL_ID}
        role="tabpanel"
        aria-labelledby={sectionTabId(section)}
        className="flex flex-col gap-6"
      >
        {board ? (
          <RankingsSection
            groupName={group?.name ?? ""}
            searchOptions={[]}
            onSearchTeam={() => undefined}
            onSearchWanted={() => handOverWith({ focusSearch: true })}
            hasAgeGroups={ageGroups.length > 0}
            unrankedLevelNote={unrankedLevelNoteFor(selectedAgeGroupId, ageGroupLevel(group))}
            segment={
              segment === undefined || selectedYear === undefined
                ? null
                : {
                    name: segmentLabel(selectedYear, segment),
                    played: counts[segment],
                    otherName: segmentLabel(selectedYear, segment === "fall" ? "spring" : "fall"),
                    otherPlayed: counts[segment === "fall" ? "spring" : "fall"],
                  }
            }
            rankings={rows}
            rankingsStale={false}
            {...(label ? { standInNote: label } : {})}
            nationalTop={rows.slice(0, NATIONAL_TOP)}
            stateTopRows={stateTopRows}
            visibleRankings={visibleRankings}
            availableStates={availableStates}
            shownState={shownState}
            onShownStateChange={setStateTop}
            unknownStateCount={unknownStateCountOf(clubs)}
            stateFilter={stateFilter}
            onStateFilterChange={setStateFilter}
            showAll={showAll}
            onToggleShowAll={() => setShowAll((shown) => !shown)}
            placeOf={(teamId) => places.get(teamId)}
            isLeagueTeam={(teamId) => leagueIds.has(teamId)}
            hasGamesFiledHere={() => false}
            onOpenTeam={(teamId) => handOverWith({ openTeamId: teamId })}
            onMarkMine={() => undefined}
            onRemoveTeam={() => undefined}
            readOnly
            myTeam={myTeam}
            myTeamNextPending
            {...(rankHistory ? { rankHistory } : {})}
            movementOf={boardMovement}
          />
        ) : (
          <div className={`${card} p-5`} role="status" aria-live="polite">
            <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
              Reading the cloud&apos;s board…
            </p>
          </div>
        )}
      </div>
    </div>
  );

  if (handover === null) return view();
  return (
    <CloudPoolGate
      status={status}
      {...(board
        ? {
            waiting: ({ done, total }: { done: number; total: number }, skip: () => void) =>
              view(
                <div
                  className={`${card} flex flex-wrap items-center justify-between gap-3 p-3`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    {total > 0
                      ? `Loading this device's copy… ${done} of ${total}`
                      : "Loading this device's copy…"}
                  </span>
                  <button type="button" onClick={skip} className={button.ghost}>
                    Show this device&apos;s copy now
                  </button>
                </div>
              ),
          }
        : {})}
    >
      {renderPage(handover)}
    </CloudPoolGate>
  );
}
