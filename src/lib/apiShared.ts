/**
 * What both serverless functions need and neither owns.
 *
 * `api/league-summary.ts` and `api/gc-team.ts` carried byte-identical copies of the handler types,
 * the client key and the throttle — about sixty lines, diverging the moment one of them was fixed
 * and the other was not. It lives here rather than in `api/` because Vercel turns files under that
 * directory into endpoints, and a helper is not an endpoint.
 *
 * `declare const process` deliberately stays in each function. It is an ambient declaration rather
 * than a value, so it cannot be exported and re-imported, and it is one line.
 */

/**
 * Minimal structural types for the Vercel Node handler. Declared here rather than taken from
 * `@vercel/node` so the project keeps its two-dependency footprint, and rather than from
 * `@types/node` because installing that also changes global timer typings for the browser project.
 */
export type ApiRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  socket?: { remoteAddress?: string };
};

export type ApiResponse = {
  status: (code: number) => ApiResponse;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * How many distinct clients a limiter tracks before it sweeps the expired ones out.
 *
 * A ceiling on memory, not on traffic: a serverless instance is short-lived and every entry ages
 * out of the window anyway, so the sweep is what keeps the map from growing without bound.
 */
const MAX_TRACKED_CLIENTS = 5_000;

/**
 * Who is asking, as far as a serverless function can tell.
 *
 * `x-forwarded-for` is set by the platform in front of the function, so on Vercel it is the real
 * client. Behind anything that does not set it, this degrades to the socket address and then to a
 * single shared bucket, which throttles everyone together rather than nobody.
 */
export const clientKey = (req: ApiRequest): string => {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
};

/**
 * A best-effort per-client throttle, with its own bucket.
 *
 * Best-effort because serverless instances do not share memory: this caps runaway retries from one
 * client rather than enforcing a global quota. The upstream's own limits remain the hard ceiling.
 *
 * The returned function takes an optional `max` so one limiter can hold several budgets under
 * different keys — the health probe shares the summary's window but not its allowance, so a burst
 * of failing retries can never starve the diagnostic that explains why they are failing.
 *
 * ON THE SWEEP: this used to be `requestLog.clear()` once the map passed the cap, which threw away
 * *every* client's history rather than the stale ones — so anyone who could push it over the cap
 * handed themselves, and everybody else, a fresh full allowance. Now only entries whose newest hit
 * has already left the window are dropped, which is exactly the set that was about to be filtered
 * away on read. Nothing live is forgotten. If every tracked client is active the map is allowed to
 * exceed the cap rather than forget one of them: a throttle that forgets under load is not one.
 */
export const createRateLimiter = (defaultMax: number, windowMs: number = RATE_LIMIT_WINDOW_MS) => {
  const hits = new Map<string, number[]>();

  return (key: string, max: number = defaultMax): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);

    if (recent.length >= max) {
      hits.set(key, recent);
      return true;
    }

    recent.push(now);
    hits.set(key, recent);

    if (hits.size > MAX_TRACKED_CLIENTS) {
      hits.forEach((times, id) => {
        // Pushed in time order, so the last is the newest this client has.
        const newest = times[times.length - 1];
        if (newest === undefined || now - newest >= windowMs) hits.delete(id);
      });
    }

    return false;
  };
};
