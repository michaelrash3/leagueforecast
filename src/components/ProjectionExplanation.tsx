import { memo, useMemo } from "react";

type ProjectionExplanationProps = {
  explanations: string[];
};

function ProjectionExplanationView({ explanations }: ProjectionExplanationProps) {
  const items = useMemo(
    () => Array.from(new Set(explanations.map((item) => item.trim()).filter(Boolean))),
    [explanations]
  );
  if (!items.length) return null;

  return (
    <div
      className="mt-3 text-xs font-semibold leading-5 text-slate-500 dark:text-slate-400"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span
              className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const ProjectionExplanation = memo(ProjectionExplanationView);
