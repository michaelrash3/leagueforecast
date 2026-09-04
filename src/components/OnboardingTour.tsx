import { useEffect, useState } from "react";

const STEPS = [
  {
    title: "Welcome to League Forecast",
    body: "Forecast your season entirely in the browser — no account, no setup. Enter games as they happen and the model projects standings, Gold Bracket odds, and clinch scenarios in real time.",
  },
  {
    title: "Create your league",
    body: "Start from the empty screen: import a schedule CSV, generate a blank round-robin, paste a team list into the season builder, or load the demo season to explore with sample data.",
  },
  {
    title: "Enter results and schedule future games",
    body: "On the Schedule tab, add games and type each final's runs, hits, and strikeouts. Marking a game Final updates standings, simulated odds, and the “why projections moved” recap instantly.",
  },
  {
    title: "Get around fast",
    body: "Press ⌘K (Ctrl+K) for the command palette to jump to any view or team. Use g then s / t / g / m / e to navigate, d to toggle dark mode, and Share to send the whole season as a link.",
  },
];

export function OnboardingTour({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
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

  if (!visible) return null;
  const current = STEPS[step];
  if (!current) return null;

  const dismiss = () => {
    setVisible(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-60 flex items-end justify-center bg-slate-950/30 p-3 sm:items-center">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <span>
            Step {step + 1} / {STEPS.length}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-sm px-2 py-0.5 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
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
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-bold text-slate-700 disabled:opacity-40 dark:border-slate-600 dark:text-slate-200"
          >
            Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg bg-slate-950 px-4 py-1.5 text-sm font-bold text-white shadow-xs hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
            >
              Get Started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
