import { useEffect, useState } from "react";

const STORAGE_KEY = "league_forecast_onboarded_v1";

const STEPS = [
  {
    title: "Welcome to League Forecast",
  },
  {
    title: "Create your league",
  },
  {
    title: "Enter results and schedule future games",
  },
  {
    title: "Get around fast",
  },
];

export function OnboardingTour({
  open,
  onClose,
  autoOpenWhenEmpty,
}: {
  open: boolean;
  onClose: () => void;
  autoOpenWhenEmpty: boolean;
}) {
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  // Sync controlled `open` prop into internal visibility.
  useEffect(() => {
    if (open) {
      setStep(0);
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [open]);

  // First-run auto-open: only when teams list is empty and the user hasn't dismissed before.
  useEffect(() => {
    if (!autoOpenWhenEmpty) return;
    try {
      if (localStorage.getItem(STORAGE_KEY) === "1") return;
    } catch {
      /* ignore */
    }
    setStep(0);
    setVisible(true);
  }, [autoOpenWhenEmpty]);

  if (!visible) return null;
  const current = STEPS[step];
  if (!current) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/30 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-none bg-white p-5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
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
