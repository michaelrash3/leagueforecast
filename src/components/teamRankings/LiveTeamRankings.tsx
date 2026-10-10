import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { readClubCard, useClubCard } from "../../hooks/useClubCard";
import {
  browserLiveSources,
  useLiveBoard,
  type LiveSources,
  type LiveViewSource,
} from "../../hooks/useLiveBoard";
import type { Confirmation } from "../../hooks/useConfirmation";
import { useLiveEdits, type ShowToast } from "../../hooks/useLiveEdits";
import { useLiveSearch } from "../../hooks/useLiveSearch";
import { useRankingsPages } from "../../hooks/useRankingsPages";
import {
  copyReader,
  poolOnScreen,
  poolWantsCloud,
  preparePool,
  type CloudStatus,
} from "../../lib/cloud/cloudSession";
import { loadCloudState } from "../../lib/cloud/cloudState";
import { todayIsoDay } from "../../lib/date";
import { whereIsGcId } from "../../lib/gcIdWhereabouts";
import { forgetLiveBoard, holdLiveBoard, type RankingsHandover } from "../../lib/live/liveBoard";
import { editLock, myTeamShown } from "../../lib/live/liveEdits";
import { liveLabel } from "../../lib/live/liveLabel";
import { poolGamesOfCard, teamsOfCard } from "../../lib/live/scoutingFromCards";
import { lastWeekOf, withMine } from "../../lib/live/views/boardShape";
import { leagueClubRanksFrom, writeLeagueClubRanks } from "../../lib/leagueClubRanks";
import { myTeamGlance } from "../../lib/myTeamGlance";
import { movementOf } from "../../lib/rankMovement";
import {
  buildUpcomingSchedule,
  rankingPoolGroupIds,
  type ScoutRankingRow,
} from "../../lib/teamRankings";
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

/** No cloud to send a pull to: a page given sources that do not say how. */
const noPulls = (): null => null;
const LiveClubPanel = lazy(() => import("./LiveClubPanel"));
/** The Games tab from its page's list, loaded with the tab's code only when the tab is opened. */
const LiveGames = lazy(() => import("./LiveGames"));
/** The Scouting tab from the board and club cards, loaded only when the tab is opened. */
const LiveScouting = lazy(() => import("./LiveScouting"));
/** Setup, with Pool health from the server's pool, loaded only when the tab is opened. */
const LiveSetup = lazy(() => import("./LiveSetup"));
/** The Archive tab from the cloud's copy, loaded only when the tab is opened. */
const LiveArchive = lazy(() => import("./LiveArchive"));
/** The Import tab, the copy's refresh through the server, loaded only when the tab is opened. */
const LiveImport = lazy(() => import("./LiveImport"));
/** The time now, as an ISO string, where no source gives one. */
const nowIso = () => new Date().toISOString();

const NO_OPTIONS: [] = [];
const NO_IDS: string[] = [];

/**
 * What the page says where it has nothing it can draw, in place of going to this device's copy,
 * which a member's device no longer holds (1.6e): why the cloud gave no meta to draw by (`LiveMiss`),
 * why a page's board could not be drawn, and an empty cloud.
 */
export const LIVE_NOTICES = {
  none: "Nothing has been published to the cloud yet. The boards appear after the next refresh.",
  older:
    "The cloud's boards were published by an older version of the app. They appear again after the next refresh.",
  newer:
    "The cloud's boards were published by a newer version of the app. Reload the page to update it.",
  unreadable:
    "The cloud's boards could not be read. They are read again when the cloud next publishes.",
  missing:
    "This page's board has not been published yet. It appears here once the cloud has built it.",
  damaged:
    "This page's board could not be read from the cloud. It is read again when the cloud next publishes.",
  offline:
    "You're offline, and this page has not been read on this device yet. It appears once you're back online.",
  noPages:
    "Team Rankings has no age groups yet. They come with the first pull, or put a League Standings season on a page in Setup.",
} as const;

