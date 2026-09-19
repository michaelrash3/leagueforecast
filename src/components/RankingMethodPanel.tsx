import {
  MATCHUP_MARGIN_CAP,
  MATCHUP_PROBABILITY_FLOOR,
  MIN_RANKED_AGE_LEVEL,
  RATING_CAP,
} from "../lib/teamRankings";
import { AGE_GAP_RUNS_PER_YEAR } from "../lib/powerRating";
import { ACTIVE_RECENCY_SCHEME } from "../lib/ratingRecency";
import { focusRing } from "../styles/tokens";

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
      className={`ml-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-bold leading-none text-slate-500 shadow-xs transition hover:border-slate-400 hover:text-slate-800 ${focusRing} dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white`}
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
            3. What a record can actually support.
          </span>{" "}
          Two things, and the second is the one that stops a 4-0 team topping the table. First, a
          thin record is pulled toward the middle, so one game does not earn a big rating. That
          makes the estimate as good as it can be — but a best guess off four games is not the same
          claim as the same number off forty, and the table used to rank them side by side. So what
          is ranked and shown is the estimate less one standard error: not what a team might be, but
          what it is confidently worth, measured against how much an average team in this pool has
          played. A 4-0 team therefore sits behind an 11-1 team that has proved as much over nearly
          three times the schedule. The full table shows the undiscounted estimate beside it, so you
          can see exactly what a record is and is not carrying.
        </li>
        <li>
          <span className="font-bold text-slate-950 dark:text-white">4. Playing up or down.</span> A
          season&apos;s age groups are rated together, so a game against the level above or below
          counts. The older side is expected to win by about {AGE_GAP_RUNS_PER_YEAR} runs per year
          of age, and the model starts from that and lets the season&apos;s cross-age games adjust
          it. An 8U losing to a 9U by {AGE_GAP_RUNS_PER_YEAR} is treated as an even game, not a loss
          that drags it down. Strength of schedule follows the same rule: playing up credits you for
          the year of age you gave away, playing down debits you for the year you took.
        </li>
        <li>
          <span className="font-bold text-slate-950 dark:text-white">
            5. Recent form counts more.
          </span>{" "}
          Newer games pull harder: {ACTIVE_RECENCY_SCHEME.label}. A side that lost in September and
          has been winning since is rated closer to the side it is now than to the one it was. The
          season is still the season: every game in the squad year stays in the fit, and an autumn
          game simply counts for less than a spring one by the time spring comes. It changes the
          rating only: the record, the games played and the strength of schedule are what the season
          was, and they do not move.
        </li>
      </ol>

      <p className="mt-3">
        <span className="font-bold text-slate-950 dark:text-white">
          Only {MIN_RANKED_AGE_LEVEL}U and up are ranked.
        </span>{" "}
        Younger pages still hold games, and those results are still evidence about the ranked teams
        that played down against them — they simply get no table of their own.
      </p>

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
        another season year, which is a different squad rather than a different level.
      </p>

      <p className="mt-3 border-t border-slate-200 pt-3 text-xs dark:border-slate-800">
        <span className="font-bold text-slate-950 dark:text-white">
          A rating is only as wide as the games behind it.
        </span>{" "}
        It is a margin against the average of everyone a team&apos;s schedule can reach — opponents,
        their opponents, and so on — so two teams that share nobody are measured against two
        different sets of teams, and their difference is not a prediction. On a part-pulled pool
        that is usually the pull rather than the schedule: a club that really does connect them sits
        in the list as a name until it is pulled, and pulling it joins both. A matchup like that is
        labelled <em>no shared opponents yet</em> rather than quietly stated, and Setup lists which
        clubs are still only names.
      </p>
    </div>
  );
}
