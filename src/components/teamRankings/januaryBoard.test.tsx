import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import userEvent from "@testing-library/user-event";
import { leagueClubRankFor } from "../../lib/leagueClubRanks";
import { HALF_WORTH_SHOWING, segmentWorthShowing } from "../../hooks/useRankingsPages";

/*
 * Which half Team Rankings opens on in January, when the calendar has moved to the spring and the
 * autumn holds nearly all of the year's play. It opened on the spring the day that half held any
 * scored game at all: a score typed ahead for March, a winter game kept only for the record, or
 * the first tournament weekend in Florida. The board then fitted a handful of clubs, and the League
 * Dashboard's "Our team" line, written off whatever board was up, went blank with it.
 */
afterEach(() => vi.useRealTimers());

const at = (iso: string) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(iso));
};

/** The board's own heading, which names the half: "National top 25 · Fall 2026". */
const boardHeading = () =>
  screen.getByRole("heading", { name: /National top 25 · / }).textContent ?? "";

const teams: ScoutTeam[] = [
  team("S-A", "Aces", { state: "KY" }),
  team("S-B", "Bats", { state: "KY" }),
  team("S-C", "Cubs", { state: "OH" }),
];

describe("the half a year opens on", () => {
  it("is the calendar's once it holds a tenth of the other half's play", () => {
    expect(HALF_WORTH_SHOWING).toBe(0.1);
    expect(segmentWorthShowing("spring", { fall: 1000, spring: 100 })).toBe("spring");
    expect(segmentWorthShowing("spring", { fall: 1000, spring: 99 })).toBe("fall");
    // January on the 26 September 2026 pool: the whole winter's schedule, scored, against August
    // and September alone.
    expect(segmentWorthShowing("spring", { fall: 150_408, spring: 317 })).toBe("fall");
  });

  it("is the calendar's where the other half has nothing, or neither has", () => {
    expect(segmentWorthShowing("fall", { fall: 3, spring: 0 })).toBe("fall");
    expect(segmentWorthShowing("spring", { fall: 0, spring: 0 })).toBe("spring");
    expect(segmentWorthShowing("spring", { fall: 12, spring: 0 })).toBe("fall");
    expect(segmentWorthShowing(undefined, { fall: 12, spring: 0 })).toBeUndefined();
  });
});

describe("Team Rankings in January 2027", () => {
  const pages: AgeGroup[] = [ageGroup(9, 2027)];
  const autumn: ScoutGame[] = [
    game("f1", "ag_9u_2027", "S-A", "S-B", 9, 1, { date: "2026-09-12" }),
    game("f2", "ag_9u_2027", "S-B", "S-C", 8, 2, { date: "2026-10-10" }),
    game("f3", "ag_9u_2027", "S-C", "S-A", 7, 2, { date: "2026-11-14" }),
  ];

  it("opens on the autumn with nothing played in the spring", () => {
    at("2027-01-20T12:00:00");
    renderTeamRankings({ ageGroups: pages, teams, games: autumn });
    expect(boardHeading()).toContain("Fall 2026");
  });

  it("is not moved to an empty spring by a score on a day that has not happened", () => {
    at("2027-01-20T12:00:00");
    // A schedule filled in ahead: a score on 13 March, which `countsTowardRating` never counts.
    const ahead = game("s1", "ag_9u_2027", "S-A", "S-B", 10, 0, { date: "2027-03-13" });
    renderTeamRankings({ ageGroups: pages, teams, games: [...autumn, ahead] });
    expect(boardHeading()).toContain("Fall 2026");
    // Nor does the spring's tab claim a game it will not rate.
    expect(screen.getByRole("button", { name: /Spring 2027/ })).toHaveTextContent("not played");
  });

  it("is not moved to an empty spring by a game kept only for the record", () => {
    at("2027-01-20T12:00:00");
    const kept = game("s2", "ag_9u_2027", "S-A", "S-B", 6, 4, {
      date: "2027-01-16",
      excluded: true,
    });
    renderTeamRankings({ ageGroups: pages, teams, games: [...autumn, kept] });
    expect(boardHeading()).toContain("Fall 2026");
  });

  it("opens on the spring once it is under way", () => {
    at("2027-04-20T12:00:00");
    const spring = [
      game("s3", "ag_9u_2027", "S-A", "S-B", 5, 4, { date: "2027-03-13" }),
      game("s4", "ag_9u_2027", "S-B", "S-C", 3, 2, { date: "2027-04-10" }),
    ];
    renderTeamRankings({ ageGroups: pages, teams, games: [...autumn, ...spring] });
    expect(boardHeading()).toContain("Spring 2027");
  });
});

