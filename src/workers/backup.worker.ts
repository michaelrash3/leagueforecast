/// <reference lib="webworker" />
import { backupOfCopy, type BackupAnswer, type BackupRequest } from "./backupProtocol";

/**
 * A backup of the cloud's Team Rankings, made off the page (1.6e). What it says and does is in
 * `backupProtocol.ts`, where it can be tested; this file only connects it to the message port. Its
 * pool store is this worker's own, which is the reason it is a worker at all: the page's is the
 * device's.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<BackupRequest>) => {
  void backupOfCopy(event.data).then(
    (answer) => scope.postMessage(answer),
    () => scope.postMessage({ ok: false, why: "failed" } satisfies BackupAnswer)
  );
};
