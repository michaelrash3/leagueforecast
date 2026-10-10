/**
 * Keyboard focus, on everything here that can be focused.
 *
 * These styles carried hover treatment and nothing for focus, so tabbing through the app moved a
 * selection nobody could see — the browser's own outline having been overridden by the ring
 * utilities used ad hoc elsewhere. `focus-visible` rather than `focus` so a mouse click does not
 * leave a ring behind it, and an offset ring so it reads against both the light and dark surfaces
 * these sit on.
 */
export const focusRing =
  "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950";

/**
 * A text field is the one place `focus-visible` is wrong: clicking into a box and seeing no change
 * reads as the click having missed. So a field rings on plain focus, and quietly, since the box
 * already has a border to thicken.
 */
export const fieldFocusRing =
  "outline-hidden focus:border-slate-950 focus:ring-2 focus:ring-slate-200 dark:focus:border-white dark:focus:ring-slate-700";

export type PillTone = "neutral" | "emerald" | "blue" | "amber" | "red" | "dark";

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
  `rounded-lg px-3 py-1 text-xs font-black uppercase tracking-wide shadow-xs ${pillTones[tone]}`;

export const card =
  "rounded-lg border border-slate-200 bg-white shadow-xs shadow-slate-200/70 ring-1 ring-white/70 dark:border-slate-800 dark:bg-slate-950 dark:shadow-black/20 dark:ring-slate-900";

/**
 * A tab. `fill` shares a phone's row equally with its siblings, its type sized with the screen
 * (2.4): the app-mode switch's two tabs at the regular size measured 336px against the 288px a
 * 320px screen leaves, which widened the whole page on the narrowest phones.
 */
export const tab = (active: boolean, size: "regular" | "fill" = "regular") =>
  `whitespace-nowrap rounded-lg font-bold transition ${
    size === "fill"
      ? "min-w-0 flex-1 px-2 py-2 text-[clamp(11px,3.6vw,14px)] sm:flex-none sm:px-5 sm:py-2.5 sm:text-sm"
      : "px-4 py-2 text-sm sm:px-5 sm:py-2.5"
  } ${focusRing} ${
    active
      ? "bg-slate-950 text-white shadow-xs dark:bg-white dark:text-slate-950"
      : "text-slate-600 hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
  }`;

export const button = {
  primary: `rounded-lg bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/10 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`,
  dark: `rounded-lg bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-lg shadow-slate-950/10 ring-1 ring-slate-800 hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:ring-white/20 dark:hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`,
  ghost: `rounded-lg border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`,
  danger: `rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-600 shadow-xs hover:bg-red-50 dark:border-red-900 dark:bg-slate-900 dark:text-red-400 dark:hover:bg-red-950/30 ${focusRing}`,
};

/**
 * The roles text plays (2.5), each one look wherever it appears, so a page title on the Forecast
 * reads as one on Settings and a footnote never passes for a heading. Grey text is slate-600 at
 * the lightest, not the slate-500 much of the app used: on the page's slate-100 background slate-500
 * measured 4.35:1, under the 4.5:1 small text needs (`tokens.test.ts` measures every role on every
 * surface, light and dark). The overline is for labels a reader can do without; what a reader needs
 * to know is never only in small capitals.
 */
export const textRole = {
  pageTitle: "text-2xl font-black tracking-tight text-slate-950 dark:text-slate-100",
  /** The line under a page title saying what the page is for. */
  pageLead: "text-sm font-semibold text-slate-600 dark:text-slate-300",
  sectionTitle: "text-lg font-black text-slate-950 dark:text-slate-100",
  cardTitle: "text-base font-black text-slate-950 dark:text-slate-100",
  body: "text-sm text-slate-700 dark:text-slate-200",
  /** Dates, counts, sources: what qualifies the content rather than being it. */
  meta: "text-xs font-semibold text-slate-600 dark:text-slate-400",
  /** A figure to read at a glance, its digits all one width so columns of them line up. */
  numeric: "font-black tabular-nums text-slate-950 dark:text-slate-100",
  overline: "text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300",
} as const;

/**
 * Three surfaces (2.5), so not every piece of content is an equally loud white card: the page
 * itself, a primary surface for what a page is about (`card`), and a quiet inset for what groups
 * within one, without a border or a shadow of its own.
 */
export const surface = {
  page: "bg-slate-100 dark:bg-slate-950",
  primary: card,
  inset: "rounded-lg bg-slate-50 dark:bg-slate-900",
} as const;

/**
 * What a panel shows in place of its content (2.5): nothing yet, on its way, failed, out of reach
 * offline, or shown as it last was while the newer copy is fetched. Each has its own surface, so
 * the five never look alike, and the same one wherever it appears (`StatePanel`).
 */
export type StateKind = "empty" | "loading" | "error" | "offline" | "stale";

export const stateTone: Record<StateKind, { box: string; title: string; body: string }> = {
  empty: {
    box: "rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center dark:border-slate-700 dark:bg-slate-900",
    title: "text-lg font-black text-slate-950 dark:text-slate-100",
    body: "text-sm font-semibold text-slate-600 dark:text-slate-300",
  },
  loading: {
    box: `${card} p-5`,
    title: "text-sm font-bold text-slate-600 dark:text-slate-300",
    body: "text-sm text-slate-700 dark:text-slate-200",
  },
  error: {
    box: "rounded-lg border border-red-200 bg-red-50 p-5 dark:border-red-900/70 dark:bg-red-950/40",
    title: "text-base font-black text-red-800 dark:text-red-200",
    body: "text-sm text-slate-700 dark:text-slate-200",
  },
  offline: {
    box: "rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900",
    title: "text-sm font-black text-slate-950 dark:text-slate-100",
    body: "text-sm font-semibold text-slate-700 dark:text-slate-200",
  },
  stale: {
    box: "rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/70 dark:bg-amber-950/40",
    title: "text-sm font-black text-amber-900 dark:text-amber-100",
    body: "text-sm font-semibold text-amber-900 dark:text-amber-100",
  },
};
