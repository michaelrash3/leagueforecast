import type { ReactNode } from "react";
import type { backtestPredictions } from "../lib/backtest";

type ModelHealthPanelProps = {
  backtestResult: ReturnType<typeof backtestPredictions>;
  cardClassName: string;
};

export function ModelHealthPanel({ backtestResult, cardClassName }: ModelHealthPanelProps) {
  return (
    <section className={`${cardClassName} border-dashed p-4 opacity-95`} aria-label="Model health">
      <details>
        <summary className="flex cursor-pointer list-none flex-col gap-2 sm:flex-row sm:items-center sm:justify-between [&::-webkit-details-marker]:hidden">
          <div>
            <h3 className="text-base font-black tracking-tight text-slate-800 dark:text-slate-200">
              Model Health
            </h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-black text-slate-600 dark:text-slate-300">
            <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
              {backtestResult.sampleSize} samples
            </span>
            {backtestResult.sampleSize > 0 && (
              <span className="rounded-full bg-slate-100 px-3 py-1 dark:bg-slate-800">
                Brier {backtestResult.brierScore.toFixed(3)}
              </span>
            )}
          </div>
        </summary>

        <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">
          {backtestResult.sampleSize === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-800/40 dark:text-slate-400">
              No calibration yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
              <div className="grid grid-cols-3 gap-2 text-center lg:grid-cols-1">
                <Metric
                  label="Brier"
                  value={backtestResult.brierScore.toFixed(3)}
                />
                <Metric
                  label="Upsets"
                  value={`${Math.round(backtestResult.upsetCaptureRate * 100)}%`}
                />
                <Metric label="Buckets" value={String(backtestResult.calibration.length)} />
              </div>
              <div className="space-y-3">
                {backtestResult.calibration.map((bucket) => (
                  <div key={`${bucket.min}-${bucket.max}`}>
                    <div className="mb-1 flex justify-between gap-3 text-xs font-black text-slate-500 dark:text-slate-400">
                      <span>
                        {Math.round(bucket.min * 100)}-{Math.round(bucket.max * 100)}% away ·{" "}
                        {bucket.samples} game{bucket.samples === 1 ? "" : "s"}
                      </span>
                      <span>
                        Pred {Math.round(bucket.predicted * 100)}% / Actual{" "}
                        {Math.round(bucket.actual * 100)}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-slate-400 dark:bg-slate-500"
                        style={{ width: `${Math.round(bucket.actual * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function Metric({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}
