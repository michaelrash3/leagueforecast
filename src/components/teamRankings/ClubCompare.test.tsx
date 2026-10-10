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

const pickCompare = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const box = await screen.findByRole("combobox", { name: /compare with/i });
  await user.click(box);
  await user.type(box, name);
  await user.keyboard("{Enter}");
};

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

  it("answers first: who should win, who should lose and by how many runs", async () => {
    // The question the box asks is "how would this team fare", so the answer leads, above the games
    // behind it and above the write-up of the team's own rank.
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    await pickCompare(user, "hawks");

    const forecast = screen.getByRole("region", {
      name: "Forecast: River Otters against Hill Hawks",
    });
    expect(forecast).toHaveTextContent(/Hill Hawks should beat River Otters by \d+\.\d runs?/);
    const chance = forecast.textContent?.match(
      /Win chance: Hill Hawks (\d+)%, River Otters (\d+)%/
    );
    expect(chance).not.toBeNull();
    expect(Number(chance![1]) + Number(chance![2])).toBe(100);
    expect(Number(chance![1])).toBeGreaterThan(50);

    const after = (first: Element, second: Element) =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const panel = screen.getByRole("region", { name: "River Otters and Hill Hawks compared" });
    expect(after(forecast, within(panel).getByText("Head to head"))).toBe(true);
    expect(after(forecast, screen.getByText("Why this ranking"))).toBe(true);

    // The same numbers the report gives Hill Hawks added by name, so the two never disagree.
    const margin = forecast.textContent?.match(/by (\d+\.\d) run/)?.[1];
    await user.type(screen.getByRole("combobox", { name: /check a team/i }), "hawks");
    await user.keyboard("{Enter}");
    const added = await screen.findByRole("table", { name: "Teams you added" });
    expect(added).toHaveTextContent(`-${margin}`);
    expect(added).toHaveTextContent(`${chance![2]}%`);
  });

  it("calls a game between two equal clubs dead even rather than naming a winner", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027, { myTeamId: "S-US" })],
      teams: [team("S-US", "River Otters"), team("S-TWIN", "Lake Otters"), team("S-BEAR", "Bears")],
      games: [
        game("u1", "ag_10u_2027", "S-US", "S-BEAR", 5, 3, { date: on }),
        game("t1", "ag_10u_2027", "S-TWIN", "S-BEAR", 5, 3, { date: on }),
      ],
    });
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    await pickCompare(user, "lake");

    const forecast = screen.getByRole("region", {
      name: "Forecast: River Otters against Lake Otters",
    });
    expect(forecast).toHaveTextContent("Too close to call: dead even");
    expect(forecast).toHaveTextContent("Win chance: River Otters 50%, Lake Otters 50%");
    expect(forecast).not.toHaveTextContent("should beat");
  });

  it("says so when nothing joins the two clubs, so the forecast is a guess", async () => {
    const user = userEvent.setup();
    const island = pool();
    island.teams.push(team("S-LOON", "Loons"), team("S-GULL", "Gulls"));
    island.games.push(game("i1", "ag_10u_2027", "S-LOON", "S-GULL", 7, 1, { date: on }));
    renderTeamRankings(island);
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    await pickCompare(user, "loons");

    const forecast = screen.getByRole("region", { name: "Forecast: River Otters against Loons" });
    expect(forecast).toHaveTextContent("no shared opponents yet");
    expect(forecast).toHaveTextContent(/a guess/);
  });

  it("puts the comparison away when cleared", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: /scouting/i }));
    await pickCompare(user, "hawks");

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByRole("region", { name: /compared/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /^Forecast/ })).toBeNull();
  });
});
