import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import css from "../../index.css?raw";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type TeamBase } from "../../lib/types";
import { LineChart, SERIES_COLOURS, seriesSlots, type LineSeries } from "./LineChart";
import { placeTicks, SeasonRaceChart } from "./SeasonRaceChart";

/*
 * The Forecast's two line charts. What was wrong with them, each held here: two of the race's five
 * teams were drawn in the same blue, the fifth line's key had no colour beside it, the race's axis
 * named places that were not whole numbers, its dates were the season's stored form and the last
 * ran off the chart, and a line's figures could be read only by a mouse held over it. Placeholder
 * names.
 */

const line = (id: string, values: number[], slot: number): LineSeries => ({
  id,
  label: `Team ${id}`,
  values,
  slot,
});

/** The colour a key or a line is drawn in, as written: `var(--chart-N)`. */
const keyColours = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>("figcaption [aria-hidden]")).map(
    (key) => key.style.background
  );

describe("the chart colours", () => {
  it("are all defined, for a white card and for a dark one", () => {
    for (let slot = 1; slot <= SERIES_COLOURS; slot += 1) {
      // Once under :root and once under .dark.
      expect(css.match(new RegExp(`--chart-${slot}: #[0-9a-f]{6};`, "g"))).toHaveLength(2);
    }
  });

  it("go to the lines shown in the order of their ids, none skipped", () => {
    const slots = seriesSlots(["m", "c", "x"]);
    expect([slots.get("c"), slots.get("m"), slots.get("x")]).toEqual([0, 1, 2]);
    // The same teams in another order of the table keep their colours.
    expect(seriesSlots(["x", "m", "c"])).toEqual(slots);
  });
});

describe("a line chart", () => {
  const series = [line("A", [10, 40, 90], 0), line("B", [80, 60, 20], 1)];
  const xLabels = ["4/5", "4/12", "4/19"];

  it("keys every line with its colour and its latest figure", () => {
    const { container } = render(<LineChart series={series} xLabels={xLabels} />);
    expect(keyColours(container)).toEqual(["var(--chart-1)", "var(--chart-2)"]);
    const key = container.querySelector("figcaption");
    expect(key).toHaveTextContent("Team A90%");
    expect(key).toHaveTextContent("Team B20%");
  });

  it("states a line's latest figure in the page's own words where it is given them", () => {
    const { container } = render(
      <LineChart
        series={[{ ...line("A", [10, 99.8], 0), nowLabel: "99%+" }, line("B", [5, 2], 1)]}
        xLabels={["1 result ago", "Now"]}
      />
    );
    expect(container.querySelector("figcaption")).toHaveTextContent("Team A99%+");
    expect(container.querySelector("desc")).toHaveTextContent(
      "Team A: 10% to 99%+; Team B: 5% to 2%"
    );
  });

  it("holds every figure in a table, for a reader who cannot point at the lines", () => {
    render(<LineChart series={series} xLabels={xLabels} />);
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Team ATeam B",
      "4/510%80%",
      "4/1240%60%",
      "4/1990%20%",
    ]);
  });

  it("reads every line at the point under a pointer, and puts the readout away as a mouse leaves", () => {
    const { container } = render(<LineChart series={series} xLabels={xLabels} />);
    const svg = container.querySelector("svg")!;
    // jsdom lays nothing out, so the chart is given the box it draws itself at before measuring.
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 640, 256);
    expect(screen.queryByTestId("chart-readout")).toBeNull();

    // The plot runs from 44 to 624; its middle point is at 334.
    fireEvent.pointerMove(svg, { clientX: 330, pointerType: "mouse" });
    expect(screen.getByTestId("chart-readout")).toHaveTextContent("4/1240%Team A60%Team B");

    fireEvent.pointerLeave(svg, { pointerType: "mouse" });
    expect(screen.queryByTestId("chart-readout")).toBeNull();
  });

  it("keeps the readout under a finger that has lifted, until the same point is tapped again", () => {
    const { container } = render(<LineChart series={series} xLabels={xLabels} />);
    const svg = container.querySelector("svg")!;
    svg.getBoundingClientRect = () => new DOMRect(0, 0, 640, 256);

    fireEvent.pointerDown(svg, { clientX: 620, pointerType: "touch" });
    fireEvent.pointerLeave(svg, { pointerType: "touch" });
    expect(screen.getByTestId("chart-readout")).toHaveTextContent("4/1990%Team A20%Team B");

    fireEvent.pointerDown(svg, { clientX: 620, pointerType: "touch" });
    expect(screen.queryByTestId("chart-readout")).toBeNull();
  });

  it("names the last point on its axis, and only as many others as fit", () => {
    const many = Array.from({ length: 40 }, (_, i) => `4/${i + 1}`);
    const { container } = render(
      <LineChart
        series={[
          line(
            "A",
            many.map((_, i) => i),
            0
          ),
        ]}
        yMax={40}
        xLabels={many}
      />
    );
    const printed = Array.from(container.querySelectorAll("svg text"))
      .map((text) => text.textContent ?? "")
      .filter((text) => text.includes("/"));
    expect(printed[printed.length - 1]).toBe("4/40");
    expect(printed.length).toBeLessThan(many.length);
    // One line needs no key.
    expect(container.querySelector("figcaption")).toBeNull();
  });
});

