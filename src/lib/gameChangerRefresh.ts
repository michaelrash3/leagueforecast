import { isNumber, isRecord, isString } from "./validate";

export const GC_REFRESH_STATE_VERSION = 1 as const;

export type GcRefreshFailure =
  | "network"
  | "timeout"
  | "throttled"
  | "upstream-error"
  | "invalid-source"
  | "ineligible-source"
  | "authentication"
  | "conflict";

export type GcRefreshChangeKind =
  | "new-final"
  | "corrected-final"
  | "newly-scheduled"
  | "rescheduled"
  | "opponent-change"
  | "removed-or-canceled"
  | "metadata-only"
  | "import-conflict";

export type GcRefreshChange = { gameId: string; kind: GcRefreshChangeKind };

export type GcRefreshSourceState = {
  sourceId: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  sourceRevision?: string;
  changes: GcRefreshChange[];
  failure?: { category: GcRefreshFailure; message: string };
  consecutiveFailures: number;
  nextEligibleAt?: string;
  lease?: { owner: string; expiresAt: string };
};

export type GcRefreshState = {
  version: typeof GC_REFRESH_STATE_VERSION;
  sources: Record<string, GcRefreshSourceState>;
};

export const emptyGcRefreshState = (): GcRefreshState => ({
  version: GC_REFRESH_STATE_VERSION,
  sources: {},
});

export type GcGameSnapshot = {
  id: string;
  date?: string;
  awayId: string;
  homeId: string;
  awayScore?: number;
  homeScore?: number;
  final: boolean;
  canceled?: boolean;
  metadataRevision?: string;
  /** A locally entered final must be reviewed instead of silently overwritten. */
  protectedManualFinal?: boolean;
};

const scoreChanged = (before: GcGameSnapshot, after: GcGameSnapshot): boolean =>
  before.awayScore !== after.awayScore || before.homeScore !== after.homeScore;

/** Classifies one imported schedule without mutating either snapshot. */
export const classifyGcChanges = (
  before: readonly GcGameSnapshot[],
  after: readonly GcGameSnapshot[]
): GcRefreshChange[] => {
  const oldById = new Map(before.map((game) => [game.id, game]));
  const newById = new Map(after.map((game) => [game.id, game]));
  const changes: GcRefreshChange[] = [];

  after.forEach((game) => {
    const old = oldById.get(game.id);
    if (!old) {
      changes.push({ gameId: game.id, kind: game.final ? "new-final" : "newly-scheduled" });
      return;
    }
    if (old.protectedManualFinal && (scoreChanged(old, game) || old.final !== game.final)) {
      changes.push({ gameId: game.id, kind: "import-conflict" });
    } else if (old.awayId !== game.awayId || old.homeId !== game.homeId) {
      changes.push({ gameId: game.id, kind: "opponent-change" });
    } else if (old.date !== game.date) {
      changes.push({ gameId: game.id, kind: "rescheduled" });
    } else if (game.canceled && !old.canceled) {
      changes.push({ gameId: game.id, kind: "removed-or-canceled" });
    } else if (!old.final && game.final) {
      changes.push({ gameId: game.id, kind: "new-final" });
    } else if (old.final && game.final && scoreChanged(old, game)) {
      changes.push({ gameId: game.id, kind: "corrected-final" });
    } else if (old.metadataRevision !== game.metadataRevision) {
      changes.push({ gameId: game.id, kind: "metadata-only" });
    }
  });
  before.forEach((game) => {
    if (!newById.has(game.id)) changes.push({ gameId: game.id, kind: "removed-or-canceled" });
  });
  return changes;
};

const PERMANENT_FAILURES = new Set<GcRefreshFailure>([
  "invalid-source",
  "ineligible-source",
  "authentication",
  "conflict",
]);
export const MAX_REFRESH_RETRIES = 5;

/** Bounded exponential retry: 1, 2, 4, 8, then 16 minutes. */
export const nextRetryAt = (now: Date, failures: number): string | undefined => {
  if (failures <= 0 || failures > MAX_REFRESH_RETRIES) return undefined;
  return new Date(now.getTime() + 60_000 * 2 ** (failures - 1)).toISOString();
};

export const canAttemptRefresh = (source: GcRefreshSourceState, now: Date): boolean => {
  if (source.failure && PERMANENT_FAILURES.has(source.failure.category)) return false;
  if (source.consecutiveFailures >= MAX_REFRESH_RETRIES) return false;
  if (source.nextEligibleAt && Date.parse(source.nextEligibleAt) > now.getTime()) return false;
  return !source.lease || Date.parse(source.lease.expiresAt) <= now.getTime();
};

/** Atomic-store callers persist the returned state; null means another owner holds the lease. */
export const acquireRefreshLease = (
  state: GcRefreshState,
  sourceId: string,
  owner: string,
  now: Date,
  ttlMs = 5 * 60_000
): GcRefreshState | null => {
  const source = state.sources[sourceId] ?? {
    sourceId,
    changes: [],
    consecutiveFailures: 0,
  };
  if (!canAttemptRefresh(source, now)) return null;
  return {
    ...state,
    sources: {
      ...state.sources,
      [sourceId]: {
        ...source,
        lastAttemptAt: now.toISOString(),
        lease: { owner, expiresAt: new Date(now.getTime() + ttlMs).toISOString() },
      },
    },
  };
};

