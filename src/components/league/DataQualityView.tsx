import type { DataQualityFinding, FindingSeverity } from "../../lib/dataQuality";
import type { ActiveShareView } from "../../lib/types";
import { button as buttonClasses } from "../../styles/tokens";

const groups: Array<{ severity: FindingSeverity; title: string }> = [
  { severity: "needs-attention", title: "Needs attention" },
  { severity: "review", title: "Worth reviewing" },
  { severity: "info", title: "Information" },
];

export function DataQualityView({
  findings,
  onDismiss,
  onNavigate,
  onRepair,
}: {
  findings: readonly DataQualityFinding[];
  onDismiss: (finding: DataQualityFinding) => void;
  onNavigate: (view: ActiveShareView, finding: DataQualityFinding) => void;
  onRepair: (finding: DataQualityFinding) => void;
}) {
  const blocking = findings.filter((item) => item.severity === "needs-attention").length;
  const affecting = findings.filter((item) => item.affectsForecast).length;
  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
          Commissioner tools
        </p>
        <h2 className="mt-1 text-3xl font-black tracking-tight">Data Quality</h2>
        <p className="mt-2 max-w-3xl text-sm text-slate-600 dark:text-slate-300">
          {blocking > 0
            ? `${blocking} issue${blocking === 1 ? "" : "s"} need attention.`
            : "No blocking issues."}{" "}
          {affecting > 0
            ? `${affecting} finding${affecting === 1 ? "" : "s"} may affect forecast reliability.`
            : "Nothing currently affects forecast reliability."}
        </p>
      </header>

      {findings.length === 0 && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-sm font-semibold text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">
          No active findings. Dismissed findings return if their details change or severity rises.
        </div>
      )}

      {groups.map(({ severity, title }) => {
        const items = findings.filter((item) => item.severity === severity);
        if (items.length === 0) return null;
        return (
          <section key={severity} aria-labelledby={`quality-${severity}`}>
            <h3 id={`quality-${severity}`} className="text-xl font-black">
              {title} <span className="text-slate-500 dark:text-slate-400">({items.length})</span>
            </h3>
            <div className="mt-3 space-y-3">
              {items.map((item) => (
                <article
                  key={item.fingerprint}
                  className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div>
                      <h4 className="font-black">{item.summary}</h4>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        {item.explanation}
                      </p>
                      <p className="mt-2 text-sm font-semibold">
                        Suggested: {item.suggestedRepair}
                      </p>
                      {item.affectsForecast && (
                        <p className="mt-2 text-xs font-bold text-amber-700 dark:text-amber-300">
                          Forecast reliability affected
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {item.safeRepair && (
                        <button
                          type="button"
                          className={buttonClasses.primary}
                          onClick={() => onRepair(item)}
                        >
                          Preview repair
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClasses.ghost}
                        onClick={() => onNavigate(item.deepLink.view, item)}
                      >
                        Review
                      </button>
                      {severity !== "needs-attention" && (
                        <button
                          type="button"
                          className={buttonClasses.ghost}
                          onClick={() => onDismiss(item)}
                        >
                          Dismiss
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