describe("the season race", () => {
  it("names whole places only on its axis", () => {
    expect(placeTicks(8)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(placeTicks(16)).toEqual([1, 3, 5, 7, 9, 11, 13, 15]);
    expect(placeTicks(1)).toEqual([1, 2]);
  });

  const teams: TeamBase[] = ["A", "B", "C", "D", "E", "F"].map((id) => ({
    id,
    name: `Team ${id}`,
  }));
  const final = (away: string, home: string): GameLog => ({
    awayRuns: away,
    homeRuns: home,
    awayHits: "",
    homeHits: "",
    awayK: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  const matchups: Matchup[] = [
    { id: "g1", date: "2026-04-05", away: "A", home: "B" },
    { id: "g2", date: "2026-04-05", away: "C", home: "D" },
    { id: "g3", date: "2026-04-12", away: "E", home: "F" },
    { id: "g4", date: "2026-04-12", away: "B", home: "C" },
  ];
  const logs = {
    g1: final("5", "2"),
    g2: final("1", "4"),
    g3: final("7", "3"),
    g4: final("2", "6"),
  };
  const race = (followId: string | null) => (
    <SeasonRaceChart
      input={{ teams, matchups, logs, settings: DEFAULT_SETTINGS }}
      names={new Map(teams.map((team) => [team.id, team.name]))}
      followId={followId}
      teamCount={teams.length}
      cutoff={4}
    />
  );

  it("draws each of its five lines in a colour of its own, with no team followed", () => {
    const { container } = render(race(null));
    const colours = keyColours(container);
    expect(colours).toHaveLength(5);
    expect(new Set(colours).size).toBe(5);
    // And the lines themselves are drawn in the colours their keys show.
    const strokes = Array.from(container.querySelectorAll<SVGElement>("polyline")).map(
      (drawn) => drawn.style.stroke
    );
    expect(strokes).toEqual(colours);
  });

  it("leads with the followed team, drawn heavier, and keeps the others' colours apart", () => {
    const { container } = render(race("F"));
    const key = container.querySelector("figcaption");
    expect(key?.firstElementChild).toHaveTextContent("Team F");
    const widths = Array.from(container.querySelectorAll("polyline")).map((drawn) =>
      drawn.getAttribute("stroke-width")
    );
    expect(widths).toEqual(["3.5", "2", "2", "2", "2"]);
    expect(new Set(keyColours(container)).size).toBe(5);
  });

  it("writes its dates as the rest of League does, and its places as places", () => {
    const { container } = render(race(null));
    const printed = Array.from(container.querySelectorAll("svg text")).map(
      (text) => text.textContent
    );
    expect(printed).toEqual(
      expect.arrayContaining(["#1", "#2", "#3", "#4", "#5", "#6", "4/5", "4/12", "Gold line"])
    );
    expect(printed).not.toContain("2026-04-05");
  });
});
