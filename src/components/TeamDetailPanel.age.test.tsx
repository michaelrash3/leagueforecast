import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team, type Pool } from "../test/teamRankingsHarness";
import { loadNamedAges, loadScoutGamesForYear, loadScoutTeams } from "../lib/teamRankingsStorage";

/**
 * A club the app filed a year too young, set right from its own panel.
 *
 * The case that asked for it: a fall-ball club filed at 8U while its league, and every club it
 * plays, is 9U, with nothing on the page to move it. Invented names throughout.
 */
const u8 = ageGroup(8, 2027);
const u9 = ageGroup(9, 2027);

const pool = (): Pool => ({
  ageGroups: [u8, u9],
  teams: [
    team("S-HIVE", "Example Hive *Fall Ball*", {
      state: "OH",
      gcTeams: [
        {
          teamId: "gcHIVEFALL26",
          name: "Example Hive *Fall Ball*",
          ageGroupId: u8.id,
          season: "fall",
          seasonYear: 2026,
          ageLevel: 8,
        },
      ],
    }),
    team("S-OWLS", "Owls", {
      state: "OH",
      gcTeams: [
        {
          teamId: "gcOWLSFALL26",
          name: "Owls 9U",
          ageGroupId: u9.id,
          season: "fall",
          seasonYear: 2026,
          ageLevel: 9,
        },
      ],
    }),
    team("S-FOXES", "Foxes", { state: "OH" }),
    team("S-BEARS", "Bears", { state: "OH" }),
  ],
  games: [
    game("g1", u8.id, "S-HIVE", "S-OWLS", 5, 9, {
      date: "2026-09-12",
      ageLevelA: 8,
      ageLevelB: 9,
      source: { kind: "gamechanger", teamId: "gcHIVEFALL26", gameId: "g1" },
    }),
    game("g2", u8.id, "S-HIVE", "S-FOXES", 13, 0, {
      date: "2026-09-25",
      ageLevelA: 8,
      source: { kind: "gamechanger", teamId: "gcHIVEFALL26", gameId: "g2" },
    }),
    game("g3", u9.id, "S-OWLS", "S-BEARS", 6, 2, {
      date: "2026-09-19",
      ageLevelA: 9,
      source: { kind: "gamechanger", teamId: "gcOWLSFALL26", gameId: "g3" },
    }),
  ],
});

beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const hive = () => loadScoutTeams().find((one) => one.id === "S-HIVE");
const pageOf = (gameId: string) =>
  loadScoutGamesForYear(2027).find((one) => one.id === gameId)?.ageGroupId;

/**
 * Opened from Find a team, the way it was reached in the case above: 8U is below the youngest
 * level with a table (`MIN_RANKED_AGE_LEVEL`), so a club filed there is on no board at all.
 */
const openHive = async (user: ReturnType<typeof userEvent.setup>) => {
  const box = screen.getByRole("combobox", { name: /find a team/i });
  await user.click(box);
  await user.type(box, "hive");
  const list = document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement;
  await user.click(
    within(within(list).getByRole("option", { name: /Example Hive/ })).getByRole("button")
  );
  return screen.getByRole("region", { name: "Example Hive *Fall Ball*" });
};

