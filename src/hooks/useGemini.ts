import { useEffect, useRef, useState } from "react";
import {
  callGemini,
  describeError,
  hashBundle,
  type GeminiBundle,
  type GeminiError,
} from "../lib/gemini";
import {
  loadGeminiCache,
  writeGeminiCache,
  type GeminiCacheEntry,
} from "../lib/storage";
import type { AiModel } from "../lib/types";

export type GeminiState = {
  text: string | null;
  loading: boolean;
  error: string | null;
};

type Options = {
  bundle: GeminiBundle | null;
  enabled: boolean;
  apiKey: string;
  model: AiModel;
};

// In-memory cache mirroring localStorage for fast repeat reads within a session.
const memoryCache = new Map<string, GeminiCacheEntry>();
let memoryCacheBootstrapped = false;

const bootstrapMemoryCache = () => {
  if (memoryCacheBootstrapped) return;
  memoryCacheBootstrapped = true;
  const persisted = loadGeminiCache();
  Object.entries(persisted).forEach(([hash, entry]) => memoryCache.set(hash, entry));
};

const persist = () => {
  const obj: Record<string, GeminiCacheEntry> = {};
  memoryCache.forEach((value, key) => {
    obj[key] = value;
  });
  writeGeminiCache(obj);
};

export function useGemini({ bundle, enabled, apiKey, model }: Options): GeminiState {
  bootstrapMemoryCache();
  const [state, setState] = useState<GeminiState>({ text: null, loading: false, error: null });
  const latestRef = useRef(0);

  // Stable cache key — recompute only when bundle/model changes.
  const cacheKey = bundle ? hashBundle(bundle, model) : null;

  useEffect(() => {
    if (!enabled || !bundle || !apiKey || !cacheKey) {
      setState({ text: null, loading: false, error: null });
      return;
    }

    // Cache hit — synchronous render of cached text.
    const cached = memoryCache.get(cacheKey);
    if (cached) {
      setState({ text: cached.text, loading: false, error: null });
      return;
    }

    const callId = latestRef.current + 1;
    latestRef.current = callId;
    setState({ text: null, loading: true, error: null });

    const controller = new AbortController();
    const debounceTimer = window.setTimeout(() => {
      callGemini(bundle, { apiKey, model, signal: controller.signal }).then((result) => {
        if (latestRef.current !== callId) return;
        if (result.ok) {
          memoryCache.set(cacheKey, { text: result.text, timestamp: Date.now() });
          persist();
          setState({ text: result.text, loading: false, error: null });
        } else {
          setState({
            text: null,
            loading: false,
            error: describeError(result.error),
          });
        }
      });
    }, 250);

    return () => {
      window.clearTimeout(debounceTimer);
      controller.abort();
    };
  }, [enabled, apiKey, model, bundle, cacheKey]);

  return state;
}

// Convenience for code paths that just want to know if AI is properly configured.
export const aiAvailable = (enabled: boolean, apiKey: string) =>
  Boolean(enabled && apiKey);

export type { GeminiError };
