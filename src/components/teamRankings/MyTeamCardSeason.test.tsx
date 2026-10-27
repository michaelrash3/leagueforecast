import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { expectedWords, MyTeamCard, ordinal } from "./MyTeamCard";
import type { MyTeamGlance } from "../../lib/myTeamGlance";
import type { UpcomingMatchup } from "../../lib/teamRankings";

/*
 * The My Team card's season beside its ratings: how tough its schedule has been in its state, its
 * record beside the one the ratings expected with its one-run games, and its next weekend.
 */
const match = (date: string, name: string, winProb: number): UpcomingMatchup => ({
  gameId: `${date}-${name}`,
  date,
  opponentId: name,
  opponentName: name,
  winProb,
});

const GLANCE: MyTeamGlance = {
  teamId: "R",
  teamName: "River City Raptors",
  nationalRank: 2737,
  nationalOf: 7126,
  state: "KY",
  stateRank: 40,
  stateOf: 98,
  record: "9-11",
  rating: 1.1,
  next: match("2026-10-31", "H/R Bulldogs", 0.67),
  schedule: { rank: 11, of: 98 },
  weekend: {
    sunday: "2026-11-01",
    games: [match("2026-10-31", "H/R Bulldogs", 0.67), match("2026-11-01", "Ospreys", 0.31)],
    called: 2,
    expectedWins: 0.98,
    toughest: match("2026-11-01", "Ospreys", 0.31),
    likeliest: match("2026-10-31", "H/R Bulldogs", 0.67),
  },
};

describe("the My Team card's season", () => {
  it("says the schedule's toughness, the record beside the expected one, and the weekend", () => {
    render(
      <MyTeamCard
        glance={GLANCE}
        onOpenTeam={() => undefined}
        expected={{
          wins: 9,
          losses: 11,
          ties: 0,
          expectedWins: 8.1,
          oneRun: { wins: 3, losses: 2 },
        }}
      />
    );
    const card = screen.getByRole("region", { name: "My team" });
    expect(card.textContent).toContain(
      "Schedule: 11th toughest of 98 in KY · 9–11 against rated clubs, about one win better than the ratings expect (8.1) · one-run games 3–2"
    );
    expect(card.textContent).toMatch(
      /Weekend to .+: 2 games, about 1\.0 wins expected · toughest vs Ospreys \(31%\) · likeliest vs H\/R Bulldogs \(67%\)/
    );
  });

  it("says how many of the weekend's games its wins expected cover, and none of none", () => {
    const weekend = GLANCE.weekend!;
    const third = { ...match("2026-11-01", "Owls", 0.5), winProb: undefined };
    const { unmount } = render(
      <MyTeamCard
        glance={{
          ...GLANCE,
          weekend: { ...weekend, games: [...weekend.games, third] },
        }}
        onOpenTeam={() => undefined}
      />
    );
    expect(screen.getByRole("region", { name: "My team" }).textContent).toMatch(
      /Weekend to .+: 3 games, about 1\.0 wins expected from the 2 the ratings can call · toughest/
    );
    unmount();
    render(
      <MyTeamCard
        glance={{
          ...GLANCE,
          weekend: { sunday: weekend.sunday, games: [third, third], called: 0, expectedWins: 0 },
        }}
        onOpenTeam={() => undefined}
      />
    );
    const card = screen.getByRole("region", { name: "My team" });
    expect(card.textContent).toMatch(/Weekend to .+: 2 games/);
    expect(card.textContent).not.toContain("wins expected");
  });

  it("leaves out what it does not know", () => {
    const { schedule: _s, weekend: _w, ...bare } = GLANCE;
    render(<MyTeamCard glance={bare} onOpenTeam={() => undefined} />);
    const card = screen.getByRole("region", { name: "My team" });
    expect(card.textContent).not.toContain("Schedule:");
    expect(card.textContent).not.toContain("Weekend to");
    expect(card.textContent).not.toContain("against rated clubs");
  });
});

describe("the words", () => {
  it("counts in ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111, 1002].map(ordinal)).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
      "111th",
      "1,002nd",
    ]);
  });

  it("says a record within half a win of the expected one as about what the ratings expect", () => {
    const record = {
      wins: 8,
      losses: 12,
      ties: 1,
      expectedWins: 8.3,
      oneRun: { wins: 0, losses: 0 },
    };
    expect(expectedWords(record)).toBe(
      "8–12–1 against rated clubs, about what the ratings expect (8.3)"
    );
    expect(expectedWords({ ...record, wins: 6 })).toBe(
      "6–12–1 against rated clubs, about 2 wins worse than the ratings expect (8.3)"
    );
  });
});
