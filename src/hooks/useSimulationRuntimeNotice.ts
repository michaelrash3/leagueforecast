import { useEffect, useRef } from "react";

import { telemetry } from "../lib/telemetry";
import type { ToastTone } from "./useToast";

export type SimulationRuntime = "worker" | "inline";

type ShowToast = (
  message: string,
  options?: {
    tone?: ToastTone;
    actionLabel?: string;
    onAction?: () => void;
    durationMs?: number;
  }
) => void;

export function shouldShowInlineRuntimeToast(runtime: SimulationRuntime, inlineToastShown: boolean) {
  return runtime === "inline" && !inlineToastShown;
}

export function useSimulationRuntimeNotice(runtime: SimulationRuntime, showToast: ShowToast) {
  const lastRuntimeRef = useRef<SimulationRuntime | null>(null);
  const inlineToastShownRef = useRef(false);

  useEffect(() => {
    if (lastRuntimeRef.current === runtime) return;

    telemetry.track("simulation_runtime", { runtime });

    if (shouldShowInlineRuntimeToast(runtime, inlineToastShownRef.current)) {
      showToast("Simulation worker unavailable; running inline mode.", {
        tone: "info",
        durationMs: 4000,
      });
      inlineToastShownRef.current = true;
    }

    lastRuntimeRef.current = runtime;
  }, [runtime, showToast]);
}
