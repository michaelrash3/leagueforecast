export type PillTone =
  | "neutral"
  | "emerald"
  | "blue"
  | "amber"
  | "red"
  | "dark";

const pillTones: Record<PillTone, string> = {
  neutral: "bg-slate-100 text-slate-600",
  emerald: "bg-emerald-100 text-emerald-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  dark: "bg-slate-950 text-white",
};

export const pill = (tone: PillTone = "neutral") =>
  `rounded-full px-3 py-1 text-xs font-black ${pillTones[tone]}`;

export const card = "rounded-3xl border border-slate-200 bg-white shadow-sm";

export const tab = (active: boolean) =>
  `rounded-xl px-4 py-2 text-sm font-black ${
    active
      ? "bg-white text-slate-950 shadow-sm"
      : "text-slate-500 hover:text-slate-950"
  }`;

export const button = {
  primary:
    "rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50",
  dark:
    "rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50",
  ghost:
    "rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50",
  danger:
    "rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-600 shadow-sm hover:bg-red-50",
};
