import { useId, useState } from "react";

export type LineSeries = {
  id: string;
  label: string;
  values: number[];
  tone?: "emerald" | "blue" | "red" | "amber" | "slate";
};

const TONE_STROKE: Record<NonNullable<LineSeries["tone"]>, string> = {
  emerald: "stroke-emerald-500",
  blue: "stroke-blue-500",
  red: "stroke-red-500",
  amber: "stroke-amber-500",
  slate: "stroke-slate-500",
};

const TONE_FILL: Record<NonNullable<LineSeries["tone"]>, string> = {
  emerald: "fill-emerald-500",
  blue: "fill-blue-500",
  red: "fill-red-500",
  amber: "fill-amber-500",
  slate: "fill-slate-500",
};

export function LineChart({
  series,
  yMin = 0,
  yMax = 100,
  yLabel = "%",
  xLabels,
  height = 220,
  showLegend = true,
  highlightLast = true,
  cutLine,
}: {
  series: LineSeries[];
  yMin?: number;
  yMax?: number;
  yLabel?: string;
  xLabels?: string[];
  height?: number;
  showLegend?: boolean;
  highlightLast?: boolean;
  cutLine?: { value: number; label?: string };
}) {
  const titleId = useId();
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };
  const width = 640;
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const maxLen = Math.max(1, ...series.map((s) => s.values.length));
  const xFor = (i: number) =>
    padding.left + (i / Math.max(maxLen - 1, 1)) * innerW;
  const yFor = (v: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, v));
    const ratio = (clamped - yMin) / Math.max(yMax - yMin, 1);
    return padding.top + (1 - ratio) * innerH;
  };

  const [hover, setHover] = useState<{ x: number; index: number } | null>(null);

  const gridTicks = 4;
  const ticks = Array.from({ length: gridTicks + 1 }, (_, i) => {
    const value = yMin + ((yMax - yMin) / gridTicks) * i;
    return { value, y: yFor(value) };
  });

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        className="w-full select-none"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - rect.left) / rect.width) * width;
          if (px < padding.left || px > padding.left + innerW) {
            setHover(null);
            return;
          }
          const ratio = (px - padding.left) / innerW;
          const index = Math.round(ratio * (maxLen - 1));
          setHover({ x: xFor(index), index });
        }}
      >
        <title id={titleId}>{series.map((s) => s.label).join(", ")}</title>
        {/* Grid */}
        {ticks.map((tick) => (
          <g key={tick.value}>
            <line
              x1={padding.left}
              x2={padding.left + innerW}
              y1={tick.y}
              y2={tick.y}
              className="stroke-slate-200 dark:stroke-slate-700"
              strokeDasharray="3 3"
            />
            <text
              x={padding.left - 6}
              y={tick.y + 3}
              className="fill-slate-500 dark:fill-slate-400 text-[10px] font-bold"
              textAnchor="end"
            >
              {Math.round(tick.value)}
              {yLabel}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xLabels && xLabels.length > 0 && (
          <g>
            {xLabels.map((label, i) => (
              <text
                key={`xl-${i}`}
                x={xFor(i)}
                y={height - 8}
                textAnchor="middle"
                className="fill-slate-500 dark:fill-slate-400 text-[10px] font-bold"
              >
                {label}
              </text>
            ))}
          </g>
        )}
        {/* Cut line band */}
        {cutLine !== undefined && (
          <g>
            <line
              x1={padding.left}
              x2={padding.left + innerW}
              y1={yFor(cutLine.value)}
              y2={yFor(cutLine.value)}
              className="stroke-red-400"
              strokeDasharray="5 4"
              strokeWidth={1.5}
            />
            {cutLine.label && (
              <text
                x={padding.left + innerW - 4}
                y={yFor(cutLine.value) - 4}
                textAnchor="end"
                className="fill-red-500 text-[10px] font-black uppercase tracking-wide"
              >
                {cutLine.label}
              </text>
            )}
          </g>
        )}
        {/* Series */}
        {series.map((s) => {
          const tone = s.tone ?? "blue";
          const points = s.values
            .map((value, i) => `${xFor(i)},${yFor(value)}`)
            .join(" ");
          const last = s.values[s.values.length - 1] ?? yMin;
          return (
            <g key={s.id}>
              <polyline
                points={points}
                fill="none"
                className={TONE_STROKE[tone]}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {highlightLast && (
                <circle
                  cx={xFor(s.values.length - 1)}
                  cy={yFor(last)}
                  r={3}
                  className={TONE_FILL[tone]}
                />
              )}
            </g>
          );
        })}
        {/* Hover crosshair + tooltip */}
        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={padding.top}
              y2={padding.top + innerH}
              className="stroke-slate-400 dark:stroke-slate-500"
              strokeDasharray="2 3"
            />
            {series.map((s) => {
              const v = s.values[hover.index];
              if (typeof v !== "number") return null;
              const tone = s.tone ?? "blue";
              return (
                <circle
                  key={`hov-${s.id}`}
                  cx={hover.x}
                  cy={yFor(v)}
                  r={3.5}
                  className={TONE_FILL[tone]}
                />
              );
            })}
            <g transform={`translate(${Math.min(hover.x + 8, width - 140)}, ${padding.top + 4})`}>
              <rect
                width={132}
                height={Math.min(110, 18 + series.length * 14)}
                rx={6}
                className="fill-white dark:fill-slate-900 stroke-slate-200 dark:stroke-slate-700"
              />
              {xLabels?.[hover.index] && (
                <text
                  x={8}
                  y={14}
                  className="fill-slate-500 dark:fill-slate-400 text-[10px] font-black uppercase tracking-wide"
                >
                  {xLabels[hover.index]}
                </text>
              )}
              {series.slice(0, 5).map((s, i) => {
                const v = s.values[hover.index];
                if (typeof v !== "number") return null;
                return (
                  <text
                    key={`tt-${s.id}`}
                    x={8}
                    y={30 + i * 14}
                    className="fill-slate-800 dark:fill-slate-100 text-[11px] font-bold"
                  >
                    {s.label}: {Math.round(v)}
                    {yLabel}
                  </text>
                );
              })}
            </g>
          </g>
        )}
      </svg>
      {showLegend && series.length > 1 && (
        <figcaption className="mt-2 flex flex-wrap gap-3 text-xs font-bold text-slate-600 dark:text-slate-300">
          {series.map((s) => {
            const tone = s.tone ?? "blue";
            return (
              <span key={`lg-${s.id}`} className="inline-flex items-center gap-2">
                <span
                  aria-hidden
                  className={`inline-block h-2 w-3 rounded ${TONE_FILL[tone].replace("fill", "bg")}`}
                />
                {s.label}
              </span>
            );
          })}
        </figcaption>
      )}
    </figure>
  );
}
