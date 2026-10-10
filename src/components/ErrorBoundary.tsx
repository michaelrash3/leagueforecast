import { Component, useRef, type ErrorInfo, type ReactNode, type RefObject } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { currentDiagnosticsReport, recordDiagnostic } from "../lib/diagnostics";
import { button } from "../styles/tokens";
import { StatePanel } from "./StatePanel";

type ErrorBoundaryProps = {
  children: ReactNode;
  /**
   * What broke, in the user's terms — "Team Rankings", "the rankings table". Named rather than
   * generic because the whole point of a boundary around one area is that the rest of the page is
   * still there, and the message has to say which part is not.
   */
  area: string;
  /**
   * Remounting the children is useless if the thing that threw is still in the state they read, so
   * a boundary that wraps a section can say what to put back before retrying.
   */
  onReset?: () => void;
  /**
   * Closes the area, for one that is an overlay somebody opened: a team's panel, a comparison. Its
   * failure is then drawn over the page where the overlay would have been, rather than below
   * everything else where nobody would see it, and offers Close beside Try again, so a download
   * that keeps failing is never the only way out. Closing puts back what `onReset` does as well,
   * since opening the overlay again is the next try.
   */
  onClose?: () => void;
};

type ErrorBoundaryState = { error: Error | null; copied: boolean };

/**
 * Stops one thrown error from blanking the page.
 *
 * React unmounts the whole tree when a render throws and nothing catches it, so a single bad row —
 * a game referring to a team that is no longer there, a rating over an empty pool, a stored value
 * in a shape this version does not expect — takes the entire app with it and leaves a white
 * screen. There is a lot of surface for that here: a worker, an asynchronous store, a network job
 * that runs for the better part of an hour, and thousands of rows loaded from a browser's own
 * storage that no server ever validated.
 *
 * What it must never do is imply the data is gone. Nothing here writes, and the pool is exactly
 * where it was; the message says so, because the first instinct on seeing an app break with a
 * season's results in it is to assume the results went with it.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, copied: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error, copied: false };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`${this.props.area} failed to render.`, error, info.componentStack);
    /*
     * And written down, because the console is not a record. Nobody reads a console on a phone at
     * a ballfield, and by the time the app is opened again on something with a keyboard the
     * console is gone — so a crash on somebody else's device used to be lost entirely. This keeps
     * the last few in this browser, to be copied out if the person wants to send them on.
     */
    recordDiagnostic({
      kind: "crash",
      where: this.props.area,
      message: error.message || String(error),
      ...(info.componentStack ? { detail: info.componentStack } : {}),
    });
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ error: null, copied: false });
  };

  private close = () => {
    this.props.onReset?.();
    this.props.onClose?.();
  };

  private copyDiagnostics = () => {
    // Best effort: an old browser or a denied permission leaves the text on screen in the details
    // below, which is where it was going to be read from anyway.
    void navigator.clipboard
      ?.writeText(currentDiagnosticsReport())
      .then(() => this.setState({ copied: true }))
      .catch(() => this.setState({ copied: false }));
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const title = `${this.props.area} could not be shown`;
    const panel = (
      <StatePanel kind="error" heading={2} title={title}>
        <p>
          Something went wrong while drawing this. Nothing has been deleted — your seasons, teams
          and games are still saved in this browser exactly as they were.
        </p>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          Try again first. If it keeps happening, reload the page, and if it still happens the
          details below are what to send on.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={this.retry} className={button.primary}>
            Try again
          </button>
          {this.props.onClose && (
            <button type="button" onClick={this.close} className={button.ghost}>
              Close
            </button>
          )}
          <button type="button" onClick={() => window.location.reload()} className={button.ghost}>
            Reload the page
          </button>
          <button type="button" onClick={this.copyDiagnostics} className={button.ghost}>
            {this.state.copied ? "Copied" : "Copy diagnostics"}
          </button>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-300">
          The copy is this browser&apos;s last few failures and nothing else — no scores, no team
          names beyond whatever is in the message below. It is not sent anywhere; it goes on your
          clipboard for you to paste wherever you like.
        </p>
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
            What went wrong
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {error.message || String(error)}
          </pre>
        </details>
      </StatePanel>
    );
    return this.props.onClose ? (
      <OverlayFrame label={title} onClose={this.close}>
        {panel}
      </OverlayFrame>
    ) : (
      panel
    );
  }
}

/**
 * A failure drawn as the drawer it stands in for: over the page, closed by its backdrop or Escape,
 * and holding the focus until it is closed.
 */
function OverlayFrame({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(true, ref as RefObject<HTMLElement>);
  return (
    <div
      className="fixed inset-0 z-55 flex justify-end bg-slate-950/40 p-3"
      role="presentation"
      onClick={onClose}
    >
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        className="h-full w-full max-w-md overflow-y-auto rounded-lg bg-white p-3 shadow-2xl outline-hidden dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          // Kept in the dialog, as the drawers keep theirs, so the page's shortcuts do not act
          // behind it; the focus is held inside, so Escape is heard here.
          event.stopPropagation();
          if (event.key === "Escape") onClose();
        }}
      >
        {children}
      </aside>
    </div>
  );
}
