import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StandingLine, topShare } from "./MyTeamCard";

/*
 * The "My team" card's line under the club's place: the share of each week's board at or above
 * it, not the place. A board fills all season as clubs play their first games, so a club in the
 * middle sank from #439 to #2,737 between September and late October while holding its own.
 */
describe("a place as a share of its board", () => {
  it("rounds up and never reads better than the place is", () => {
    expect(topShare(1, 200)).toBe(1);
    expect(topShare(1, 7126)).toBe(1);
    expect(topShare(2737, 7126)).toBe(39);
    expect(topShare(100, 1000)).toBe(10);
    expect(topShare(101, 1000)).toBe(11);
    expect(topShare(7126, 7126)).toBe(100);
  });
});

/** The y of each point the line draws, top first being best. */
const heights = () =>
  (screen.getByRole("img").querySelector("polyline")?.getAttribute("points") ?? "")
    .split(" ")
    .map((point) => Number(point.split(",")[1]));

describe("the standing line", () => {
  it("draws a club that holds its share of a growing board flat, where its place fell", () => {
    render(
      <StandingLine
        history={[
          { asOf: "2026-09-01", rank: 100, of: 1000 },
          { asOf: "2026-09-29", rank: 400, of: 4000 },
        ]}
        now={700}
        nowOf={7000}
      />
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(
      /^Standing by week: top 10% on .+, top 10% on .+, top 10% now$/
    );
    expect(screen.getByText(/^Top 10% on .+, top 10% now$/)).toBeTruthy();
    expect(new Set(heights()).size).toBe(1);
  });

  it("draws a climb up the line and a fall down it", () => {
    render(
      <StandingLine
        history={[
          { asOf: "2026-09-01", rank: 50, of: 100 },
          { asOf: "2026-09-08", rank: 60, of: 100 },
        ]}
        now={20}
        nowOf={200}
      />
    );
    const [first, fell, now] = heights();
    expect(fell).toBeGreaterThan(first!);
    expect(now).toBeLessThan(first!);
  });

  it("draws a move of a point or two as a small one, not across the whole line", () => {
    render(
      <StandingLine history={[{ asOf: "2026-09-01", rank: 300, of: 1000 }]} now={31} nowOf={100} />
    );
    const [first, now] = heights();
    // From top 30% to top 31%: a tenth of the span the line allows at least, so a few pixels.
    expect(Math.abs(now! - first!)).toBeLessThan(4);
  });

  it("leaves out weeks whose board was not counted, and draws nothing short of two weeks", () => {
    const { container } = render(
      <StandingLine
        history={[
          { asOf: "2026-09-01", rank: 439 },
          { asOf: "2026-09-08", rank: null, of: 900 },
        ]}
        now={2737}
        nowOf={7126}
      />
    );
    expect(container.innerHTML).toBe("");
  });
});
