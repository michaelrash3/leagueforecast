/**
 * `fetch` for the app's GameChanger client (`fetchGcTeams`) that is answered by the proxy's own
 * handler (`api/gc-team.ts`) in this process, rather than over the network by a deployed proxy.
 * A job on one of GitHub's servers asks GameChanger directly, as the Firebase proxy does, and pays
 * for nothing but the minutes: GameChanger answers GitHub's servers (`gcReach.ts`, 11,395 teams a
 * minute on 29 September 2026).
 *
 * Every request is the proxy's, so its limits and its reading of GameChanger's answers are the
 * deployed proxy's too. Its handler is called directly, past the cloud copy's list
 * (`memberCheck.ts`): the job is not a caller from outside, and has no account to sign in with.
 * Here, beside the scripts, so the app's bundle never holds the handler.
 */
import { gcTeamHandler } from "../api/gc-team.ts";
import type { ApiRequest, ApiResponse } from "../src/lib/apiShared.ts";

type Sent = { status: number; headers: Record<string, string>; body: string };

/** One caller's `fetch`, known to the handler's own limits by `remoteAddress`. */
export const handlerFetch =
  (remoteAddress = "203.0.113.7"): typeof fetch =>
  async (input, init) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, "http://in-process.invalid");
    const sent = await new Promise<Sent>((resolve, reject) => {
      const answer: Sent = { status: 200, headers: {}, body: "" };
      const res: ApiResponse = {
        status(code) {
          answer.status = code;
          return res;
        },
        setHeader(name, value) {
          answer.headers[name.toLowerCase()] = value;
        },
        json(body) {
          answer.headers["content-type"] ??= "application/json";
          res.end(JSON.stringify(body));
        },
        end(body) {
          answer.body = body ?? "";
          resolve(answer);
        },
      };
      const req: ApiRequest = {
        method: init?.method ?? "GET",
        url: `${url.pathname}${url.search}`,
        headers: {},
        socket: { remoteAddress },
      };
      gcTeamHandler(req, res).catch(reject);
    });
    return new Response(sent.body, { status: sent.status, headers: sent.headers });
  };