describe("setting a club's age on its panel", () => {
  it("moves the club and its own games to that age, holds it there, and undoes cleanly", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    const panel = await openHive(user);

    // Where the app filed it, said as that rather than as something GameChanger said.
    expect(panel).toHaveTextContent("Fall 2026 · filed at 8U");
    expect(panel).toHaveTextContent("The app filed this club at 8U.");

    await user.selectOptions(within(panel).getByLabelText("Age"), "9");
    await user.click(within(panel).getByRole("button", { name: "Set age" }));

    expect(harness.toasts()).toContain(
      "Example Hive *Fall Ball* is 9U now: 2 of its games moved to 9U 2027."
    );
    expect(hive()?.gcTeams?.[0]).toMatchObject({ ageGroupId: u9.id, ageLevel: 9 });
    expect([pageOf("g1"), pageOf("g2"), pageOf("g3")]).toEqual([u9.id, u9.id, u9.id]);
    expect(loadNamedAges().get("gcHIVEFALL26")).toMatchObject({
      level: 9,
      pinned: true,
      was: 8,
    });
    expect(panel).toHaveTextContent("You set this club to 9U; the app had filed it at 8U.");

    // The toast's undo puts back exactly what was there.
    const undo = harness.showToast.mock.calls[harness.showToast.mock.calls.length - 1]?.[1] as {
      onAction: () => void;
    };
    act(() => undo.onAction());
    expect(hive()?.gcTeams?.[0]).toMatchObject({ ageGroupId: u8.id, ageLevel: 8 });
    expect([pageOf("g1"), pageOf("g2")]).toEqual([u8.id, u8.id]);
    expect(loadNamedAges().has("gcHIVEFALL26")).toBe(false);
  });

  it("lets the app decide again, back at the level it had filed the club at", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    const panel = await openHive(user);
    await user.selectOptions(within(panel).getByLabelText("Age"), "9");
    await user.click(within(panel).getByRole("button", { name: "Set age" }));
    // A second change keeps the level the app had, not the one set a moment ago.
    await user.selectOptions(within(panel).getByLabelText("Age"), "10");
    await user.click(within(panel).getByRole("button", { name: "Set age" }));
    expect(loadNamedAges().get("gcHIVEFALL26")).toMatchObject({ level: 10, was: 8 });

    await user.click(within(panel).getByRole("button", { name: "Let the app decide" }));

    expect(harness.toasts()).toContain(
      "Example Hive *Fall Ball* is back at 8U, where the app had it."
    );
    expect(loadNamedAges().has("gcHIVEFALL26")).toBe(false);
    expect(hive()?.gcTeams?.[0]).toMatchObject({ ageGroupId: u8.id, ageLevel: 8 });
    expect([pageOf("g1"), pageOf("g2")]).toEqual([u8.id, u8.id]);
    expect(panel).toHaveTextContent("The app filed this club at 8U.");
  });

  it("ranks the club on the page of the age it was set to", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openHive(user);
    await user.selectOptions(within(panel).getByLabelText("Age"), "9");
    await user.click(within(panel).getByRole("button", { name: "Set age" }));

    await user.click(screen.getByRole("button", { name: "9U" }));
    await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
    expect(
      within(screen.getByRole("table")).getByRole("button", { name: "Example Hive *Fall Ball*" })
    ).toBeInTheDocument();
  });
});

describe("finding a club by its GameChanger link", () => {
  it("offers the club an id is linked to, and says so when no club carries it", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const box = screen.getByRole("combobox", { name: /find a team/i });
    const list = () =>
      document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement;

    await user.click(box);
    await user.type(box, "https://web.gc.com/teams/gcHIVEFALL26");
    expect(
      within(list())
        .getAllByRole("option")
        .map((one) => one.textContent)
    ).toEqual([expect.stringContaining("Example Hive *Fall Ball*")]);

    await user.clear(box);
    await user.type(box, "https://web.gc.com/teams/gcNOBODY0000");
    expect(list()).toHaveTextContent("No team here is linked to that GameChanger page.");
  });
});

describe("why a club is filed at its age", () => {
  const sourced = (link: Record<string, unknown>): Pool => {
    const base = pool();
    return {
      ...base,
      teams: base.teams.map((one) =>
        one.id === "S-HIVE"
          ? { ...one, gcTeams: one.gcTeams?.map((entry) => ({ ...entry, ...link })) }
          : one
      ),
    };
  };

  it("says which rule filed it and what GameChanger's own age field says", async () => {
    const user = userEvent.setup();
    renderTeamRankings(sourced({ ageFrom: "list" }));
    const panel = await openHive(user);
    expect(panel).toHaveTextContent(
      "filed at 8U, from its league or organization on your list; GameChanger gives no age"
    );
  });

  it("names GameChanger's field when that is what answered", async () => {
    const user = userEvent.setup();
    renderTeamRankings(sourced({ ageFrom: "gamechanger", ageLabel: "8U" }));
    const panel = await openHive(user);
    expect(panel).toHaveTextContent(`filed at 8U, from GameChanger's age field ("8U")`);
  });

  it("says it was set by you once it is, and nothing it cannot know", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openHive(user);
    await user.selectOptions(within(panel).getByLabelText("Age"), "9");
    await user.click(within(panel).getByRole("button", { name: "Set age" }));
    expect(panel).toHaveTextContent("filed at 9U, set by you");
    expect(panel).not.toHaveTextContent("GameChanger gives no age");
  });
});

