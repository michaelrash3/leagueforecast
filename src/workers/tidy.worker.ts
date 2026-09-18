/// <reference lib="webworker" />
import { createTidyHandler, type WorkerRequest } from "./tidyProtocol";

/**
 * Tidying a nationwide pool, off the main thread.
 *
 * The tidy is five passes over every game — settling stand-ins the other side's schedule can name,
 * folding a club's several GameChanger ids together, collapsing rows that mean one game. On a pool
 * of two hundred thousand games it takes the better part of half a minute, and it was running
 * inside a `setTimeout` on the main thread: a frozen tab for that whole time, and any reload or
 * state change in the middle cancelled it. The result was a pool with eleven and a half thousand
 * results still filed against "TBD" while the code to settle them worked perfectly and never got
 * to finish.
 *
 * Here it can take as long as it needs. The page stays usable and the answer arrives when it does.
 * What it says and does is in `tidyProtocol.ts`, where it can be tested; this file only connects
 * it to the message port.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const handle = createTidyHandler((response) => scope.postMessage(response));

scope.onmessage = (event: MessageEvent<WorkerRequest>) => handle(event.data);
