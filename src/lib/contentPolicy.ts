// With its extension, unlike the rest of `src`: `vite.config.ts` loads this file, and Vite's own
// config loader resolves an import only as written.
import type { FirebaseWebConfig } from "./cloud/cloudConfig.ts";
import { functionsOrigin } from "./cloud/functionsUrl.ts";

/**
 * The page's Content-Security-Policy, widened at build time for what the build talks to beyond its
 * own origin.
 *
 * `index.html` carries the policy for a build with nothing configured: every connection to the
 * page's own origin and nowhere else. That is right for the Vercel proxy, and it is what stopped
 * the Firebase one: a build with `VITE_GC_PROXY_URL` set sent every pull to another origin, which
 * `connect-src 'self'` refuses before a request leaves the browser. The Node check of the proxy
 * (`npm run verify:gc`) passed all the same, since no browser is there to enforce a policy, so the
 * policy is now written from the same settings the bundle is built from (`vite.config.ts`), and CI
 * reads it back out of a build.
 *
 * What each setting adds, and nothing more:
 * - `VITE_GC_PROXY_URL`: its origin, to `connect-src`.
 * - `firebase`, the project the cloud copy lives in (`FIREBASE_WEB_CONFIG`): Firestore, the two
 *   sign-in APIs and the project's functions (`functionsOrigin`, where an edit is sent) to
 *   `connect-src`; Google's loader for the sign-in frame (`apis.google.com`) to `script-src`; and
 *   the project's own auth domain to `frame-src`, where that frame and the sign-in popup's answer
 *   come from.
 */
export type PolicySettings = {
  VITE_GC_PROXY_URL?: string | undefined;
  firebase?: FirebaseWebConfig | null | undefined;
};

/**
 * An https address's origin: scheme, host and any port, and then only the end or a path, query or
 * fragment. Read by pattern rather than with `URL`, which `vite.config.ts`'s own type check (no
 * DOM, no Node types) has no name for.
 */
const ORIGIN = /^https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d{1,5})?(?:[/?#]|$)/i;

/** An https origin, or null for anything else, including text that could break out of a policy. */
const httpsOrigin = (raw: string | undefined): string | null => {
  const match = ORIGIN.exec(raw?.trim() ?? "");
  const host = match?.[1];
  return host ? `https://${host.toLowerCase()}${match?.[2] ?? ""}` : null;
};

const FIREBASE_CONNECT = [
  "https://firestore.googleapis.com",
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
];
const FIREBASE_SCRIPT = ["https://apis.google.com"];
const PROJECT_ID = /^[a-z][a-z0-9-]*[a-z0-9]$/;

/** Each directive's sources, in the order written, from a policy's text. */
const parse = (policy: string): Map<string, string[]> =>
  new Map(
    policy
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .filter(([name]) => Boolean(name))
      .map(([name = "", ...sources]) => [name, sources])
  );

/**
 * `base` with the sources `settings` call for added. A directive the base leaves out starts from
 * what it would have fallen back to (`default-src`), so adding to it never loosens anything else.
 */
export const widenPolicy = (base: string, settings: PolicySettings): string => {
  const directives = parse(base);
  const fallback = directives.get("default-src") ?? [];
  const add = (name: string, sources: readonly string[]) => {
    const current = directives.get(name) ?? [...fallback];
    for (const source of sources) if (!current.includes(source)) current.push(source);
    directives.set(name, current);
  };

  const proxy = httpsOrigin(settings.VITE_GC_PROXY_URL);
  if (proxy) add("connect-src", [proxy]);

  const firebase = settings.firebase;
  const authOrigin = firebase ? httpsOrigin(`https://${firebase.authDomain}`) : null;
  if (authOrigin) {
    add("connect-src", FIREBASE_CONNECT);
    add("script-src", FIREBASE_SCRIPT);
    add("frame-src", [authOrigin]);
  }
  // A project's id is lower-case letters, digits and hyphens, a letter first; anything else names
  // no host of its own, whatever pattern the address it makes would pass.
  const functions =
    firebase && PROJECT_ID.test(firebase.projectId)
      ? httpsOrigin(functionsOrigin(firebase.projectId))
      : null;
  if (authOrigin && functions) add("connect-src", [functions]);

  return [...directives].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
};

/** The `content` of `index.html`'s policy tag, rewritten by `widenPolicy`. */
export const widenPolicyInHtml = (html: string, settings: PolicySettings): string =>
  html.replace(
    /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]*)(")/,
    (_, open: string, policy: string, close: string) =>
      `${open}${widenPolicy(policy, settings)}${close}`
  );
