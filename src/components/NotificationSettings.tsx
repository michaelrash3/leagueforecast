import { useState } from "react";
import {
  loadNotificationPreferences,
  notificationDeviceId,
  saveNotificationPreferences,
  type NotificationPreferences,
} from "../lib/notifications";
import { button, card, fieldFocusRing } from "../styles/tokens";

const options: Array<{ key: keyof NotificationPreferences; label: string }> = [
  { key: "finalScores", label: "Followed-team final scores" },
  { key: "scheduleChanges", label: "Followed-team schedule changes" },
  { key: "clinches", label: "Clinches" },
  { key: "eliminations", label: "Eliminations" },
  { key: "forecastChanges", label: "Material forecast changes" },
  { key: "refreshFailures", label: "Refresh failures needing action" },
];

export function NotificationSettings() {
  const [preferences, setPreferences] = useState(loadNotificationPreferences);
  const [message, setMessage] = useState("");
  const update = (next: NotificationPreferences) => {
    setPreferences(next);
    saveNotificationPreferences(next);
  };
  const enable = async () => {
    if (!("Notification" in window)) {
      setMessage("Browser notifications are not available on this device.");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setMessage("Notification permission was not granted. No alerts will be sent.");
      return;
    }
    notificationDeviceId();
    update({ ...preferences, enabled: true });
    setMessage("Notifications enabled for this browser.");
  };
  const test = () => {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      setMessage("Enable browser notifications first.");
      return;
    }
    new Notification("League Forecast test", {
      body: "Notifications are working on this device.",
      tag: "league-forecast-test",
    });
    setMessage("Test notification sent.");
  };
  return (
    <section className={`${card} p-5`} aria-labelledby="notification-settings-title">
      <h3 id="notification-settings-title" className="text-xl font-black">
        Automatic notifications
      </h3>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        Permission is requested only when you choose Enable. Preferences apply to this browser.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {!preferences.enabled ? (
          <button type="button" className={button.primary} onClick={() => void enable()}>
            Enable notifications
          </button>
        ) : (
          <button
            type="button"
            className={button.danger}
            onClick={() => update({ ...preferences, enabled: false })}
          >
            Turn off notifications
          </button>
        )}
        <button type="button" className={button.ghost} onClick={test}>
          Send test notification
        </button>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {options.map(({ key, label }) => (
          <label key={key} className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input
              type="checkbox"
              checked={Boolean(preferences[key])}
              onChange={(event) => update({ ...preferences, [key]: event.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <label className="mt-4 block text-sm font-semibold">
        Forecast change threshold
        <span className="mt-1 flex items-center gap-2">
          <input
            className={`w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 ${fieldFocusRing}`}
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={preferences.forecastThreshold}
            onChange={(event) =>
              update({
                ...preferences,
                forecastThreshold: Math.max(1, Math.min(100, Number(event.target.value) || 1)),
              })
            }
          />
          percentage points
        </span>
      </label>
      {message && (
        <p className="mt-3 text-sm font-semibold" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
