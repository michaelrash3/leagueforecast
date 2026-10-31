/** Stop the worker 30 seconds before Cloud Tasks' deadline; include startup in this budget. */
export const PULL_WORKER_TIMEOUT_MS = 29.5 * 60_000;

/**
 * The most a leg's worker may hold on Cloud Run, of the instance's 8 GiB: the rest is for what a
 * heap does not count, the gzipped pieces and the answers' bytes, and for the function itself. The
 * nightly refresh, pulling 15,793 teams into the whole pool, held 3.5 GB at its end on 29 September
 * 2026.
 */
export const CLOUD_RUN_LEG_HEAP_MB = 5_120;

/**
 * The most a leg's worker may hold, in MB: Cloud Run's, unless the run says otherwise
 * (`PULL_LEG_HEAP_MB`), as a run on one of GitHub's runners does (`cloud-pull.yml`). Those have
 * the nightly's 16 GB, where the nightly gives its pull 12,288 MB, and it peaked at 7,588.7 MB on
 * 30 October 2026 pulling into the same pool. A value that is not a whole number of megabytes a
 * runner could hold, 512 to 16,384, is no value, and the leg keeps Cloud Run's.
 */
export const legHeapMb = (env: Record<string, string | undefined>): number => {
  const said = (env.PULL_LEG_HEAP_MB ?? "").trim();
  if (!/^\d+$/.test(said)) return CLOUD_RUN_LEG_HEAP_MB;
  const mb = Number(said);
  return mb >= 512 && mb <= 16_384 ? mb : CLOUD_RUN_LEG_HEAP_MB;
};

export type PullWorkerPort<T> = {
  onMessage: (listener: (answer: T) => void) => void;
  onError: (listener: (error: Error & { code?: string }) => void) => void;
  onExit: (listener: (code: number) => void) => void;
  stop: () => Promise<unknown>;
};

/** A request must stop its worker before returning, including on timeout and failure. */
export const waitForPullWorker = <T>(
  worker: PullWorkerPort<T>,
  timeoutMs = PULL_WORKER_TIMEOUT_MS
): Promise<T> =>
  new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (result: { answer: T } | { error: Error }): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      try {
        await worker.stop();
        if ("error" in result) reject(result.error);
        else resolve(result.answer);
      } catch (error) {
        reject(error);
      }
    };
    const deadline = setTimeout(() => {
      void finish({
        error: new Error("The pull reached its worker time limit and was stopped before retrying."),
      });
    }, timeoutMs);
    worker.onMessage((answer) => void finish({ answer }));
    worker.onError(
      (error) =>
        void finish({
          error:
            error.code === "ERR_WORKER_OUT_OF_MEMORY"
              ? new Error("The pull ran out of memory on the cloud's server.")
              : error,
        })
    );
    worker.onExit(
      (code) =>
        void finish({
          error: new Error(`The pull's worker stopped (exit ${code}) without an answer.`),
        })
    );
  });
