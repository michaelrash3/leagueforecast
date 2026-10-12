import type { ReactNode } from "react";
import { stateTone, type StateKind } from "../styles/tokens";

/**
 * What a panel says when it has nothing of its own to show (2.5): nothing yet (`empty`), on its
 * way (`loading`), failed (`error`), out of reach without a connection (`offline`), or shown as it
 * last was while a newer copy is fetched (`stale`). One layout for the five, each on its own
 * surface (`stateTone`): what happened, what it means or what to do, and the way on.
 *
 * A failure interrupts a screen reader (`role="alert"`) and the passing states are announced when
 * they change (`role="status"`); an empty panel is part of the page, announced as nothing.
 */
export function StatePanel({
  kind,
  title,
  heading,
  children,
  actions,
  className = "",
}: {
  kind: StateKind;
  title?: ReactNode;
  /** The title as a heading, at this level, where it starts a section of the page. */
  heading?: 2 | 3;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const tone = stateTone[kind];
  const role = kind === "error" ? "alert" : kind === "empty" ? undefined : "status";
  const Title = heading === 2 ? "h2" : heading === 3 ? "h3" : "p";
  return (
    <div role={role} className={`${tone.box} ${className}`}>
      {title !== undefined && <Title className={tone.title}>{title}</Title>}
      {children !== undefined && (
        <div className={`${title !== undefined ? "mt-2 " : ""}space-y-2 ${tone.body}`}>
          {children}
        </div>
      )}
      {kind === "loading" && (
        // A skeleton of the panel to come, still under reduced motion.
        <div aria-hidden="true" className="mt-3 space-y-2">
          <div className="h-3 w-3/4 rounded-sm bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
          <div className="h-3 w-1/2 rounded-sm bg-slate-200 motion-safe:animate-pulse dark:bg-slate-800" />
        </div>
      )}
      {actions !== undefined && (
        <div className={`mt-3 flex flex-wrap gap-2 ${kind === "empty" ? "justify-center" : ""}`}>
          {actions}
        </div>
      )}
    </div>
  );
}
