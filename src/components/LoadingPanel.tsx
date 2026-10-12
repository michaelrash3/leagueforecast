import { card } from "../styles/tokens";

/**
 * What stands in while a lazily-loaded area is being fetched.
 *
 * Almost always a single frame on a warm cache; on a phone at a ballpark on one bar it can be a
 * second or two, which is exactly the case code-splitting is for. It says which area is coming so
 * the wait reads as a wait rather than as the app having lost its place.
 */
export function LoadingPanel({ area }: { area: string }) {
  return (
    <div className={`${card} min-h-64 p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Loading {area}…</p>
      <div className="mt-5 space-y-3" aria-hidden="true">
        <div className="h-7 w-2/5 animate-pulse rounded bg-slate-200 motion-reduce:animate-none dark:bg-slate-800" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-900" />
        <div className="h-16 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-900" />
      </div>
    </div>
  );
}
