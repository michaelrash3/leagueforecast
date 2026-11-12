import { useEffect, useId, useRef, useState } from "react";
import { focusRing, tapArea } from "../../styles/tokens";

export type LineSeries = {
  id: string;
  label: string;
  values: number[];
  /** Which chart colour draws it, counted from 0 (`seriesSlots`). */
  slot: number;
  /** Drawn heavier than the rest: the team this browser follows. */
  lead?: boolean;
  /** The legend's figure, where the page states the latest value in words of its own. */
  nowLabel?: string;
};

/** The chart colours `index.css` defines, `--chart-1` to `--chart-8`. */
export const SERIES_COLOURS = 8;

const colourOf = (slot: number) => `var(--chart-${(slot % SERIES_COLOURS) + 1})`;

/**
 * A colour for each line drawn, by the line's id rather than its place in the table: the lines
 * shown take the first colours in the order of their ids, so a team keeps its colour while the
 * same teams are on the chart, however they pass one another. The colours are told apart next to
 * their neighbours in this order (`index.css`), which is why none is skipped.
 */
export const seriesSlots = (ids: readonly string[]): Map<string, number> =>
  new Map([...ids].sort().map((id, at) => [id, at]));

/** The width a chart is drawn at before its box has been measured, and where it cannot be. */
const UNMEASURED_WIDTH = 640;

/** An axis label's width, near enough to keep two from touching: 12px semibold digits and words. */
const labelWidth = (label: string) => label.length * 7 + 16;

/**
 * The width of the box the chart is drawn in, as it changes. The chart is drawn at that size, one
 * unit of its SVG to one pixel, so its type is 12px on every screen. Drawn to a fixed 640 units and
 * stretched to fit, as it was, a 360px phone showed its axis at 4.5px and its 240px plot at 108px,
 * and a wide desktop showed the same labels at 19px.
 */
