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
  const [settledSnapshot, setSettledSnapshot] = useState<RankingsInput | null>(null);
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
   * Everything the answer depends on, gathered into one object that is a new object whenever any
   * of it is. It is both what gets fitted and the key for whether the fit on screen is current.
   *
   * This used to be a digest — the three array lengths and a weighted sum of the scores — and it
   * was wrong in both directions. It missed every change that alters a rating without altering a
   * length or a score: setting a game not to count, correcting a team's name, saying which level a
   * side played at, fixing who played whom, moving a game to another page, or changing an age
   * group's year, which decides the whole pool. A rating and a record went on counting a game the
   * page had already marked as not counting. The weighted sum could collide as well, so two
   * genuinely different sets of scores could share a key.
   *
   * Identity is the honest test and it costs nothing to take. Every input here is React state or
   * memoised from it, so an array is a new array exactly when the pool behind it changed, and
   * never merely because the component rendered. That makes this both complete — there is no
   * field of a team, a game or an age group it can miss — and cheaper than walking thousands of
   * games to build a string.
   *
   * The one thing it asks of a caller is that these arrays not be rebuilt on every render. They
   * are not today, and a caller that did would refit constantly rather than show a stale table,
   * which is the failure worth having. Fitting from this object rather than from `input` is what
   * makes that guarantee hold: what was fitted and what the staleness is judged against are then
   * the same snapshot, and cannot drift apart.
   */
  const snapshot = useMemo(
    (): RankingsInput => ({
      ageGroupId: input.ageGroupId,
      teams: input.teams,
      games: input.games,
      ageGroups: input.ageGroups,
      ...(input.myTeamId === undefined ? {} : { myTeamId: input.myTeamId }),
    }),
    [input.ageGroupId, input.teams, input.games, input.ageGroups, input.myTeamId]
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
      snapshot.ageGroupId,
      snapshot.teams,
      snapshot.games,
      snapshot.myTeamId,
      snapshot.ageGroups
    );
  }, [idle, small, snapshot]);

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
          snapshot.ageGroupId,
          snapshot.teams,
          snapshot.games,
          snapshot.myTeamId,
          snapshot.ageGroups
        );
        if (latestIdRef.current !== id) return;
        setRows(fitted);
        setSettledSnapshot(snapshot);
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
        setSettledSnapshot(snapshot);
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
        ageGroupId: snapshot.ageGroupId,
        teams: snapshot.teams,
        games: snapshot.games,
        ...(snapshot.myTeamId === undefined ? {} : { myTeamId: snapshot.myTeamId }),
        ageGroups: snapshot.ageGroups,
      } satisfies WorkerRequest);
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      detach?.();
      // The fit is no longer wanted; say so rather than letting it post an answer for a pool that
      // has moved on.
      worker?.postMessage({ kind: "cancel", id } satisfies WorkerRequest);
    };
  }, [idle, small, snapshot]);

  if (idle) return { rows: NO_ROWS, stale: false };
  if (inlineRows) return { rows: inlineRows, stale: false };
  return { rows, stale: settledSnapshot !== snapshot };
}