describe("finding a club known only from other clubs' schedules", () => {
  it("offers it on the page its games were filed on, and opens its panel", async () => {
    const user = userEvent.setup();
    const base = pool();
    renderTeamRankings({
      ...base,
      teams: [...base.teams, team("S-WASPS", "Example Wasps", { nameOnly: true })],
      games: [
        ...base.games,
        game("g4", u9.id, "S-OWLS", "S-WASPS", 7, 5, {
          date: "2026-09-20",
          ageLevelA: 9,
          source: { kind: "gamechanger", teamId: "gcOWLSFALL26", gameId: "g4" },
        }),
      ],
    });
    const box = screen.getByRole("combobox", { name: /find a team/i });
    await user.click(box);
    await user.type(box, "wasps");
    const list = document.getElementById(box.getAttribute("aria-controls") ?? "") as HTMLElement;
    const option = within(list).getByRole("option", { name: /Example Wasps/ });
    expect(option).toHaveTextContent("9U 2027");
    await user.click(within(option).getByRole("button"));
    expect(screen.getByRole("region", { name: "Example Wasps" })).toHaveTextContent("Owls");
  });
});

describe("an age set on a club whose ids were filed apart", () => {
  it("puts each id back at the level the app had it at", async () => {
    const user = userEvent.setup();
    const base = pool();
    const harness = renderTeamRankings({
      ...base,
      teams: base.teams.map((one) =>
        one.id === "S-HIVE"
          ? {
              ...one,
              gcTeams: [
                ...(one.gcTeams ?? []),
                {
                  teamId: "gcHIVESPRG27",
                  name: "Example Hive 9U",
                  ageGroupId: u9.id,
                  season: "spring" as const,
                  seasonYear: 2027,
                  ageLevel: 9,
                },
              ],
            }
          : one
      ),
      games: [
        ...base.games,
        game("s1", u9.id, "S-HIVE", "S-BEARS", 4, 3, {
          date: "2026-09-20",
          ageLevelA: 9,
          source: { kind: "gamechanger", teamId: "gcHIVESPRG27", gameId: "s1" },
        }),
      ],
    });
    const panel = await openHive(user);
    await user.selectOptions(within(panel).getByLabelText("Age"), "10");
    await user.click(within(panel).getByRole("button", { name: "Set age" }));
    // Both ids on the one 10U page while the level is set.
    expect(pageOf("g1")).toBe(pageOf("s1"));
    expect(pageOf("g1")).not.toBe(u9.id);

    await user.click(within(panel).getByRole("button", { name: "Let the app decide" }));

    expect(harness.toasts()).toContain(
      "Example Hive *Fall Ball* is back where the app had it: 8U and 9U."
    );
    const links = hive()?.gcTeams ?? [];
    expect(links.find((link) => link.teamId === "gcHIVEFALL26")).toMatchObject({
      ageGroupId: u8.id,
      ageLevel: 8,
    });
    expect(links.find((link) => link.teamId === "gcHIVESPRG27")).toMatchObject({
      ageGroupId: u9.id,
      ageLevel: 9,
    });
    expect([pageOf("g1"), pageOf("g2"), pageOf("s1")]).toEqual([u8.id, u8.id, u9.id]);
    expect(links.some((link) => link.ageFrom === "you")).toBe(false);
  });
});

describe("the age choice on a panel left open", () => {
  it("starts from the level shown on the year's page it is now on", async () => {
    const user = userEvent.setup();
    const base = pool();
    const u10last = ageGroup(10, 2026);
    renderTeamRankings({
      ...base,
      ageGroups: [...base.ageGroups, u10last],
      teams: base.teams.map((one) =>
        one.id === "S-HIVE"
          ? {
              ...one,
              gcTeams: [
                ...(one.gcTeams ?? []),
                {
                  teamId: "gcHIVEFALL25",
                  name: "Example Hive",
                  ageGroupId: u10last.id,
                  season: "fall" as const,
                  seasonYear: 2025,
                  ageLevel: 10,
                },
              ],
            }
          : one
      ),
      games: [
        ...base.games,
        game("h1", u10last.id, "S-HIVE", "S-OWLS", 3, 2, {
          date: "2025-09-13",
          ageLevelA: 10,
          source: { kind: "gamechanger", teamId: "gcHIVEFALL25", gameId: "h1" },
        }),
      ],
    });
    const panel = await openHive(user);
    expect(within(panel).getByLabelText("Age")).toHaveValue("8");

    await user.selectOptions(screen.getByLabelText("Season"), "2026");

    const still = screen.getByRole("region", { name: "Example Hive *Fall Ball*" });
    expect(within(still).getByLabelText("Age")).toHaveValue("10");
  });
});
