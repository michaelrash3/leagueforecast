import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { type AgeUnknownList, describeAgeUnknown, type NamedAgeAsk } from "../lib/ageUnknown";
import { handoffLoaded } from "../lib/crawlHandoffStore";
import { todayIsoDay } from "../lib/date";
import type { DeletedClubs } from "../lib/deletedGames";
import { parseGcOrgList } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";
import { type GcPullProgress, remainingIds } from "../lib/gameChangerPull";
import {
  dueRefresh,
  idsPlayingAround,
  type RefreshCadence,
  type RefreshLog,
} from "../lib/gameChangerSchedule";
import { mergeOrgMembership, type OrgMembership } from "../lib/orgMembership";
import { isPoolFilled, subscribePoolFilled } from "../lib/poolFill";
import type { RunPhase } from "../lib/pullRun";
import { segmentOn } from "../lib/teamRankings";
import {
  loadRefreshCadence,
  saveOrgMembership,
  saveRefreshCadence,
} from "../lib/teamRankingsStorage";
import { useHeldHandoff } from "./useCrawlHandoff";
import type { useToast } from "./useToast";

/**
 * What a GameChanger refresh would ask for, and when: the teams due by the cadence chosen and the
 * one instant they are all judged at, the teams with a game within a day that a refresh never holds
 * back, everything due today with what is done set aside, the clubs nobody could age, and the team
 * and organization files chosen by hand or handed over by the crawl. With them, what a stopped
 * pull still has to fetch (`resumable`), and whether the week ahead is shown (`showWeek`).
 *
 * GameChangerImportPanel.tsx worked these out among its other values. They moved here whole and are
 * called where they were, so their state, memos and effects keep their place among the panel's.
 */
export type GcPullScheduleInputs = {
  ageless: AgeUnknownList;
  asks: NamedAgeAsk;
  droppedClubs: DeletedClubs;
  membership: OrgMembership;
  phase: RunPhase;
  pool: GcImportState;
  refreshLog: RefreshLog;
  savedProgress: GcPullProgress | null;
  setLoaded: Dispatch<SetStateAction<{ name: string; size: number; text: string } | null>>;
  setMembership: Dispatch<SetStateAction<OrgMembership>>;
  showToast: ReturnType<typeof useToast>["show"];
};

