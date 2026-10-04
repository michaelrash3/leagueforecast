import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLiveBoard, type LiveSources } from "../../hooks/useLiveBoard";
import type { Confirmation } from "../../hooks/useConfirmation";
import { useLiveEdits, type ShowToast } from "../../hooks/useLiveEdits";
import { useLiveSearch } from "../../hooks/useLiveSearch";
import { useRankingsPages } from "../../hooks/useRankingsPages";
import {
  poolOnScreen,
  poolWantsCloud,
  preparePool,
  type CloudStatus,
} from "../../lib/cloud/cloudSession";
import { todayIsoDay } from "../../lib/date";
import { whereIsGcId } from "../../lib/gcIdWhereabouts";
import { forgetLiveBoard, holdLiveBoard, type RankingsHandover } from "../../lib/live/liveBoard";
import { editLock } from "../../lib/live/liveEdits";
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
import type { SeasonMeta } from "../../lib/storage";
import { button, card } from "../../styles/tokens";
import { CloudPoolGate } from "../CloudPoolGate";
import { warmTeamSearch } from "../TeamSearchSelect";
import { RankingsHeader } from "./RankingsHeader";
import { NATIONAL_TOP, RankingsSection, STATE_TOP } from "./RankingsSection";
import { SECTION_PANEL_ID, sectionTabId } from "./SectionNav";
import { TEAM_PANEL_ID } from "../teamPanelId";
import type { MergeCandidate } from "../TeamDetailPanel";

/** A club's panel from its card, loaded with the pool's codec only when a club is opened. */
const LiveClubPanel = lazy(() => import("./LiveClubPanel"));
/** The Games tab from its page's list, loaded with the tab's code only when the tab is opened. */
const LiveGames = lazy(() => import("./LiveGames"));
/** The Scouting tab from the board and club cards, loaded only when the tab is opened. */
const LiveScouting = lazy(() => import("./LiveScouting"));
/** Setup, with Pool health from the server's pool, loaded only when the tab is opened. */
const LiveSetup = lazy(() => import("./LiveSetup"));

/**
 * How long the page waits for a board to draw before it goes to this device's copy the old way:
 * the time the cloud's own start is given (`STARTUP_WAIT_MS`). A page, half or year moved to once a
 * board has drawn is given as long again for its own.
 */
export const LIVE_WAIT_MS = 4_000;
const NO_OPTIONS: [] = [];
const NO_GROUPS: AgeGroup[] = [];
const NO_IDS: string[] = [];
const NOWHERE: RankingsHandover = {};

/** Find a team's box (`RankingsSection`). */
const SEARCH_BOX_ID = "scout-team-search";

/**
 * Team Rankings opened on the cloud's published board (`LiveBoard`), for a member who turned it
 * on in the Cloud panel: the board the server built, drawn as the page draws it, while this
 * device's copy of the pool is brought in and Team Rankings' own code loads behind it.
 *
 * It stays the page while it can (1.5): a club's panel edits through the edit function
 * (`useLiveEdits`), and the page no longer goes to this device's copy once all is quiet, as it did
 * while the board was only a stand-in for it. It hands over to Team Rankings on this device's copy
 * (`renderPage`) for what it cannot do yet (a team it has no card for, an edit the Games tab or
 * Scouting asks for, another area of the page) and for a board it should not stand in for: none
 * published for the page, one this build cannot read or check, or one built before changes the
 * copy or this device has since made. Once handed over it stays handed over.
 *
 * Handed over while the pool is still coming in, the board stays on screen (or, with none to draw,
 * a card saying the page opens on this device's copy), with a strip saying how far the pool has
 * got, and works as before; Team Rankings opens once the pool is in (or the strip's button is
 * pressed) where the board then is, so nothing done meanwhile is lost (the club
 * open, the search, Scouting's clubs, the state boards). Then the board is gone: its route, its
 * listener and its effects end with it, and Team Rankings alone has the page. The rows it showed
 * are held for Team Rankings to open on (`liveBoard.ts`) until its own fit replaces them, and let
 * go when the page closes.
 */
