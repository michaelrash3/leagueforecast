/**
 * A numbered row of "here is what to do next" cards, each with its own buttons — including ones
 * that are really a hidden file input wearing a button's clothes.
 */
import React from "react";
import { button as buttonClasses, card } from "../styles/tokens";

export type DesignFlowAction = {
  label: string;
  onClick?: () => void;
  tone?: "primary" | "dark" | "ghost";
  file?: {
    accept: string;
    ariaLabel: string;
    onChange: (file: File) => void;
  };
};

export type DesignFlowStep = {
  eyebrow: string;
  title: string;
  body: string;
  meta: string;
  tone: "blue" | "amber" | "emerald" | "red";
  actions?: DesignFlowAction[];
};

const flowToneClasses: Record<DesignFlowStep["tone"], string> = {
  blue: "from-blue-600/16 via-blue-500/8 to-transparent text-blue-700 ring-blue-200 dark:from-blue-500/20 dark:text-blue-200 dark:ring-blue-900/70",
  amber:
    "from-amber-500/18 via-amber-400/8 to-transparent text-amber-700 ring-amber-200 dark:from-amber-500/20 dark:text-amber-200 dark:ring-amber-900/70",
  emerald:
    "from-emerald-500/16 via-emerald-400/8 to-transparent text-emerald-700 ring-emerald-200 dark:from-emerald-500/20 dark:text-emerald-200 dark:ring-emerald-900/70",
  red: "from-red-500/16 via-red-400/8 to-transparent text-red-700 ring-red-200 dark:from-red-500/20 dark:text-red-200 dark:ring-red-900/70",
};

const flowButtonClass = (tone: DesignFlowAction["tone"] = "ghost") =>
  tone === "primary"
    ? buttonClasses.primary
    : tone === "dark"
      ? buttonClasses.dark
      : buttonClasses.ghost;

export function DesignFlowPanel({
  title,
  subtitle,
  steps,
  footer,
}: {
  title: string;
  subtitle: string;
  steps: DesignFlowStep[];
  footer?: React.ReactNode;
}) {
  return (
    <section className={`${card} overflow-hidden`} aria-label={title}>
      <div className="border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400">
          Launch checklist
        </div>
        <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950 dark:text-white">
          {title}
        </h2>
        <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-600 dark:text-slate-300">
          {subtitle}
        </p>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => (
          <article
            key={step.title}
            className={`rounded-lg bg-linear-to-br ${flowToneClasses[step.tone]} p-4 ring-1`}
          >
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-950 shadow-xs ring-1 ring-white/70 dark:bg-slate-950 dark:text-white dark:ring-white/10">
                {index + 1}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-80">
                  {step.eyebrow}
                </div>
                <h3 className="mt-1 text-base font-black tracking-tight text-slate-950 dark:text-white">
                  {step.title}
                </h3>
              </div>
            </div>
            <p className="mt-4 text-sm font-bold leading-6 text-slate-600 dark:text-slate-300">
              {step.body}
            </p>
            <div className="mt-4 rounded-lg bg-white/75 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600 ring-1 ring-white/80 dark:bg-slate-950/55 dark:text-slate-300 dark:ring-white/10">
              {step.meta}
            </div>
            {step.actions && step.actions.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {step.actions.map((action) =>
                  action.file ? (
                    <label
                      key={action.label}
                      className={`inline-flex cursor-pointer ${flowButtonClass(action.tone)}`}
                    >
                      {action.label}
                      <input
                        type="file"
                        accept={action.file.accept}
                        className="hidden"
                        aria-label={action.file.ariaLabel}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) action.file?.onChange(file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : (
                    <button
                      key={action.label}
                      type="button"
                      onClick={action.onClick}
                      className={flowButtonClass(action.tone)}
                    >
                      {action.label}
                    </button>
                  )
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
