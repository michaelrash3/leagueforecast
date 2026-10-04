import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { markTaken, resetCloudGuard } from "../../lib/cloud/cloudGuard";
import {
  gamesShardLabel,
  loadAgeGroups,
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

describe("a page whose year is in its name alone", () => {
  it("vouches for a lopsided score there, in the year storage filed it under", async () => {
    const user = userEvent.setup();
    // A page from before pages stored their year: storage reads 2027 off its name.
    const { year: _year, ...named } = thisYear;
    renderTeamRankings(pool({ ageGroups: [lastYear, named], search: "?age=10&year=2027" }));
    await user.click(screen.getByRole("tab", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: "Check the pool" }));
    const list = (await screen.findByText(/^Won by more than \d+ runs$/)).closest("div")!;
    await user.click(within(list).getByRole("button", { name: /It.s real/ }));
    await waitFor(() => expect(stored("lopsided")?.scoreConfirmed).toBe(34));
  });
});

describe("games added and taken away", () => {
  const leagueOnPage = (): Partial<Pool> => ({
    league: {
      teams: [
        { id: "L-HAWKS", name: "Hawks" },
        { id: "L-WRENS", name: "Wrens" },
      ],
      matchups: [{ id: "m1", date: "9/20", away: "L-HAWKS", home: "L-WRENS" }],
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

  it("adds a game with the new clubs it names, and no club League Standings made but did not name", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool(leagueOnPage()));
    await user.type(screen.getByPlaceholderText("Team name"), "Hawks");
    await user.type(screen.getByPlaceholderText("Opponent name"), "Brand New Nine");
    const [scoreA, scoreB] = screen.getAllByPlaceholderText("Score");
    await user.type(scoreA as HTMLElement, "3");
    await user.type(scoreB as HTMLElement, "2");
    await user.click(screen.getByRole("button", { name: "Add Game" }));
    await waitFor(() =>
      expect(loadScoutTeams().map((entry) => entry.name)).toEqual([
        "Rays",
        "Jays",
        "Owls",
        "Hawks",
        "Brand New Nine",
      ])
    );
    const added = loadScoutGamesForYear(2027).filter((entry) => entry.id.startsWith("scout_"));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ teamAScore: 3, teamBScore: 2, ageGroupId: thisYear.id });
  });

  it("puts a removed game back on Undo, keeping what was changed since", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    const played = await gameRow(user, "2026-09-12");
    await user.click(within(played).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(stored("played")).toBeUndefined());
    // A score entered after the removal, before its Undo.
    const open = await gameRow(user, "2026-09-26");
    await user.click(within(open).getByRole("button", { name: "Enter score" }));
    const [a, b] = within(open).getAllByPlaceholderText("Score");
    await user.type(a as HTMLElement, "6");
    await user.type(b as HTMLElement, "3");
    await user.click(within(open).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(stored("open")).toMatchObject({ teamAScore: 6 }));
    const call = harness.showToast.mock.calls.find((entry) => entry[0] === "Game removed.")!;
    act(() => (call[1] as { onAction: () => void }).onAction());
    await waitFor(() => expect(stored("played")).toMatchObject({ teamAScore: 5, teamBScore: 4 }));
    expect(stored("open")).toMatchObject({ teamAScore: 6, teamBScore: 3 });
    expect(loadScoutGamesForYear(2027).map((entry) => entry.id)).toEqual([
      "played",
      "lopsided",
      "open",
    ]);
  });

  it("imports a schedule with the new clubs it names alone, and Undo takes games and clubs back out", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool(leagueOnPage()));
    await user.click(screen.getByRole("button", { name: "Import games" }));
    await user.click(screen.getByLabelText("Games to import"));
    await user.paste("Date,Opponent,Us,Them\n2026-08-22,Velocirabbits,6,5\n2026-08-23,Rays,3,10");
    await user.click(screen.getByRole("button", { name: "Read games" }));
    await user.type(screen.getByLabelText("Whose schedule is this?"), "Hawks");
    await user.click(screen.getByRole("button", { name: /^Add 2 games$/ }));
    await waitFor(() =>
      expect(loadScoutTeams().map((entry) => entry.name)).toEqual([
        "Rays",
        "Jays",
        "Owls",
        "Hawks",
        "Velocirabbits",
      ])
    );
    const imported = () =>
      loadScoutGamesForYear(2027).filter((entry) => entry.id.startsWith("scout_"));
    expect(imported()).toHaveLength(2);
    const call = harness.showToast.mock.calls.find((entry) => entry[0] === "Added 2 games.")!;
    act(() => (call[1] as { onAction: () => void }).onAction());
    await waitFor(() => expect(imported()).toHaveLength(0));
    expect(loadScoutTeams().map((entry) => entry.name)).toEqual(["Rays", "Jays", "Owls"]);
  });

  it("marks a club League Standings made as the page's own, the club joining the roster alone", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool({ ...leagueOnPage(), search: "?age=10&year=2027" }));
    await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
    const row = within(screen.getByRole("table"))
      .getByRole("button", { name: "Hawks" })
      .closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: /mark mine/i }));
    await waitFor(() =>
      expect(loadAgeGroups().find((group) => group.id === thisYear.id)?.myTeamId).toBeDefined()
    );
    const marked = loadAgeGroups().find((group) => group.id === thisYear.id)?.myTeamId;
    expect(loadScoutTeams().find((entry) => entry.id === marked)?.name).toBe("Hawks");
    expect(loadScoutTeams().map((entry) => entry.name)).toEqual(["Rays", "Jays", "Owls", "Hawks"]);
    // Pressed again, the mark comes off.
    await user.click(
      await within(screen.getByRole("table")).findByRole("button", { name: /my team/i })
    );
    await waitFor(() =>
      expect(loadAgeGroups().find((group) => group.id === thisYear.id)).not.toHaveProperty(
        "myTeamId"
      )
    );
  });
});
