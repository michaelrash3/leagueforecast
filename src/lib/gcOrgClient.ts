import {
  bodylessFailure,
  gcProxyEndpoint,
  isAbortError,
  readTeamResult,
  signedInFetch,
  unconfiguredMessage,
  type FetchGcTeamOptions,
  type GcFetchFailure,
} from "./gameChangerClient";

/**
 * The GameChanger proxy's organization route (`?org=`), apart from the client every pull uses
 * (`gameChangerClient.ts`): only a League Standings start from an organization asks it, so it is
 * fetched with that panel rather than with Team Rankings, whose load the client is part of.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** An organization's team list through the proxy: GameChanger's own body, or why there is none. */
export type GcOrgTeamsFetch = { ok: true; raw: string } | GcFetchFailure;

/**
 * An organization's team list (`?org=`), for a League Standings season started from a GameChanger
 * organization: one request, its body handed back for the caller to read (`readGcOrgTeams`), and
 * every failure as data, read as a team's is. Never throws.
 */
export const fetchGcOrgTeams = async (
  orgId: string,
  { fetchImpl = signedInFetch, signal, endpoint = gcProxyEndpoint() }: FetchGcTeamOptions = {}
): Promise<GcOrgTeamsFetch> => {
  try {
    const response = await fetchImpl(`${endpoint}?org=${encodeURIComponent(orgId)}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!isRecord(payload)) {
      if (response.status === 404 || (response.status >= 200 && response.status < 300)) {
        return {
          ok: false,
          reason: "unconfigured",
          message: unconfiguredMessage(endpoint),
          status: response.status,
        };
      }
      return bodylessFailure(endpoint, response.status);
    }
    if (payload.ok === true && typeof payload.raw === "string")
      return { ok: true, raw: payload.raw };
    const failure = payload.ok === true ? null : readTeamResult(payload, endpoint, response.status);
    if (failure && !failure.ok) return failure;
    return {
      ok: false,
      reason: "unrecognized",
      message: `${endpoint} answered ok but without GameChanger's list of the organization's teams.`,
      status: response.status,
    };
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) {
      return { ok: false, reason: "network", message: "GameChanger pull cancelled." };
    }
    return {
      ok: false,
      reason: "network",
      message: error instanceof Error ? error.message : "GameChanger pull failed.",
    };
  }
};
