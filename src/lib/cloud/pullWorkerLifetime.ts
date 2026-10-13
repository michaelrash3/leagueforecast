/** Leave five minutes to record the failure before Cloud Tasks' 30-minute deadline. */
export const PULL_WORKER_TIMEOUT_MS = 25 * 60_000;

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
        error: new Error(
          `The pull exceeded its ${Math.round(timeoutMs / 60_000)}-minute worker limit and was stopped before retrying.`
        ),
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
