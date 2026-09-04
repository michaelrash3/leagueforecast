import { MATCHUP_MARGIN_CAP, MATCHUP_PROBABILITY_FLOOR, RATING_CAP } from "../lib/teamRankings";

const pct = (value: number) => `${Math.round(value * 100)}%`;

/**
 * The question mark that opens the explanation, and the explanation itself.
 *
 * They are two exports rather than one component because the button belongs inside the rankings
 * heading and the panel very much does not: that heading is uppercase and letter-spaced, and an
 * explanatory paragraph rendered inside it inherits both — a wall of spaced capitals. Nesting a
 * block inside an `h2` is not valid HTML either. So the caller holds the open state, puts the
 * button in the heading, and renders the panel after it.
 *
 * Click, not hover: this is used on a phone at a ballfield, where there is no hover and a tooltip
 * needing one is a control that does nothing. It expands in place rather than opening a dialog, so
 * the table it describes stays on screen behind it.
 *
 * Every number here is imported from the code that uses it, so the explanation cannot quietly
 * become wrong the day somebody tunes the model.
 */
export function RankingMethodButton({
  open,
  onToggle,
  panelId,
}: {
  open: boolean;
  onToggle: () => void;
  panelId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label="How the ranking is decided"
      className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-bold leading-none text-slate-500 shadow-xs transition hover:border-slate-400 hover:text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
    >
      ?
    </button>
  );
}

export function RankingMethodPanel({ id, onClose }: { id: string; onClose: () => void }) {
  return (
    <div
      id={id}
      className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm normal-case leading-6 tracking-normal text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
          How the ranking is decided
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-xs font-bold text-slate-500 hover:underline dark:text-slate-400"
        >
          Close
        </button>
      </div>

      <p className="mt-3">
        A rating estimates how many runs a team beats an <em>average</em> team in this age group by.{" "}
        <strong className="text-slate-950 dark:text-white">0.0</strong> is average;{" "}
        <strong className="text-slate-950 dark:text-white">+3.0</strong> is about three runs better
        than average against equal opposition.
      </p>

      <ol className="mt-3 flex list-none flex-col gap-3 p-0">
        <li>
          <span className="font-bold text-slate-950 dark:text-white">
            1. Run margin, but capped.
          </span>{" "}
          Each game contributes the winning margin, clamped to {RATING_CAP} runs. A{" "}
          {RATING_CAP + 12}
          -0 counts the same as an {RATING_CAP}-0 — otherwise one blowout against a weak team would
          outweigh a season of close wins against strong ones.
        </li>
        <li>
          <span className="font-bold text-slate-950 dark:text-white">
            2. Adjusted for who you played.
          </span>{" "}
          Rather than averaging, the model looks for a rating per team such that every game&apos;s
          margin is explained as well as possible, all at once. Beat a good team by 3 and you rate
          well; beat a poor team by the same 3 and you do not. It carries through a chain too — beat
          a team that beat a strong team and some of that reaches you, which is what lets two teams
          who never met be compared through a common opponent.
        </li>
        <li>
          <span className="font-bold text-slate-950 dark:text-white">
            3. Small samples pulled toward the middle.
          </span>{" "}
          One game does not earn a big rating. The more a team plays, the more its rating is its own
          — which is what stops a 1-0 team topping the table in April.
        </li>
      </ol>

      <p className="mt-3">
        <span className="font-bold text-slate-950 dark:text-white">Win probability</span> comes from
        the gap between two ratings, and never leaves {pct(MATCHUP_PROBABILITY_FLOOR)}–
        {pct(1 - MATCHUP_PROBABILITY_FLOOR)}. Projected margins stop at {MATCHUP_MARGIN_CAP} runs.
        Youth baseball has no locks, and a number closer to certain than that would be claiming one.
      </p>

      <p className="mt-3">
        <span className="font-bold text-slate-950 dark:text-white">What is left out:</span> wins and
        losses as such — only margins count; which team was listed first, since that carries no
        meaning here; games not yet played; games you have set not to count; and anything from
        another age group.
      </p>

      <p className="mt-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
        <span className="font-bold text-slate-950 dark:text-white">Worth knowing:</span> until teams
        share opponents, directly or through a chain, a rating is not much more than run
        differential. A table where nobody has played anybody in common is not really a ranking yet.
      </p>
    </div>
  );
}
