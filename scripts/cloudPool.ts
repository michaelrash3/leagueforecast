/**
 * The Team Rankings pool as the cloud copy holds it (README, "Your data on every device"), read
 * from outside a browser: from one of GitHub's servers, with the Firebase key GitHub keeps for
 * deploys (`FIREBASE_SERVICE_ACCOUNT`), for a job that pulls on the pool's behalf overnight.
 *
 * It signs in as that key and reads the copy's manifest and the pool's pieces through Firestore's
 * REST API (`firestoreRestStore`), and lays them into the app's own pool store held in memory, as a
 * device taking in a cloud copy does (`loadPoolFrom`), so everything after reads the pool through
 * the app's own loaders. League Standings and archived seasons are not read: a pull needs neither.
 * It writes only when opened to (`openStores`), which the nightly refresh is. Nothing is fetched
 * from npm; the key signs its own request with Node's crypto.
 */
import { createSign } from "node:crypto";
import type { CloudStore } from "../src/lib/cloud/cloudEngine.ts";
import {
  firestoreRestDocuments,
  firestoreRestLive,
  firestoreRestStore,
} from "../src/lib/cloud/firestoreRest.ts";
import { restLeagueDocs, type LeagueDocsList } from "../src/lib/live/cloudLeague.ts";
import { REBUILD_LEDGER_PATH } from "../src/lib/live/rebuildLedger.ts";
import type { LiveStore } from "../src/lib/live/viewStore.ts";
import { loadPoolFrom, type LoadedCopy } from "../src/lib/cloud/cloudRunner.ts";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

const base64Url = (base64: string): string =>
  base64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/** An hour's access to Firestore for `account`, signed with its own key. */
const accessToken = async (account: ServiceAccount): Promise<string> => {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = base64Url(
    btoa(
      JSON.stringify({
        iss: account.client_email,
        scope: "https://www.googleapis.com/auth/datastore",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signature = base64Url(
    createSign("RSA-SHA256").update(`${header}.${claims}`).sign(account.private_key, "base64")
  );
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const answer = (await response.json()) as { access_token?: string; error?: string };
  if (!answer.access_token) {
    throw new Error(`Google refused the key's sign-in (HTTP ${response.status}, ${answer.error})`);
  }
  return answer.access_token;
};

/**
 * A token for `account` that is asked for again ten minutes before its hour is up, so a job longer
 * than an hour keeps its access.
 */
const tokens = (account: ServiceAccount): (() => Promise<string>) => {
  let held: { token: string; until: number } | null = null;
  return async () => {
    if (!held || Date.now() > held.until) {
      held = { token: await accessToken(account), until: Date.now() + 50 * 60_000 };
    }
    return held.token;
  };
};

const accountOf = (keyJson: string): ServiceAccount => {
  try {
    return JSON.parse(keyJson) as ServiceAccount;
  } catch {
    // Not the parser's own message, which quotes the text it choked on: this runs where the log
    // is public, and the text is a private key.
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not a service account key's JSON.");
  }
};

/** The cloud copy's store for the key's project: read only unless `writable`. */
export const openCloudStore = (keyJson: string, writable: boolean): CloudStore => {
  const account = accountOf(keyJson);
  return firestoreRestStore({ projectId: account.project_id, token: tokens(account), writable });
};

/**
 * The cloud copy's store and the published views' (`live/`), for the key's project, on one
 * sign-in: read only unless `writable`. With them, a read of the rebuilds' ledger
 * (`rebuildLedger.ts`): its fields as written, or null where there is none, and never a write.
 */
export const openStores = (
  keyJson: string,
  writable: boolean
): {
  copy: CloudStore;
  live: LiveStore;
  leagueDocs: LeagueDocsList;
  readLedger: () => Promise<unknown>;
} => {
  const account = accountOf(keyJson);
  const access = { projectId: account.project_id, token: tokens(account), writable };
  const docs = firestoreRestDocuments(access);
  return {
    copy: firestoreRestStore(access),
    live: firestoreRestLive(access),
    // Read only, whatever the stores are opened for: nothing here writes a season.
    leagueDocs: restLeagueDocs(docs),
    readLedger: () => docs.read(REBUILD_LEDGER_PATH),
  };
};

export type CloudPool = LoadedCopy;

/**
 * Reads the cloud copy's pool into the app's pool store, in memory, so the app's loaders
 * (`loadScoutTeams`, `loadRefreshLog`, …) read it. Null when there is no copy yet.
 */
export const loadCloudPool = (keyJson: string): Promise<CloudPool | null> =>
  loadPoolFrom(openCloudStore(keyJson, false));
