import { lazy, useState, type ReactNode } from "react";
import type { Confirmation } from "../hooks/useConfirmation";
import type { ShowToast } from "../hooks/useLiveEdits";
import type { CloudStatus } from "../lib/cloud/cloudSession";
import { loadCloudState } from "../lib/cloud/cloudState";
import type { RankingsHandover } from "../lib/live/liveBoard";
import { readLiveBoard } from "../lib/preferences";
import { CloudPoolGate } from "./CloudPoolGate";
import { loadTeamRankingsView } from "./teamRankingsChunk";

const LiveTeamRankings = lazy(() =>
  import("./teamRankings/LiveTeamRankings").then((module) => ({
    default: module.LiveTeamRankings,
  }))
);

/** Where this browser's cloud copy stands when there is no member's sign-in to read a board with. */
const NO_MEMBER = new Set<CloudStatus["kind"]>([
  "off",
  "none",
  "signed-out",
  "not-owner",
  "gone",
  "update",
]);

/**
 * Whether Team Rankings opens on the cloud's board: turned on in the Cloud panel, in a browser that
 * keeps a cloud copy, and signed in as a member, or still finding out.
 */
export const liveBoardWanted = (status: CloudStatus): boolean =>
  readLiveBoard() && loadCloudState().enabled && !NO_MEMBER.has(status.kind);

/**
 * Team Rankings as it opens: on the cloud's board (`LiveTeamRankings`) for a member who turned it
 * on, or as it always has, once its pool is in step with the cloud copy (`CloudPoolGate`). Which
 * is decided as the page opens and kept until it closes, so turning the switch, or the cloud's
 * state moving, never swaps one page for the other under the reader.
 */
export function RankingsOpen({
  status,
  page,
  showToast,
  confirm,
}: {
  status: CloudStatus;
  page: (handover?: RankingsHandover) => ReactNode;
  /** The app's toast and confirmation, which the live page's edits are said through. */
  showToast: ShowToast;
  confirm: Confirmation["request"];
}) {
  const [live] = useState(() => liveBoardWanted(status));
  if (!live) return <CloudPoolGate status={status}>{page()}</CloudPoolGate>;
  return (
    <LiveTeamRankings
      status={status}
      renderPage={(handover) => page(handover)}
      preloadPage={loadTeamRankingsView}
      showToast={showToast}
      confirm={confirm}
    />
  );
}
