import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import type { LiveLeagueState } from "./lib/live/leagueSync";
import { writeOurTeam } from "./lib/preferences";
import { readLook, saveLook } from "./lib/sinceLastLook";
import { getActiveSeasonId, saveLogs, saveMatchups, saveTeams } from "./lib/storage";

/*
 * Opening the app after a while starts with what changed for the team followed, counting the
 * scores entered on this device too, which the digest of other devices' changes never told.
 * Placeholder names.
 */
beforeAll(() => prefetchAllViews());

const live = vi.hoisted(() => ({ state: { kind: "off" } as LiveLeagueState }));
vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: () => ({
    state: live.state,
    guardUndo: () => null,
    removeSeason: async () => true,
  }),
}));

const TWO_DAYS = 2 * 24 * 3_600_000;
const final = (awayRuns: string, homeRuns: string) => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

describe("Since you last looked, in the app", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    saveTeams([
      { id: "ACES", name: "Aces" },
      { id: "BEAR", name: "Bears" },
      { id: "COMT", name: "Comets" },
    ]);
    saveMatchups([
      { id: "g1", date: "10/18", away: "BEAR", home: "COMT" },
      { id: "g2", date: "10/24", away: "ACES", home: "BEAR" },
      { id: "g3", date: "11/1", away: "COMT", home: "ACES" },
    ]);
    saveLogs({ g1: final("7", "2"), g2: final("9", "4") });
    const seasonId = getActiveSeasonId();
    writeOurTeam(seasonId, "ACES");
    // The last visit, two days ago: one game final, the Aces third and given 30% in the next.
    saveLook(seasonId, {
      v: 1,
      at: Date.now() - TWO_DAYS,
      places: { BEAR: 1, COMT: 2, ACES: 3 },
      finals: ["g1"],
      chances: { g2: { a: "ACES", pA: 0.3 } },
    });
  });
  afterEach(() => {
    live.state = { kind: "off" };
  });

  it("opens on the followed team's news, and puts it away", async () => {
    const user = userEvent.setup();
    render(<App />);
    const card = await screen.findByRole(
      "region",
      { name: "Since you last looked" },
      { timeout: 20_000 }
    );
    expect(card).toHaveTextContent("W 9–4 vs Bears · you had 30%");
    expect(card).toHaveTextContent(/Place 3 then, [12] now/);

    await user.click(within(card).getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("region", { name: "Since you last looked" })).toBeNull();
    expect(readLook(getActiveSeasonId())?.finals).toEqual(expect.arrayContaining(["g1", "g2"]));
  }, 30_000);
});
