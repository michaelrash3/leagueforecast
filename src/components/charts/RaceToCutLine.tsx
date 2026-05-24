import { LineChart, type LineSeries } from "./LineChart";

/**
 * Race-to-the-cut-line chart: x = state index (e.g. game progression), y = rank
 * (inverted so #1 is at top). Cut line drawn as a horizontal band.
 */
export function RaceToCutLine({
  rankSeries,
  cutoff,
  totalTeams,
  xLabels,
  highlightIds = [],
}: {
  rankSeries: { id: string; name: string; ranks: number[] }[];
  cutoff: number;
  totalTeams: number;
  xLabels?: string[];
  highlightIds?: string[];
}) {
  // Invert ranks: smaller rank = higher on chart. We map rank R → y value (totalTeams - R + 1)
  // so the LineChart can plot ascending = better.
  const series: LineSeries[] = rankSeries.map((s, idx) => ({
    id: s.id,
    label: s.name,
    values: s.ranks.map((r) => totalTeams - r + 1),
    tone: highlightIds.includes(s.id)
      ? idx % 2 === 0
        ? "emerald"
        : "blue"
      : "slate",
  }));
  return (
    <LineChart
      series={series}
      yMin={0}
      yMax={totalTeams}
      yLabel=""
      xLabels={xLabels}
      height={260}
      showLegend={false}
      cutLine={{ value: totalTeams - cutoff + 0.5, label: `Top ${cutoff}` }}
    />
  );
}
