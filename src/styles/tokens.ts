export type PillTone =
  | "neutral"
  | "emerald"
  | "blue"
  | "amber"
  | "red"
  | "dark";

const pillTones: Record<PillTone, string> = {
  neutral:
    "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700",
  emerald:
    "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:ring-emerald-900/70",
  blue: "bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:ring-blue-900/70",
  amber:
    "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:ring-amber-900/70",
  red: "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900/70",
  dark: "bg-slate-950 text-white ring-1 ring-slate-800 dark:bg-white dark:text-slate-950 dark:ring-white/20",
};

export const pill = (tone: PillTone = "neutral") =>
  `rounded-none px-3 py-1 text-xs font-black uppercase tracking-wide shadow-sm ${pillTones[tone]}`;

export const card =
  "rounded-none border border-transparent bg-transparent shadow-none ring-0 backdrop-blur-0 dark:border-transparent dark:bg-transparent dark:shadow-none dark:ring-0";

export const tab = (active: boolean) =>
  `whitespace-nowrap rounded-none px-4 py-2 text-sm font-black transition sm:px-5 sm:py-2.5 ${
    active
      ? "bg-white text-slate-950 shadow-lg shadow-slate-950/10 ring-1 ring-slate-200 dark:bg-white dark:text-slate-950 dark:ring-white/20"
      : "text-slate-500 hover:bg-white/75 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
  }`;

export const button = {
  primary:
    "rounded-none bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/10 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50",
  dark:
    "rounded-none bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/10 ring-1 ring-slate-800 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:ring-white/20 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "rounded-none border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "rounded-none border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-600 shadow-sm hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30",
};
