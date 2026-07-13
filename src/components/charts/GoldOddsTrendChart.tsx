import { useMemo } from "react";
import { LineChart, type LineSeries } from "./LineChart";
import { displayName } from "../../lib/format";

type TrendRow = {
  id: string;
  name: string;
  goldPct: number;
  goldTrend: number[];
};

const TONES: NonNullable<LineSeries["tone"]>[] = ["emerald", "blue", "amber", "red", "slate"];

/**
 * Season-long Gold-odds trajectory for the strongest teams, using the same worker-produced
 * trend series (`goldTrend`) that powers the inline Standings sparklines — just rendered at
 * full size with hover, a legend, and shared axes so the races are readable side by side.
 */
export function GoldOddsTrendChart({
  rows,
  maxSeries = 5,
}: {
  rows: TrendRow[];
  maxSeries?: number;
}) {
  const { series, xLabels } = useMemo(() => {
    const withTrend = rows.filter((row) => row.goldTrend.length >= 2);
    const top = [...withTrend].sort((a, b) => b.goldPct - a.goldPct).slice(0, maxSeries);
    const built: LineSeries[] = top.map((row, index) => ({
      id: row.id,
      label: displayName(row.name),
      values: row.goldTrend,
      tone: TONES[index % TONES.length],
    }));
    const maxLen = built.reduce((max, s) => Math.max(max, s.values.length), 0);
    const labels = Array.from({ length: maxLen }, (_, i) => (i === maxLen - 1 ? "Now" : ""));
    return { series: built, xLabels: labels };
  }, [rows, maxSeries]);

  if (series.length === 0) return null;

  return (
    <LineChart
      series={series}
      yMin={0}
      yMax={100}
      yLabel="%"
      xLabels={xLabels}
      height={240}
    />
  );
}
