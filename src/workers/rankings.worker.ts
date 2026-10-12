/// <reference lib="webworker" />
import { createRankingsHandler, type WorkerRequest } from "./rankingsProtocol";

/**
 * Rating a season-year pool is a least-squares fit over every team in it, and it grows with the
 * pool: about a tenth of a second at five hundred teams, a second and a half at two and a half
 * thousand, and far worse beyond. On the main thread that is the page locking up every time a
 * score is entered, so it happens here instead and the table keeps showing the last answer until
 * the new one arrives.
 *
 * Everything this worker says and does is in `rankingsProtocol.ts`, where it can be tested; this
 * file only connects it to the message port.
 */
const ctx = self as unknown as DedicatedWorkerGlobalScope;
const handle = createRankingsHandler((response) => ctx.postMessage(response));

ctx.onmessage = (event: MessageEvent<WorkerRequest>) => handle(event.data);
