import { useCallback, useEffect, useRef, useState } from "react";

export type ToastTone = "info" | "success" | "error" | "undo";

export type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
  durationMs: number;
};

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);
  const idRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => () => clearTimer(), []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, []);

  const show = useCallback(
    (
      message: string,
      options: {
        tone?: ToastTone;
        actionLabel?: string;
        onAction?: () => void;
        durationMs?: number;
      } = {}
    ) => {
      clearTimer();
      const id = idRef.current + 1;
      idRef.current = id;
      const tone = options.tone ?? "info";
      const durationMs = options.durationMs ?? (tone === "undo" ? 8000 : 4000);
      setToast({
        id,
        message,
        tone,
        actionLabel: options.actionLabel,
        onAction: options.onAction,
        durationMs,
      });
      timerRef.current = window.setTimeout(() => {
        setToast((current) => (current && current.id === id ? null : current));
        timerRef.current = null;
      }, durationMs);
    },
    []
  );

  return { toast, show, dismiss };
}
