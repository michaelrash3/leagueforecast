/// <reference lib="webworker" />
import { backupOfCopy, type BackupAnswer, type BackupRequest } from "./backupProtocol";

/**
 * A backup of the cloud's Team Rankings, made off the page (1.6e). What it says and does is in
 * `backupProtocol.ts`, where it can be tested; this file only connects it to the message port. Its
 * pool store is this worker's own, which is the reason it is a worker at all: the page's is the
 * device's.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

const FAILED: BackupAnswer = { ok: false, why: "failed" };

/**
 * The answer posted, or a failure where the browser will not post it: the file or the CSV is the
 * whole pool as strings, which a phone short of memory can refuse to clone (`DataCloneError`). A
 * throw here would be an unhandled rejection in this realm, which never reaches the page's
 * `onerror`, so the page would wait on an answer that is never coming.
 */
const answer = (made: BackupAnswer): void => {
  try {
    scope.postMessage(made);
  } catch {
    scope.postMessage(FAILED);
  }
};

scope.onmessage = (event: MessageEvent<BackupRequest>) => {
  void backupOfCopy(event.data).then(answer, () => answer(FAILED));
};
