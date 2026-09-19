import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TidyProgressView } from "./TidyProgressView";
import { TIDY_STEPS, type TidyStepName } from "../../lib/gameChangerImport";
import type { TidyProgress } from "../../hooks/usePoolTidy";

/**
 * The tidy walks every game several times over and, on a nationwide pool, takes the better part of
 * half a minute. It showed a spinner and a sentence, which on that timescale is indistinguishable
 * from a hang — and a tidy that looks hung gets reloaded, which is how eleven thousand results came
 * to sit filed against "TBD" while the code to settle them worked perfectly.
 *
 * There is no honest percentage to show: the tidy repeats until a pass finds nothing, so nobody
 * knows how many passes there will be until the last one. What it can show is what each pass found,
 * and each pass finding less than the one before is what finishing looks like.
 */
const step = (pass: number, name: TidyStepName, found: number, ms = pass * 1000): TidyProgress => ({
  pass,
  step: name,
  found,
  teams: 40000,
  games: 200000 - found,
  ms,
});

/** A pass with `found` on the naming step and nothing anywhere else, which is the usual shape. */
const pass = (n: number, found: number): TidyProgress[] =>
  TIDY_STEPS.map((name) => step(n, name, name === "named" ? found : 0, n * 1000));

const twoPasses = [...pass(1, 416), ...pass(2, 0)];

describe("the tidy's progress", () => {
  it("shows what each pass found, pass by pass", () => {
    render(<TidyProgressView steps={twoPasses} running={false} />);

    const table = screen.getByRole("table");
    // Two passes, plus the header row and the totals row.
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByLabelText(/Pass 1,.*stand-ins.*: 416/i)).toBeInTheDocument();
    expect(within(table).getByLabelText(/Pass 2,.*stand-ins.*: 0/i)).toBeInTheDocument();
  });

  it("names the step it is on while it is running", () => {
    // Which is the difference between "still working" and "stopped without telling you".
    render(<TidyProgressView steps={[...pass(1, 416), step(2, "notBaseball", 0)]} running />);

    expect(screen.getByText(/Pass 2, not ball/i)).toBeInTheDocument();
  });

  it("says how it knew to stop, once it has", () => {
    render(<TidyProgressView steps={twoPasses} running={false} />);

    expect(screen.getByText(/2 passes; the last found nothing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pass 2, /i)).not.toBeInTheDocument();
  });

  it("totals each step across every pass", () => {
    render(
      <TidyProgressView steps={[...pass(1, 416), ...pass(2, 54), ...pass(3, 0)]} running={false} />
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const totals = rows[rows.length - 1]!;
    expect(within(totals).getByText("470")).toBeInTheDocument();
  });

  it("reads the count out as well as shading it", () => {
    /*
     * The shading carries the size of a pass at a glance, but it is a colour, so it cannot be the
     * only thing that says so. Every cell states its number and labels itself.
     */
    render(<TidyProgressView steps={twoPasses} running={false} />);

    const firstPass = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(within(firstPass).getByText("416")).toBeInTheDocument();
  });

  it("says something while the first pass is still in the air", () => {
    // A tidy that has started and reported nothing yet must not draw a blank where the work goes.
    render(<TidyProgressView steps={[]} running />);

    expect(screen.getByText(/starting the first pass/i)).toBeInTheDocument();
  });

  it("draws nothing at all when no tidy has run", () => {
    const { container } = render(<TidyProgressView steps={[]} running={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});
