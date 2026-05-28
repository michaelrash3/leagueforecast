type ProjectionExplanationProps = {
  explanations: string[];
};

export function ProjectionExplanation({ explanations }: ProjectionExplanationProps) {
  const items = explanations.map((item) => item.trim()).filter(Boolean);
  if (!items.length) return null;

  return (
    <aside
      className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/80 px-4 py-3 text-sm font-semibold leading-6 text-slate-600 shadow-sm dark:border-slate-700/80 dark:bg-slate-800/60 dark:text-slate-300"
      aria-label="Projection context"
    >
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-300 dark:bg-slate-600"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
