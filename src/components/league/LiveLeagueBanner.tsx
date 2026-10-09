import type { LiveLeagueState } from "../../lib/live/leagueSync";

/** What each state that stops editing says, and whether it is a fault to look at or a wait. */
const SAID: Partial<Record<LiveLeagueState["kind"], { text: string; alert: boolean }>> = {
  connecting: {
    text: "Opening League Standings from the cloud. Editing starts once it is in.",
    alert: false,
  },
  offline: {
    text: "Offline. League Standings is as this device last had it; editing is off until the connection is back.",
    alert: false,
  },
  newer: {
    text: "This season was saved by a newer version of the app. Reload to update before editing it.",
    alert: true,
  },
  unreadable: {
    text: "This season in the cloud could not be read, so nothing here is sent to it. Editing is off.",
    alert: true,
  },
  gone: {
    text: "This season was deleted on another device. It stays here to look at; editing is off.",
    alert: true,
  },
  apart: {
    text: "The cloud has a different season under this one's name, started on another device, so the two are kept apart. Editing is off; make a new season here to carry on.",
    alert: true,
  },
  unstorable: {
    text: "A team or game id in this season is too long to keep in the cloud, so nothing here is sent to it. Editing is off.",
    alert: true,
  },
  refused: {
    text: "League Standings could not be opened from the cloud for this account. Editing is off; check you are signed in with an account on the list.",
    alert: true,
  },
};

/** Why League Standings may not be edited in `state`, or null when it may. */
export const editingOffBecause = (state: LiveLeagueState): string | null =>
  SAID[state.kind]?.text ?? null;

/**
 * The line over League Standings kept live when it may not be edited, saying why
 * (`LiveLeagueState`). Nothing at all while live, or while League is kept on this device alone.
 */
export function LiveLeagueBanner({ state }: { state: LiveLeagueState }) {
  const said = SAID[state.kind];
  if (!said) return null;
  return (
    <div
      role={said.alert ? "alert" : "status"}
      className={`mb-4 rounded-lg px-4 py-3 text-sm font-semibold leading-6 ${
        said.alert
          ? "bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200"
          : "bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100"
      }`}
    >
      {said.text}
    </div>
  );
}
