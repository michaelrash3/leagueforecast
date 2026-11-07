import { useCallback, useEffect, useMemo, useState } from "react";
import { needsAPerson } from "../components/league/LiveLeagueBanner";
import type { TabNavItem } from "../components/TabNav";
import { readNotifyPrefs, subscribeNotifyPrefs, writeNotifyPrefs } from "../lib/preferences";
import { digestOddsMove, raceOf, type NotifyPrefs } from "../lib/seasonDigest";
import type { SeasonStore } from "../lib/seasonStore";
import type { GameLog } from "../lib/types";
import { useDigestNotifications } from "./useDigestNotifications";
import { useSeasonDigest } from "./useSeasonDigest";

/** What "Since you last looked" reads of League Standings: the forecast, the season and the league. */
export type SinceLastLookInputs = {
  hasCutLine: boolean;
  /** Whether the forecast's odds are still being worked out for the season as it stands. */
  oddsPending: boolean;
  /** The final games' scores as the forecast has caught up with them, and as they stand. */
  finalLogs: Record<string, GameLog>;
  storedFinalLogs: Record<string, GameLog>;
  dashboardRows: Parameters<typeof raceOf>[0];
  seasonStore: SeasonStore;
  ourTeamId: string | null;
  liveLeagueState: Parameters<typeof needsAPerson>[0];
  activeSeasonId: string;
  seasonLabel: string;
  nameOf: Parameters<typeof useDigestNotifications>[0]["nameOf"];
};

/**
 * "Since you last looked" (2.6), out of `App.tsx` whole: the notifications a person opted into and
 * their other tabs' changes to them, the race read off the forecast once it has caught up, the
 * digest of what changed, its notifications and the Dashboard tab's badge. Called where its code
 * was, so its state, memo and effects keep their place among the component's.
 */
export function useSinceLastLook({
  hasCutLine,
  oddsPending,
  finalLogs,
  storedFinalLogs,
  dashboardRows,
  seasonStore,
  ourTeamId,
  liveLeagueState,
  activeSeasonId,
  seasonLabel,
  nameOf,
}: SinceLastLookInputs) {
  /*
   * What changed in the season since this device last looked (2.6): another device's scores, games
   * moved or removed, clinches and eliminations, the followed team's odds moving. The race is read
   * from the forecast once its odds have settled, and not at all without a cut line. Notifications
   * of the same, opted into, while the app is open but not looked at.
   */
  const [notifyPrefs, setNotifyPrefsState] = useState<NotifyPrefs>(readNotifyPrefs);
  const setNotifyPrefs = useCallback((prefs: NotifyPrefs) => {
    setNotifyPrefsState(prefs);
    writeNotifyPrefs(prefs);
  }, []);
  // Changed in another tab, the installed app beside this one: followed here, or this tab would
  // go on announcing what was turned off there.
  useEffect(() => subscribeNotifyPrefs(() => setNotifyPrefsState(readNotifyPrefs())), []);
  /*
   * Only once the deferred finals have caught up with the season as well (`finalLogs`): until
   * then the forecast is still the one from before the scores that just came, and a race read
   * from it would be set beside the season it does not describe.
   */
  const digestRace = useMemo(
    () =>
      hasCutLine && !oddsPending && finalLogs === storedFinalLogs && dashboardRows.length
        ? raceOf(dashboardRows)
        : null,
    [hasCutLine, oddsPending, finalLogs, storedFinalLogs, dashboardRows]
  );
  // The big "Since you last looked" card reads the season once the forecast describes it as it
  // stands (`SinceLastLook`).
  const lookReady =
    dashboardRows.length > 0 && finalLogs === storedFinalLogs && (!hasCutLine || !oddsPending);
  const digest = useSeasonDigest({
    store: seasonStore,
    race: digestRace,
    followed: ourTeamId,
    oddsMove: digestOddsMove(notifyPrefs),
    heard: liveLeagueState.kind === "live",
  });
  useDigestNotifications({
    seasonId: activeSeasonId,
    seasonLabel,
    changes: digest.changes,
    prefs: notifyPrefs,
    followed: ourTeamId,
    problem: needsAPerson(liveLeagueState),
    nameOf,
  });
  const digestBadge: TabNavItem<string>["badge"] | undefined = digest.changes.length
    ? {
        count: digest.changes.length,
        describe: `${digest.changes.length} ${digest.changes.length === 1 ? "change" : "changes"} since you last looked`,
      }
    : undefined;

  return { notifyPrefs, setNotifyPrefs, lookReady, digest, digestBadge };
}
