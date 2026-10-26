import { forecastWords } from "../../lib/matchupForecast";
import { previewMatchup, type ScoutRankingRow } from "../../lib/teamRankings";

/**
 * A matchup row's What if: the two clubs met today, on the ratings the board shows, worked out on
 * the device (`previewMatchup`) and said as Compare with says it (`forecastWords`). On a played
 * game it is what the board makes of them now, not what anyone expected then.
 */
export function WhatIf({ a, b }: { a: ScoutRankingRow; b: ScoutRankingRow }) {
  const preview = previewMatchup(a, b);
  const words = forecastWords(a.teamName, b.teamName, preview);
  return (
    <p className="text-xs text-slate-600 dark:text-slate-300" role="status">
      Today, on the board&apos;s ratings: {words.headline}. {words.chances}.
      {preview.unconnected && (
        <span className="block font-bold text-amber-700 dark:text-amber-400">
          Nothing in the games so far links these two, so this is a guess.
        </span>
      )}
    </p>
  );
}

/** The What if button, which says what it opens and that it is open. */
export function WhatIfButton({
  open,
  onToggle,
  label,
}: {
  open: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={`What if ${label} met today`}
      onClick={onToggle}
      className="text-xs font-bold text-slate-600 hover:underline dark:text-slate-300"
    >
      What if?
    </button>
  );
}
