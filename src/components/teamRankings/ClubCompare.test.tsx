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
 * A coach scouts a club by what it did against the clubs both have played. The projection between
 * two clubs is one number; Compare with lays out the games behind it.
 */
const on = seasonDate(2027);
const pool = () => ({
  ageGroups: [ageGroup(10, 2027, { myTeamId: "S-US" })],
  teams: [
    team("S-US", "River Otters"),
    team("S-THEM", "Hill Hawks"),
    team("S-BEAR", "Bears"),
    team("S-CUB", "Cubs"),
  ],
  games: [
    game("h1", "ag_10u_2027", "S-US", "S-THEM", 4, 6, { date: on }),
    game("u1", "ag_10u_2027", "S-US", "S-BEAR", 8, 3, { date: on }),
    game("t1", "ag_10u_2027", "S-BEAR", "S-THEM", 5, 6, { date: on }),
    game("u2", "ag_10u_2027", "S-CUB", "S-US", 2, 1, { date: on }),
    game("t2", "ag_10u_2027", "S-THEM", "S-CUB", 9, 0, { date: on }),
  ],
});

describe("comparing two clubs in Scouting", () => {
  it("lays out their meeting, the clubs both played, and each one's results", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));

    const box = await screen.findByRole("combobox", { name: /compare with/i });
    await user.click(box);
    await user.type(box, "hawks");
    await user.keyboard("{Enter}");

    const panel = screen.getByRole("region", { name: "River Otters and Hill Hawks compared" });
    expect(panel).toHaveTextContent("River Otters L 4–6");
    const common = within(panel).getByRole("table", { name: "Common opponents" });
    const bears = within(common).getByText("Bears").closest("tr")!;
    expect(bears).toHaveTextContent("W 8–3");
    expect(bears).toHaveTextContent("W 6–5");
    const cubs = within(common).getByText("Cubs").closest("tr")!;
    expect(cubs).toHaveTextContent("L 1–2");
    expect(cubs).toHaveTextContent("W 9–0");
  });

  it("puts the comparison away when cleared", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    const box = await screen.findByRole("combobox", { name: /compare with/i });
    await user.click(box);
    await user.type(box, "hawks");
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByRole("region", { name: /compared/ })).toBeNull();
  });
});