export const recordRefreshSuccess = (
  state: GcRefreshState,
  sourceId: string,
  owner: string,
  now: Date,
  sourceRevision: string | undefined,
  changes: GcRefreshChange[]
): GcRefreshState => {
  const source = state.sources[sourceId];
  if (!source || source.lease?.owner !== owner) return state;
  return {
    ...state,
    sources: {
      ...state.sources,
      [sourceId]: {
        sourceId,
        lastAttemptAt: source.lastAttemptAt,
        lastSuccessAt: now.toISOString(),
        ...(sourceRevision ? { sourceRevision } : {}),
        changes,
        consecutiveFailures: 0,
      },
    },
  };
};

export const recordRefreshFailure = (
  state: GcRefreshState,
  sourceId: string,
  owner: string,
  now: Date,
  category: GcRefreshFailure,
  message: string
): GcRefreshState => {
  const source = state.sources[sourceId];
  if (!source || source.lease?.owner !== owner) return state;
  const failures = source.consecutiveFailures + 1;
  const retryAt = PERMANENT_FAILURES.has(category) ? undefined : nextRetryAt(now, failures);
  return {
    ...state,
    sources: {
      ...state.sources,
      [sourceId]: {
        ...source,
        lease: undefined,
        failure: { category, message },
        consecutiveFailures: failures,
        ...(retryAt ? { nextEligibleAt: retryAt } : { nextEligibleAt: undefined }),
      },
    },
  };
};

/** Stable across retries and overlapping workers for the same source revision. */
export const refreshIdempotencyKey = (sourceId: string, sourceRevision: string): string =>
  `${encodeURIComponent(sourceId)}@${encodeURIComponent(sourceRevision)}`;

export type RefreshStatusKind =
  "updated" | "refreshing" | "offline" | "stale" | "retry-scheduled" | "manual-action" | "never";
export type RefreshStatus = { kind: RefreshStatusKind; label: string; detail?: string };

export const describeRefreshStatus = (
  source: GcRefreshSourceState | undefined,
  now: Date,
  online: boolean,
  staleAfterMs = 24 * 60 * 60_000
): RefreshStatus => {
  if (!online) return { kind: "offline", label: "Offline", detail: "Refresh will resume online." };
  if (!source) return { kind: "never", label: "Not refreshed yet" };
  if (source.lease && Date.parse(source.lease.expiresAt) > now.getTime()) {
    return { kind: "refreshing", label: "Refreshing" };
  }
  if (source.failure && PERMANENT_FAILURES.has(source.failure.category)) {
    return {
      kind: "manual-action",
      label: "Manual action required",
      detail: source.failure.message,
    };
  }
  if (source.nextEligibleAt && Date.parse(source.nextEligibleAt) > now.getTime()) {
    return {
      kind: "retry-scheduled",
      label: "Retry scheduled",
      detail: `Next automatic refresh ${source.nextEligibleAt}`,
    };
  }
  const success = source.lastSuccessAt ? Date.parse(source.lastSuccessAt) : Number.NaN;
  if (!Number.isFinite(success) || now.getTime() - success > staleAfterMs) {
    return { kind: "stale", label: "Refresh is stale", detail: source.failure?.message };
  }
  return { kind: "updated", label: "Updated recently", detail: source.lastSuccessAt };
};

const failureKinds = new Set<GcRefreshFailure>([
  "network",
  "timeout",
  "throttled",
  "upstream-error",
  "invalid-source",
  "ineligible-source",
  "authentication",
  "conflict",
]);
const changeKinds = new Set<GcRefreshChangeKind>([
  "new-final",
  "corrected-final",
  "newly-scheduled",
  "rescheduled",
  "opponent-change",
  "removed-or-canceled",
  "metadata-only",
  "import-conflict",
]);

export const coerceGcRefreshState = (raw: unknown): GcRefreshState => {
  if (!isRecord(raw) || raw.version !== GC_REFRESH_STATE_VERSION || !isRecord(raw.sources)) {
    return emptyGcRefreshState();
  }
  const sources: Record<string, GcRefreshSourceState> = {};
  Object.entries(raw.sources).forEach(([sourceId, value]) => {
    if (!isRecord(value) || !isString(value.sourceId) || value.sourceId !== sourceId) return;
    const failure =
      isRecord(value.failure) && failureKinds.has(value.failure.category as GcRefreshFailure)
        ? {
            category: value.failure.category as GcRefreshFailure,
            message: isString(value.failure.message) ? value.failure.message : "",
          }
        : undefined;
    const changes = Array.isArray(value.changes)
      ? value.changes.flatMap((change): GcRefreshChange[] => {
          if (
            !isRecord(change) ||
            !isString(change.gameId) ||
            !changeKinds.has(change.kind as GcRefreshChangeKind)
          ) {
            return [];
          }
          return [{ gameId: change.gameId, kind: change.kind as GcRefreshChangeKind }];
        })
      : [];
    const lease =
      isRecord(value.lease) && isString(value.lease.owner) && isString(value.lease.expiresAt)
        ? { owner: value.lease.owner, expiresAt: value.lease.expiresAt }
        : undefined;
    sources[sourceId] = {
      sourceId,
      changes,
      consecutiveFailures: isNumber(value.consecutiveFailures)
        ? Math.max(0, Math.floor(value.consecutiveFailures))
        : 0,
      ...(isString(value.lastAttemptAt) ? { lastAttemptAt: value.lastAttemptAt } : {}),
      ...(isString(value.lastSuccessAt) ? { lastSuccessAt: value.lastSuccessAt } : {}),
      ...(isString(value.sourceRevision) ? { sourceRevision: value.sourceRevision } : {}),
      ...(isString(value.nextEligibleAt) ? { nextEligibleAt: value.nextEligibleAt } : {}),
      ...(failure ? { failure } : {}),
      ...(lease ? { lease } : {}),
    };
  });
  return { version: GC_REFRESH_STATE_VERSION, sources };
};
