import { beforeEach, describe, expect, it, vi } from "vitest";
import { readTheme, writeTheme } from "../preferences";

/*
 * The theme is kept under `lf_theme_v1`, beside the app's other preferences. It was kept under
 * `nkb_theme_v1`, a name left from the app's first league, and a device that chose its theme then
 * keeps it.
 */

const backing = new Map<string, string>();

beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => {
      backing.set(k, v);
    },
    removeItem: (k: string) => {
      backing.delete(k);
    },
  });
});

describe("the theme", () => {
  it("is kept under the app's own name", () => {
    expect(writeTheme("dark")).toBe(true);
    expect([...backing.entries()]).toEqual([["lf_theme_v1", "dark"]]);
    expect(readTheme()).toBe("dark");
  });

  it("is read from the old name until it is next chosen, and then the old name goes", () => {
    backing.set("nkb_theme_v1", "dark");
    expect(readTheme()).toBe("dark");
    writeTheme("light");
    expect([...backing.entries()]).toEqual([["lf_theme_v1", "light"]]);
    expect(readTheme()).toBe("light");
  });

  it("is none where neither name holds one", () => {
    backing.set("nkb_theme_v1", "purple");
    expect(readTheme()).toBeNull();
  });
});
