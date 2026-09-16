/**
 * A dashed box standing in for a panel that has nothing to show yet, saying what would fill it.
 */
export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900">
      <h3 className="text-xl font-black">{title}</h3>
      <p className="mt-2 text-sm font-semibold text-slate-500">{body}</p>
    </div>
  );
}
