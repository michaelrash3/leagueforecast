import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";
import { beginPull, isPoolBusy, resetPullSession } from "../../lib/pullSession";
import { loadScoutGames, loadTidyStamp } from "../../lib/teamRankingsStorage";

afterEach(() => resetPullSession());

/**
 * One club's schedule names the opponent; the other posted the same game against a stand-in with
 * the mirrored score. Settling that is the tidy's first pass, and a real pool was found with eleven
 * thousand of them unsettled — not because the pass was wrong, but because it never finished.
 */
const untidiedPool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-HOME", "Home Club", { state: "KY" }),
    team("S-AWAY", "Away Club", { state: "KY" }),
    team("S-TBD", "TBD- 3:00 PM", { placeholder: true }),
  ],
  games: [
    game("named", "ag_10u_2027", "S-HOME", "S-AWAY", 6, 2, {
      date: seasonDate(2027),
      source: { kind: "gamechanger" as const, teamId: "gcHOME", gameId: "n1" },
    }),
    game("slot", "ag_10u_2027", "S-AWAY", "S-TBD", 2, 6, {
      date: seasonDate(2027),
      source: { kind: "gamechanger" as const, teamId: "gcAWAY", gameId: "s1" },
    }),
  ],
  untidied: true,
});

describe("tidying a pool nobody asked about", () => {
  it("settles what it can and says so, with nothing pressed", async () => {
    const harness = renderTeamRankings(untidiedPool());

    await waitFor(() =>
      expect(harness.toasts().join(" ")).toMatch(
        /placeholder named from the other team's schedule/i
      )
    );
    // The stand-in row is now filed against the club the other side named.
    const games = loadScoutGames();
    expect(games.some((entry) => entry.teamAId === "S-TBD" || entry.teamBId === "S-TBD")).toBe(
      false
    );
  });

  it("stamps the pool so it is not tidied again for nothing", async () => {
    const harness = renderTeamRankings(untidiedPool());
    await waitFor(() => expect(harness.toasts().length).toBeGreaterThan(0));
    expect(loadTidyStamp()).toBeTruthy();
  });

  /*
   * Both write the whole pool. A tidy finishing during a pull would save over the teams the pull
   * had just written — and the pull's cursor has already counted them settled, so a resume would
   * never fetch them again.
   */
  it("stays out of the way while a pull has the pool", async () => {
    beginPull("2026-09-17T08:00:00.000Z");
    const harness = renderTeamRankings(untidiedPool());

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(harness.toasts()).toEqual([]);
    // Untouched: the stamp is still unset, so it comes round again once the pull lets go.
    expect(loadTidyStamp()).toBeNull();
    expect(isPoolBusy()).toBe(true);
  });
});
