import type { ApiRequest, ApiResponse } from "./apiShared";

/**
 * Whether a request to the GameChanger proxy comes from an account on the cloud copy's list
 * (`firestore.rules`, `members/{address}`), and the proxy's door that turns everyone else away.
 *
 * The proxy was open to anyone: GameChanger's endpoints need no login, and nothing it handed back
 * was secret. Its cost is what changed that. The Firebase function is billed by the request and
 * by the bytes it sends, past a free allowance, and the project stops itself at a dollar
 * (`billingCap.ts`), so anybody who found the URL could spend the month's dollar and stop every
 * pull with it. The user asked on 2 October 2026 that only the accounts they allow use the cloud,
 * and these are the same accounts.
 *
 * The check asks Firestore, with the caller's own sign-in token, for the caller's own entry on the
 * list. The rules answer that read for a member and refuse it for anyone else, so the list and the
 * rules stay the one place that says who is let in, and nothing here needs a key of its own:
 * Firestore checks the token's signature, its expiry and its project before the rules run. A
 * request with no token at all is turned away without asking anything.
 *
 * An answer is kept for ten minutes (`MEMBER_CHECK_TTL_MS`), and never past the token's own
 * expiry, so a pull of a few thousand teams costs a read or two rather than one per batch. Only
 * the answers Firestore gave are kept: one it could not give is asked again next time.
 */

/** What the list says of the account behind a request. */
export type MemberVerdict =
  /** On the list. */
  | "member"
  /** No usable sign-in: none sent, or one Firestore does not accept (expired, forged, elsewhere). */
  | "signed-out"
  /** Signed in with an account that is not on the list. */
  | "not-member"
  /** Firestore could not be asked just now. */
  | "unavailable";

export type MemberCheck = (authorization: string | undefined) => Promise<MemberVerdict>;

/** How long an answer is kept. */
export const MEMBER_CHECK_TTL_MS = 10 * 60_000;

/** The most answers kept at once; the oldest goes first. */
const MAX_KEPT = 500;

/** The token in an `Authorization: Bearer …` header, or null. */
export const bearerToken = (header: string | undefined): string | null => {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match?.[1] ?? null;
};

/**
 * A sign-in token's claims, read without checking its signature: only to know whose entry to ask
 * for and how long an answer may be kept. Firestore checks the token itself when it is asked.
 */
const claimsOf = (token: string): Record<string, unknown> | null => {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof claims === "object" && claims !== null && !Array.isArray(claims)
      ? (claims as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** The address a token was issued to, in lower case as the list names it, or null. */
export const tokenAddress = (token: string): string | null => {
  const email = claimsOf(token)?.email;
  return typeof email === "string" && email.includes("@") ? email.trim().toLowerCase() : null;
};

/** When a token stops being good, in ms, or null when it does not say. */
export const tokenExpiry = (token: string): number | null => {
  const exp = claimsOf(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1_000 : null;
};

/**
 * A check against the list in `projectId`'s Firestore. `origin` is Firestore's REST host, or the
 * emulator's (`http://127.0.0.1:8085`) under test.
 */
export const createMemberCheck = ({
  projectId,
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
  origin = "https://firestore.googleapis.com",
  ttlMs = MEMBER_CHECK_TTL_MS,
}: {
  projectId: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  origin?: string;
  ttlMs?: number;
}): MemberCheck => {
  const kept = new Map<string, { verdict: MemberVerdict; until: number }>();

  return async (authorization) => {
    const token = bearerToken(authorization);
    if (!token) return "signed-out";
    const at = now();
    const known = kept.get(token);
    if (known && known.until > at) return known.verdict;
    kept.delete(token);

    const address = tokenAddress(token);
    if (!address) return "signed-out";
    const expiry = tokenExpiry(token);
    if (expiry !== null && expiry <= at) return "signed-out";

    let status: number;
    try {
      const response = await fetchImpl(
        `${origin}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/members/${encodeURIComponent(address)}`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      status = response.status;
    } catch {
      return "unavailable";
    }
    const verdict: MemberVerdict =
      status === 200
        ? "member"
        : status === 401
          ? "signed-out"
          : status === 403 || status === 404
            ? "not-member"
            : "unavailable";
    if (verdict === "unavailable") return verdict;

    if (kept.size >= MAX_KEPT) {
      const oldest = kept.keys().next().value;
      if (oldest !== undefined) kept.delete(oldest);
    }
    kept.set(token, { verdict, until: Math.min(at + ttlMs, expiry ?? Infinity) });
    return verdict;
  };
};

/** What a caller turned away is told, by why. */
export const MEMBERS_ONLY_MESSAGES: Record<"signed-out" | "not-member", string> = {
  "signed-out":
    "Pulling from GameChanger is for the accounts on the cloud copy's list. Sign in with one from the cloud button, then pull again.",
  "not-member":
    "This Google account is not on the cloud copy's list, so it cannot pull from GameChanger. Ask the list's owner to add it.",
};

const authorizationOf = (req: ApiRequest): string | undefined => {
  const value = req.headers.authorization;
  return Array.isArray(value) ? value[0] : value;
};

/**
 * `handler` behind the list: a member's request goes through, and anyone else's is answered here
 * with the proxy's own failure shape, `reason: "members-only"`, so the app can say what to do.
 * The probe (`?probe=1`) stays open: it says only that the function is up and how it is set,
 * touches nothing upstream, and is what a deploy's check asks first.
 */
export const membersOnly =
  (
    handler: (req: ApiRequest, res: ApiResponse) => Promise<void>,
    check: MemberCheck
  ): ((req: ApiRequest, res: ApiResponse) => Promise<void>) =>
  async (req, res) => {
    const url = new URL(typeof req.url === "string" ? req.url : "/", "http://localhost");
    if (url.searchParams.get("probe") === "1") return handler(req, res);

    const verdict = await check(authorizationOf(req));
    if (verdict === "member") return handler(req, res);

    res.setHeader("cache-control", "no-store");
    if (verdict === "unavailable") {
      res.status(503).json({
        ok: false,
        reason: "upstream-error",
        message:
          "Could not check this account against the cloud copy's list just now. Try again in a minute.",
        status: 503,
      });
      return;
    }
    const status = verdict === "signed-out" ? 401 : 403;
    res.status(status).json({
      ok: false,
      reason: "members-only",
      message: MEMBERS_ONLY_MESSAGES[verdict],
      status,
    });
  };