/*
 * The same flip, driven by a real game: the first January game anywhere in the pool made the spring
 * the board, and the League Dashboard's "Our team" line went with it.
 */
describe("the first January game anywhere, on 20 January 2027", () => {
  const final = (away: number, home: number) => ({
    awayRuns: String(away),
    awayHits: "",
    awayK: "",
    homeRuns: String(home),
    homeHits: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  const clubs = ["S-HIVE", "S-OWLS", "S-ACES", "S-GATR", "S-MARL"];
  // An autumn every club played in, three weekends of a round robin: thirty games.
  const autumn = [0, 1, 2].flatMap((week) =>
    clubs.flatMap((home, h) =>
      clubs.slice(h + 1).map((away, a) =>
        game(`f${week}${h}${a}`, "ag_9u_2027", home, away, 4 + ((h + a + week) % 5), 3, {
          date: `2026-${String(9 + week).padStart(2, "0")}-12`,
        })
      )
    )
  );
  const pool = (withJanuary: boolean) => ({
    ageGroups: [ageGroup(9, 2027, { seasonIds: ["default"] })],
    teams: [
      team("S-HIVE", "Example Hive", { state: "OH" }),
      team("S-OWLS", "Owls", { state: "OH" }),
      team("S-ACES", "Aces", { state: "KY" }),
      team("S-GATR", "Gators", { state: "FL" }),
      team("S-MARL", "Marlins", { state: "FL" }),
    ],
    games: [
      ...autumn,
      // An MLK-weekend tournament game in Florida: the only spring game anywhere yet.
      ...(withJanuary
        ? [game("j1", "ag_9u_2027", "S-GATR", "S-MARL", 6, 2, { date: "2027-01-16" })]
        : []),
    ],
    league: {
      teams: [
        { id: "L-HIVE", name: "Example Hive" },
        { id: "L-OWLS", name: "Owls" },
      ],
      matchups: [{ id: "m1", date: "9/19", away: "L-HIVE", home: "L-OWLS" }],
      logs: { m1: final(6, 4) },
    },
  });

  it("control: with no January game the Dashboard has the club's place", async () => {
    at("2027-01-20T12:00:00");
    renderTeamRankings(pool(false));
    await waitFor(() => expect(leagueClubRankFor("default", "L-HIVE")).toBeDefined());
    expect(boardHeading()).toContain("Fall 2026");
  });

  it("keeps the autumn board, and the club's place, when two Florida clubs play", async () => {
    at("2027-01-20T12:00:00");
    renderTeamRankings(pool(true));
    await waitFor(() => expect(leagueClubRankFor("default", "L-HIVE")).toBeDefined());
    expect(boardHeading()).toContain("Fall 2026");
  });

  it("keeps the club's place while the spring board is read", async () => {
    at("2027-01-20T12:00:00");
    const user = userEvent.setup();
    renderTeamRankings(pool(true));
    await waitFor(() => expect(leagueClubRankFor("default", "L-HIVE")).toBeDefined());
    const onTheAutumn = leagueClubRankFor("default", "L-HIVE");
    expect(onTheAutumn?.board).toBe("9U 2027 · Fall 2026");

    await user.click(screen.getByRole("button", { name: /Spring 2027/ }));
    await waitFor(() => expect(boardHeading()).toContain("Spring 2027"));
    // The Florida clubs' board, settled, and given its turn to write.
    await waitFor(() => expect(screen.getAllByText("Gators").length).toBeGreaterThan(0));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The league plays in the autumn, so a spring board says nothing about where its clubs stand.
    expect(leagueClubRankFor("default", "L-HIVE")).toMatchObject({
      board: "9U 2027 · Fall 2026",
      rank: onTheAutumn?.rank,
    });
  });
});
