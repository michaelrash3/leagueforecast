import { useId, useState } from "react";
import { canNotify, showNotification } from "../../hooks/useDigestNotifications";
import type { NotifyPrefs } from "../../lib/seasonDigest";
import { button, fieldFocusRing, textRole } from "../../styles/tokens";

const ODDS_MOVES = [5, 10, 15, 20, 25] as const;

/**
 * What this device is told of when the season changes elsewhere (2.6), each kind opted into, and
 * all of it off until turned on. The browser is asked for permission when it is turned on and not
 * before, and a test notification shows it works.
 */
export function NotificationSettings({
  prefs,
  onPrefs,
  followedName,
}: {
  prefs: NotifyPrefs;
  onPrefs: (prefs: NotifyPrefs) => void;
  /** The team this browser follows, whose scores and schedule can be notified of, or null. */
  followedName: string | null;
}) {
  const oddsId = useId();
  const [said, setSaid] = useState<string | null>(null);
  const team = followedName ?? "Our team";

  const turnOn = async () => {
    if (!canNotify()) {
      setSaid("This browser does not show notifications.");
      return;
    }
    const answer =
      Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
    if (answer === "granted") {
      setSaid(null);
      onPrefs({ ...prefs, on: true });
    } else {
      setSaid(
        "Notifications are blocked for this site. Allow them in the browser's settings for this site, then turn this on again."
      );
    }
  };

  const test = async () => {
    const shown = await showNotification("League Standings", {
      body: "Notifications are on for this device.",
      tag: "league-test",
    });
    setSaid(
      shown
        ? "A test notification was sent."
        : "The test notification could not be shown. Check that the browser allows notifications for this site."
    );
  };

  const kind = (
    key: "finals" | "schedule" | "clinches" | "eliminations" | "problems",
    label: string
  ) => (
    <label className={`flex items-center gap-2 ${textRole.body} font-semibold`}>
      <input
        type="checkbox"
        checked={prefs[key]}
        disabled={!prefs.on}
        onChange={(event) => onPrefs({ ...prefs, [key]: event.target.checked })}
        className="h-4 w-4"
      />
      {label}
    </label>
  );

  return (
    <div className="mt-8 rounded-lg border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-900">
      <h3 className={textRole.sectionTitle}>Notifications</h3>
      <p className={`mt-2 ${textRole.meta}`}>
        This device can be told when the season changes on another one: finals and corrected scores,
        games moved or removed, clinches and eliminations. They come while League Forecast is open,
        in a tab or installed, and not while it is closed; nothing is sent to a server.
      </p>
      <label className={`mt-3 flex items-center gap-2 ${textRole.body} font-bold`}>
        <input
          type="checkbox"
          checked={prefs.on}
          onChange={(event) =>
            event.target.checked ? void turnOn() : onPrefs({ ...prefs, on: false })
          }
          className="h-4 w-4"
        />
        Notify this device
      </label>
      {said && (
        <p role="status" className={`mt-2 ${textRole.meta}`}>
          {said}
        </p>
      )}
      <fieldset className="mt-3 space-y-2" disabled={!prefs.on}>
        <legend className={textRole.overline}>Notify of</legend>
        {kind("finals", `${team}'s finals and corrected scores`)}
        {kind("schedule", `${team}'s games added, moved or removed`)}
        {kind("clinches", "Clinches")}
        {kind("eliminations", "Eliminations")}
        {kind("problems", "League Standings stopping and needing you")}
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={oddsId} className={`${textRole.body} font-semibold`}>
            {team}&rsquo;s Gold chance moving by
          </label>
          <select
            id={oddsId}
            value={prefs.oddsMove === null ? "never" : String(prefs.oddsMove)}
            disabled={!prefs.on}
            onChange={(event) =>
              onPrefs({
                ...prefs,
                oddsMove: event.target.value === "never" ? null : Number(event.target.value),
              })
            }
            className={`rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-950 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 ${fieldFocusRing}`}
          >
            {ODDS_MOVES.map((points) => (
              <option key={points} value={points}>
                {points} points or more
              </option>
            ))}
            <option value="never">Never</option>
          </select>
        </div>
      </fieldset>
      {!followedName && (
        <p className={`mt-2 ${textRole.meta}`}>
          Follow a team with the Our team card on the Dashboard to hear of its scores and schedule.
        </p>
      )}
      <button
        type="button"
        className={`mt-4 ${button.ghost}`}
        disabled={!prefs.on}
        onClick={() => void test()}
      >
        Send a test notification
      </button>
    </div>
  );
}