/** What a list or card the page could not read is said as, with a button to read it again. */
export const LIVE_UNREAD = {
  games: "The cloud's games for this page could not be read just now.",
  scouting: "The cloud's report could not be read just now.",
  archive: "The cloud's finished seasons could not be read just now.",
  club: "This club could not be read from the cloud just now.",
} as const;
const NOWHERE: RankingsHandover = {};

/** Find a team's box (`RankingsSection`). */
const SEARCH_BOX_ID = "scout-team-search";

/**
 * Team Rankings opened on the cloud's published board (`LiveBoard`), for a member who turned it
 * on in the Cloud panel: the board the server built, drawn as the page draws it, with Team
 * Rankings' own code loading behind it.
 *
 * It is the page (1.6e), since a member's device is to hold no pool for it to go to: its edits go
 * through the edit function (`useLiveEdits`), and what it cannot draw it says, and stays. It hands
 * over to Team Rankings on this device's copy (`renderPage`) only where that is the right page or
 * the only one: an account the rules refuse, or a browser with no member signed in to read as and
 * no board kept to show, which is the visitor's own app; and what it cannot do yet, the rest of
 * Setup and a pasted list pulled. Only then is this device's copy of the pool brought in, and once
 * handed over it stays handed over.
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
}) {
  const [handedOver, setHandedOver] = useState(false);
  // Where the board is, kept up to date by it, and where Team Rankings opened, once it has.
  const [where, setWhere] = useState<RankingsHandover>(NOWHERE);
  const [opened, setOpened] = useState<RankingsHandover | null>(null);
  const [poolReady, setPoolReady] = useState(() => !poolWantsCloud());

  // The page's code comes in under the board, for what it still hands over.
  useEffect(() => {
    void preloadPage().catch(() => undefined);
  }, [preloadPage]);
  // The pool only once handed over: the board is read from the cloud, which needs none of it.
  useEffect(() => {
    if (!handedOver) return;
    let alive = true;
    void preparePool().finally(() => {
      if (alive) setPoolReady(true);
    });
    return () => {
      alive = false;
    };
  }, [handedOver]);
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
      handedOver={handedOver}
      onHandOver={handOver}
      onWhere={setWhere}
      onSkip={skip}
    />
  );
}

/**
 * The cloud's board itself (`useLiveBoard`), with the page's own header, places, state boards and
 * badges, and the club panel, Find a team, Games and Scouting read from views a server publishes;
 * Setup through the edit function, and the Archive tab from the copy itself.
 * It says where it is (`onWhere`) and when it should hand over (`onHandOver`) to the page above it,
 * which decides when it goes.
 */
