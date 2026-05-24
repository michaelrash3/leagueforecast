import { useEffect, useState } from "react";

const STORAGE_KEY = "nkb_onboarded_v1";

const STEPS = [
  {
    title: "Welcome to the NKB Season Tracker",
    body:
      "Standings, projections, Gold Bracket odds, and what-if scenarios — all from results you enter or import. Everything is saved in this browser.",
  },
  {
    title: "Start a season",
    body:
      "Import a schedule CSV, or paste team names into the New Season Builder to generate a blank round-robin schedule.",
  },
  {
    title: "Enter scores in Games",
    body:
      "Type R/H/K per team, then mark Final. Standings, projections, and Gold odds update instantly.",
  },
  {
    title: "Play with the model",
    body:
      "Use the What-If tab to flip remaining games and see how the standings shift live. Press ⌘K (Ctrl+K) any time for the command palette.",
  },
];

export function OnboardingTour({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setOpen(true);
  }, [enabled]);

  if (!open) return null;
  const current = STEPS[step];
  if (!current) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/30 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span>
            Step {step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="rounded px-2 py-0.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            Skip
          </button>
        </div>
        <h2 className="text-lg font-black tracking-tight text-slate-950 dark:text-slate-100">
          {current.title}
        </h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
          {current.body}
        </p>
        <div className="mt-5 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-black text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="rounded-xl bg-slate-950 px-4 py-1.5 text-sm font-black text-white shadow-sm hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="rounded-xl bg-red-600 px-4 py-1.5 text-sm font-black text-white shadow-sm hover:bg-red-700"
            >
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
