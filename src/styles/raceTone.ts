import type { TeamWithProjection } from "../lib/types";

/**
 * Where a team stands in the race for the gold bracket, and how a row says so.
 *
 * The tone is the reading; the two class maps are how it is shown. Together in one place because a
 * tone nobody can style is useless and a style nobody assigns a tone to is arbitrary.
 */
export type RaceTone = "clinched" | "safe" | "inside" | "bubble" | "chasing" | "out";

export const raceToneForTeam = (team: TeamWithProjection, goldCutoff: number): RaceTone => {
  if (team.goldStatus === "Clinched") return "clinched";
  if (team.goldStatus === "Eliminated") return "out";
  if ((team.rank ?? 99) <= goldCutoff) {
    if (team.goldPct >= 75) return "safe";
    return "inside";
  }
  if (team.goldPct >= 25 || (team.projectedRank ?? 99) <= goldCutoff) return "bubble";
  return "chasing";
};

export const raceRowToneClasses: Record<RaceTone, string> = {
  clinched:
    "bg-linear-to-r from-slate-950/8 via-slate-900/4 to-transparent ring-slate-900/20 dark:from-white/10 dark:via-white/5 dark:ring-white/15",
  safe: "bg-linear-to-r from-emerald-500/14 via-emerald-400/7 to-transparent ring-emerald-300/50 dark:from-emerald-500/18 dark:via-emerald-400/8 dark:ring-emerald-800/70",
  inside:
    "bg-linear-to-r from-blue-500/14 via-sky-400/7 to-transparent ring-blue-300/50 dark:from-blue-500/18 dark:via-sky-400/8 dark:ring-blue-800/70",
  bubble:
    "bg-linear-to-r from-amber-500/18 via-yellow-400/8 to-transparent ring-amber-300/60 dark:from-amber-500/22 dark:via-yellow-400/10 dark:ring-amber-800/70",
  chasing:
    "bg-linear-to-r from-orange-500/14 via-orange-400/7 to-transparent ring-orange-300/50 dark:from-orange-500/18 dark:via-orange-400/8 dark:ring-orange-800/70",
  out: "bg-linear-to-r from-red-500/14 via-rose-400/7 to-transparent ring-red-300/50 dark:from-red-500/18 dark:via-rose-400/8 dark:ring-red-800/70",
};

export const raceSeedBadgeClasses: Record<RaceTone, string> = {
  clinched: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
  safe: "bg-emerald-600 text-white dark:bg-emerald-400 dark:text-emerald-950",
  inside: "bg-blue-600 text-white dark:bg-blue-400 dark:text-blue-950",
  bubble: "bg-amber-500 text-slate-950 dark:bg-amber-300 dark:text-amber-950",
  chasing: "bg-orange-500 text-white dark:bg-orange-300 dark:text-orange-950",
  out: "bg-red-600 text-white dark:bg-red-400 dark:text-red-950",
};
