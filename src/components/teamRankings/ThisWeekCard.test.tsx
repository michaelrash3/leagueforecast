import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThisWeekCard } from "./ThisWeekCard";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import type { WeeklyGame } from "../../lib/theWeekly";
import { formatStartTime } from "../../lib/date";

describe("ThisWeekCard", () => {
  it("names the week's movers with where they were and are, each opening its club", () => {
    const open = vi.fn();
    render(
      <ThisWeekCard
        movers={{
          into: [
            { teamId: "up", name: "Aces", from: 40, to: 12 },
            { teamId: "new", name: "Bears", from: null, to: 20 },
          ],
          outOf: [{ teamId: "down", name: "Cubs", from: 8, to: 31 }],
          climbs: [{ teamId: "far", name: "Dukes", from: 210, to: 64 }],
        }}
        rowOf={() => undefined}
        onOpenTeam={open}
      />
    );
    const week = screen.getByRole("region", { name: "The Weekly" });
    expect(week.textContent).toContain("Into the top 25: Aces #40 → #12, Bears new → #20");
    expect(week.textContent).toContain("Out of the top 25: Cubs #8 → #31");
    expect(week.textContent).toContain("Biggest climbs: Dukes #210 → #64 (up 146)");
    fireEvent.click(screen.getByRole("button", { name: "Bears" }));
    expect(open).toHaveBeenCalledWith("new");
  });

  it("draws nothing when nobody moved", () => {
    const { container } = render(
      <ThisWeekCard
        movers={{ into: [], outOf: [], climbs: [] }}
        rowOf={() => undefined}
        onOpenTeam={() => undefined}
      />
    );
    expect(container.textContent).toBe("");
  });

  it("leads with the week's upset and says the game ahead, the streaks and our week", () => {
    const open = vi.fn();
    const names: Record<string, [string, number]> = {
      M: ["Marlow Mudhens", 40],
      I: ["Ironwood Ospreys", 12],
      P: ["Pike Valley Pythons", 3],
      K: ["Kettle Creek Kings", 5],
      H: ["Harbor Point Herons", 9],
      R: ["River City Raptors", 2737],
      B: ["H/R Bulldogs", 4515],
      X: ["Fox Run Flyers", 18],
    };
    const rowOf = (teamId: string) => {
      const known = names[teamId];
      return known
        ? ({ teamId, teamName: known[0], rank: known[1] } as ScoutRankingRow)
        : undefined;
    };
    render(
      <ThisWeekCard
        movers={null}
        weekly={{
          asOf: "2026-10-25",
          upsets: [
            {
              winnerId: "M",
              loserId: "I",
              winnerRuns: 7,
              loserRuns: 4,
              date: "2026-10-24",
              chance: 0.14,
            },
            {
              winnerId: "X",
              loserId: "P",
              winnerRuns: 5,
              loserRuns: 3,
              date: "2026-10-20",
              chance: 0.22,
            },
          ],
          ahead: { teamAId: "P", teamBId: "K", date: "2026-10-31", chanceA: 0.54, margin: 0.4 },
          streaks: [{ teamId: "H", wins: 9 }],
        }}
        myWeek={{ wins: 2, losses: 1, ties: 0, bestWin: { teamId: "B", place: 4515 } }}
        myTeamId="R"
        rowOf={rowOf}
        onOpenTeam={open}
      />
    );
    const week = screen.getByRole("region", { name: /^The Weekly/ });
    expect(week.textContent).toContain("week to ");
    expect(week.textContent).toContain(
      "Upset of the week: Marlow Mudhens 7–4 over Ironwood Ospreys (#12) · Marlow Mudhens had a 14% chance. Also: Fox Run Flyers over Pike Valley Pythons (22%)"
    );
    expect(week.textContent).toMatch(
      /Game of the week: .+ · Pike Valley Pythons \(#3\) vs Kettle Creek Kings \(#5\) · 54% to 46%/
    );
    expect(week.textContent).toContain("Winning streaks: Harbor Point Herons 9 straight");
    expect(week.textContent).toContain(
      "Your week: River City Raptors went 2–1; best win over H/R Bulldogs (#4,515)"
    );
    fireEvent.click(screen.getByRole("button", { name: "Ironwood Ospreys" }));
    expect(open).toHaveBeenCalledWith("I");
  });

  it("says when the game of the week starts, and its day alone where it has no start", () => {
    const names: Record<string, [string, number]> = { A: ["Aces", 3], B: ["Bears", 5] };
    const rowOf = (teamId: string) => {
      const known = names[teamId];
      return known
        ? ({ teamId, teamName: known[0], rank: known[1] } as ScoutRankingRow)
        : undefined;
    };
    const start = "2026-10-31T14:30:00.000Z";
    const ahead: WeeklyGame = {
      teamAId: "A",
      teamBId: "B",
      date: "2026-10-31",
      chanceA: 0.54,
      margin: 0.4,
    };
    const card = (game: WeeklyGame) =>
      render(
        <ThisWeekCard
          movers={null}
          weekly={{ asOf: "2026-10-25", upsets: [], ahead: game, streaks: [] }}
          rowOf={rowOf}
          onOpenTeam={() => undefined}
        />
      );
    const timed = card({ ...ahead, start: Date.parse(start) / 60_000 });
    // In the reader's own time, as the rest of Team Rankings says a start (`dayAndTime`).
    expect(screen.getByRole("region", { name: /^The Weekly/ }).textContent).toContain(
      `Game of the week: Sat, Oct 31 · ${formatStartTime(start)} · Aces (#3) vs Bears (#5) · 54% to 46%`
    );
    timed.unmount();
    card(ahead);
    const untimed = screen.getByRole("region", { name: /^The Weekly/ }).textContent;
    expect(untimed).toContain("Game of the week: Sat, Oct 31 · Aces (#3) vs Bears (#5)");
    expect(untimed).not.toMatch(/AM|PM/);
  });

  it("says no week of ours for a week our club played nothing", () => {
    render(
      <ThisWeekCard
        movers={{ into: [], outOf: [], climbs: [] }}
        weekly={{ asOf: "2026-10-25", upsets: [], ahead: null, streaks: [] }}
        myWeek={null}
        myTeamId="R"
        rowOf={() => undefined}
        onOpenTeam={() => undefined}
      />
    );
    expect(screen.queryByRole("region", { name: /^The Weekly/ })).toBeNull();
  });
});
