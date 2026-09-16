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
    <div className={`${card} p-5`} role="status" aria-live="polite">
      <p className="text-sm font-bold text-slate-500">Loading {area}…</p>
    </div>
  );
}
