export type PillTone =
  | "neutral"
  | "emerald"
  | "blue"
  | "amber"
  | "red"
  | "dark";

const pillTones: Record<PillTone, string> = {
  neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  red: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  dark: "bg-slate-950 text-white dark:bg-white dark:text-slate-950",
};

export const pill = (tone: PillTone = "neutral") =>
  `rounded-full px-3 py-1 text-xs font-black ${pillTones[tone]}`;

export const card =
  "rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900";

export const tab = (active: boolean) =>
  `whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-black sm:px-4 sm:py-2 sm:text-sm ${
    active
      ? "bg-white text-slate-950 shadow-sm dark:bg-slate-700 dark:text-white"
      : "text-slate-500 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white"
  }`;

export const button = {
  primary:
    "rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50",
  dark:
    "rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-600 shadow-sm hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30",
};
