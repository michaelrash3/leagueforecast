/**
 * Starting a module worker, in the one place that knows how.
 *
 * Three hooks each had their own copy of this, differing only in the URL and the warning text. A
 * worker is optional everywhere it is used — an old browser, a blocked worker, a bundler that did
 * not emit the chunk — so failing to start one is not an error to throw but an answer to give:
 * null, and the caller runs the same work on this thread instead.
 *
 * The URL has to be built by the caller, as a `new URL(..., import.meta.url)` written out in full,
 * because that literal is what the bundler looks for to emit the worker at all. Passing a string
 * through here would leave nothing to emit.
 */
export const createWorker = (url: URL, label: string): Worker | null => {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(url, { type: "module" });
  } catch (err) {
    console.warn(`${label} worker unavailable, falling back inline.`, err);
    return null;
  }
};
