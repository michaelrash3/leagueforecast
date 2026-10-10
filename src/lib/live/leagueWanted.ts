import type { CloudStatus } from "../cloud/cloudSession";

/** Signed in to the cloud as an account on its list, whatever the copy itself is doing. */
export const memberSignedIn = (status: CloudStatus): boolean =>
  status.kind === "working" ||
  status.kind === "saved" ||
  status.kind === "gone" ||
  status.kind === "update" ||
  (status.kind === "error" && status.account !== null);

/**
 * Whether League Standings is kept live on this device (`useLiveLeague`): a member signed in, and
 * either the cloud's League documents met here before (`met`), when it is
 * live whatever the copy is doing, or, for its first meeting, the copy having brought this device
 * in step (1.6e): a settlement here took in everything newer of the copy's League (`inStep`,
 * `leagueInStep`), and the copy says nothing newer is waiting. So a device's first meeting sends the
 * copy's seasons up and takes the copy's as its bases, rather than older ones of its own. Until
 * then the copy brings League in here and League's changes wait for the meeting. A member's League
 * is always kept live (1.6f): no device writes the copy, so there is no switch to keep it apart.
 */
export const leagueLiveWanted = ({
  status,
  met,
  inStep,
}: {
  status: CloudStatus;
  met: boolean;
  inStep: boolean;
}): boolean =>
  memberSignedIn(status) &&
  (met || (inStep && status.kind === "saved" && !status.newer.includes("league")));

/**
 * Whether the season on screen is still to give way to the cloud's before League is kept live to
 * wait for it (2.7 review): while the session is still finding out who is signed in, which the app
 * stops waiting for after `STARTUP_WAIT_MS`, or while a member's device still to meet the cloud's
 * seasons has the copy bring them in (working, or saved with League not yet in step). A shared
 * scenario waits then: matched now, it would be against this device's games from before, missing
 * any added elsewhere. A member's device whose copy is gone, of a later version or failing has no
 * cloud's seasons on the way, and goes on showing its own.
 */
export const leagueArriving = (asked: {
  status: CloudStatus;
  met: boolean;
  inStep: boolean;
}): boolean =>
  asked.status.kind === "connecting" ||
  ((asked.status.kind === "working" || asked.status.kind === "saved") && !leagueLiveWanted(asked));

/**
 * How deleting a season goes on this device (1.6e review):
 * - `here`: in a browser no member has signed in to, the season is this device's alone, and
 *   deleted here.
 * - `cloud`: with League kept live this moment, it is deleted from the cloud first.
 * - `refuse`: on a member's device whose League is not live this moment (offline, signed out, or
 *   still to meet the cloud's seasons), the season's document is still in the cloud, and deleted
 *   here alone it would come back at the next meeting; so nothing is deleted, and the member is
 *   told why.
 */
export const seasonDeleteRoute = ({
  live,
  memberDevice,
}: {
  live: boolean;
  memberDevice: boolean;
}): "here" | "cloud" | "refuse" => {
  if (live) return "cloud";
  return memberDevice ? "refuse" : "here";
};

/** Why a season was not deleted, where no cloud answered this moment. */
export const SEASON_DELETE_OFFLINE = "Connect to the cloud to delete a season every device shares.";

/**
 * Why a member's device whose League is not live this moment deleted no season (`refuse`): still
 * meeting the cloud's seasons, once signed in, and otherwise not connected to it.
 */
export const seasonDeleteRefused = (status: CloudStatus): string =>
  memberSignedIn(status)
    ? "League Standings is still being brought in step with the cloud. Try again in a moment."
    : SEASON_DELETE_OFFLINE;
