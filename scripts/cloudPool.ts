/**
 * The Team Rankings pool as the cloud copy holds it (README, "Your data on every device"), read
 * from outside a browser: from one of GitHub's servers, with the Firebase key GitHub keeps for
 * deploys (`FIREBASE_SERVICE_ACCOUNT`), for a job that pulls on the pool's behalf overnight.
 *
 * Read only. It signs in as that key, reads the copy's manifest and the pool's pieces through
 * Firestore's REST API, and lays them into the app's own pool store held in memory, as a device
 * taking in a cloud copy does (`applyCloudPoolValues`), so everything after reads the pool through
 * the app's own loaders. League Standings and archived seasons are not read: a pull needs neither.
 * Nothing is fetched from npm; the key signs its own request with Node's crypto.
 */
import { createSign } from "node:crypto";
import { fetchValues, type CloudStore } from "../src/lib/cloud/cloudEngine.ts";
import { coerceManifest, type CloudManifest } from "../src/lib/cloud/cloudManifest.ts";
import { LEAGUE_PART } from "../src/lib/cloud/cloudPlan.ts";
import {
  applyCloudPoolValues,
  initTeamRankingsStore,
  type PoolStoreIo,
} from "../src/lib/teamRankingsStorage.ts";

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

/** A value as Firestore's REST API writes it, one type tag to a value. */
type FirestoreValue = {
  nullValue?: null;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = { fields?: Record<string, FirestoreValue> };

const base64Url = (base64: string): string =>
  base64.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

const bytesOf = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));

/** Firestore's typed JSON as plain values, bytes as bytes. */
const plain = (value: FirestoreValue): unknown => {
  if (value.mapValue) return fieldsOf(value.mapValue.fields ?? {});
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(plain);
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.bytesValue !== undefined) return bytesOf(value.bytesValue);
  return null;
};

const fieldsOf = (fields: Record<string, FirestoreValue>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, plain(value)]));

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

/** The copy's documents, read-only: the calls a pull never makes throw if one is made. */
const restStore = (account: ServiceAccount, token: string): CloudStore => {
  const base = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/documents`;
  const read = async (path: string): Promise<FirestoreDocument | null> => {
    const response = await fetch(`${base}/${path}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Firestore answered HTTP ${response.status} for ${path}`);
    return (await response.json()) as FirestoreDocument;
  };
  const refuse = () => Promise.reject(new Error("This reader writes nothing to the cloud copy."));
  return {
    readManifest: async () => {
      const found = await read("copies/main");
      if (!found) return null;
      const manifest = coerceManifest(fieldsOf(found.fields ?? {}));
      if (!manifest) throw new Error("The cloud copy's manifest is not one this build can read.");
      return manifest;
    },
    getChunk: async (id) => {
      const found = await read(`copies/main/chunks/${encodeURIComponent(id)}`);
      const data = found?.fields?.data;
      return data?.bytesValue !== undefined ? bytesOf(data.bytesValue) : null;
    },
    commitManifest: refuse,
    putChunk: refuse,
    deleteChunk: refuse,
  };
};

/** The store in memory, empty until the cloud's values are laid in. */
const memoryIo = (): PoolStoreIo => {
  const values = new Map<string, unknown>();
  return {
    keys: async () => [...values.keys()],
    get: async (key) => values.get(key),
    set: async (key, value) => {
      values.set(key, value);
      return true;
    },
    remove: async (key) => {
      values.delete(key);
    },
    readLocal: () => null,
    clearLocal: () => undefined,
  };
};

export type CloudPool = {
  manifest: CloudManifest;
  /** The pool's pieces read, and their size as stored. */
  keys: number;
  bytes: number;
};

/**
 * Reads the cloud copy's pool into the app's pool store, in memory, so the app's loaders
 * (`loadScoutTeams`, `loadRefreshLog`, …) read it. Null when there is no copy yet.
 */
export const loadCloudPool = async (keyJson: string): Promise<CloudPool | null> => {
  let account: ServiceAccount;
  try {
    account = JSON.parse(keyJson) as ServiceAccount;
  } catch {
    // Not the parser's own message, which quotes the text it choked on: this runs where the log
    // is public, and the text is a private key.
    throw new Error("FIREBASE_SERVICE_ACCOUNT is not a service account key's JSON.");
  }
  return loadPoolFrom(restStore(account, await accessToken(account)));
};

/** The same, from any store holding a cloud copy: the seam a run without the key is tried on. */
export const loadPoolFrom = async (store: CloudStore): Promise<CloudPool | null> => {
  const manifest = await store.readManifest();
  if (!manifest) return null;
  const parts = manifest.parts.filter(
    (part) => part.key !== LEAGUE_PART && !part.key.includes("_archive_rows_")
  );
  const fetched = await fetchValues({ store, parts });
  if (!fetched.ok) throw new Error("A piece of the cloud copy's pool is missing or damaged.");
  await initTeamRankingsStore(memoryIo());
  if (!(await applyCloudPoolValues(fetched.values))) {
    throw new Error("The cloud copy holds a pool key this build does not keep.");
  }
  return {
    manifest,
    keys: parts.length,
    bytes: parts.reduce((sum, part) => sum + part.bytes, 0),
  };
};
