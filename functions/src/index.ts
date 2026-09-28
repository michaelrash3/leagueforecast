/**
 * The app's Firebase functions. Bundled with esbuild into `lib/index.js` (`npm run build`), so the
 * handler is the very file Vercel runs rather than a copy of it: see `serveGcProxy` for what a
 * function on another host adds.
 */
import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import gcTeamHandler from "../../api/gc-team";
import { capBilling, describeCap } from "../../src/lib/billingCap";
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

/**
 * The hard stop on the project's bill (`billingCap.ts`): reads each budget reading published to
 * the `billing-cap` topic and takes the project off its billing account once the month's cost has
 * reached the budget.
 *
 * It runs as a service account of its own, `billing-cap`, because it is the one thing here that
 * may turn billing off: the proxy's identity, which answers anybody, is not given that. One
 * instance, and no retry: a budget publishes several readings a day, so a stop that fails is tried
 * again by the next one, and a failure is logged as an error either way.
 */
export const billingCap = onMessagePublished(
  {
    topic: "billing-cap",
    region: "us-central1",
    serviceAccount: "billing-cap@",
    memory: "256MiB",
    timeoutSeconds: 60,
    maxInstances: 1,
    retry: false,
  },
  async (event) => {
    const outcome = await capBilling(event.data.message.data);
    const line = describeCap(outcome);
    if (outcome.kind === "failed") {
      logger.error(line);
      throw new Error(line);
    }
    if (outcome.kind === "stopped") logger.warn(line);
    else logger.info(line);
  }
);