function LiveBoard({
  status,
  sources,
  seasons,
  showToast,
  confirm,
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
  handedOver: boolean;
  onHandOver: () => void;
  onWhere: (where: RankingsHandover) => void;
  onSkip: () => void;
}) {
  const today = todayIsoDay();
  /*
   * The pages, from what the meta publishes (`LivePages.groups`) once there is a meta, kept or
   * read, read through the copy's own check: a member's device keeps no copy in step to lay them
   * out by (1.6e). This device's own pages lay the page out only until then, and under a meta from
   * a build that published none.
   */
  const [localGroups] = useState(() => loadAgeGroups());
  const [publishedRaw, setPublishedRaw] = useState<unknown[] | undefined>(undefined);
  const publishedGroups = useMemo(
    () => (publishedRaw ? coerceAgeGroups(publishedRaw) : null),
    [publishedRaw]
  );
  const ageGroups = publishedGroups ?? localGroups;
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
  if (metaGroups !== undefined && metaGroups !== publishedRaw) setPublishedRaw(metaGroups);
  /*
   * The pages as the cloud holds them, for Setup and Games, whose edits are worked out against
   * them: the meta's whenever it carries them, since a season put on a page here changes the
   * cloud's pages and the next publish says so, while this device's copy, read as the page opened,
   * does not move with it.
   */
  const cloudGroups = useMemo(
    () => (metaGroups ? coerceAgeGroups(metaGroups) : ageGroups),
    [metaGroups, ageGroups]
  );

  const [stateTop, setStateTop] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const [showAll, setShowAll] = useState(false);
  /*
   * The club whose panel is open, from its card, and one whose card could not be read, with the
   * meta it was read by, as a list not read is kept (`cannotList`): a publish since reads it again.
   */
  const [openClub, setOpenClub] = useState<string | null>(null);
  const [cannotOpenAt, setCannotOpenAt] = useState<{
    teamId: string;
    source: LiveViewSource | null;
  } | null>(null);
  // Find a team, from the year's published list once somebody goes to search.
  const search = useLiveSearch(live.source, selectedYear);
  /*
   * Where a page's Games list, a card Scouting reads, or the copy's archive could not be read: the
   * area, page and year (`listWhere`), so another one is read rather than said to have failed, and
   * the meta it was read by, so a publish since reads it again. The area is not drawn meanwhile, so
   * drawing it again reads it afresh.
   */
  const [cannotList, setCannotList] = useState<{
    where: string;
    source: LiveViewSource | null;
  } | null>(null);
  // Scouting's clubs: the one reported on, the one set beside it, and opponents asked for.
  const [scoutedTeam, setScoutedTeam] = useState("");
  const [comparedTeam, setComparedTeam] = useState("");
  const [pickedOpponents, setPickedOpponents] = useState<string[]>(NO_IDS);

  const offline =
    live.metaMiss === "offline" ||
    live.metaMiss === "no-reader" ||
    live.boardMiss === "offline" ||
    live.link === "cut-off";
  // A member's edits, sent to the edit function against the copy the views are of: off once handed
  // over, offline, and until the network has answered for the board.
  const metaCopy = live.meta?.meta.copy ?? null;
  const edits = useLiveEdits({
    copy: metaCopy,
    locked: editLock({
      handedOver,
      unlinked: live.metaMiss === "no-reader",
      offline,
      heard: live.meta?.from === "network",
    }),
    showToast,
    ...(sources?.call ? { deps: sources.call } : {}),
  });
  /*
   * The page's own club as the cloud has it, with a mark made here and not yet published drawn
   * over it: the cloud's pages, not this device's copy, which an edit sent from here does not move.
   */
  const myTeamId = myTeamShown(
    edits.pending,
    selectedAgeGroupId,
    cloudGroups.find((group) => group.id === selectedAgeGroupId)?.myTeamId
  );
  const board = live.board;
  const rows = useMemo(() => (board ? withMine(board.view.rows, myTeamId) : []), [board, myTeamId]);
  // The page's clubs as its board lists them: the names the Games tab's form and import offer.
  const boardTeams = useMemo(
    () => rows.map((row) => ({ id: row.teamId, name: row.teamName })),
    [rows]
  );
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
   * Held as the board is put on screen (a layout effect), not in a passive effect React runs some
   * time after: a test that found the board drawn and closed the page at once could close it
   * before the hold, which then held a board for a page no longer open.
   */
  useLayoutEffect(() => {
    if (board)
      holdLiveBoard(
        { ageGroupId: selectedAgeGroupId, ...(live.segment ? { segment: live.segment } : {}) },
        board.view.rows
      );
    else forgetLiveBoard();
  }, [board, selectedAgeGroupId, live.segment]);

  /*
   * When the page hands over to this device's copy (1.6e): an account the rules refuse, or, on an
   * area that reads the published views, a browser with no member signed in to read them as and no
   * board kept to show, both of which the visitor's own app is for; and something asked for that the
   * board cannot do yet. An offline read keeps whatever board was drawn from this device's own keep,
   * and says so; with none kept, it says that.
   */
  const readsViews = section === "rankings" || section === "scouting" || section === "games";
  const nothingToDraw =
    !board && (live.meta === null || live.keptMissed || live.boardMiss !== null);
  const handOverNow =
    live.metaMiss === "refused" || (readsViews && live.metaMiss === "no-reader" && nothingToDraw);

  /*
   * What it says instead of drawing, where it cannot draw: why the network gave no meta to draw by,
   * that the cloud has no pages (once a meta, kept or read, has laid the page out), and why the
   * page's own board is not drawn. A board drawn from what this device kept stays drawn under the
   * first two, which the meta it was laid out by may still serve.
   */
  const missNotice =
    live.metaMiss === "none" ||
    live.metaMiss === "older" ||
    live.metaMiss === "newer" ||
    live.metaMiss === "unreadable"
      ? LIVE_NOTICES[live.metaMiss]
      : null;
  const noPages = ageGroups.length === 0 && live.meta !== null;
  const pageNotice = missNotice ?? (noPages ? LIVE_NOTICES.noPages : null);
  const boardNotice =
    pageNotice ??
    (offline && nothingToDraw
      ? LIVE_NOTICES.offline
      : live.boardMiss === "missing"
        ? LIVE_NOTICES.missing
        : live.boardMiss === "damaged" || live.boardMiss === "gone"
          ? LIVE_NOTICES.damaged
          : null);

  // A list, card or archive not read here: said where it was asked, and read again on asking.
  const listWhere = `${section}|${selectedAgeGroupId}|${selectedYear ?? ""}`;
  const listUnread = cannotList?.where === listWhere && cannotList.source === live.source;
  const readListAgain = () => setCannotList(null);
  /*
   * A club's card not read, while the meta it was read by is the one on screen. Once the cloud
   * publishes, the club open (the one that could not be) draws its panel again, which reads it.
   */
  const cannotOpen =
    cannotOpenAt && cannotOpenAt.source === live.source ? cannotOpenAt.teamId : null;
  const cannotReadClub = useCallback(
    (teamId: string) => setCannotOpenAt({ teamId, source: live.source }),
    [live.source]
  );

  // Where Team Rankings is to open: the club open, or the one that could not be, the search, the
  // clubs Scouting was on, and the state boards as they are.
  const clubOpen = cannotOpen ?? openClub;
  const where = useMemo(
    (): RankingsHandover => ({
      stateTop,
      stateFilter,
      showAll,
      ...(clubOpen ? { openTeamId: clubOpen } : {}),
      ...(search.asked && !search.view ? { focusSearch: true } : {}),
      ...(scoutedTeam ? { reportTeamId: scoutedTeam } : {}),
      ...(comparedTeam ? { compareTeamId: comparedTeam } : {}),
      ...(pickedOpponents.length > 0 ? { pickedOpponentIds: pickedOpponents } : {}),
    }),
    [
      stateTop,
      stateFilter,
      showAll,
      clubOpen,
      search.asked,
      search.view,
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

  /*
   * Where the clubs of the league seasons this page claims stand on its board, written for League
   * Standings' "Our team" card (`leagueClubRanksFrom`), as the device's own board writes them: off
   * the page's own board once it is drawn (the board is never another page's or half's, which
   * `useLiveBoard` holds back until its own comes), and only off a half the season plays its games
   * in. The clubs each season's teams are come with the meta (`LivePages.league`), worked out on
   * the server as the device works them out (`deriveAllKnown`).
   */
  const leagueOnPages = live.meta?.pages.league;
  useEffect(() => {
    if (!board) return;
    const group = cloudGroups.find((one) => one.id === selectedAgeGroupId);
    if (!group) return;
    const segment = live.segment;
    const label =
      segment === undefined || selectedYear === undefined
        ? group.name
        : `${group.name} · ${segmentLabel(selectedYear, segment)}`;
    const at = new Date().toISOString();
    group.seasonIds.forEach((seasonId) => {
      const season = leagueOnPages?.find(
        (entry) => entry.page === group.id && entry.season === seasonId
      );
      if (!season) return;
      if (segment !== undefined && season.halves.length > 0 && !season.halves.includes(segment))
        return;
      writeLeagueClubRanks(
        seasonId,
        leagueClubRanksFrom(
          rows,
          new Map(season.clubs.map(({ team, club }) => [team, club])),
          (teamId) => stateById.get(teamId),
          lastWeek,
          label,
          at
        )
      );
    });
  }, [
    board,
    live.segment,
    cloudGroups,
    selectedAgeGroupId,
    selectedYear,
    leagueOnPages,
    rows,
    stateById,
    lastWeek,
  ]);
  const leagueIds = useMemo(
    () => new Set((board?.view.rows ?? []).filter((row) => row.league).map((row) => row.teamId)),
    [board]
  );
  /*
   * The page's own club's card, for the games still on its schedule, read off the pages the board
   * is fitted over as the page's own card reads them off the pool (`buildUpcomingSchedule`).
   */
  const mineCard = useClubCard(live.source, selectedYear, myTeamId ?? null);
  const poolIds = useMemo(
    () => new Set(rankingPoolGroupIds(selectedAgeGroupId, ageGroups)),
    [selectedAgeGroupId, ageGroups]
  );
  const myUpcoming = useMemo(
    () =>
      mineCard.card && myTeamId
        ? buildUpcomingSchedule(
            myTeamId,
            rows,
            poolGamesOfCard(mineCard.card, poolIds),
            teamsOfCard(mineCard.card),
            today
          )
        : [],
    [mineCard.card, myTeamId, rows, poolIds, today]
  );
  const myTeam = useMemo(
    () => myTeamGlance(rows, myTeamId, (teamId) => stateById.get(teamId), myUpcoming, lastWeek),
    [rows, myTeamId, stateById, myUpcoming, lastWeek]
  );
  /*
   * A club marked as the page's own, or the mark taken off it, sent as the device's page sends it
   * (`page.myTeam`), with the club as its card has it, so one League Standings made joins the
   * roster under the mark, as the device's page adopts it.
   */
  const markMine = (teamId: string) => {
    const source = live.source;
    if (!selectedAgeGroupId) return;
    const pageName = ageGroups.find((group) => group.id === selectedAgeGroupId)?.name ?? "";
    const unmark = myTeamId === teamId;
    void (async () => {
      const adopt =
        unmark || !source
          ? null
          : ((await readClubCard(source, selectedYear, teamId))?.team ?? null);
      const name = rows.find((row) => row.teamId === teamId)?.teamName ?? "That club";
      await edits.edit(
        {
          kind: "page.myTeam",
          ageGroupId: selectedAgeGroupId,
          teamId: unmark ? null : teamId,
          ...(adopt?.id === teamId ? { adopt } : {}),
        },
        {
          done: unmark
            ? `No club is marked as yours on ${pageName}.`
            : `${name} is your team on ${pageName}.`,
          undo: true,
        }
      );
    })();
  };

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
   * read a card through, or a card that could not be read, the panel says so and offers to try again,
   * and reads it again by itself once the cloud publishes.
   */
  const openTeam = (teamId: string) => {
    if (!live.source) {
      cannotReadClub(teamId);
      return;
    }
    setCannotOpenAt(null);
    setOpenClub(teamId);
    window.requestAnimationFrame(() =>
      document.getElementById(TEAM_PANEL_ID)?.scrollIntoView?.({ block: "start" })
    );
  };
  // A club named in Setup, in the squad year its row is of: its card is that year's.
  const openTeamIn = (teamId: string, year?: number) => {
    if (year !== undefined && year !== selectedYear) openYear(year);
    openTeam(teamId);
  };
  const closeClub = useCallback(() => setOpenClub(null), []);
  const shutUnread = () => {
    setCannotOpenAt(null);
    setOpenClub(null);
  };
  // A list a section could not read, marked where it was asked, which is where it is said.
  const cannotListHere = () => setCannotList({ where: listWhere, source: live.source });

  /**
   * A club picked in Find a team opens on the page its list says, with its panel from its card, as
   * Team Rankings opens one. A list that could not be read is said so, and searching reads it again.
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
  // list later leaves the person wherever they are on the page. Put there as the box is drawn (a
  // layout effect), not in a passive effect React runs some time after: on a busy machine the box
  // was on screen without the caret, and a test that found it drawn saw focus still on the page,
  // about one run in twenty under load.
  const searchReady = search.view !== null;
  useLayoutEffect(() => {
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
  const readingBoard = handedOver
    ? onCopySoon
    : statusCard(boardNotice ?? "Reading the cloud's board…");
  // A list or card not read, with a button to read it again.
  const unread = (text: string) => (
    <div className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{text}</p>
      <button type="button" onClick={readListAgain} className={`${button.ghost} mt-3`}>
        Try again
      </button>
    </div>
  );
  /*
   * Why the network gave no meta, said above what is drawn from the one this device kept: on the
   * areas that read views, where with nothing drawn the area says it itself.
   */
  const missBanner =
    missNotice !== null && (section === "games" ? live.source !== null : board !== null)
      ? statusCard(missNotice)
      : null;

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
        {readsViews && missBanner}
        {section === "games" ? (
          listUnread ? (
            unread(LIVE_UNREAD.games)
          ) : noPages ? (
            statusCard(LIVE_NOTICES.noPages)
          ) : live.source ? (
            <Suspense fallback={statusCard("Reading the cloud's games…")}>
              <LiveGames
                source={live.source}
                year={selectedYear}
                pageId={selectedAgeGroupId}
                groupName={group?.name ?? ""}
                today={today}
                groups={cloudGroups}
                edits={edits}
                confirm={confirm}
                onCannot={cannotListHere}
                suggestedTeams={boardTeams}
                myTeamName={rows.find((row) => row.isMine)?.teamName ?? ""}
                onGoToImport={() => openSection("import")}
              />
            </Suspense>
          ) : (
            statusCard(
              missNotice ?? (offline ? LIVE_NOTICES.offline : "Reading the cloud's games…")
            )
          )
        ) : section === "scouting" ? (
          listUnread ? (
            unread(LIVE_UNREAD.scouting)
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
                edits={edits}
                onCannot={cannotListHere}
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
              pageId={selectedAgeGroupId}
              groupName={group?.name ?? ""}
              groups={cloudGroups}
              seasons={seasons}
              onOpenTeam={openTeamIn}
              copy={sources ? sources.copy : copyReader}
              showToast={showToast}
            />
          </Suspense>
        ) : section === "archive" ? (
          listUnread ? (
            unread(LIVE_UNREAD.archive)
          ) : (
            <Suspense fallback={statusCard("Reading the cloud's finished seasons…")}>
              <LiveArchive copy={sources ? sources.copy : copyReader} onCannot={cannotListHere} />
            </Suspense>
          )
        ) : section === "import" ? (
          <Suspense fallback={statusCard("Reading the cloud's refresh…")}>
            <LiveImport
              edits={edits}
              now={sources ? sources.now : nowIso}
              pulls={sources ? (sources.pulls ?? noPulls) : (browserLiveSources().pulls ?? noPulls)}
              device={loadCloudState().device}
            />
          </Suspense>
        ) : board ? (
          <RankingsSection
            groupName={group?.name ?? ""}
            searchOptions={searchOptions}
            onSearchTeam={openSearchedTeam}
            explainGcId={explainGcId}
            onSearchWanted={search.ask}
            searchLoading={searchLoading}
            searchFailed={search.failed}
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
            onMarkMine={markMine}
            onRemoveTeam={() => undefined}
            readOnly={edits.locked !== null}
            myTeam={myTeam}
            myTeamNextPending={myTeamId !== undefined && !mineCard.card && !mineCard.failed}
            myTeamNextUnread={mineCard.failed}
            {...(rankHistory ? { rankHistory } : {})}
            movementOf={boardMovement}
          />
        ) : (
          readingBoard
        )}
      </div>
      {cannotOpen !== null && handedOver ? (
        <section id={TEAM_PANEL_ID} className={`${card} p-5`} role="status" aria-live="polite">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            This club opens on this device&apos;s copy as soon as it is in&hellip;
          </p>
        </section>
      ) : cannotOpen !== null ? (
        <section id={TEAM_PANEL_ID} className={`${card} p-5`} role="status" aria-live="polite">
          <p className="text-sm text-slate-500 dark:text-slate-400">{LIVE_UNREAD.club}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => openTeam(cannotOpen)} className={button.ghost}>
              Try again
            </button>
            <button type="button" onClick={shutUnread} className={button.ghost}>
              Close
            </button>
          </div>
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
              onCannot={cannotReadClub}
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
