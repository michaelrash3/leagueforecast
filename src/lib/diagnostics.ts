/**
 * The last few things that went wrong in this browser, so a bug report can be more than "it went
 * blank".
 *
 * There is no server to report to and there is not going to be one: everything this app holds
 * lives in the browser it was typed into, and a crash carrying team names, season labels and a
 * component stack is not something to post to a third party on a user's behalf. So a crash is
 * written down here instead, and the error screen offers to put it on the clipboard. Somebody who
 * wants to send it can; nobody has to.
 *
 * `ErrorBoundary.componentDidCatch` used to say "the console is the only record there is", which
 * was true and is the reason a crash on a stranger's phone was simply lost — nobody reads a
 * console on a phone at a ballfield, and by the time the app is reopened the console is gone.
 */
const KEY = "league_forecast_diagnostics_v1";

/** How many are kept. Enough to show a pattern, small enough to paste into a message. */
export const DIAGNOSTIC_LIMIT = 20;

/** Long enough for a real stack, short enough that twenty of them still fit in storage. */
const DETAIL_LIMIT = 2000;

export type DiagnosticKind = "crash" | "pool-write";

export type DiagnosticEntry = {
  at: string;
  kind: DiagnosticKind;
  /** Where it happened, in the user's terms: the boundary's area, or the storage key. */
  where: string;
  message: string;
  /** A component stack for a crash; absent for anything that did not have one. */
  detail?: string;
};

const clip = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

const isEntry = (value: unknown): value is DiagnosticEntry => {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.at === "string" &&
    (entry.kind === "crash" || entry.kind === "pool-write") &&
    typeof entry.where === "string" &&
    typeof entry.message === "string" &&
    (entry.detail === undefined || typeof entry.detail === "string")
  );
};

/**
 * Every read and write here is wrapped, and every failure is swallowed.
 *
 * This runs on the path that is already handling a crash. A private window, blocked site data or
 * a full quota must not turn a caught error into a second, uncaught one — the boundary is the
 * last thing standing between a bad row and a blank page.
 */
export const readDiagnostics = (): DiagnosticEntry[] => {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
};

/** Records one. Newest first, oldest dropped past the limit. */
export const recordDiagnostic = (entry: Omit<DiagnosticEntry, "at">): void => {
  try {
    const next: DiagnosticEntry[] = [
      {
        at: new Date().toISOString(),
        kind: entry.kind,
        where: clip(entry.where, 200),
        message: clip(entry.message, DETAIL_LIMIT),
        ...(entry.detail === undefined ? {} : { detail: clip(entry.detail, DETAIL_LIMIT) }),
      },
      ...readDiagnostics(),
    ].slice(0, DIAGNOSTIC_LIMIT);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or unavailable store means no record, which is where this started. Never a throw.
  }
};

export const clearDiagnostics = (): void => {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do, and nothing worth breaking the page over.
  }
};

/**
 * The report, as text somebody can paste into a message.
 *
 * The browser string and the screen size are here because the two failures this app actually has
 * are browser-specific — Safari's storage eviction, and a worker that will not start — and neither
 * is answerable without knowing which browser. There is nothing in it that is not already visible
 * to any site the person opens.
 */
export const diagnosticsReport = (
  entries: DiagnosticEntry[],
  now: Date,
  agent: string,
  screen: { width: number; height: number }
): string => {
  const head = [
    `League Forecast diagnostics — ${now.toISOString()}`,
    `Browser: ${agent}`,
    `Screen: ${screen.width}×${screen.height}`,
  ];
  if (entries.length === 0) {
    return [...head, "", "Nothing has been recorded in this browser."].join("\n");
  }
  const body = entries.map((entry, index) => {
    const lines = [
      `${index + 1}. ${entry.at} · ${entry.kind} · ${entry.where}`,
      `   ${entry.message}`,
    ];
    if (entry.detail) lines.push(entry.detail.replace(/^/gm, "   "));
    return lines.join("\n");
  });
  return [...head, `Recorded: ${entries.length}`, "", ...body].join("\n");
};

/** The report for what is stored right now, read off this browser. */
export const currentDiagnosticsReport = (): string =>
  diagnosticsReport(readDiagnostics(), new Date(), navigator.userAgent, {
    width: window.screen?.width ?? 0,
    height: window.screen?.height ?? 0,
  });
