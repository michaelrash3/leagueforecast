import type { LiveLeagueState } from "../../lib/live/leagueSync";
import type { StateKind } from "../../styles/tokens";
import { StatePanel } from "../StatePanel";

/**
 * What each state that stops editing says, and how it is shown (`StatePanel`): a fault to look at,
 * the season as this device last had it while the cloud's comes in, or offline.
 */
const SAID: Partial<Record<LiveLeagueState["kind"], { text: string; kind: StateKind }>> = {
  connecting: {
    text: "Opening League Standings from the cloud. Editing starts once it is in.",
    kind: "stale",
  },
  offline: {
    text: "Offline. League Standings is as this device last had it; editing is off until the connection is back.",
    kind: "offline",
  },
  newer: {
    text: "This season was saved by a newer version of the app. Reload to update before editing it.",
    kind: "error",
  },
  unreadable: {
    text: "This season in the cloud could not be read, so nothing here is sent to it. Editing is off.",
    kind: "error",
  },
  gone: {
    text: "This season was deleted on another device. It stays here to look at; editing is off.",
    kind: "error",
  },
  apart: {
    text: "The cloud has a different season under this one's name, started on another device, so the two are kept apart. Editing is off; make a new season here to carry on.",
    kind: "error",
  },
  unstorable: {
    text: "A team or game id in this season is too long to keep in the cloud, so nothing here is sent to it. Editing is off.",
    kind: "error",
  },
  refused: {
    text: "League Standings could not be opened from the cloud for this account. Editing is off; check you are signed in with an account on the list.",
    kind: "error",
  },
};

/** Why League Standings may not be edited in `state`, or null when it may. */
export const editingOffBecause = (state: LiveLeagueState): string | null =>
  SAID[state.kind]?.text ?? null;

/**
 * What has stopped League kept live and will not mend itself, for a notification (2.6): a fault a
 * person has to see to, not a wait for the connection.
 */
export const needsAPerson = (state: LiveLeagueState): { kind: string; text: string } | null => {
  const said = SAID[state.kind];
  return said?.kind === "error" ? { kind: state.kind, text: said.text } : null;
};

/**
 * The line over League Standings kept live when it may not be edited, saying why
 * (`LiveLeagueState`). Nothing at all while live, or while League is kept on this device alone.
 */
export function LiveLeagueBanner({ state }: { state: LiveLeagueState }) {
  const said = SAID[state.kind];
  if (!said) return null;
  return (
    <StatePanel kind={said.kind} className="mb-4">
      {said.text}
    </StatePanel>
  );
}
