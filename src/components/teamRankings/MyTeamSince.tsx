import { lazy, Suspense, useEffect, useState } from "react";
import type { MyTeamGlance } from "../../lib/myTeamGlance";
import {
  myTeamMoves,
  readMyTeamLook,
  saveMyTeamLook,
  takeMyTeamLook,
  type MyTeamLook,
  type MyTeamMoves,
} from "../../lib/myTeamLook";

/**
 * The line itself, fetched only when there is something to tell: most visits have nothing new, and
 * with it in the tab, opening Team Rankings measured 167.1 KB gzipped against 165.4 KB before.
 */
const MyTeamSinceLine = lazy(() =>
  import("./MyTeamSinceLine").then((module) => ({ default: module.MyTeamSinceLine }))
);
import { ErrorBoundary } from "../ErrorBoundary";

/** A look older than this is compared with; a newer one is a visit still going on. */
const VISIT_GAP_MS = 60 * 60 * 1000;

/** What a club's visit settled on: the moves to tell, and a look to keep, if any. */
type Held = { key: string; moves: MyTeamMoves | null; keep?: MyTeamLook };

const decide = (key: string, now: MyTeamLook): Held => {
  const prev = readMyTeamLook(now.teamId);
  // The first visit has nothing to compare with, so it only keeps where the club stands.
  if (!prev) return { key, moves: null, keep: now };
  if (now.at - prev.at < VISIT_GAP_MS) return { key, moves: null };
  const moves = myTeamMoves(prev, now);
  return moves ? { key, moves } : { key, moves: null, keep: now };
};

/**
 * Compares the club with the last look once per club and board shown, once the board is settled,
 * and holds what moved until it is put away. Nothing is read or written but this device's storage.
 */
export function useMyTeamSince(glance: MyTeamGlance, board: string | undefined, settled: boolean) {
  const [held, setHeld] = useState<Held | null>(null);
  // When the page opened: the visit's time, whichever render the club is settled in.
  const [openedAt] = useState(() => Date.now());
  const key = `${glance.teamId}|${board ?? ""}`;
  // Only once the board is fitted to the latest games: a look taken from a board still being
  // refitted would keep the places from before them.
  if (settled && held?.key !== key) setHeld(decide(key, takeMyTeamLook(openedAt, glance, board)));

  useEffect(() => {
    if (held?.keep) saveMyTeamLook(held.keep);
  }, [held]);

  if (!held?.moves || held.key !== key) return null;
  return {
    moves: held.moves,
    /** Keeps the club as it stands now, so the next visit is told only what comes after. */
    dismiss: () => {
      saveMyTeamLook(takeMyTeamLook(Date.now(), glance, board));
      setHeld({ key, moves: null });
    },
  };
}

/** The top of the My Team card while something moved since the last visit, until put away. */
export function MyTeamSince({
  glance,
  board,
  settled,
}: {
  glance: MyTeamGlance;
  board?: string;
  settled: boolean;
}) {
  const since = useMyTeamSince(glance, board, settled);
  if (!since) return null;
  return (
    <ErrorBoundary area="what moved since you last looked">
      <Suspense fallback={null}>
        <MyTeamSinceLine moves={since.moves} onDismiss={since.dismiss} />
      </Suspense>
    </ErrorBoundary>
  );
}
