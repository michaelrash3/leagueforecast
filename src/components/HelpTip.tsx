import type { ReactNode } from "react";

type HelpTipProps = {
  title: string;
  children: ReactNode;
};

export function HelpTip({ title, children }: HelpTipProps) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-black leading-none text-slate-500 shadow-sm transition hover:border-slate-400 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 dark:hover:text-white"
        aria-label={`Help: ${title}`}
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-7 z-40 hidden w-64 -translate-x-1/2 rounded-none border border-slate-200 bg-white p-3 text-left text-xs font-semibold normal-case leading-5 tracking-normal text-slate-600 shadow-xl group-focus-within:block group-hover:block dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-900 dark:text-slate-100">
          {title}
        </span>
        {children}
      </span>
    </span>
  );
}
