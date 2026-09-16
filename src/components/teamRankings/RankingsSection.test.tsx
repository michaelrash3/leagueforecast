import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";
import { NATIONAL_TOP, STATE_TOP } from "./RankingsSection";

/**
 * A pool big enough that both leaderboards have to cut something: thirty teams across two states,
 * each playing the next, so every result is connected and the fit has an opinion about all of them.
 */
const bigPool = (): Pool => {
  const teams = Array.from({ length: 30 }, (_, index) =>
    team(`S-${index}`, `Team ${index}`, { state: index % 2 === 0 ? "KY" : "OH" })
  );
  const games = Array.from({ length: 29 }, (_, index) =>
    // A ladder: each team beats the next, so the ranking is the seeding and is easy to assert on.
    game(`g${index}`, "ag_10u_2027", `S-${index}`, `S-${index + 1}`, 6, 2, {
      date: seasonDate(2027),
    })
  );
  return { ageGroups: [ageGroup(10, 2027)], teams, games };
};

const listNames = (heading: RegExp): string[] => {
  const card = screen
    .getByRole("heading", { name: heading })
    .closest<HTMLElement>("div.rounded-lg")!;
  return within(card)
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");
};

describe("the two leaderboards", () => {
  it("leads with the national top 25 and no more", () => {
    renderTeamRankings(bigPool());
    expect(listNames(/national top/i)).toHaveLength(NATIONAL_TOP);
  });

  it("says how many teams the 25 was drawn from", () => {
    renderTeamRankings(bigPool());
    expect(screen.getByText("of 30 ranked")).toBeInTheDocument();
  });

  it("leads with a state top 10 and no more", () => {
    renderTeamRankings(bigPool());
    expect(listNames(/state top/i)).toHaveLength(STATE_TOP);
  });

  it("puts only that state's teams in the state list", () => {
    renderTeamRankings(bigPool());
    // Fifteen teams per state, so a list of ten is a real cut and not just everyone who qualified.
    const shown = (screen.getByRole("combobox", { name: "State" }) as HTMLSelectElement).value;
    const expectedParity = shown === "KY" ? 0 : 1;
    listNames(/state top/i).forEach((text) => {
      const number = Number(/Team (\d+)/.exec(text)?.[1]);
      expect(number % 2).toBe(expectedParity);
    });
  });

  it("re-lists when another state is picked", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    const picker = screen.getByRole("combobox", { name: "State" });

    await user.selectOptions(picker, "OH");
    listNames(/state top/i).forEach((text) => {
      expect(Number(/Team (\d+)/.exec(text)?.[1]) % 2).toBe(1);
    });
  });

  it("explains itself when nobody has a state yet", () => {
    renderTeamRankings({
      ageGroups: [ageGroup(10, 2027)],
      teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
      games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
    });

    expect(screen.getByText(/no team here has a state yet/i)).toBeInTheDocument();
  });
});

describe("the full table", () => {
  it("stays collapsed until it is asked for", () => {
    renderTeamRankings(bigPool());
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Show all 30 teams" })).toBeInTheDocument();
  });

  it("shows every team once opened, not just the leaders", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());

    await user.click(screen.getByRole("button", { name: "Show all 30 teams" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(31); // + header
  });

  it("filters to one state without changing anyone's rating", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    await user.click(screen.getByRole("button", { name: "Show all 30 teams" }));

    const ratingBefore = within(screen.getByRole("table")).getAllByRole("row")[1]!.textContent;
    // Two things are labelled "State" once the table is open — the state-top picker above and this
    // filter — so this one is reached by its id rather than by a name they share.
    await user.selectOptions(document.getElementById("scout-state-filter")!, "KY");

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(16); // 15 KY teams + header
    // Filtering changes who is listed, not how anyone is rated: the leader's row is unchanged.
    expect(rows[1]!.textContent).toBe(ratingBefore);
  });
});

describe("section navigation", () => {
  it("opens the section a link names", () => {
    renderTeamRankings({ ...bigPool(), search: "?section=setup" });
    expect(screen.getByRole("tab", { name: "Setup", selected: true })).toBeInTheDocument();
    expect(screen.getByText(/add an age group by hand/i)).toBeInTheDocument();
  });

  it("puts the section in the URL when one is opened", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());

    await user.click(screen.getByRole("tab", { name: "Games" }));
    expect(new URLSearchParams(window.location.search).get("section")).toBe("games");
  });

  it("shows one section at a time", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());
    expect(screen.getByRole("heading", { name: /national top/i })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Scouting" }));
    expect(screen.queryByRole("heading", { name: /national top/i })).toBeNull();
  });

  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    renderTeamRankings(bigPool());

    screen.getByRole("tab", { name: "Rankings" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Games", selected: true })).toHaveFocus();
  });
});
