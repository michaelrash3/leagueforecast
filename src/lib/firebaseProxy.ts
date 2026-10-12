import type { ApiRequest, ApiResponse } from "./apiShared";

/**
 * The GameChanger proxy as a Firebase function: the same handler Vercel runs (`api/gc-team.ts`),
 * with the two things a function on another host has to add for itself.
 *
 * It answers from another origin than the app's, so a browser needs CORS to read it. GameChanger's
 * own CORS is why the proxy exists at all; this one admits the app's pages and nobody else's. And
 * it compresses: Vercel gzips a function's answer on the way out and a Firebase function does not,
 * while what a Firebase function is billed for beyond its free allowance is mostly the bytes it
 * sends. A batch is ten teams of GameChanger's JSON, text that shrinks several times over.
 *
 * Written against the handler's own structural types, which Express's request and response (what
 * `firebase-functions` hands a function) satisfy, and with web streams rather than Node's zlib so
 * it type-checks and tests beside the rest of `src/lib` without Node's typings.
 */

/**
 * The pages allowed to call the proxy from a browser: the app on Vercel, its preview builds, and a
 * local dev server. CORS only governs what a browser may read, so this keeps other sites' pages off
 * the proxy; it is not a lock, and a script can call it whatever this says.
 */
export const GC_PROXY_ORIGINS: readonly RegExp[] = [
  /^https:\/\/leagueforecast(?:-[a-z0-9-]+)?\.vercel\.app$/,
  /^http:\/\/localhost(?::\d+)?$/,
  /^http:\/\/127\.0\.0\.1(?::\d+)?$/,
];

export const isGcProxyOrigin = (origin: string): boolean =>
  GC_PROXY_ORIGINS.some((allowed) => allowed.test(origin));

/** Answers smaller than this go as they are: a gzip header costs more than it saves. */
export const MIN_GZIP_CHARS = 1_024;

/** A response that can also send bytes, as Node's (and so Express's) can. */
export type ProxyResponse = Omit<ApiResponse, "end" | "status"> & {
  status: (code: number) => unknown;
  end: (body?: string | Uint8Array) => unknown;
};

const header = (req: ApiRequest, name: string): string | undefined => {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

const gzip = async (text: string): Promise<Uint8Array> => {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/**
 * Serves one request through `handler`, with CORS for the app's pages and a gzipped answer for a
 * browser that takes one. Resolves once the answer is sent, compression included.
 */
export const serveGcProxy = async (
  req: ApiRequest,
  res: ProxyResponse,
  handler: (req: ApiRequest, res: ApiResponse) => Promise<void>
): Promise<void> => {
  const origin = header(req, "origin");
  if (origin && isGcProxyOrigin(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    // The pull holds itself back by GameChanger's Retry-After, which a page on another origin
    // cannot read unless it is named here: it is not one of the headers CORS lets through.
    res.setHeader("access-control-expose-headers", "retry-after");
  }
  res.setHeader("vary", "Origin, Accept-Encoding");
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-methods", "GET");
    // The sign-in a pull carries (`memberCheck.ts`), which a page on another origin may send
    // only when the answer to this preflight names it.
    res.setHeader("access-control-allow-headers", "accept, authorization");
    res.setHeader("access-control-max-age", "86400");
    res.status(204);
    res.end();
    return;
  }

  const takesGzip = /\bgzip\b/i.test(header(req, "accept-encoding") ?? "");
  let sending: Promise<unknown> = Promise.resolve();
  const answer: ApiResponse = {
    status: (code) => {
      res.status(code);
      return answer;
    },
    setHeader: (name, value) => res.setHeader(name, value),
    end: (body) => {
      res.end(body);
    },
    json: (body) => {
      const text = JSON.stringify(body);
      res.setHeader("content-type", "application/json; charset=utf-8");
      if (!takesGzip || text.length < MIN_GZIP_CHARS) {
        res.end(text);
        return;
      }
      sending = gzip(text).then((bytes) => {
        res.setHeader("content-encoding", "gzip");
        res.end(bytes);
      });
    },
  };
  await handler(req, answer);
  await sending;
};
