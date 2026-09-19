import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TidyProgressView } from "./TidyProgressView";
import { TIDY_STEPS, type TidyStep, type TidyStepName } from "../../lib/gameChangerImport";
import type { TidyWatch } from "../../lib/pullSession";

/**
 * The tidy walks every game several times over and, on a nationwide pool, takes a minute or two.
 * It showed a spinner and a sentence, which on that timescale is indistinguishable from a hang —
 * and a tidy that looks hung gets reloaded, which is how eleven thousand results came to sit filed
 * against "TBD" while the code to settle them worked perfectly.
 *
 * There is no honest percentage to show: the tidy repeats until a pass finds nothing, so nobody
 * knows how many passes there will be until the last one. What it can show is what each pass
 * found, and each pass finding less than the one before is what finishing looks like.
 */
const step = (pass: number, name: TidyStepName, found: number, done = true): TidyStep => ({
  pass,
  step: name,
  found,
  teams: 40000,
  games: 200000 - found,
  done,
});

/** A pass with `found` on the naming step and nothing anywhere else, which is the usual shape. */
const pass = (n: number, found: number): TidyStep[] =>
  TIDY_STEPS.map((name) => step(n, name, name === "named" ? found : 0));

/** Nothing in flight: every step of every pass has reported back. */
const ended = (steps: TidyStep[]): TidyWatch => ({ steps, now: null });
/** Mid-step, which is what a tidy looks like nearly all of the time it is running. */
const midway = (steps: TidyStep[], now: TidyStep): TidyWatch => ({ steps, now });

const twoPasses = ended([...pass(1, 416), ...pass(2, 0)]);

describe("the tidy's progress", () => {
  it("shows what each pass found, pass by pass", () => {
    render(<TidyProgressView watch={twoPasses} running={false} />);

    const table = screen.getByRole("table");
    // Two passes, plus the header row and the totals row.
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByLabelText(/Pass 1,.*stand-ins.*: 416/i)).toBeInTheDocument();
    expect(within(table).getByLabelText(/Pass 2,.*stand-ins.*: 0/i)).toBeInTheDocument();
  });

  it("says how it knew to stop, once it has", () => {
    render(<TidyProgressView watch={twoPasses} running={false} />);

    expect(screen.getByText(/2 passes; the last found nothing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Pass 2 · /i)).not.toBeInTheDocument();
  });

  it("totals each step across every pass", () => {
    render(
      <TidyProgressView
        watch={ended([...pass(1, 416), ...pass(2, 54), ...pass(3, 0)])}
        running={false}
      />
    );

    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(rows[rows.length - 1]!).getByText("470")).toBeInTheDocument();
  });

  it("reads the count out as well as shading it", () => {
    /*
     * The shading carries the size of a pass at a glance, but it is a colour, so it cannot be the
     * only thing that says so. Every cell states its number and labels itself.
     */
    render(<TidyProgressView watch={twoPasses} running={false} />);

    const firstPass = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(within(firstPass).getByText("416")).toBeInTheDocument();
  });

  it("says something while the first pass is still in the air", () => {
    // A tidy that has started and reported nothing yet must not draw a blank where the work goes.
    render(<TidyProgressView watch={ended([])} running />);

    expect(screen.getByText(/starting the first pass/i)).toBeInTheDocument();
  });

  it("draws nothing at all when no tidy has run", () => {
    const { container } = render(<TidyProgressView watch={ended([])} running={false} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the step that is running right now", () => {
  /*
   * The whole reason a step reports twice. On a large pool a single step is seconds of silence,
   * and a run reported only on the way out of each one shows nothing moving for all of it — which
   * is the thing this was built to stop. What says the work is alive is the name of the step in
   * flight, and it comes from the worker, so it stops arriving if the worker does.
   */
  it("names the step it is inside, not the last one it finished", () => {
    render(<TidyProgressView watch={midway(pass(1, 416), step(2, "named", 0, false))} running />);

    expect(screen.getByText(/Pass 2 · name…/i)).toBeInTheDocument();
  });

  it("marks the cell the tidy is inside, rather than leaving it blank", () => {
    render(<TidyProgressView watch={midway(pass(1, 416), step(2, "named", 0, false))} running />);

    expect(screen.getByLabelText(/Pass 2,.*stand-ins.*running now/i)).toBeInTheDocument();
  });

  it("counts a pass that has only just started as a pass", () => {
    // Otherwise the table sits a whole step behind, and on a slow step that is seconds of nothing.
    render(
      <TidyProgressView watch={midway(pass(1, 416), step(2, "notBaseball", 0, false))} running />
    );

    // Two pass rows, plus the header and the totals.
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  });

  it("says how many steps are behind it, which is the thing that advances", () => {
    render(<TidyProgressView watch={midway(pass(1, 416), step(2, "named", 0, false))} running />);

    expect(screen.getByText(/9 of 18 steps/)).toBeInTheDocument();
  });

  it("marks nothing as running once the run is over", () => {
    render(<TidyProgressView watch={twoPasses} running={false} />);

    expect(screen.queryByLabelText(/running now/i)).not.toBeInTheDocument();
  });
});