const useBoxWidth = () => {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(UNMEASURED_WIDTH);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // An observer reports once when it starts watching, so the first size arrives through it too.
    const observer = new ResizeObserver(() => {
      const measured = Math.round(element.clientWidth);
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [box, width] as const;
};

export function LineChart({
  series,
  yMin = 0,
  yMax = 100,
  yTicks,
  valueLabel = (value) => `${Math.round(value)}%`,
  xLabels,
  cutLine,
  invert = false,
}: {
  series: LineSeries[];
  yMin?: number;
  yMax?: number;
  /** Where the grid's lines fall. Five evenly spaced where none are given. */
  yTicks?: number[];
  /** A value as the axis, the readout and the table print it. */
  valueLabel?: (value: number) => string;
  /** A name for every point along the line, first to last. The axis prints as many as fit. */
  xLabels: string[];
  cutLine?: { value: number; label?: string };
  /** Smaller values at the top, for places in a table, where first is best. */
  invert?: boolean;
}) {
  const titleId = useId();
  const descId = useId();
  const [box, width] = useBoxWidth();
  const [at, setAt] = useState<number | null>(null);

  // Tall enough to tell five lines apart on a phone, and no taller than a wide screen needs.
  const height = Math.round(Math.max(220, Math.min(340, width * 0.4)));
  const padding = { top: 12, right: 16, bottom: 28, left: 44 };
  const innerW = Math.max(1, width - padding.left - padding.right);
  const innerH = height - padding.top - padding.bottom;

  const points = Math.max(1, ...series.map((s) => s.values.length));
  const xFor = (i: number) => padding.left + (i / Math.max(points - 1, 1)) * innerW;
  const yFor = (v: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    const ratio = (clamped - yMin) / Math.max(yMax - yMin, 1);
    return padding.top + (invert ? ratio : 1 - ratio) * innerH;
  };

  const ticks = yTicks ?? Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) / 4) * i);

  // As many of the axis's labels as fit without touching, counted back from the last so the
  // latest point is always named.
  const widest = Math.max(0, ...xLabels.map(labelWidth));
  const every = Math.max(1, Math.ceil(widest / (innerW / Math.max(points - 1, 1))));
  const onAxis = (i: number) => xLabels[i] !== "" && (points - 1 - i) % every === 0;

  const read = (event: React.PointerEvent<SVGSVGElement>): number | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const px = ((event.clientX - rect.left) / rect.width) * width;
    const ratio = Math.max(0, Math.min(1, (px - padding.left) / innerW));
    return Math.round(ratio * (points - 1));
  };

  /** A line's figure at one point; its latest is the page's own wording where there is one. */
  const labelAt = (s: LineSeries, i: number, value: number) =>
    i === s.values.length - 1 && s.nowLabel ? s.nowLabel : valueLabel(value);

  const described = series
    .map((s) => {
      const first = s.values[0];
      const last = s.values[s.values.length - 1];
      if (first === undefined || last === undefined) return s.label;
      return `${s.label}: ${valueLabel(first)} to ${labelAt(s, s.values.length - 1, last)}`;
    })
    .join("; ");

  return (
    <figure>
      <div ref={box} className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          height={height}
          role="img"
          aria-labelledby={titleId}
          aria-describedby={descId}
          // A finger moving across reads the chart, and one moving up or down scrolls the page.
          className="block w-full touch-pan-y select-none"
          onPointerMove={(event) => setAt(read(event))}
          onPointerDown={(event) => {
            const next = read(event);
            // A mouse leaves the chart to put the readout away; a finger taps the same point again.
            setAt((shown) => (event.pointerType !== "mouse" && shown === next ? null : next));
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setAt(null);
          }}
        >
          <title id={titleId}>{series.map((s) => s.label).join(", ")}</title>
          <desc id={descId}>{described}</desc>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={padding.left + innerW}
                y1={yFor(tick)}
                y2={yFor(tick)}
                className="stroke-slate-200 dark:stroke-slate-800"
              />
              <text
                x={padding.left - 8}
                y={yFor(tick) + 4}
                textAnchor="end"
                className="fill-slate-600 text-xs font-semibold tabular-nums dark:fill-slate-400"
              >
                {valueLabel(tick)}
              </text>
            </g>
          ))}
          {xLabels.map((label, i) =>
            onAxis(i) ? (
              <text
                key={`x-${i}`}
                x={xFor(i)}
                y={height - 8}
                // The ends are set from their own edge, so neither runs out past the chart.
                textAnchor={i === points - 1 ? "end" : i === 0 ? "start" : "middle"}
                className="fill-slate-600 text-xs font-semibold tabular-nums dark:fill-slate-400"
              >
                {label}
              </text>
            ) : null
          )}
          {cutLine !== undefined && (
            <g>
              <line
                x1={padding.left}
                x2={padding.left + innerW}
                y1={yFor(cutLine.value)}
                y2={yFor(cutLine.value)}
                className="stroke-red-500 dark:stroke-red-400"
                strokeDasharray="5 4"
                strokeWidth={1.5}
              />
              {cutLine.label && (
                <text
                  x={padding.left + 6}
                  y={yFor(cutLine.value) - 6}
                  // Ringed in the card's own colour, so a line crossing behind it does not strike
                  // through the words.
                  className="fill-slate-700 stroke-white text-xs font-bold [paint-order:stroke] dark:fill-slate-200 dark:stroke-slate-900"
                  strokeWidth={4}
                  strokeLinejoin="round"
                >
                  {cutLine.label}
                </text>
              )}
            </g>
          )}
          {series.map((s) => (
            <polyline
              key={s.id}
              points={s.values.map((value, i) => `${xFor(i)},${yFor(value)}`).join(" ")}
              fill="none"
              style={{ stroke: colourOf(s.slot) }}
              strokeWidth={s.lead ? 3.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {/* Over every line, each ringed in the card's colour so it reads where lines cross. */}
          {series.map((s) => {
            const last = s.values[s.values.length - 1];
            if (last === undefined) return null;
            return (
              <circle
                key={`end-${s.id}`}
                cx={xFor(s.values.length - 1)}
                cy={yFor(last)}
                r={s.lead ? 5 : 4}
                style={{ fill: colourOf(s.slot) }}
                className="stroke-white dark:stroke-slate-900"
                strokeWidth={2}
              />
            );
          })}
          {at !== null && (
            <g>
              <line
                x1={xFor(at)}
                x2={xFor(at)}
                y1={padding.top}
                y2={padding.top + innerH}
                className="stroke-slate-400 dark:stroke-slate-500"
              />
              {series.map((s) => {
                const value = s.values[at];
                if (value === undefined) return null;
                return (
                  <circle
                    key={`at-${s.id}`}
                    cx={xFor(at)}
                    cy={yFor(value)}
                    r={4}
                    style={{ fill: colourOf(s.slot) }}
                    className="stroke-white dark:stroke-slate-900"
                    strokeWidth={2}
                  />
                );
              })}
            </g>
          )}
        </svg>
        {at !== null && (
          <div
            data-testid="chart-readout"
            // On the side of the line with more room, so it never covers the point it reads.
            style={
              xFor(at) < width / 2 ? { left: xFor(at) + 12 } : { right: width - xFor(at) + 12 }
            }
            className="pointer-events-none absolute top-2 z-10 max-w-[70%] rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900"
          >
            {xLabels[at] ? (
              <div className="mb-1 font-semibold text-slate-600 dark:text-slate-300">
                {xLabels[at]}
              </div>
            ) : null}
            {series.map((s) => {
              const value = s.values[at];
              if (value === undefined) return null;
              return (
                <div key={`read-${s.id}`} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                    style={{ background: colourOf(s.slot) }}
                  />
                  <span className="font-black tabular-nums text-slate-950 dark:text-slate-100">
                    {labelAt(s, at, value)}
                  </span>
                  <span className="font-semibold text-slate-600 dark:text-slate-300">
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {series.length > 1 && (
        <figcaption className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
          {series.map((s) => {
            const last = s.values[s.values.length - 1];
            return (
              <span key={`key-${s.id}`} className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block w-4 shrink-0 rounded-full ${s.lead ? "h-1" : "h-0.5"}`}
                  style={{ background: colourOf(s.slot) }}
                />
                <span>{s.label}</span>
                {last !== undefined && (
                  <span className="font-black tabular-nums text-slate-950 dark:text-slate-100">
                    {labelAt(s, s.values.length - 1, last)}
                  </span>
                )}
              </span>
            );
          })}
        </figcaption>
      )}
      {/* Every figure the chart draws, for a reader who cannot point at it or tell its colours. */}
      <details className="mt-2 text-xs">
        <summary
          className={`inline-flex cursor-pointer items-center rounded-sm font-bold text-slate-600 dark:text-slate-300 ${tapArea} ${focusRing}`}
        >
          Show the numbers
        </summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left tabular-nums">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td />
                {series.map((s) => (
                  <th
                    key={`head-${s.id}`}
                    scope="col"
                    className="px-2 py-1 font-bold text-slate-950 dark:text-slate-100"
                  >
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: points }, (_, i) => (
                <tr key={`row-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                  <th
                    scope="row"
                    className="whitespace-nowrap py-1 pr-2 font-semibold text-slate-600 dark:text-slate-300"
                  >
                    {xLabels[i] || `Point ${i + 1}`}
                  </th>
                  {series.map((s) => {
                    const value = s.values[i];
                    return (
                      <td
                        key={`cell-${s.id}`}
                        className="px-2 py-1 font-semibold text-slate-800 dark:text-slate-200"
                      >
                        {value === undefined ? "—" : labelAt(s, i, value)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
