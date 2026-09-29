/**
 * The Firebase web app's settings, which say which project the cloud copy lives in.
 *
 * None of this is secret. The console hands it to any page that asks, the app's bundle carries it
 * for anyone to read, and what keeps the data private is the Firestore rules (`firestore.rules`),
 * which let one signed-in account and nobody else near it. See README, "Your data on every device".
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

const REQUIRED = ["apiKey", "authDomain", "projectId", "appId"] as const;
const OPTIONAL = ["storageBucket", "messagingSenderId"] as const;

/**
 * Reads the setting as whoever set it is likely to have pasted it: the block the Firebase console
 * shows (`const firebaseConfig = { apiKey: "…", … };`, keys unquoted), just its braces, or JSON.
 * Null unless every field the app needs is there, so a half-pasted value switches the feature off
 * rather than failing on the first sign-in.
 */
export const parseFirebaseConfig = (raw: string | undefined): FirebaseWebConfig | null => {
  if (!raw) return null;
  const found: Partial<Record<(typeof REQUIRED)[number] | (typeof OPTIONAL)[number], string>> = {};
  for (const key of [...REQUIRED, ...OPTIONAL]) {
    const match = new RegExp(`(?:^|[\\s{,])["']?${key}["']?\\s*:\\s*["']([^"']*)["']`).exec(raw);
    const value = match?.[1]?.trim();
    if (value) found[key] = value;
  }
  const { apiKey, authDomain, projectId, appId } = found;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(found.storageBucket ? { storageBucket: found.storageBucket } : {}),
    ...(found.messagingSenderId ? { messagingSenderId: found.messagingSenderId } : {}),
  };
};

/**
 * The build's setting. Written out whole, as `configuredProxy` is and for the same reason: Vite
 * substitutes `import.meta.env.VITE_…` only where it appears literally, and a Node script, which
 * has no `import.meta.env`, lands in the catch and reads none.
 */
export function configuredFirebase(): FirebaseWebConfig | null {
  try {
    const value: unknown = import.meta.env.VITE_FIREBASE_CONFIG;
    return typeof value === "string" ? parseFirebaseConfig(value) : null;
  } catch {
    return null;
  }
}
