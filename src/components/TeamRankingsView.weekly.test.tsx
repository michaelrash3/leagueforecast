import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../test/teamRankingsHarness";

/*
 * This device's Setup reads the last weekly re-measure of where a rating starts through the
 * member's reader of `live/` (`liveReader`, `readLastClosedLevel`) and hands it to the Model check
 * card. The card's own tests hand it a reader; this one holds the wiring between: the view passing
 * `lastWeekly`, read through the session's reader, as a browser that keeps a cloud copy would.
 */

const { WEEKLY } = vi.hoisted(() => ({
  WEEKLY: {
    format: 1,
    measuredOn: "2026-10-12",
    measuredAt: "2026-10-12T08:40:00.000Z",
    year: 2027,
    check: {
      held: -1.6,
      level: -1.7417,
      standardError: 0.1628,
      games: 79_981,
      clusters: 10_590,
      weeks: [{ from: "2026-10-05", to: "2026-10-11", games: 6_528, level: -1.7444 }],
      paired: { by: -0.000102, standardError: 0.000133, samples: 79_981 },
      better: false,
    },
  },
}));

vi.mock("../lib/cloud/cloudSession", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/cloud/cloudSession")>()),
  liveReader: async () => ({
    readMeta: async () => null,
    getChunk: async () => null,
    readClosedLevel: async () => WEEKLY,
  }),
}));

describe("the weekly re-measure on this device's Setup", () => {
  it("is read through the member's reader of live/ and shown on the Model check card", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: "2026-09-12" })],
    });
    await user.click(screen.getByRole("tab", { name: "Setup" }));

    expect(
      await screen.findByText(
        /^Last weekly re-measure, 12 Oct, on the 2027 squad year\. Starting level for leagues with few outside games: held at −1\.6; /
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check the model" })).toBeInTheDocument();
  });
});
