import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { GcTeamLink } from "../../lib/teamRankings";
import { loadAgeGroups } from "../../lib/teamRankingsStorage";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/*
 * Marking a club as yours before it has played. The only "Mark mine" was on a row of the Full
 * Rankings table, and a row is a club with a game on the page, so a club with none yet could be
 * found by Find a team and opened, and not marked: the user's report of 14 November 2026. Its
 * panel has the button now. Placeholder clubs.
 */
const link = (teamId: string, ageGroupId: string): GcTeamLink => ({
  teamId,
  name: teamId,
  ageGroupId,
});

const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-ACES", "Aces", { state: "KY" }),
    team("S-BEAR", "Bears", { state: "KY" }),
    // On the page by its GameChanger link, its schedule still to come.
    team("S-COME", "Comets", { state: "KY", gcTeams: [link("gcCOME", "ag_10u_2027")] }),
  ],
  games: [game("g1", "ag_10u_2027", "S-ACES", "S-BEAR", 6, 2, { date: seasonDate(2027) })],
});

/** The club's panel, opened from Find a team. */
const open = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const box = screen.getByRole("combobox", { name: /find a team/i });
  await user.click(box);
  await user.type(box, name);
  const list = document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement;
  await user.click(
    within(within(list).getByRole("option", { name: new RegExp(name) })).getByRole("button")
  );
  return screen.findByRole("region", { name });
};

describe("a club with no game yet", () => {
  it("has no row to be marked on", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(await screen.findByRole("button", { name: /Show all \d+ teams?/ }));
    const marks = screen.getAllByRole("button", { name: /Mark mine/ });
    const rows = marks.map((mark) => mark.closest("tr, li")?.textContent ?? "");
    expect(rows.some((row) => row.includes("Aces"))).toBe(true);
    expect(rows.some((row) => row.includes("Comets"))).toBe(false);
  });

  it("is marked as yours from its panel, and the mark taken off there", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await open(user, "Comets");

    const mark = await within(panel).findByRole("button", { name: "☆ Mark mine" });
    expect(mark).toHaveAttribute("aria-pressed", "false");
    await user.click(mark);

    const marked = await within(panel).findByRole("button", { name: "★ My team" });
    expect(marked).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(loadAgeGroups()[0]?.myTeamId).toBe("S-COME"));
    // And the page says so, in the place its My Team card will be once the club has a result.
    const card = await screen.findByRole("region", { name: "My team" });
    expect(card).toHaveTextContent("Comets");
    expect(card).toHaveTextContent("It has no result here yet");

    await user.click(marked);
    await within(panel).findByRole("button", { name: "☆ Mark mine" });
    await waitFor(() => expect(loadAgeGroups()[0]?.myTeamId).toBeUndefined());
    expect(screen.queryByRole("region", { name: "My team" })).toBeNull();
  });

  it("says a club with games is yours on its panel as its row does", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await open(user, "Aces");
    await user.click(await within(panel).findByRole("button", { name: "☆ Mark mine" }));
    await within(panel).findByRole("button", { name: "★ My team" });
    // The table's row for the same club now reads the same.
    await user.click(within(panel).getAllByRole("button", { name: /Close/ })[0]!);
    await user.click(await screen.findByRole("button", { name: /Show all \d+ teams?/ }));
    expect(screen.getAllByRole("button", { name: "★ My team" }).length).toBeGreaterThan(0);
  });
});
