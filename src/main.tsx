import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initTeamRankingsStore } from "./lib/teamRankingsStorage";
import { bootCloud } from "./lib/cloud/cloudSession";
import { listenForTakes } from "./lib/cloud/cloudTabs";
import "./index.css";

const mount = () => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      {/* The last catch. Anything a section's own boundary does not hold lands here, so the worst
          case is a message that says the data is safe rather than a blank page. */}
      <ErrorBoundary area="League Forecast">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
};

/**
 * The Team Rankings pool lives in IndexedDB, which is asynchronous, and the app reads it during
 * render. So it is loaded into memory before anything mounts — one wait, at the only moment there
 * is nothing on screen to interrupt.
 *
 * This never rejects: a browser without IndexedDB, or one that refuses it, resolves having done
 * nothing and the app falls back to localStorage. Mounting is not allowed to depend on it either
 * way, so a failure here still starts the app.
 */
/**
 * Asks the browser to keep this origin's storage through disk pressure and long absences. Safari
 * evicts script-writable storage after seven days without a visit, and a season is in nothing but
 * that storage. A request, not a guarantee: Chrome grants it on engagement, Safari on being added
 * to the home screen, and nothing here depends on the answer.
 */
const askToKeepStorage = (): void => {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    /* not offered here */
  }
};

/**
 * A line of text in the empty page while the cloud copy is fetched, before the app is drawn over
 * it (React clears what the root holds as it mounts).
 */
const showBootLine = (text: string): void => {
  const root = document.getElementById("root");
  if (!root) return;
  const line = document.createElement("p");
  line.className = "p-6 text-sm font-semibold text-slate-600";
  line.textContent = text;
  root.replaceChildren(line);
};

/*
 * Before anything reads storage, this tab starts listening for another tab taking a copy in from
 * the cloud: whether or not this one is signed in, it reloads then, rather than write what it read
 * back over the newer data (`cloudTabs.ts`).
 */
listenForTakes();

/*
 * Then, for a browser that keeps a cloud copy, that copy's League Standings: another device's
 * newer seasons are brought in before the app draws, so it opens on the latest data rather than
 * swapping it in under whoever is looking. `bootCloud` never throws and waits on the network for a
 * few seconds at most (`STARTUP_WAIT_MS`, `STARTUP_TAKE_MS`); a browser that has never signed in
 * never runs Firebase at all. Team Rankings' pool is brought in when Team Rankings opens.
 */
initTeamRankingsStore()
  .catch(() => undefined)
  .then(() => bootCloud(showBootLine))
  .catch(() => undefined)
  .finally(() => {
    mount();
    askToKeepStorage();
  });
