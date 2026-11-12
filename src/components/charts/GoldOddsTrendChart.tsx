import { useMemo } from "react";
import { LineChart, seriesSlots, type LineSeries } from "./LineChart";
import { displayName } from "../../lib/format";
import { formatGoldPct } from "../../lib/standingsView";
import type { TeamWithProjection } from "../../lib/types";

/** How far back a point is, counted in results: the trend is redrawn after each one. */
const backLabel = (back: number) =>
  back === 0 ? "Now" : `${back} ${back === 1 ? "result" : "results"} ago`;

/**
 * Gold odds over the latest results for the strongest teams, from the same worker-produced trend
 * (`goldTrend`) as the sparklines on Standings, at full size with shared axes, a key that states
 * each team's Gold % as the tables do, a readout under the pointer and the figures as a table.
 */
export function GoldOddsTrendChart({
  rows,
  maxSeries = 5,
}: {
  rows: TeamWithProjection[];
  maxSeries?: number;
}) {
  const { series, xLabels } = useMemo(() => {
    const withTrend = rows.filter((row) => row.goldTrend.length >= 2);
    const top = [...withTrend].sort((a, b) => b.goldPct - a.goldPct).slice(0, maxSeries);
    const slots = seriesSlots(top.map((row) => row.id));
    const built: LineSeries[] = top.map((row) => ({
      id: row.id,
      label: displayName(row.name),
      values: row.goldTrend,
      slot: slots.get(row.id) ?? 0,
      // The line ends where the Gold % column stands, so the key says it as the column does.
      nowLabel: formatGoldPct(row),
    }));
    const points = built.reduce((max, s) => Math.max(max, s.values.length), 0);
    const labels = Array.from({ length: points }, (_, i) => backLabel(points - 1 - i));
    return { series: built, xLabels: labels };
  }, [rows, maxSeries]);

  if (series.length === 0) return null;

  return <LineChart series={series} yMin={0} yMax={100} xLabels={xLabels} />;
}
