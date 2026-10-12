import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/*
 * GameChanger lists some clubs with no state, so a search for one listed a bare name among the
 * dozens of clubs that share it. The clubs that played it are from somewhere, and that is where it
 * is likely from: the result says so, and a search naming that state finds it.
 */
const pool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [
    team("S-HUR", "Hurricanes", { city: "Wilmington" }),
    team("S-FLHUR", "Hurricanes", { state: "FL", city: "Tampa" }),
    team("S-STIX", "Cincy Stix", { state: "OH" }),
    team("S-OTT", "Otters", { state: "OH" }),
    team("S-HAWK", "Hebron Hawks", { state: "KY" }),
    team("S-GATOR", "Gators", { state: "FL" }),
  ],
  games: [
    game("g1", "ag_10u_2027", "S-STIX", "S-HUR", 6, 4, { date: seasonDate(2027) }),
    game("g2", "ag_10u_2027", "S-HUR", "S-OTT", 5, 5, { date: seasonDate(2027) }),
    game("g3", "ag_10u_2027", "S-HAWK", "S-HUR", 2, 3, { date: seasonDate(2027) }),
    game("g4", "ag_10u_2027", "S-FLHUR", "S-GATOR", 7, 1, { date: seasonDate(2027) }),
  ],
});

/** A search box's own results: the page's native selects carry the option role too. */
const resultsOf = (box: HTMLElement) =>
  within(document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement)
    .queryAllByRole("option")
    .filter((option) => !/No team matches/.test(option.textContent ?? ""));

describe("finding a club with no state by where the clubs that played it are from", () => {
  it("says which states' clubs played it, and finds it by that state", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const box = screen.getByRole("combobox", { name: /find a team/i });

    await user.click(box);
    await user.type(box, "hurricanes");
    const lines = resultsOf(box).map((option) => option.textContent ?? "");
    expect(lines).toHaveLength(2);
    expect(lines.some((line) => line.includes("Wilmington, played by OH, KY clubs"))).toBe(true);
    expect(lines.some((line) => line.includes("Tampa, FL"))).toBe(true);

    await user.type(box, " ohio");
    const found = resultsOf(box);
    expect(found).toHaveLength(1);
    expect(found[0]).toHaveTextContent("Wilmington, played by OH, KY clubs");
  });
});
