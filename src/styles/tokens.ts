export type PillTone =
  | "neutral"
  | "emerald"
  | "blue"
  | "amber"
  | "red"
  | "dark";

const pillTones: Record<PillTone, string> = {
  neutral:
    "bg-white/80 text-slate-700 ring-1 ring-slate-200 backdrop-blur dark:bg-slate-900/70 dark:text-slate-200 dark:ring-slate-700",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/70",
  blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900/70",
  amber:
    "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/70",
  red: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900/70",
  dark: "bg-slate-950 text-white ring-1 ring-slate-800 dark:bg-white dark:text-slate-950 dark:ring-white/20",
};

export const pill = (tone: PillTone = "neutral") =>
  `rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide shadow-sm ${pillTones[tone]}`;

export const card =
  "rounded-[2rem] border border-white/70 bg-white/90 shadow-xl shadow-slate-200/60 ring-1 ring-slate-200/80 backdrop-blur dark:border-slate-700/70 dark:bg-slate-900/85 dark:shadow-black/30 dark:ring-slate-800";

export const tab = (active: boolean) =>
  `whitespace-nowrap rounded-2xl px-4 py-2 text-sm font-black transition sm:px-6 sm:py-3 sm:text-base ${
    active
      ? "bg-white text-slate-950 shadow-lg shadow-black/15 ring-1 ring-white/80"
      : "text-slate-300/75 hover:bg-white/10 hover:text-white"
  }`;

export const button = {
  primary:
    "rounded-xl bg-gradient-to-r from-red-600 via-red-600 to-amber-600 px-5 py-3 text-sm font-black text-white shadow-lg shadow-red-950/10 hover:from-red-700 hover:to-amber-700 disabled:cursor-not-allowed disabled:opacity-50",
  dark:
    "rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/10 ring-1 ring-slate-800 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:ring-white/20 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "rounded-xl border border-slate-300 bg-white/90 px-5 py-3 text-sm font-black text-slate-800 shadow-sm ring-1 ring-white/70 backdrop-blur hover:bg-white dark:border-slate-600 dark:bg-slate-800/90 dark:text-slate-100 dark:ring-white/10 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-600 shadow-sm hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30",
};
