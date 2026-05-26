import React from "react";
import { clamp } from "../../lib/util";

export const Sparkline = React.memo(function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return <span className="text-slate-500">—</span>;
  const width = 108;
  const height = 30;
  const seed = values[0] ?? 0;
  const data = values.length === 1 ? [seed, seed] : values;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - (clamp(value, 0, 100) / 100) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const last = data[data.length - 1] ?? 0;
  const tone = last >= 75 ? "stroke-emerald-500" : last >= 40 ? "stroke-blue-500" : "stroke-slate-500";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible"
      role="img"
      aria-label={`Gold odds trend, latest ${Math.round(last)}%`}
    >
      <polyline
        points={points}
        fill="none"
        className={tone}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={height - (clamp(last, 0, 100) / 100) * height}
        r="3"
        className={tone.replace("stroke", "fill")}
      />
    </svg>
  );
});
