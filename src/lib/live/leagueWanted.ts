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
 * in step, no newer League waiting in it (1.6e). So a device's first meeting sends the copy's
 * seasons up and takes the copy's as its bases, rather than older ones of its own; until then the
 * copy carries League here, editable offline, as it did before League was live by default.
 */
export const leagueLiveWanted = ({
  on,
  status,
  met,
}: {
  on: boolean;
  status: CloudStatus;
  met: boolean;
}): boolean =>
  on &&
  memberSignedIn(status) &&
  (met || (status.kind === "saved" && !status.newer.includes("league")));
