import { describe, expect, it } from "vitest";
import { createTtlCache } from "../ttlCache";

/** A clock the test moves by hand, so nothing here waits on real time. */
const clock = (start = 0) => {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
};

describe("keeping a value for a while", () => {
  it("hands back what it was given", () => {
    const cache = createTtlCache<string>(1_000, 10);
    cache.set("a", "Aces");
    expect(cache.get("a")).toBe("Aces");
  });

  it("has nothing to say about a key it never saw", () => {
    expect(createTtlCache<string>(1_000, 10).get("a")).toBeUndefined();
  });

  it("forgets a value once it is old enough", () => {
    const time = clock();
    const cache = createTtlCache<string>(1_000, 10, time.now);
    cache.set("a", "Aces");

    time.advance(999);
    expect(cache.get("a")).toBe("Aces");
    time.advance(1);
    // A profile corrected upstream should not be pinned to a stale copy forever.
    expect(cache.get("a")).toBeUndefined();
  });

  it("drops the aged-out entry rather than holding it", () => {
    const time = clock();
    const cache = createTtlCache<string>(1_000, 10, time.now);
    cache.set("a", "Aces");
    time.advance(2_000);
    cache.get("a");

    expect(cache.size()).toBe(0);
  });

  it("starts the clock again when a value is replaced", () => {
    const time = clock();
    const cache = createTtlCache<string>(1_000, 10, time.now);
    cache.set("a", "Aces");
    time.advance(900);
    cache.set("a", "Aces 12U");
    time.advance(900);

    expect(cache.get("a")).toBe("Aces 12U");
  });
});

describe("staying within bounds", () => {
  it("drops the oldest once it is full", () => {
    const cache = createTtlCache<number>(1_000, 3);
    ["a", "b", "c", "d"].forEach((key, index) => cache.set(key, index));

    expect(cache.size()).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe(3);
  });

  it("keeps the one being asked for over the one that is not", () => {
    const cache = createTtlCache<number>(1_000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    // Reading counts as use, so "a" is no longer the oldest when "c" arrives.
    cache.get("a");
    cache.set("c", 3);

    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
  });

  it("cannot grow past its bound however much is put in", () => {
    const cache = createTtlCache<number>(1_000, 5);
    // A pull of twenty thousand teams must not grow the instance by twenty thousand profiles.
    for (let index = 0; index < 20_000; index += 1) cache.set(`team-${index}`, index);

    expect(cache.size()).toBe(5);
  });

  it("empties on request", () => {
    const cache = createTtlCache<number>(1_000, 5);
    cache.set("a", 1);
    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.get("a")).toBeUndefined();
  });
});
