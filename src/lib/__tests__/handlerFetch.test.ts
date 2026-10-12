import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import profileFixture from "./fixtures/gc-team-profile.json";
import gamesFixture from "./fixtures/gc-team-games.json";
import { clearProfileCache } from "../../../api/gc-team";
import { handlerFetch } from "../../../scripts/handlerFetch";
import { fetchGcTeams } from "../gameChangerClient";

/*
 * The app's GameChanger client answered by the proxy's own handler in the same process
 * (`scripts/handlerFetch.ts`), as the nightly refresh on GitHub asks: GameChanger is the only thing
 * on the network, stood in for here.
 */

const TEAM_ID = "gsUthn4XoIxS";

beforeEach(() => {
  clearProfileCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes("gc.com")) throw new Error(`Only GameChanger is on the network: ${url}`);
      const body = url.endsWith("/games") ? gamesFixture : profileFixture;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the proxy's handler as the client's fetch", () => {
  it("answers a pull with the team's schedule, asking nothing but GameChanger", async () => {
    const answers = await fetchGcTeams([TEAM_ID], { fetchImpl: handlerFetch(), concurrency: 1 });
    const answer = answers.get(TEAM_ID);
    expect(answer?.ok).toBe(true);
    if (!answer?.ok) return;
    expect(answer.schedule.profile.id).toBe(TEAM_ID);
    expect(answer.schedule.games.length).toBeGreaterThan(0);
  });

  it("carries the handler's status and headers, as a deployed proxy's answer would", async () => {
    const response = await handlerFetch()("/api/gc-team?ids=not%20an%20id&raw=1");
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/json/);
    expect(await response.json()).toMatchObject({ ok: false });
  });
});
