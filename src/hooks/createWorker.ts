/**
 * Starting a module worker, in the one place that knows what to do when it cannot be started.
 *
 * A worker is optional everywhere it is used — an old browser, a blocked worker, a bundler that
 * did not emit the chunk — so failing to start one is not an error to throw but an answer to give:
 * null, and the caller does the same work on this thread instead.
 *
 * It takes a function that builds the worker, not a URL, and that is not a style choice. Vite finds
 * workers by looking for the whole `new Worker(new URL("./x.worker.ts", import.meta.url), { type:
 * "module" })` expression written out at one place; it is a syntactic match, not a value it can
 * follow. Hand the URL to a helper and the expression is split in two, nothing matches, and no
 * worker chunk is emitted at all — the app then silently runs every worker's job on the main
 * thread, which on a nationwide pool means a frozen tab. Keeping the whole expression inside the
 * callback leaves it intact at the call site, so the bundler still sees it.
 *
 * `workerChunks.spec.ts` checks the built output for the three chunks, because nothing else does:
 * unit tests stub `Worker`, and a build with no workers in it succeeds.
 */
export const createWorker = (build: () => Worker, label: string): Worker | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return build();
  } catch (err) {
    console.warn(`${label} worker unavailable, falling back inline.`, err);
    return null;
  }
};
