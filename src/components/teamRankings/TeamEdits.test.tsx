import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { markTaken, resetCloudGuard } from "../../lib/cloud/cloudGuard";
import {
  gamesShardLabel,
  loadRealClubs,
  loadScoutGamesForYear,
  loadScoutTeams,
  onCloudPoolWrite,
} from "../../lib/teamRankingsStorage";
import {
  ageGroup,
  game,
  renderTeamRankings,
  team,
  type Pool,
} from "../../test/teamRankingsHarness";

/*
 * The everyday edits on Team Rankings, as the page makes them: a score entered, a game kept out of
 * the maths and put back, a club's state, and a lopsided score vouched for. Each writes the one
 * year it touches and the roster as it is stored, nothing more. Placeholder names throughout.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
});
afterAll(() => vi.useRealTimers());
afterEach(() => {
  onCloudPoolWrite(null);
  resetCloudGuard();
});

const lastYear = ageGroup(10, 2026);
const thisYear = ageGroup(10, 2027, { seasonIds: ["default"] });
const pulled = (id: string, name: string) =>
  team(id, name, {
    state: "OH",
    gcTeams: [{ teamId: `gc${id}`, name: `${name} 10U`, ageGroupId: thisYear.id }],
  });

const pool = (extra: Partial<Pool> = {}): Pool => ({
  ageGroups: [lastYear, thisYear],
  teams: [pulled("S-RAYS", "Rays"), pulled("S-JAYS", "Jays"), pulled("S-OWLS", "Owls")],
  games: [
    game("old", lastYear.id, "S-RAYS", "S-JAYS", 2, 1, { date: "2026-04-11" }),
    game("played", thisYear.id, "S-RAYS", "S-JAYS", 5, 4, { date: "2026-09-12" }),
    game("lopsided", thisYear.id, "S-OWLS", "S-JAYS", 34, 0, { date: "2026-09-19" }),
    {
      id: "open",
      ageGroupId: thisYear.id,
      teamAId: "S-OWLS",
      teamBId: "S-RAYS",
      date: "2026-09-26",
    },
  ],
  search: "?section=games&age=10&year=2027",
  ...extra,
});

/** The logged game dated `date`, every game shown. */
const gameRow = async (user: ReturnType<typeof userEvent.setup>, date: string) => {
  const showAll = screen.queryByRole("button", { name: /^Show all \d+ games$/ });
  if (showAll) await user.click(showAll);
  const card = screen.getByText(/^Logged games/).closest<HTMLElement>("div.rounded-lg")!;
  return within(card)
    .getAllByRole("listitem")
    .find((item) => item.textContent?.includes(date)) as HTMLElement;
};

const stored = (id: string) => loadScoutGamesForYear(2027).find((entry) => entry.id === id);

/** The pool's keys written from here on, as the cloud copy hears them. */
const watchWrites = () => {
  const keys: string[] = [];
  onCloudPoolWrite((key) => keys.push(key));
  return keys;
};
const shardOf = (year: number) => gamesShardLabel(year);

describe("a game's score and whether it counts", () => {
  it("takes a score entered for a game still to be played, in its own year alone", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const row = await gameRow(user, "2026-09-26");
    await user.click(within(row).getByRole("button", { name: "Enter score" }));
    const [a, b] = within(row).getAllByPlaceholderText("Score");
    const writes = watchWrites();
    await user.type(a as HTMLElement, "6");
    await user.type(b as HTMLElement, "3");
    await user.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stored("open")).toMatchObject({ teamAScore: 6, teamBScore: 3 }));
    expect(writes.some((key) => key.endsWith(shardOf(2026)))).toBe(false);
  });

  it("keeps a played game out of the maths, and puts it back", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const row = await gameRow(user, "2026-09-12");
    await user.click(within(row).getByRole("button", { name: "Don't count" }));
    await waitFor(() => expect(stored("played")?.excluded).toBe(true));
    await user.click(within(row).getByRole("button", { name: "Count it" }));
    await waitFor(() => expect(stored("played")).not.toHaveProperty("excluded"));
  });
});