export function useGcPullSchedule({
  ageless,
  asks,
  droppedClubs,
  membership,
  phase,
  pool,
  refreshLog,
  savedProgress,
  setLoaded,
  setMembership,
  showToast,
}: GcPullScheduleInputs) {
  const linkedTeams = useMemo(
    () => new Set(membership.orgs.flatMap((org) => org.teamIds)).size,
    [membership]
  );
  /** Whether everything in the file it would keep is kept by the end, already or now. */
  const readOrgFile = (text: string): boolean => {
    const { orgs } = parseGcOrgList(text);
    if (!orgs.some((org) => org.teamIds?.length)) {
      showToast("That file names no teams under its organizations: it needs the Team IDs column.", {
        tone: "error",
      });
      return false;
    }
    const next = mergeOrgMembership(membership, orgs, new Date().toISOString());
    if (next === membership) {
      // A file of only tournaments changes nothing too, since the merge leaves each out, but
      // "already kept" would be untrue of them.
      showToast(
        orgs.every((org) => !org.teamIds?.length || org.kind === "tournament")
          ? "Nothing to keep in that file: its organizations are tournaments, whose names give a bracket's age, not a team's."
          : "Nothing new in that file: every organization in it is already kept."
      );
      return true;
    }
    if (!saveOrgMembership(next)) {
      showToast("Could not keep the organizations: the browser refused the write.", {
        tone: "error",
      });
      return false;
    }
    setMembership(next);
    showToast(`Kept ${next.orgs.length.toLocaleString()} organizations with teams under them.`);
    return true;
  };
  /*
   * A file chosen by hand and one the crawl handed over (`useHeldHandoff`) go in the same way;
   * `loaded` is told once one has, which for the crawl's is when the miner marks its rows sent.
   */
  const chooseTeamFile = (file: File, loaded?: () => void) => {
    const reader = new FileReader();
    reader.onerror = () => showToast("Could not read that file.", { tone: "error" });
    reader.onload = () => {
      setLoaded({ name: file.name, size: file.size, text: String(reader.result ?? "") });
      loaded?.();
    };
    reader.readAsText(file);
  };
  const chooseOrgFile = (file: File, loaded?: () => void) => {
    const reader = new FileReader();
    reader.onerror = () => showToast("Could not read that file.", { tone: "error" });
    reader.onload = () => {
      if (readOrgFile(String(reader.result ?? ""))) loaded?.();
    };
    reader.readAsText(file);
  };
  // The crawl's files, taken only while a list can be chosen, and its organizations only once the
  // pool they are kept with is read in, as the file inputs would be.
  const poolReadIn = useSyncExternalStore(subscribePoolFilled, isPoolFilled, () => false);
  useHeldHandoff("teams", phase.kind === "picking", ({ id, file }) =>
    chooseTeamFile(file, () => handoffLoaded(id, "teams"))
  );
  useHeldHandoff("orgs", phase.kind === "picking" && poolReadIn, ({ id, file }) =>
    chooseOrgFile(file, () => handoffLoaded(id, "orgs"))
  );
  const [cadence, setCadence] = useState<RefreshCadence>(() => loadRefreshCadence());
  const chooseCadence = useCallback((next: RefreshCadence) => {
    setCadence(next);
    saveRefreshCadence(next);
  }, []);

  /*
   * One instant for all of it. The gate that decides what is due, the count in the button and the
   * sentence under it all read a clock now, and three clocks a millisecond apart could disagree
   * about whether a team was asked seven days ago — which is exactly the kind of thing nobody
   * would ever reproduce.
   */
  /*
   * The teams with a game within a day of today, which a refresh never holds back however lately
   * they were pulled (`MIN_PULL_GAP_HOURS`). Off the games, so a walk of the pool once per change
   * to it rather than once per render.
   */
  const playing = useMemo(() => idsPlayingAround(pool.games, todayIsoDay()), [pool.games]);
  const { due, agelessLine } = useMemo(() => {
    const now = new Date();
    return {
      due: dueRefresh(now, refreshLog, pool.ageGroups, pool.teams, {
        /*
         * The season being played and no other. A finished season's pages cannot change, so
         * walking them every day spent a pool's worth of requests on nothing; what it costs is a
         * result posted after August 1 for a game in late July, which the pull no longer reads.
         */
        seasonYear: segmentOn(todayIsoDay(now)).year,
        ageless,
        cadence,
        namedAges: asks,
        refused: droppedClubs,
        playing,
      }),
      agelessLine: describeAgeUnknown(ageless, now, asks, droppedClubs),
    };
  }, [refreshLog, pool.ageGroups, pool.teams, ageless, cadence, asks, droppedClubs, playing]);

  /*
   * The same day, with what has already been done today set aside. Only ever used by the button
   * that asks for it: a person who has just fixed a link, or who knows a tournament finished an
   * hour ago, is asking about something the day log cannot know, and "come back tomorrow" is the
   * wrong answer to that.
   *
   * Built when asked for rather than alongside `due`, because both walk every team's GameChanger
   * links, and on the daily cadence that is the whole pool rather than a level or two of it.
   * Computing it beside the other one paid that walk twice on every change for an answer that is
   * read only when nothing is due.
   */
  const everythingDue = useCallback(() => {
    const now = new Date();
    return dueRefresh(now, refreshLog, pool.ageGroups, pool.teams, {
      // Held to the season being played for the same reason as `due` above.
      seasonYear: segmentOn(todayIsoDay(now)).year,
      ageless,
      cadence,
      namedAges: asks,
      refused: droppedClubs,
      force: true,
      playing,
    });
  }, [refreshLog, pool.ageGroups, pool.teams, ageless, cadence, asks, droppedClubs, playing]);
  const [showWeek, setShowWeek] = useState(false);
  const resumable = savedProgress ? remainingIds(savedProgress) : [];

  return {
    agelessLine,
    cadence,
    chooseCadence,
    chooseOrgFile,
    chooseTeamFile,
    due,
    everythingDue,
    linkedTeams,
    resumable,
    setShowWeek,
    showWeek,
  };
}
