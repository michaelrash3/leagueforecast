import { Component, type ErrorInfo, type ReactNode } from "react";
import { button, card } from "../styles/tokens";

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
};

type ErrorBoundaryState = { error: Error | null };

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
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // The console is the only record there is — there is no server to report to — and without the
    // component stack a bug report is "it went blank", which is not enough to fix anything.
    console.error(`${this.props.area} failed to render.`, error, info.componentStack);
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={`${card} p-5`} role="alert">
        <h2 className="text-sm font-black uppercase tracking-wide text-red-600 dark:text-red-400">
          {this.props.area} could not be shown
        </h2>
        <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
          Something went wrong while drawing this. Nothing has been deleted — your seasons, teams
          and games are still saved in this browser exactly as they were.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Try again first. If it keeps happening, reload the page, and if it still happens the
          details below are what to send on.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={this.retry} className={button.primary}>
            Try again
          </button>
          <button type="button" onClick={() => window.location.reload()} className={button.ghost}>
            Reload the page
          </button>
        </div>
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500">
            What went wrong
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {error.message || String(error)}
          </pre>
        </details>
      </div>
    );
  }
}