export function LiveTeamRankings({
  status,
  renderPage,
  preloadPage,
  sources,
  seasons,
  showToast,
  confirm,
  waitMs = LIVE_WAIT_MS,
}: {
  status: CloudStatus;
  /** Team Rankings on this device's own copy, opened where the board left off. */
  renderPage: (handover: RankingsHandover) => ReactNode;
  /** Loads Team Rankings' code, so it is there by the time the board hands over. */
  preloadPage: () => Promise<unknown>;
  sources?: LiveSources;
  /** League Standings' seasons, which Setup asks which page each plays on. */
  seasons: SeasonMeta[];
  /** The page's toast and confirmation, which the edits say themselves through. */
  showToast: ShowToast;
  confirm: Confirmation["request"];
  /** `LIVE_WAIT_MS`, but for a test. */
  waitMs?: number;
}) {
  const [handedOver, setHandedOver] = useState(false);
  // Where the board is, kept up to date by it, and where Team Rankings opened, once it has.
  const [where, setWhere] = useState<RankingsHandover>(NOWHERE);
  const [opened, setOpened] = useState<RankingsHandover | null>(null);
  const [poolReady, setPoolReady] = useState(() => !poolWantsCloud());

  // The pool and the page's code come in under the board, for what it hands over.
  useEffect(() => {
    let alive = true;
    if (poolWantsCloud())
      void preparePool().finally(() => {
        if (alive) setPoolReady(true);
      });
    void preloadPage().catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [preloadPage]);
  // The rows held for Team Rankings are for the page this opened; nobody's once it closes.
  useEffect(() => () => forgetLiveBoard(), []);

  const handOver = useCallback(() => setHandedOver(true), []);
  const skip = useCallback(() => {
    poolOnScreen();
    setPoolReady(true);
  }, []);

  if (handedOver && poolReady && opened === null) setOpened(where);
  if (opened) return <CloudPoolGate status={status}>{renderPage(opened)}</CloudPoolGate>;
  return (
    <LiveBoard
      status={status}
      {...(sources ? { sources } : {})}
      seasons={seasons}
      showToast={showToast}
      confirm={confirm}
      waitMs={waitMs}
      handedOver={handedOver}
      onHandOver={handOver}
      onWhere={setWhere}
      onSkip={skip}
    />
  );
}

/**
 * The cloud's board itself (`useLiveBoard`), with the page's own header, places, state boards and
 * badges, and the club panel, Find a team, Games and Scouting read from views a server publishes.
 * It says where it is (`onWhere`) and when it should hand over (`onHandOver`) to the page above it,
 * which decides when it goes.
 */
function LiveBoard({
  status,
  sources,
  seasons,
  showToast,
  confirm,
  waitMs,
  handedOver,
  onHandOver,
  onWhere,
  onSkip,
}: {
  status: CloudStatus;
  sources?: LiveSources;
  seasons: SeasonMeta[];
  showToast: ShowToast;
  confirm: Confirmation["request"];
  waitMs: number;
  handedOver: boolean;
  onHandOver: () => void;
  onWhere: (where: RankingsHandover) => void;
  onSkip: () => void;
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
  /*
   * The pages as the cloud holds them, for Setup, which edits them there: the meta's whenever it
   * carries them, since a season put on a page here changes the cloud's pages and the next publish
   * says so, while this device's copy, read as the page opened, does not move with it.
   */
  const cloudGroups = useMemo(
    () => (metaGroups ? coerceAgeGroups(metaGroups) : ageGroups),
    [metaGroups, ageGroups]
  );

  const [stateTop, setStateTop] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [waitedOut, setWaitedOut] = useState(false);
  // The club whose panel is open, from its card, and one whose card could not be read.
  const [openClub, setOpenClub] = useState<string | null>(null);
  const [cannotOpen, setCannotOpen] = useState<string | null>(null);
  // Find a team, from the year's published list once somebody goes to search.
  const search = useLiveSearch(live.source, selectedYear);
  // Whether a page's Games list, or a card Scouting reads, could not be read.
  const [cannotList, setCannotList] = useState(false);
  // Scouting's clubs: the one reported on, the one set beside it, and opponents asked for.
  const [scoutedTeam, setScoutedTeam] = useState("");
  const [comparedTeam, setComparedTeam] = useState("");
  const [pickedOpponents, setPickedOpponents] = useState<string[]>(NO_IDS);
  // An edit or a what-if asked for, or a search with no list to read, which the board cannot do.
  const [wanted, setWanted] = useState(false);
  const [searchWanted, setSearchWanted] = useState(false);

  // The board has a while to draw.
  useEffect(() => {
    const timer = setTimeout(() => setWaitedOut(true), waitMs);
    return () => clearTimeout(timer);
  }, [waitMs]);

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
   * A page, half or year moved to once a board has drawn has a while of its own for its board to
   * draw, from when it was moved to: on the first render after the move none is drawn yet, and the
   * first while, from opening, has long run out.
   */
  const [drawnOnce, setDrawnOnce] = useState(false);
  if (board && !drawnOnce) setDrawnOnce(true);
  const [keyWaited, setKeyWaited] = useState<string | null>(null);
  useEffect(() => {
    if (!drawnOnce || live.key === null) return;
    const key = live.key;
    const timer = setTimeout(() => setKeyWaited(key), waitMs);
    return () => clearTimeout(timer);
  }, [drawnOnce, live.key, waitMs]);
  const outOfTime =
    !board && (drawnOnce ? keyWaited !== null && keyWaited === live.key : waitedOut);

  /*
   * Why the page cannot wait for a quiet moment: an area the board does not draw, no page, a meta
   * or board that will not do, nothing drawn in the time allowed, or a board built before changes
   * it does not have. An offline read keeps whatever board was drawn from this device's own keep,
   * and hands over for want of one only once that keep has been looked in.
   */
  const offline =
    live.metaMiss === "offline" ||
    live.metaMiss === "no-reader" ||
    live.boardMiss === "offline" ||
    live.link === "cut-off";
  const nothingToDraw =
    !board && (live.meta === null || live.keptMissed || live.boardMiss !== null);
  const handOverNow =
    (section !== "rankings" &&
      section !== "games" &&
      section !== "scouting" &&
      section !== "setup") ||
    cannotList ||
    // No page: once there are pages to choose from, this device's or the meta's, and the meta's
    // are the ones laid out by, which is a render after the meta that brings them.
    (!selectedAgeGroupId &&
      (localGroups.length > 0 || (live.meta !== null && metaGroups === publishedRaw))) ||
    (live.metaMiss !== null && !offline) ||
    (live.boardMiss !== null && live.boardMiss !== "offline") ||
    (offline && nothingToDraw) ||
    outOfTime ||
    live.standing === "behind-copy" ||
    live.standing === "owed" ||
    cannotOpen !== null ||
    search.failed ||
    searchWanted ||
    wanted;

  // Where Team Rankings is to open: the club open, or the one that could not be, the search, the
  // clubs Scouting was on, and the state boards as they are.
  const clubOpen = cannotOpen ?? openClub;
  const where = useMemo(
    (): RankingsHandover => ({
      stateTop,
      stateFilter,
      showAll,
      ...(clubOpen ? { openTeamId: clubOpen } : {}),
      ...(search.failed || searchWanted ? { focusSearch: true } : {}),
      ...(scoutedTeam ? { reportTeamId: scoutedTeam } : {}),
      ...(comparedTeam ? { compareTeamId: comparedTeam } : {}),
      ...(pickedOpponents.length > 0 ? { pickedOpponentIds: pickedOpponents } : {}),
    }),
    [
      stateTop,
      stateFilter,
      showAll,
      clubOpen,
      search.failed,
      searchWanted,
      scoutedTeam,
      comparedTeam,
      pickedOpponents,
    ]
  );
  // Said before the handover, so the page above has it when it hands over.
  useEffect(() => onWhere(where), [where, onWhere]);
  useEffect(() => {
    if (handOverNow && !handedOver) onHandOver();
  }, [handOverNow, handedOver, onHandOver]);

  const searchLoading = search.asked && !search.view && !search.failed;

  // A member's edits, sent to the edit function against the copy the views are of: off offline, and
  // until the network has answered for the board.
  const metaCopy = live.meta?.meta.copy ?? null;
  const edits = useLiveEdits({
    copy: metaCopy,
    locked: editLock({ offline, heard: live.meta?.from === "network" }),
    showToast,
    ...(sources?.call ? { deps: sources.call } : {}),
  });
  // What a club's panel offers to fold it into: the board's clubs, by the names the board shows.
  const foldInto = useMemo(
    (): MergeCandidate[] =>
      rows.map((row) => ({
        id: row.teamId,
        name: row.teamName,
        ...(row.state ? { state: row.state } : {}),
      })),
    [rows]
  );
  const followFold = useCallback((intoId: string) => setOpenClub(intoId), []);

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
      setCannotOpen(teamId);
      return;
    }
    setCannotOpen(null);
    setOpenClub(teamId);
    window.requestAnimationFrame(() =>
      document.getElementById(TEAM_PANEL_ID)?.scrollIntoView?.({ block: "start" })
    );
  };
  const closeClub = useCallback(() => setOpenClub(null), []);
  const cannotListGames = useCallback(() => setCannotList(true), []);
  const wantPage = useCallback(() => setWanted(true), []);

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

  const statusCard = (text: string) => (
    <div className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{text}</p>
    </div>
  );
  // What the board cannot draw, said while the pool it hands over to comes in.
  const onCopySoon = statusCard("This opens on this device's copy as soon as it is in…");
  const readingBoard = handedOver ? onCopySoon : statusCard("Reading the cloud's board…");

  return (
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
      {handedOver && <PoolStrip status={status} onSkip={onSkip} />}
      <div
        id={SECTION_PANEL_ID}
        role="tabpanel"
        aria-labelledby={sectionTabId(section)}
        className="flex flex-col gap-6"
      >
        {section === "games" ? (
          cannotList ? (
            onCopySoon
          ) : live.source ? (
            <Suspense fallback={statusCard("Reading the cloud's games…")}>
              <LiveGames
                source={live.source}
                year={selectedYear}
                pageId={selectedAgeGroupId}
                groupName={group?.name ?? ""}
                today={today}
                onCannot={cannotListGames}
                onEditWanted={wantPage}
              />
            </Suspense>
          ) : (
            statusCard("Reading the cloud's games…")
          )
        ) : section === "scouting" ? (
          cannotList ? (
            onCopySoon
          ) : live.source && board ? (
            <Suspense fallback={statusCard("Reading the cloud's report…")}>
              <LiveScouting
                source={live.source}
                year={selectedYear}
                pageId={selectedAgeGroupId}
                groupName={group?.name ?? ""}
                ageGroups={ageGroups}
                segment={segment}
                routeSegment={routeSegment}
                rows={rows}
                clubs={clubs}
                placeOf={placeOfClub}
                today={today}
                reportTeamId={scoutedTeam}
                onReportTeam={setScoutedTeam}
                compareId={comparedTeam}
                onCompareChange={setComparedTeam}
                pickedOpponentIds={pickedOpponents}
                onPickedOpponentIdsChange={setPickedOpponents}
                onWhatIf={wantPage}
                onCannot={cannotListGames}
              />
            </Suspense>
          ) : (
            readingBoard
          )
        ) : section === "setup" ? (
          <Suspense fallback={statusCard("Reading the pool's health…")}>
            <LiveSetup
              edits={edits}
              confirm={confirm}
              today={today}
              groups={cloudGroups}
              seasons={seasons}
              onOpenTeam={openTeam}
              onRestWanted={wantPage}
            />
          </Suspense>
        ) : section !== "rankings" ? (
          onCopySoon
        ) : board ? (
          <RankingsSection
            groupName={group?.name ?? ""}
            searchOptions={searchOptions}
            onSearchTeam={openSearchedTeam}
            explainGcId={explainGcId}
            onSearchWanted={live.source ? search.ask : () => setSearchWanted(true)}
            searchLoading={searchLoading}
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
          readingBoard
        )}
      </div>
      {cannotOpen !== null ? (
        <section id={TEAM_PANEL_ID} className={`${card} p-5`} role="status" aria-live="polite">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This club opens on this device&apos;s copy as soon as it is in&hellip;
          </p>
        </section>
      ) : (
        openClub &&
        live.source && (
          <Suspense
            fallback={
              <section
                id={TEAM_PANEL_ID}
                className={`${card} p-5`}
                role="status"
                aria-live="polite"
              >
                <p className="text-sm text-slate-500 dark:text-slate-400">Opening the club…</p>
              </section>
            }
          >
            <LiveClubPanel
              key={openClub}
              edits={edits}
              confirm={confirm}
              candidates={foldInto}
              onFolded={followFold}
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
        )
      )}
    </div>
  );
}

/** How far this device's copy has got while the board waits for it, and a way to stop waiting. */
function PoolStrip({ status, onSkip }: { status: CloudStatus; onSkip: () => void }) {
  const [done, total] = status.kind === "working" ? (status.progress ?? [0, 0]) : [0, 0];
  return (
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
      <button type="button" onClick={onSkip} className={button.ghost}>
        Show this device&apos;s copy now
      </button>
    </div>
  );
}