describe("a club's state", () => {
  it("sets it on the club's panel, writing the roster as it is stored and no team the league made", async () => {
    const user = userEvent.setup();
    renderTeamRankings(
      pool({
        search: "?age=10&year=2027",
        league: {
          teams: [
            { id: "L-RAYS", name: "Rays" },
            { id: "L-HAWKS", name: "Hawks" },
          ],
          matchups: [{ id: "m1", date: "9/20", away: "L-RAYS", home: "L-HAWKS" }],
          logs: {},
        },
      })
    );
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Rays" }));
    const box = await screen.findByPlaceholderText("KY");
    await user.clear(box);
    await user.type(box, "ky");
    await waitFor(() =>
      expect(loadScoutTeams().find((entry) => entry.id === "S-RAYS")?.state).toBe("KY")
    );
    expect(loadScoutTeams().map((entry) => entry.id)).toEqual(["S-RAYS", "S-JAYS", "S-OWLS"]);
  });
});

describe("a club's state, further", () => {
  const withLeague = () =>
    pool({
      search: "?age=10&year=2027",
      league: {
        teams: [
          { id: "L-RAYS", name: "Rays" },
          { id: "L-HAWKS", name: "Hawks" },
          { id: "L-WRENS", name: "Wrens" },
        ],
        matchups: [
          { id: "m1", date: "9/20", away: "L-HAWKS", home: "L-WRENS" },
          { id: "m2", date: "9/21", away: "L-RAYS", home: "L-HAWKS" },
        ],
        logs: {
          m1: {
            awayRuns: "4",
            awayHits: "",
            awayK: "",
            homeRuns: "2",
            homeHits: "",
            homeK: "",
            innings: "6",
            isFinal: true,
          },
        },
      },
    });

  it("adds a club League Standings made to the roster with its state, and no other", async () => {
    const user = userEvent.setup();
    renderTeamRankings(withLeague());
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Hawks" }));
    await user.type(await screen.findByPlaceholderText("KY"), "in");
    await waitFor(() =>
      expect(loadScoutTeams().find((entry) => entry.name === "Hawks")?.state).toBe("IN")
    );
    expect(loadScoutTeams().map((entry) => entry.name)).toEqual(["Rays", "Jays", "Owls", "Hawks"]);
  });

  it("saves nothing for a state still being typed: one letter is not a state", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool({ search: "?age=10&year=2027" }));
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Rays" }));
    const box = await screen.findByPlaceholderText("KY");
    await user.tripleClick(box);
    await user.keyboard("k");
    expect(box).toHaveValue("K");
    expect(loadScoutTeams().find((entry) => entry.id === "S-RAYS")?.state).toBe("OH");
    await user.keyboard("y");
    await waitFor(() =>
      expect(loadScoutTeams().find((entry) => entry.id === "S-RAYS")?.state).toBe("KY")
    );
  });

  it("keeps the state the store holds when it will not take another, and says so", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool({ search: "?age=10&year=2027" }));
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: "Rays" }));
    const box = await screen.findByPlaceholderText("KY");
    // Another tab took a newer copy of the pool in: this one may not write over it.
    markTaken("pool", false);
    await user.clear(box);
    await user.type(box, "ky");
    await waitFor(() => expect(harness.toasts()).toContain("Could not save (storage full)."));
    expect(loadScoutTeams().find((entry) => entry.id === "S-RAYS")?.state).toBe("OH");
    expect(box).toHaveValue("OH");
  });
});

describe("a club said to be real", () => {
  it("stays on the list when the store will not keep the answer", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool({ search: "?age=10&year=2027" }));
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: "Check the pool" }));
    const list = (await screen.findByText(/^Clubs that may not be real$/)).closest("div")!;
    const owls = within(list).getByText("Owls").closest("li") as HTMLElement;
    markTaken("pool", false);
    await user.click(within(owls).getByRole("button", { name: /It.s real/ }));
    expect(loadRealClubs().size).toBe(0);
    expect(within(list).getByText("Owls")).toBeInTheDocument();
  });
});

describe("a lopsided score vouched for", () => {
  it("counts it at the margin it reads now, writing that game's year alone", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool({ search: "?age=10&year=2027" }));
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: "Check the pool" }));
    const writes = watchWrites();
    const list = (await screen.findByText(/^Won by more than \d+ runs$/)).closest("div")!;
    await user.click(within(list).getByRole("button", { name: /It.s real/ }));
    await waitFor(() => expect(stored("lopsided")?.scoreConfirmed).toBe(34));
    expect(writes.some((key) => key.endsWith(shardOf(2026)))).toBe(false);
  });
});
