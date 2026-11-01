import type { Toast } from "../hooks/useToast";

const toneClasses: Record<Toast["tone"], string> = {
  info: "bg-slate-950 text-white",
  success: "bg-emerald-700 text-white",
  error: "bg-red-600 text-white",
  undo: "bg-slate-950 text-white",
};

export function ToastView({ toast, onDismiss }: { toast: Toast | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    // On a phone, above the tab bar fixed along the bottom of the screen (2.4). One placed at the
    // top sits there on every screen, over the header.
    <div
      role="status"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 z-60 flex justify-center px-4 sm:px-6 ${
        toast.place === "top" ? "top-3" : "bottom-28 sm:bottom-6 sm:justify-end"
      }`}
    >
      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-lg px-5 py-3 text-sm font-bold shadow-lg ring-1 ring-black/10 ${
          toneClasses[toast.tone]
        }`}
      >
        <span>{toast.message}</span>
        {toast.actionLabel && toast.onAction && (
          <button
            type="button"
            onClick={() => {
              toast.onAction?.();
              onDismiss();
            }}
            className="rounded-lg bg-white/15 px-3 py-1 text-xs font-semibold uppercase tracking-wide hover:bg-white/25"
          >
            {toast.actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="rounded-lg px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white hover:bg-white/15"
        >
          ×
        </button>
      </div>
    </div>
  );
}
