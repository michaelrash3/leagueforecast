/// <reference lib="webworker" />
import {
  buildTeamRankings,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type SeasonSegment,
} from "../lib/teamRankings";

/**
 * Rating a season-year pool is a least-squares fit over every team in it, and it grows with the
 * pool: about a tenth of a second at five hundred teams, a second and a half at two and a half
 * thousand, and far worse beyond. On the main thread that is the page locking up every time a
 * score is entered, so it happens here instead and the table keeps showing the last answer until
 * the new one arrives.
 */
export type RankingsRequest = {
  kind: "rankings";
  id: number;
  ageGroupId: string;
  teams: ScoutTeam[];
  games: ScoutGame[];
  myTeamId?: string;
  ageGroups: AgeGroup[];
  /** One half of the baseball year, or the whole of it when absent. */
  segment?: SeasonSegment;
};

export type CancelRequest = { kind: "cancel"; id: number };

export type WorkerRequest = RankingsRequest | CancelRequest;

export type RankingsResponse = {
  kind: "rankings";
  id: number;
  rows: ScoutRankingRow[];
  elapsedMs: number;
};

export type WorkerResponse = RankingsResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const canceled = new Set<number>();

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.kind === "cancel") {
    canceled.add(req.id);
    return;
  }
  if (canceled.has(req.id)) {
    canceled.delete(req.id);
    return;
  }

  const start = performance.now();
  const rows = buildTeamRankings(
    req.ageGroupId,
    req.teams,
    req.games,
    req.myTeamId,
    req.ageGroups,
    req.segment
  );
  // A fit that finished after the page stopped wanting it is thrown away rather than posted: the
  // answer is for a pool that has already changed.
  if (!canceled.has(req.id)) {
    ctx.postMessage({
      kind: "rankings",
      id: req.id,
      rows,
      elapsedMs: performance.now() - start,
    } satisfies RankingsResponse);
  }
  canceled.delete(req.id);
};
