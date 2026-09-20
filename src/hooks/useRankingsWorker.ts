import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type SeasonSegment,
} from "../lib/teamRankings";
import { encodeScoutGames, encodeScoutTeams } from "../lib/teamRankingsCompact";
import { whatIfCurve, type WhatIfCurve } from "../lib/scoutWhatIf";
import type { PoolShipment, WorkerRequest, WorkerResponse } from "../workers/rankingsProtocol";
import { createWorker } from "./createWorker";

type RankingsInput = {
  ageGroupId: string;
  teams: ScoutTeam[];
  games: ScoutGame[];
  myTeamId?: string;
  ageGroups: AgeGroup[];
  /** One half of the baseball year, or the whole of it when absent. */
  segment?: SeasonSegment;
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

/** Which fixture the reader has opened, and whose schedule it is on. */
export type WhatIfAsk = { forTeamId: string; gameId: string; today: string };

/**
 * The answer, while it is being worked out and once it is.
 *
 * `failed` is not an error state so much as a refusal: the fixture is gone from the pool, or the
 * selection will not take it. Either way there is no answer and the panel says so, which is the
 * only alternative to showing places nobody should act on.
 */
export type WhatIfState =
  | { status: "idle" }
  | { status: "working"; ask: WhatIfAsk }
  | { status: "ready"; ask: WhatIfAsk; curve: WhatIfCurve }
  | { status: "failed"; ask: WhatIfAsk };

const NOT_ASKED: WhatIfState = { status: "idle" };

/** A settled answer, remembered against the ask it answers so a stale one is never shown. */
type WhatIfResult = { ask: WhatIfAsk; curve: WhatIfCurve | null };

/**
 * The pool the worker holds, as this hook last shipped it.
 *
 * Identity, all the way down. The arrays are the ones from the snapshot — a new array is a new
 * pool, exactly as the staleness test below already reads it — and the worker is the one they were
 * sent to, because a worker created after a failure knows nothing about what its predecessor held.
 */
type Shipped = { worker: Worker; teams: ScoutTeam[]; games: ScoutGame[]; revision: number };

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
  whatIf: WhatIfState;
  /** Stable across renders. `null` puts the answer away. */
  askWhatIf: (ask: WhatIfAsk | null) => void;
} {
  const [rows, setRows] = useState<ScoutRankingRow[]>(NO_ROWS);
  const [settledSnapshot, setSettledSnapshot] = useState<RankingsInput | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const shippedRef = useRef<Shipped | null>(null);
  const revisionRef = useRef(0);
  const nextIdRef = useRef(0);
  const latestIdRef = useRef(0);
  const latestWhatIfIdRef = useRef(0);
  const [ask, setAsk] = useState<WhatIfAsk | null>(null);
  const [result, setResult] = useState<WhatIfResult | null>(null);
  const askWhatIf = useCallback((next: WhatIfAsk | null) => setAsk(next), []);

  /*
   * Derived rather than stored. Only the settled answer is state; whether we are working is
   * simply whether the answer in hand is the answer to the question being asked. Storing the
   * status as well would be two things to keep in step, and the moment they disagreed the panel
   * would say "working" over a number or show a number for a fixture nobody opened.
   */
  const whatIf: WhatIfState = useMemo(() => {
    if (!ask) return NOT_ASKED;
    if (!result || result.ask !== ask) return { status: "working", ask };
    return result.curve ? { status: "ready", ask, curve: result.curve } : { status: "failed", ask };
  }, [ask, result]);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      shippedRef.current = null;
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
      ...(input.segment === undefined ? {} : { segment: input.segment }),
    }),
    [input.ageGroupId, input.teams, input.games, input.ageGroups, input.myTeamId, input.segment]
  );

  /**
   * How to name the pool to this worker: by revision when it has been sent this one already, and
   * by shipping it when it has not.
   *
   * Compact on the wire — the tuples-and-dictionary form IndexedDB stores — because a structured
   * clone of the objects is the cost this whole arrangement exists to stop paying: at nationwide
   * scale the objects are several times the compact form's size, and were copied on every request.
   * Encoding is a pass over the pool on the main thread, paid once per change to the pool rather
   * than once per fit.
   *
   * Hoisted out of the fit so a what-if names the same pool the same way. Two callers shipping by
   * two sets of rules would be two chances to send a nationwide pool twice.
   */
  const poolFor = useCallback(
    (worker: Worker): PoolShipment => {
      const shipped = shippedRef.current;
      if (
        shipped !== null &&
        shipped.worker === worker &&
        shipped.teams === snapshot.teams &&
        shipped.games === snapshot.games
      ) {
        return { revision: shipped.revision };
      }
      const revision = revisionRef.current + 1;
      revisionRef.current = revision;
      shippedRef.current = { worker, teams: snapshot.teams, games: snapshot.games, revision };
      return {
        revision,
        teams: encodeScoutTeams(snapshot.teams),
        games: encodeScoutGames(snapshot.games),
      };
    },
    [snapshot]
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
      snapshot.ageGroups,
      snapshot.segment
    );
  }, [idle, small, snapshot]);

  useEffect(() => {
    if (idle || small) return;
    if (!workerRef.current)
      workerRef.current = createWorker(
        () =>
          new Worker(new URL("../workers/rankings.worker.ts", import.meta.url), {
            type: "module",
          }),
        "Rankings"
      );

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
          snapshot.ageGroups,
          snapshot.segment
        );
        if (latestIdRef.current !== id) return;
        setRows(fitted);
        setSettledSnapshot(snapshot);
      };

      if (!worker) {
        runInline();
        return;
      }

      /**
       * Sends the pool itself, and remembers having done so.
       *
       * Compact on the wire — the tuples-and-dictionary form IndexedDB stores — because a
       * structured clone of the objects is the cost this whole arrangement exists to stop paying:
       * at nationwide scale the objects are several times the compact form's size, and were
       * copied on every request. Encoding here is a pass over the pool on the main thread, paid
       * once per change to the pool rather than once per fit.
       */
      const request = (pool: PoolShipment): WorkerRequest => ({
        kind: "rankings",
        id,
        ageGroupId: snapshot.ageGroupId,
        ...(snapshot.myTeamId === undefined ? {} : { myTeamId: snapshot.myTeamId }),
        ageGroups: snapshot.ageGroups,
        ...(snapshot.segment === undefined ? {} : { segment: snapshot.segment }),
        pool,
      });

      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.kind === "pool-needed") {
          // Whatever this hook believed the worker held, it does not. Ship it, if this request is
          // still the one wanted; otherwise the next request will, because nothing is on record.
          shippedRef.current = null;
          if (event.data.id === id && latestIdRef.current === id) {
            worker.postMessage(request(poolFor(worker)));
          }
          return;
        }
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
        shippedRef.current = null;
        runInline();
      };

      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      detach = () => {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
      };

      worker.postMessage(request(poolFor(worker)));
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      detach?.();
      // The fit is no longer wanted; say so rather than letting it post an answer for a pool that
      // has moved on.
      worker?.postMessage({ kind: "cancel", id } satisfies WorkerRequest);
    };
  }, [idle, small, snapshot, poolFor]);

  /**
   * The what-if, against the very pool the board on screen was built from.
   *
   * The gate is `settledSnapshot === snapshot`, not merely "we have an answer". A what-if is a
   * place in a table, and a place is only meaningful against the table the reader is looking at —
   * so while the board is catching up there is nothing to place anybody in, and the ask waits.
   * That is also what makes one held pool enough: the board and the what-if are always naming the
   * same revision.
   *
   * A small pool is worked out here, as the board is. Two fits over four hundred clubs is well
   * inside what a press can wait for, and it keeps the feature alive in tests and anywhere a
   * worker cannot be had.
   */
  useEffect(() => {
    if (!ask) return;
    const fixture = snapshot.games.find((game) => game.id === ask.gameId);
    const answer = (curve: WhatIfCurve | null) => setResult({ ask, curve });

    const runInline = () =>
      answer(
        fixture
          ? whatIfCurve(
              fixture,
              ask.forTeamId,
              snapshot.ageGroupId,
              snapshot.teams,
              snapshot.games,
              snapshot.myTeamId,
              snapshot.ageGroups,
              snapshot.segment,
              ask.today
            )
          : null
      );

    /*
     * Both of these are deferred by a turn rather than run here. A two-fit answer is work, and
     * doing it in the effect body would block the paint that puts "working it out" on screen —
     * the reader would see the press do nothing and then the answer appear.
     */
    if (idle || !fixture) {
      const miss = window.setTimeout(() => answer(null), 0);
      return () => window.clearTimeout(miss);
    }
    if (small) {
      const soon = window.setTimeout(runInline, 0);
      return () => window.clearTimeout(soon);
    }
    // The board is still catching up, so there is no table to be placed in yet. Left as "working";
    // this effect runs again when the board settles, because `settledSnapshot` is a dependency.
    if (settledSnapshot !== snapshot) return;

    if (!workerRef.current)
      workerRef.current = createWorker(
        () =>
          new Worker(new URL("../workers/rankings.worker.ts", import.meta.url), {
            type: "module",
          }),
        "Rankings"
      );
    const worker = workerRef.current;
    if (!worker) {
      runInline();
      return;
    }

    const id = nextIdRef.current + 1;
    nextIdRef.current = id;
    latestWhatIfIdRef.current = id;
    let detach: (() => void) | null = null;

    const request = (pool: PoolShipment): WorkerRequest => ({
      kind: "what-if",
      id,
      ageGroupId: snapshot.ageGroupId,
      ...(snapshot.myTeamId === undefined ? {} : { myTeamId: snapshot.myTeamId }),
      ageGroups: snapshot.ageGroups,
      ...(snapshot.segment === undefined ? {} : { segment: snapshot.segment }),
      forTeamId: ask.forTeamId,
      gameId: ask.gameId,
      today: ask.today,
      pool,
    });

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.kind === "pool-needed") {
        shippedRef.current = null;
        if (event.data.id === id && latestWhatIfIdRef.current === id) {
          worker.postMessage(request(poolFor(worker)));
        }
        return;
      }
      if (event.data.kind !== "what-if" || event.data.id !== id) return;
      detach?.();
      detach = null;
      if (latestWhatIfIdRef.current !== id) return;
      answer(event.data.curve);
    };
    const onError = (error: ErrorEvent) => {
      console.warn("Rankings worker failed, falling back to inline.", error.message);
      detach?.();
      detach = null;
      worker.terminate();
      workerRef.current = null;
      shippedRef.current = null;
      runInline();
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    detach = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    worker.postMessage(request(poolFor(worker)));

    return () => {
      detach?.();
      worker.postMessage({ kind: "cancel", id } satisfies WorkerRequest);
    };
  }, [ask, idle, small, snapshot, settledSnapshot, poolFor]);

  if (idle) return { rows: NO_ROWS, stale: false, whatIf, askWhatIf };
  if (inlineRows) return { rows: inlineRows, stale: false, whatIf, askWhatIf };
  return { rows, stale: settledSnapshot !== snapshot, whatIf, askWhatIf };
}
