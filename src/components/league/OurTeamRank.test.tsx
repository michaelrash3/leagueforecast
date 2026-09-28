import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OurTeamCard } from "./OurTeamCard";
import { leagueClubRankFor } from "../../lib/leagueClubRanks";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";

/*
 * The club's national and state place on the League Dashboard's "Our team" card, carried from the
 * Team Rankings board it was last read off. Invented names.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
});
afterAll(() => vi.useRealTimers());

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

describe("the league's clubs on the board", () => {
  it("are written for the season the page claims, each league team by its own id", async () => {
    renderTeamRankings({
      ageGroups: [ageGroup(9, 2027, { seasonIds: ["default"] })],
      teams: [
        team("S-HIVE", "Example Hive", { state: "OH" }),
        team("S-OWLS", "Owls", { state: "OH" }),
        team("S-ACES", "Aces", { state: "KY" }),
      ],
      games: [
        game("g1", "ag_9u_2027", "S-ACES", "S-OWLS", 9, 1, { date: "2026-09-12" }),
        game("g2", "ag_9u_2027", "S-ACES", "S-HIVE", 8, 2, { date: "2026-09-13" }),
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

    await waitFor(() => expect(leagueClubRankFor("default", "L-HIVE")).toBeDefined());
    const hive = leagueClubRankFor("default", "L-HIVE");
    const owls = leagueClubRankFor("default", "L-OWLS");
    expect(hive).toMatchObject({ clubId: "S-HIVE", of: 3, state: "OH", stateOf: 2 });
    expect(owls).toMatchObject({ clubId: "S-OWLS", of: 3, state: "OH", stateOf: 2 });
    // The league game put the Hive above the Owls; the Aces beat both.
    expect([hive?.rank, owls?.rank]).toEqual([2, 3]);
    expect([hive?.stateRank, owls?.stateRank]).toEqual([1, 2]);
    expect(hive?.board).toMatch(/^9U 2027/);
  });
});

describe("a season whose board has emptied", () => {
  it("loses the places it had, rather than going on showing them", async () => {
    const user = userEvent.setup();
    renderTeamRankings({
      ageGroups: [ageGroup(9, 2027, { seasonIds: ["default"] })],
      teams: [
        team("S-HIVE", "Example Hive", { state: "OH" }),
        team("S-OWLS", "Owls", { state: "OH" }),
      ],
      games: [game("g1", "ag_9u_2027", "S-HIVE", "S-OWLS", 5, 3, { date: "2026-09-12" })],
      league: {
        teams: [
          { id: "L-HIVE", name: "Example Hive" },
          { id: "L-OWLS", name: "Owls" },
        ],
        matchups: [{ id: "m1", date: "10/3", away: "L-HIVE", home: "L-OWLS" }],
        logs: {},
      },
    });
    await waitFor(() => expect(leagueClubRankFor("default", "L-HIVE")).toBeDefined());

    // The spring half, where nothing has been played: a board with nobody on it.
    await user.click(screen.getByRole("button", { name: /^Spring 2027/ }));
    await waitFor(() => expect(leagueClubRankFor("default", "L-HIVE")).toBeUndefined());
  });
});

describe("the Our team card", () => {
  const summary = {
    teamId: "L-HIVE",
    name: "Example Hive",
    place: 2,
    of: 8,
    record: "5-2",
  };

  it("says where the club stands nationally and in its state, and as of when", () => {
    render(
      <OurTeamCard
        summary={summary}
        teams={[{ id: "L-HIVE", name: "Example Hive" }]}
        onPick={() => {}}
        onEnterScore={() => {}}
        clubRank={{
          clubId: "S-HIVE",
          board: "9U 2027 · Fall 2026",
          rank: 37,
          of: 1812,
          state: "OH",
          stateRank: 4,
          stateOf: 160,
          movement: 3,
          at: "2026-09-27T21:00:00.000Z",
        }}
      />
    );
    const region = screen.getByRole("region", { name: "Our team" });
    expect(region).toHaveTextContent(
      "Team Rankings: 37th of 1,812 nationally (▲3) · 4th of 160 in OH · 9U 2027 · Fall 2026, as of 9/27"
    );
  });

  it("dates the board by the reader's own day, not by UTC's", () => {
    vi.stubEnv("TZ", "America/Chicago");
    try {
      render(
        <OurTeamCard
          summary={summary}
          teams={[{ id: "L-HIVE", name: "Example Hive" }]}
          onPick={() => {}}
          onEnterScore={() => {}}
          clubRank={{
            clubId: "S-HIVE",
            board: "9U 2027",
            rank: 37,
            of: 1812,
            // 9:30 in the evening of 27 September in Chicago, already the 28th in UTC.
            at: "2026-09-28T02:30:00.000Z",
          }}
        />
      );
      expect(screen.getByRole("region", { name: "Our team" })).toHaveTextContent(
        "9U 2027, as of 9/27"
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("says nothing of Team Rankings when no board has been read", () => {
    render(
      <OurTeamCard
        summary={summary}
        teams={[{ id: "L-HIVE", name: "Example Hive" }]}
        onPick={() => {}}
        onEnterScore={() => {}}
      />
    );
    expect(screen.getByRole("region", { name: "Our team" })).not.toHaveTextContent("Team Rankings");
  });
});
