import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveBoard, type LiveSources } from "../../hooks/useLiveBoard";
import { useLiveSearch } from "../../hooks/useLiveSearch";
import { useRankingsPages } from "../../hooks/useRankingsPages";
import { poolWantsCloud, preparePool, type CloudStatus } from "../../lib/cloud/cloudSession";
import { todayIsoDay } from "../../lib/date";
import { whereIsGcId } from "../../lib/gcIdWhereabouts";
import { forgetLiveBoard, holdLiveBoard, type RankingsHandover } from "../../lib/live/liveBoard";
import { liveLabel } from "../../lib/live/liveLabel";
import { lastWeekOf, withMine } from "../../lib/live/views/boardShape";
import { myTeamGlance } from "../../lib/myTeamGlance";
import { movementOf } from "../../lib/rankMovement";
import type { AgeGroup, ScoutRankingRow } from "../../lib/teamRankings";
import { ageGroupLevel, segmentLabel } from "../../lib/teamRankings/seasons";
import {
  clubsOfBoard,
  defaultStateOf,
  placesOf,
  unknownStateCountOf,
  unrankedLevelNoteFor,
} from "../../lib/teamRankings/boardDisplay";
import { filterRankingsByState, statesInUse } from "../../lib/teamRankings/names";
import { coerceAgeGroups, loadAgeGroups } from "../../lib/teamRankingsStorage";
import { button, card } from "../../styles/tokens";
import { CloudPoolGate } from "../CloudPoolGate";
import { warmTeamSearch } from "../TeamSearchSelect";
import { RankingsHeader } from "./RankingsHeader";
import { NATIONAL_TOP, RankingsSection, STATE_TOP } from "./RankingsSection";
import { SECTION_PANEL_ID, sectionTabId } from "./SectionNav";
import { TEAM_PANEL_ID } from "../teamPanelId";

/** A club's panel from its card, loaded with the pool's codec only when a club is opened. */
const LiveClubPanel = lazy(() => import("./LiveClubPanel"));
/** The Games tab from its page's list, loaded with the tab's code only when the tab is opened. */
const LiveGames = lazy(() => import("./LiveGames"));
/** The Scouting tab from the board and club cards, loaded only when the tab is opened. */
const LiveScouting = lazy(() => import("./LiveScouting"));

/**
 * How long the page waits for a board to draw before it goes to this device's copy the old way:
 * the time the cloud's own start is given (`STARTUP_WAIT_MS`).
 */
export const LIVE_WAIT_MS = 4_000;
/** How long with no tap, key or scroll before the board hands over to this device's own copy. */
export const QUIET_MS = 1_000;

const INPUT_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

const NO_OPTIONS: [] = [];
const NO_GROUPS: AgeGroup[] = [];

