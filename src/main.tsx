import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initTeamRankingsStore } from "./lib/teamRankingsStorage";
import { loadSavedBoard } from "./lib/savedBoard";
import { bootCloud, memberBootsLive } from "./lib/cloud/cloudSession";
import { startPoolFill } from "./lib/poolFill";
import { afterOpening } from "./lib/live/openingHold";
import { startApp } from "./lib/bootOrder";
import { listenForTakes } from "./lib/cloud/cloudTabs";
import { startTabTurn } from "./lib/tabTurn";
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

// Which tab of this browser may write League Standings: a tab opened after another is read-only
// until it takes the turn (`tabTurn.ts`). Asked before anything is drawn or saved.
startTabTurn();

/*
 * Before anything reads storage, this tab starts listening for another tab taking a copy in from
 * the cloud: whether or not this one is signed in, it reloads then, rather than write what it read
 * back over the newer data (`cloudTabs.ts`).
 */
listenForTakes();

/*
 * Then the first draw, with the cloud session started beside it (`bootOrder.ts`): a browser that
 * keeps a cloud copy and has not yet met League's own documents is offered that copy's newer
 * League Standings rather than having them laid under a page already drawn. `bootCloud` never
 * throws and gives the network a few seconds at most (`STARTUP_WAIT_MS`, `STARTUP_TAKE_MS`); a
 * browser that has never signed in never runs Firebase at all. Team Rankings' pool is brought in
 * when Team Rankings opens.
 *
 * The board Team Rankings last showed is read beside the pool, from the same store, so the page
 * can open on it while its own fit runs (`savedBoard.ts`).
 *
 * The Team Rankings pool lives in IndexedDB, which is asynchronous, and the app reads it during
 * render. So it is loaded into memory before anything mounts — one wait, at the only moment there
 * is nothing on screen to interrupt — except on a member's device, which opens on the cloud's
 * board and reads no pool to draw it: there it is read once the board is drawn, and what reads
 * the pool waits for it (`poolFill.ts`). Either way this never rejects: a browser without
 * IndexedDB, or one that refuses it, resolves having done nothing and the app falls back to
 * localStorage.
 */
void startApp({
  fill: (after) =>
    startPoolFill(() => Promise.all([initTeamRankingsStore(), loadSavedBoard()]), after),
  // Every device draws first and signs in beside the page (`bootOrder.ts`): the page is already
  // mounting, so nothing is taken in under it.
  cloud: () => bootCloud({ mounting: true }),
  // A member's device draws at once, its sign-in started beside the page, and its store read
  // once the board is drawn.
  memberLive: memberBootsLive,
  drawn: afterOpening,
  mount: () => {
    mount();
    askToKeepStorage();
  },
});
