import { afterEach, describe, expect, it, vi } from "vitest";
import { clientKey, createRateLimiter, RATE_LIMIT_WINDOW_MS, type ApiRequest } from "../apiShared";

const req = (headers: ApiRequest["headers"], remoteAddress?: string): ApiRequest => ({
  headers,
  ...(remoteAddress ? { socket: { remoteAddress } } : {}),
});

describe("working out who is asking", () => {
  it("takes the first hop of x-forwarded-for, which is the client", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.7, 70.41.3.18, 150.172.238.178" }))).toBe(
      "203.0.113.7"
    );
  });

  it("handles the header arriving as a list", () => {
    expect(clientKey(req({ "x-forwarded-for": ["203.0.113.7", "198.51.100.2"] }))).toBe(
      "203.0.113.7"
    );
  });

  it("falls back to the socket, then to one shared bucket", () => {
    expect(clientKey(req({}, "198.51.100.9"))).toBe("198.51.100.9");
    // Everyone together rather than nobody: a limiter that cannot tell clients apart should still
    // limit something.
    expect(clientKey(req({}))).toBe("unknown");
  });

  it("does not take an empty forwarded header as an identity", () => {
    expect(clientKey(req({ "x-forwarded-for": "   " }, "198.51.100.9"))).toBe("198.51.100.9");
  });
});

describe("the throttle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to the limit and then refuses", () => {
    const limited = createRateLimiter(3);
    expect(limited("a")).toBe(false);
    expect(limited("a")).toBe(false);
    expect(limited("a")).toBe(false);
    expect(limited("a")).toBe(true);
  });

  it("gives each client its own allowance", () => {
    const limited = createRateLimiter(1);
    expect(limited("a")).toBe(false);
    expect(limited("a")).toBe(true);
    // b is untouched by a using its own up.
    expect(limited("b")).toBe(false);
  });

  it("takes a per-call limit, so one limiter can hold several budgets", () => {
    const limited = createRateLimiter(10);
    expect(limited("probe", 1)).toBe(false);
    expect(limited("probe", 1)).toBe(true);
    // The same limiter, a different key, the default allowance: the small budget did not shrink it.
    expect(limited("summary")).toBe(false);
  });

  it("lets a client back in once its hits age out of the window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limited = createRateLimiter(1);
    expect(limited("a")).toBe(false);
    expect(limited("a")).toBe(true);
    vi.setSystemTime(RATE_LIMIT_WINDOW_MS + 1);
    expect(limited("a")).toBe(false);
  });

  /*
   * The regression that matters. The sweep used to be `clear()` on the whole map once it passed
   * its cap, so anyone who could push it over — by varying x-forwarded-for, or just by arriving
   * alongside enough other clients — handed every client, themselves included, a fresh allowance.
   * A throttle that can be reset on demand is not a throttle.
   */
  it("does not hand a throttled client a fresh allowance when the map is swept", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limited = createRateLimiter(2);

    expect(limited("victim")).toBe(false);
    expect(limited("victim")).toBe(false);
    expect(limited("victim")).toBe(true);

    // Well past the 5,000-client cap, all of them inside the window, all arriving after the victim.
    for (let i = 0; i < 6_000; i += 1) limited(`flood-${i}`);

    expect(limited("victim")).toBe(true);
  });

  it("still forgets a client whose hits have expired, so the map does not grow forever", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limited = createRateLimiter(2);
    limited("old");

    // The sweep runs on a write, and only drops entries whose newest hit has left the window.
    vi.setSystemTime(RATE_LIMIT_WINDOW_MS + 1);
    for (let i = 0; i < 6_000; i += 1) limited(`flood-${i}`);

    // Observable proof it was dropped rather than kept: a full allowance, from a clean entry.
    expect(limited("old")).toBe(false);
    expect(limited("old")).toBe(false);
    expect(limited("old")).toBe(true);
  });
});
