import type { Toast } from "../hooks/useToast";

const toneClasses: Record<Toast["tone"], string> = {
  info: "bg-slate-950 text-white",
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  undo: "bg-slate-950 text-white",
};

export function ToastView({
  toast,
  onDismiss,
}: {
  toast: Toast | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;
  const isError = toast.tone === "error";
  const liveMode = isError ? "assertive" : "polite";
  const role = isError ? "alert" : "status";

  return (
    <div
      role={role}
      aria-live={liveMode}
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4"
    >
      <div
        className={`pointer-events-auto flex items-center gap-3 rounded-2xl px-5 py-3 text-sm font-bold shadow-lg ring-1 ring-black/10 ${
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
            className="rounded-lg bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wide hover:bg-white/25"
          >
            {toast.actionLabel}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="rounded-lg px-2 py-1 text-xs font-black uppercase tracking-wide text-white/70 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  );
}
