import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { MachineLeft } from "../components/league/PlayoffMachine";
import { type CloudStatus, loadNewer } from "../lib/cloud/cloudSession";
import type { NameOf } from "../lib/impactRecap";
import { leagueArriving } from "../lib/live/leagueWanted";
import type { AppMode } from "../lib/preferences";
import type { ActiveShareView, GameLog, Matchup } from "../lib/types";
import type { useConfirmation } from "./useConfirmation";
import type { LiveLeague } from "./useLiveLeague";
import type { Seasons } from "./useSeasons";
import type { useToast } from "./useToast";

/** What `useScenarioLinks` reads of App, each by the name App gives it. */
export type ScenarioLinksInputs = {
  activeSeasonId: string;
  activeSeasonKey: string;
  appMode: AppMode;
  cloud: CloudStatus;
  leagueMet: boolean;
  leagueSettled: boolean;
  liveLeague: LiveLeague;
  logs: Record<string, GameLog>;
  matchups: Matchup[];
  nameOf: NameOf;
  requestConfirmation: ReturnType<typeof useConfirmation>["request"];
  seasons: Seasons;
  setActiveView: Dispatch<SetStateAction<ActiveShareView>>;
  showToast: ReturnType<typeof useToast>["show"];
};

/**
 * What the playoff machine is handed from outside it (2.7). A scenario someone shared by link:
 * heard in the address, asked about once the season on screen is the one this device shows, so it
 * is matched against that season's own games, and kept for the season only once the person says
 * so (`scenarioLink.ts`). And the machine as it was last left, given back when the Forecast tab is
 * shown again, for as long as the page is open and the season is the same one.
 *
 * App.tsx did this under "Scenario links". It moved here whole and is called where it was, so its
 * three effects keep their place among App's.
 */
export function useScenarioLinks({
  activeSeasonId,
  activeSeasonKey,
  appMode,
  cloud,
  leagueMet,
  leagueSettled,
  liveLeague,
  logs,
  matchups,
  nameOf,
  requestConfirmation,
  seasons,
  setActiveView,
  showToast,
}: ScenarioLinksInputs) {
  /*
   * A playoff-machine scenario someone shared: shown, and kept on this device for the open season
   * only once the person says so (`scenarioLink.ts`). It never touches the season. The handling
   * is fetched only when a link names a scenario, so none of it is in the page's first download.
   */
  const [scenarioLink, setScenarioLink] = useState<{ hash: string } | null>(() =>
    typeof window !== "undefined" && window.location.hash.includes("scenario=")
      ? { hash: window.location.hash }
      : null
  );
  useEffect(() => {
    const heard = () => {
      if (window.location.hash.includes("scenario="))
        setScenarioLink({ hash: window.location.hash });
    };
    window.addEventListener("hashchange", heard);
    return () => window.removeEventListener("hashchange", heard);
  }, []);
  const scenarioLinkTaken = useRef<{ hash: string } | null>(null);
  const [incomingScenario, setIncomingScenario] = useState<{
    seasonId: string;
    id: string;
  } | null>(null);
  const incomingScenarioOpened = useCallback(() => setIncomingScenario(null), []);
  /*
   * The playoff machine as last left, given back when the Forecast tab is shown again: its picks
   * last as long as the page does, as the machine says, not only until another tab is looked at.
   * They are one season's, so a change of season lets them go, as it does on screen, told by
   * `activeSeasonKey`: by id alone, a season deleted and its id given out again, or restored over,
   * would hand its picks and its open scenario to the season now under that id.
   */
  const [playoffLeft, setPlayoffLeft] = useState<MachineLeft | null>(null);
  if (playoffLeft && playoffLeft.season !== activeSeasonKey) setPlayoffLeft(null);
  /*
   * Whether the season on screen is still to give way to the cloud's: the sign-in still coming, a
   * member's first meeting with the cloud's seasons, or League kept live waiting for its version.
   */
  const leagueComing = leagueArriving({ status: cloud, met: leagueMet, inStep: leagueSettled });
  const seasonArriving = leagueComing || liveLeague.state.kind === "connecting";
  const scenarioLinkWaitTold = useRef<{ hash: string } | null>(null);
  useEffect(() => {
    // Signed in, with the cloud's newer seasons still to be taken in on a first meeting: they come
    // when the page is left, left alone a while or asked, which may be minutes. The other waits are
    // a moment's, and go unsaid.
    if (
      !scenarioLink ||
      scenarioLinkTaken.current === scenarioLink ||
      scenarioLinkWaitTold.current === scenarioLink ||
      appMode !== "league" ||
      cloud.kind !== "saved" ||
      !leagueComing
    )
      return;
    scenarioLinkWaitTold.current = scenarioLink;
    showToast("The shared scenario opens once League Standings has the cloud's newer seasons.", {
      tone: "info",
      actionLabel: "Load them now",
      onAction: () => void loadNewer(),
      durationMs: 12_000,
    });
  }, [scenarioLink, appMode, cloud.kind, leagueComing, showToast]);
  useEffect(() => {
    // Asked once the open season is the one this device shows, so the link is matched against the
    // season's own games; until then it stays in the address bar, to be asked about then.
    if (
      !scenarioLink ||
      scenarioLinkTaken.current === scenarioLink ||
      appMode !== "league" ||
      seasonArriving
    )
      return;
    scenarioLinkTaken.current = scenarioLink;
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    const seasonId = activeSeasonId;
    const seasonName = seasons.all.find((season) => season.id === seasonId)?.name ?? "this season";
    void import("../lib/scenarioLink")
      .then((links) =>
        links.openScenarioLink({
          hash: scenarioLink.hash,
          seasonId,
          seasonName,
          matchups,
          logs,
          nameOf,
          ask: requestConfirmation,
          say: (text, tone) => showToast(text, { tone }),
        })
      )
      .then((kept) => {
        if (!kept) return;
        setIncomingScenario({ seasonId, id: kept.id });
        setActiveView("model");
      })
      .catch(() =>
        showToast("The scenario link could not be opened. Reload the page and open it again.", {
          tone: "error",
        })
      );
  }, [
    scenarioLink,
    appMode,
    seasonArriving,
    activeSeasonId,
    seasons.all,
    matchups,
    logs,
    nameOf,
    requestConfirmation,
    showToast,
    // App's own state setter, which never changes: named only because, handed in, the hooks lint
    // can no longer see that it is.
    setActiveView,
  ]);

  return { incomingScenario, incomingScenarioOpened, playoffLeft, setPlayoffLeft };
}
