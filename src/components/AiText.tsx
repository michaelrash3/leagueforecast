import { useGemini } from "../hooks/useGemini";
import type { GeminiBundle } from "../lib/gemini";
import type { AiModel } from "../lib/types";

/**
 * Renders an AI-generated paragraph for a given bundle. Falls back to
 * `fallback` (the deterministic prose) when AI is disabled, no key, or the
 * call errors. Shows a subtle skeleton while loading.
 */
export function AiText({
  bundle,
  enabled,
  apiKey,
  model,
  fallback,
  className,
}: {
  bundle: GeminiBundle | null;
  enabled: boolean;
  apiKey: string;
  model: AiModel;
  fallback: string;
  className?: string;
}) {
  const { text, loading, error } = useGemini({ bundle, enabled, apiKey, model });

  if (!enabled || !apiKey || !bundle) {
    return <p className={className}>{fallback}</p>;
  }

  if (loading) {
    return (
      <div className={className} aria-busy="true">
        <div className="h-3 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-2 h-3 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
        <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
      </div>
    );
  }

  if (error || !text) {
    return (
      <div className={className}>
        <p>{fallback}</p>
        {error && (
          <p className="mt-1 text-[11px] font-bold text-amber-600 dark:text-amber-400">
            AI summary unavailable: {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <p
      className={className}
      title="AI-generated summary"
    >
      {text}
      <span className="ml-2 text-[10px] font-black uppercase tracking-wide text-slate-400 dark:text-slate-500">
        AI
      </span>
    </p>
  );
}
