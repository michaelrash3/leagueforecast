import { describe, expect, it } from "vitest";
import { loadedAtStartTest, type ModuleLinks } from "../bootChunk";

/*
 * The boot chunk takes the logic the page loads at start, and nothing a view loads later: a module
 * only a later view uses, put there, would be downloaded by every first visit for nothing.
 */
const graph: Record<string, ModuleLinks> = {
  "index.html": { isEntry: true, importers: [] },
  "src/main.tsx": { isEntry: false, importers: ["index.html"] },
  "src/App.tsx": { isEntry: false, importers: ["src/main.tsx"] },
  "src/lib/date.ts": { isEntry: false, importers: ["src/App.tsx", "src/views/Schedule.tsx"] },
  "src/lib/util.ts": { isEntry: false, importers: ["src/lib/date.ts"] },
  // Two modules that import each other, reached from the start.
  "src/lib/a.ts": { isEntry: false, importers: ["src/lib/b.ts", "src/App.tsx"] },
  "src/lib/b.ts": { isEntry: false, importers: ["src/lib/a.ts"] },
  // A view App imports on demand, and what only it uses.
  "src/views/Schedule.tsx": { isEntry: false, importers: [] },
  "src/lib/scheduleOnly.ts": { isEntry: false, importers: ["src/views/Schedule.tsx"] },
  // Two modules that import each other, reached only from the view.
  "src/lib/c.ts": { isEntry: false, importers: ["src/lib/d.ts", "src/views/Schedule.tsx"] },
  "src/lib/d.ts": { isEntry: false, importers: ["src/lib/c.ts"] },
};

describe("loadedAtStartTest", () => {
  const atStart = loadedAtStartTest((id) => graph[id] ?? null);

  it("takes what a chain of static imports from the entry reaches", () => {
    expect(atStart("src/App.tsx")).toBe(true);
    expect(atStart("src/lib/date.ts")).toBe(true);
    expect(atStart("src/lib/util.ts")).toBe(true);
    expect(atStart("src/lib/a.ts")).toBe(true);
    expect(atStart("src/lib/b.ts")).toBe(true);
  });

  it("leaves out what only a view loaded on demand uses", () => {
    expect(atStart("src/views/Schedule.tsx")).toBe(false);
    expect(atStart("src/lib/scheduleOnly.ts")).toBe(false);
    expect(atStart("src/lib/c.ts")).toBe(false);
    expect(atStart("src/lib/d.ts")).toBe(false);
  });

  it("leaves out a module it does not know", () => {
    expect(atStart("src/lib/nowhere.ts")).toBe(false);
  });

  it("gives the same answers asked in any order", () => {
    const ids = Object.keys(graph).concat("src/lib/nowhere.ts");
    const forward = loadedAtStartTest((id) => graph[id] ?? null);
    const backward = loadedAtStartTest((id) => graph[id] ?? null);
    const one = ids.map(forward);
    const other = [...ids].reverse().map(backward).reverse();
    expect(one).toEqual(other);
  });
});
