import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initTeamRankingsStore } from "./lib/teamRankingsStorage";
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
initTeamRankingsStore()
  .catch(() => undefined)
  .finally(mount);
