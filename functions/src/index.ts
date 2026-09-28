/**
 * The app's Firebase functions. Bundled with esbuild into `lib/index.js` (`npm run build`), so the
 * handler is the very file Vercel runs rather than a copy of it: see `serveGcProxy` for what a
 * function on another host adds.
 */
import { onRequest } from "firebase-functions/v2/https";
import gcTeamHandler from "../../api/gc-team";
import { serveGcProxy } from "../../src/lib/firebaseProxy";

/**
 * GET /gcTeam?ids=<id,id,…>&raw=1 — the GameChanger proxy, as `/api/gc-team` is on Vercel.
 *
 * Public, as that one is: GameChanger's endpoints need no login and nothing here is secret. A
 * handful of instances at most, each taking many requests at once, since a batch spends its time
 * waiting on GameChanger rather than computing; the per-instance limiter and profile cache in the
 * handler go further with fewer, busier instances.
 */
export const gcTeam = onRequest(
  {
    region: "us-central1",
    invoker: "public",
    memory: "256MiB",
    timeoutSeconds: 60,
    concurrency: 40,
    maxInstances: 5,
  },
  (req, res) => serveGcProxy(req, res, gcTeamHandler)
);