/** Find a team's box (`RankingsSection`). */
const SEARCH_BOX_ID = "scout-team-search";

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
  /*
   * The pages, from this device's copy; on a device that has never held one, from what the meta
   * publishes (`LivePages.groups`), read through the copy's own check, until the copy comes in.
   */
  const [localGroups] = useState(() => loadAgeGroups());
  const [publishedRaw, setPublishedRaw] = useState<unknown[] | undefined>(undefined);
  const publishedGroups = useMemo(
    () => (publishedRaw ? coerceAgeGroups(publishedRaw) : NO_GROUPS),
    [publishedRaw]
  );
  const ageGroups = localGroups.length > 0 ? localGroups : publishedGroups;
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
  const metaGroups = live.meta?.pages.groups;
  if (localGroups.length === 0 && metaGroups !== publishedRaw) setPublishedRaw(metaGroups);

  const [handover, setHandover] = useState<RankingsHandover | null>(null);
  const [stateTop, setStateTop] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [poolReady, setPoolReady] = useState(() => !poolWantsCloud());
  const [pageLoaded, setPageLoaded] = useState(false);
  const [waitedOut, setWaitedOut] = useState(false);
  // The club whose panel is open, from its card, and one whose card could not be read.
  const [openClub, setOpenClub] = useState<string | null>(null);
  const [cannotOpen, setCannotOpen] = useState<string | null>(null);
  // Find a team, from the year's published list once somebody goes to search.
  const search = useLiveSearch(live.source, selectedYear);
  // Whether a page's Games list, or a card Scouting reads, could not be read.
  const [cannotList, setCannotList] = useState(false);
  // The club Scouting reports on, when somebody picked one.
  const [scoutedTeam, setScoutedTeam] = useState("");

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

  /*
   * The board on screen is the one Team Rankings opens on, whenever it hands over; with none on
   * screen, none is. Letting go here too, not only where a refusal forgets every board
   * (`useLiveBoard`): a refusal heard between a board's drawing and this effect's running was
   * forgotten first and then held again by the late effect, about one time in six in the test.
   */
  useEffect(() => {
    if (board)
      holdLiveBoard(
        { ageGroupId: selectedAgeGroupId, ...(live.segment ? { segment: live.segment } : {}) },
        board.view.rows
      );
    else forgetLiveBoard();
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
    (section !== "rankings" && section !== "games" && section !== "scouting") ||
    cannotList ||
    // No page: once there are pages to choose from, this device's or the meta's, and the meta's
    // are the ones laid out by, which is a render after the meta that brings them.
    (!selectedAgeGroupId &&
      (localGroups.length > 0 || (live.meta !== null && metaGroups === publishedRaw))) ||
    (live.metaMiss !== null && !offline) ||
    (live.boardMiss !== null && live.boardMiss !== "offline") ||
    (offline && !board) ||
    (waitedOut && !board) ||
    live.standing === "behind-copy" ||
    live.standing === "owed" ||
    cannotOpen !== null ||
    search.failed;
  // The club open, or the one that could not be, opens on Team Rankings too, and so does a search
  // whose list could not be read.
  const clubOpen = cannotOpen ?? openClub;
  const where: RankingsHandover = {
    stateTop,
    stateFilter,
    showAll,
    ...(clubOpen ? { openTeamId: clubOpen } : {}),
    ...(search.failed ? { focusSearch: true } : {}),
    ...(scoutedTeam ? { reportTeamId: scoutedTeam } : {}),
  };
  if (handOverNow && !handover) setHandover(where);

  const handOverWith = (extra: RankingsHandover) => setHandover({ ...where, ...extra });

  // A second with nobody touching the screen, once the board, the pool and the page's code are in.
  const settled = board !== null && poolReady && pageLoaded && handover === null;
  useEffect(() => {
    if (!settled) return;
    /*
     * Not while somebody is in the search box: the page would open on a box of its own, with what
     * they typed and the clubs it found gone, which reading the results for a second is no reason
     * for. It waits the while again once they leave it.
     */
    const quietly = () => {
      if (document.activeElement?.id === SEARCH_BOX_ID) {
        timer = setTimeout(quietly, quietMs);
        return;
      }
      setHandover({
        stateTop,
        stateFilter,
        showAll,
        ...(clubOpen ? { openTeamId: clubOpen } : {}),
        ...(scoutedTeam ? { reportTeamId: scoutedTeam } : {}),
      });
    };
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
  }, [settled, stateTop, stateFilter, showAll, clubOpen, scoutedTeam, quietMs]);

  const clubs = useMemo(() => clubsOfBoard(rows), [rows]);
  const places = useMemo(() => placesOf(clubs), [clubs]);
  const placeOfClub = useCallback((teamId: string) => places.get(teamId), [places]);
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

  /**
   * A club tapped on the board opens its panel from its card (`LiveClubPanel`); with no meta to
   * read a card through, it opens on Team Rankings, as every club did before there were cards.
   */
  const openTeam = (teamId: string) => {
    if (!live.source) {
      handOverWith({ openTeamId: teamId });
      return;
    }
    setOpenClub(teamId);
    window.requestAnimationFrame(() =>
      document.getElementById(TEAM_PANEL_ID)?.scrollIntoView?.({ block: "start" })
    );
  };
  const closeClub = useCallback(() => setOpenClub(null), []);
  const cannotListGames = useCallback(() => setCannotList(true), []);

  /**
   * A club picked in Find a team opens on the page its list says, with its panel from its card, as
   * Team Rankings opens one; with no meta to read the list through, the search is Team Rankings'.
   */
  const searchOptions = search.view?.options ?? NO_OPTIONS;
  const pageOfSearched = search.view?.pageOf;
  const openSearchedTeam = (teamId: string) => {
    const pageId = pageOfSearched?.get(teamId);
    if (pageId) openPage(pageId);
    openTeam(teamId);
  };
  const held = search.view?.held;
  const explainGcId = useCallback(
    (gcTeamId: string) => (held ? whereIsGcId(gcTeamId, held) : undefined),
    [held]
  );
  // The caret in the box once the list asked for is in, and only then: a publish that changes the
  // list later leaves the person wherever they are on the page.
  const searchReady = search.view !== null;
  useEffect(() => {
    if (searchReady) document.getElementById(SEARCH_BOX_ID)?.focus();
  }, [searchReady]);
  // The box's own work on the list, after the frame that draws it (`warmTeamSearch`).
  useEffect(() => {
    if (searchOptions.length === 0) return;
    const soon = window.setTimeout(() => warmTeamSearch(searchOptions), 0);
    return () => window.clearTimeout(soon);
  }, [searchOptions]);
  const readingReport = (
    <div className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
        Reading the cloud&apos;s report…
      </p>
    </div>
  );
  const readingBoard = (
    <div className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
        Reading the cloud&apos;s board…
      </p>
    </div>
  );
  const readingGames = (
    <div className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
        Reading the cloud&apos;s games…
      </p>
    </div>
  );
  const opening = (
    <section id={TEAM_PANEL_ID} className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm text-slate-500 dark:text-slate-400">Opening the club…</p>
    </section>
  );

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
        {section === "games" ? (
          live.source ? (
            <Suspense fallback={readingGames}>
              <LiveGames
                source={live.source}
                year={selectedYear}
                pageId={selectedAgeGroupId}
                groupName={group?.name ?? ""}
                today={today}
                onCannot={cannotListGames}
                onEditWanted={() => handOverWith({})}
              />
            </Suspense>
          ) : (
            readingGames
          )
        ) : section === "scouting" ? (
          live.source && board ? (
            <Suspense fallback={readingReport}>
              <LiveScouting
                source={live.source}
                year={selectedYear}
                pageId={selectedAgeGroupId}
                groupName={group?.name ?? ""}
                ageGroups={ageGroups}
                segment={segment}
                rows={rows}
                clubs={clubs}
                placeOf={placeOfClub}
                today={today}
                reportTeamId={scoutedTeam}
                onReportTeam={setScoutedTeam}
                onWhatIf={() => handOverWith({})}
                onCannot={cannotListGames}
              />
            </Suspense>
          ) : (
            readingBoard
          )
        ) : board ? (
          <RankingsSection
            groupName={group?.name ?? ""}
            searchOptions={searchOptions}
            onSearchTeam={openSearchedTeam}
            explainGcId={explainGcId}
            onSearchWanted={live.source ? search.ask : () => handOverWith({ focusSearch: true })}
            searchLoading={search.asked && !search.view}
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
            placeOf={placeOfClub}
            isLeagueTeam={(teamId) => leagueIds.has(teamId)}
            hasGamesFiledHere={() => false}
            onOpenTeam={openTeam}
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
      {openClub && live.source && (
        <Suspense fallback={opening}>
          <LiveClubPanel
            key={openClub}
            source={live.source}
            year={selectedYear}
            teamId={openClub}
            ageGroupId={selectedAgeGroupId}
            ageGroupName={group?.name ?? ""}
            ageGroups={ageGroups}
            segment={segment}
            onClose={closeClub}
            onCannot={setCannotOpen}
          />
        </Suspense>
      )}
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
