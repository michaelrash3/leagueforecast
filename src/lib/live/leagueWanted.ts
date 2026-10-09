import type { CloudStatus } from "../cloud/cloudSession";

/** Signed in to the cloud as an account on its list, whatever the copy itself is doing. */
export const memberSignedIn = (status: CloudStatus): boolean =>
  status.kind === "working" ||
  status.kind === "saved" ||
  status.kind === "gone" ||
  status.kind === "update" ||
  (status.kind === "error" && status.account !== null);

/**
 * Whether League Standings is kept live on this device (`useLiveLeague`): its switch on (`on`), a
 * member signed in, and either the cloud's League documents met here before (`met`), when it is
 * live whatever the copy is doing, or, for its first meeting, the copy having brought this device
 * in step (1.6e): a settlement here took in everything newer of the copy's League (`inStep`,
 * `leagueInStep`), and the copy says nothing newer is waiting. So a device's first meeting sends the
 * copy's seasons up and takes the copy's as its bases, rather than older ones of its own. Until
 * then the copy brings League in here and League's changes wait for the meeting (`leagueToCopy`).
 */
export const leagueLiveWanted = ({
  on,
  status,
  met,
  inStep,
}: {
  on: boolean;
  status: CloudStatus;
  met: boolean;
  inStep: boolean;
}): boolean =>
  on &&
  memberSignedIn(status) &&
  (met || (inStep && status.kind === "saved" && !status.newer.includes("league")));

/**
 * How deleting a season goes on this device (1.6e review):
 * - `here`: with League's switch off, or in a browser no member has signed in to, the season is
 *   this device's alone, and deleted here.
 * - `cloud`: with League kept live this moment, it is deleted from the cloud first.
 * - `refuse`: on a member's device whose League is not live this moment (offline, signed out, or
 *   still to meet the cloud's seasons), the season's document is still in the cloud, and deleted
 *   here alone it would come back at the next meeting; so nothing is deleted, and the member is
 *   told why.
 */
export const seasonDeleteRoute = ({
  on,
  live,
  memberDevice,
}: {
  on: boolean;
  live: boolean;
  memberDevice: boolean;
}): "here" | "cloud" | "refuse" => {
  if (!on) return "here";
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
