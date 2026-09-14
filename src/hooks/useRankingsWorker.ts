import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
} from "../lib/teamRankings";
import type { WorkerRequest, WorkerResponse } from "../workers/rankings.worker";

type RankingsInput = {
  ageGroupId: string;
  teams: ScoutTeam[];
  games: ScoutGame[];
  myTeamId?: string;
  ageGroups: AgeGroup[];
};

/**
 * A pool small enough that the fit is imperceptible is not worth a round trip to a worker — the
 * postMessage copy of the teams and games would cost more than the sum. Measured at about a tenth
 * of a second for five hundred teams, so anything under this runs where it is asked.
 */
const INLINE_TEAM_LIMIT = 400;

/** Waits for typing to stop before refitting; entering a score should not queue a fit per keypress. */
const DEBOUNCE_MS = 150;

/** Referentially stable, so a consumer memoising on an empty result does not re-run every render. */
const NO_ROWS: ScoutRankingRow[] = [];

const createWorker = (): Worker | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../workers/rankings.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (error) {
    console.warn("Rankings worker unavailable, falling back to inline.", error);
    return null;
  }
};

/**
 * The ranking table, fitted off the main thread once the pool is big enough to be felt.
 *
 * While a fit is running the previous rows stay on screen — they are the last true answer, and
 * blanking the table on every keystroke would be worse than being a moment out of date. `stale`
 * says which it is, so the page can mark itself as catching up.
 *
 * Falls back to fitting inline wherever a worker cannot be had (tests, older browsers, a blocked
 * module worker), so the table is never empty for want of a worker.
 */
export function useRankingsWorker(input: RankingsInput): {
  rows: ScoutRankingRow[];
  stale: boolean;
} {
  const [rows, setRows] = useState<ScoutRankingRow[]>(NO_ROWS);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const nextIdRef = useRef(0);
  const latestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  /**
   * What the answer depends on. Lengths rather than contents: a fit is re-run when a game or a
   * team arrives or leaves, or when the page changes, and re-running it on every identity change
   * of an array rebuilt each render would mean re-running it always. A score edited in place is
   * caught by `scoresKey` below rather than by any length.
   */
  const scoresKey = useMemo(
    () =>
      input.games.reduce(
        (total, game) => total + (game.teamAScore ?? 0) * 31 + (game.teamBScore ?? 0),
        0
      ),
    [input.games]
  );

  const key = useMemo(
    () =>
      JSON.stringify([
        input.ageGroupId,
        input.teams.length,
        input.games.length,
        input.ageGroups.length,
        input.myTeamId ?? "",
        scoresKey,
      ]),
    [
      input.ageGroupId,
      input.teams.length,
      input.games.length,
      input.ageGroups.length,
      input.myTeamId,
      scoresKey,
    ]
  );

  const idle = input.ageGroupId === "" || input.teams.length === 0;
  const small = input.teams.length <= INLINE_TEAM_LIMIT;

  /**
   * A small pool is fitted here, during render, exactly as it was before any of this. It is the
   * same call the component used to make and is cheap enough to make every time.
   */
  const inlineRows = useMemo(() => {
    if (idle || !small) return null;
    return buildTeamRankings(
      input.ageGroupId,
      input.teams,
      input.games,
      input.myTeamId,
      input.ageGroups
    );
    // `key` stands in for the contents; see its note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, small, key]);

  useEffect(() => {
    if (idle || small) return;
    if (!workerRef.current) workerRef.current = createWorker();

    const id = nextIdRef.current + 1;
    nextIdRef.current = id;
    latestIdRef.current = id;
    const worker = workerRef.current;
    let detach: (() => void) | null = null;

    const timer = window.setTimeout(() => {
      if (latestIdRef.current !== id) return;

      const runInline = () => {
        const fitted = buildTeamRankings(
          input.ageGroupId,
          input.teams,
          input.games,
          input.myTeamId,
          input.ageGroups
        );
        if (latestIdRef.current !== id) return;
        setRows(fitted);
        setSettledKey(key);
      };

      if (!worker) {
        runInline();
        return;
      }

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.kind !== "rankings" || event.data.id !== id) return;
        detach?.();
        detach = null;
        if (latestIdRef.current !== id) return;
        setRows(event.data.rows);
        setSettledKey(key);
      };
      const onError = (error: ErrorEvent) => {
        console.warn("Rankings worker failed, falling back to inline.", error.message);
        detach?.();
        detach = null;
        worker.terminate();
        workerRef.current = null;
        runInline();
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      detach = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      worker.postMessage({
        kind: "rankings",
        id,
        ageGroupId: input.ageGroupId,
        teams: input.teams,
        games: input.games,
        ...(input.myTeamId === undefined ? {} : { myTeamId: input.myTeamId }),
        ageGroups: input.ageGroups,
      } satisfies WorkerRequest);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      detach?.();
      // The fit is no longer wanted; say so rather than letting it post an answer for a pool that
      // has moved on.
      worker?.postMessage({ kind: "cancel", id } satisfies WorkerRequest);
    };
    // `key` stands in for the contents; see its note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idle, small, key]);

  if (idle) return { rows: NO_ROWS, stale: false };
  if (inlineRows) return { rows: inlineRows, stale: false };
  return { rows, stale: settledKey !== key };
}
