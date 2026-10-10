import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { readNotified, writeNotified } from "../lib/preferences";
import {
  changeKey,
  countLine,
  describeChange,
  worthNotifying,
  type Change,
  type NotifyPrefs,
} from "../lib/seasonDigest";

/** How long news gathers before it is announced, so a run of scores is one notification. */
export const NOTIFY_GATHER_MS = 20_000;

/** Whether this browser can show notifications at all. */
export const canNotify = (): boolean => typeof window !== "undefined" && "Notification" in window;

/**
 * Shows a notification the way this browser allows: through the service worker where there is one
 * (a phone shows nothing else), or directly. False if it could not be shown.
 */
export const showNotification = async (
  title: string,
  options: NotificationOptions
): Promise<boolean> => {
  if (!canNotify() || Notification.permission !== "granted") return false;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return true;
    }
    new Notification(title, options);
    return true;
  } catch {
    return false;
  }
};

const subscribeVisibility = (listener: () => void) => {
  document.addEventListener("visibilitychange", listener);
  return () => document.removeEventListener("visibilitychange", listener);
};
const pageHidden = () => document.visibilityState === "hidden";

/**
 * Notifications of the season's news while the app is open but not being looked at (2.6): a tab
 * in the background, or the installed app behind another. Only the kinds a person opted into
 * (`worthNotifying`), only news that came after the page was last looked at, gathered for
 * `NOTIFY_GATHER_MS` into one notification, and each announced once on this device however many
 * tabs are open or times the page reloads (`readNotified`).
 *
 * Nothing is sent to a server, and nothing arrives while the app is closed: that takes a push
 * service holding each device's subscription, which the app does not have.
 */
export function useDigestNotifications({
  seasonId,
  seasonLabel,
  changes,
  prefs,
  followed,
  problem,
  nameOf,
}: {
  seasonId: string;
  seasonLabel: string;
  changes: readonly Change[];
  prefs: NotifyPrefs;
  followed: string | null;
  /** What has stopped League kept live and needs a person, or null. */
  problem: { kind: string; text: string } | null;
  nameOf: (teamId: string) => string;
}) {
  const hidden = useSyncExternalStore(subscribeVisibility, pageHidden, () => false);
  const worth = useMemo(() => worthNotifying(changes, prefs, followed), [changes, prefs, followed]);
  const problemKey =
    problem && prefs.on && prefs.problems ? `${seasonId}:problem:${problem.kind}` : null;
  const oddsMove = prefs.oddsMove;
  const keys = [
    ...worth.map((change) => `${seasonId}:${changeKey(change, oddsMove)}`),
    ...(problemKey ? [problemKey] : []),
  ];
  const pending = keys.join("|");

  // What was on screen when the page was put away is not news to announce.
  const [wasHidden, setWasHidden] = useState(hidden);
  const [onScreen, setOnScreen] = useState<ReadonlySet<string>>(() => new Set());
  if (hidden !== wasHidden) {
    setWasHidden(hidden);
    setOnScreen(new Set(hidden ? keys : []));
  }

  // Read when the gathering ends, rather than restarting it on everything that changes.
  const latest = useRef({
    seasonId,
    seasonLabel,
    worth,
    oddsMove,
    problem,
    problemKey,
    onScreen,
    nameOf,
  });
  useEffect(() => {
    latest.current = {
      seasonId,
      seasonLabel,
      worth,
      oddsMove,
      problem,
      problemKey,
      onScreen,
      nameOf,
    };
  });

  useEffect(() => {
    if (!hidden || !prefs.on || pending === "") return;
    const timer = window.setTimeout(() => {
      const now = latest.current;
      const keyOf = (change: Change) => `${now.seasonId}:${changeKey(change, now.oddsMove)}`;
      const announce = async () => {
        const notified = readNotified();
        const fresh = now.worth.filter(
          (change) => !now.onScreen.has(keyOf(change)) && !notified.has(keyOf(change))
        );
        const problemNews =
          now.problem &&
          now.problemKey &&
          !now.onScreen.has(now.problemKey) &&
          !notified.has(now.problemKey)
            ? now.problem
            : null;
        if (fresh.length === 0 && !problemNews) return;
        const lines = [
          ...(problemNews ? [problemNews.text] : []),
          ...(fresh.length ? [`${countLine(fresh)}.`] : []),
          ...fresh.slice(0, 2).map((change) => describeChange(change, now.nameOf)),
        ];
        const shown = await showNotification(now.seasonLabel || "League Standings", {
          body: lines.join("\n"),
          tag: `league-digest-${now.seasonId}`,
        });
        if (!shown) return;
        for (const change of fresh) notified.add(keyOf(change));
        if (problemNews && now.problemKey) notified.add(now.problemKey);
        writeNotified(notified);
      };
      // One tab announces at a time, so two open tabs do not both tell of the same score.
      if (navigator.locks) void navigator.locks.request("lf-league-notify", announce);
      else void announce();
    }, NOTIFY_GATHER_MS);
    return () => window.clearTimeout(timer);
  }, [hidden, prefs.on, pending]);
}
