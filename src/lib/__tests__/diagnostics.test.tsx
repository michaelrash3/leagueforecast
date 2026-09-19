import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDiagnostics,
  DIAGNOSTIC_LIMIT,
  diagnosticsReport,
  readDiagnostics,
  recordDiagnostic,
  type DiagnosticEntry,
} from "../diagnostics";

/**
 * A crash on somebody else's phone used to be lost. `componentDidCatch` said so itself — "the
 * console is the only record there is" — and nobody reads a console on a phone at a ballfield.
 *
 * So the rules this has to keep are about not making a bad moment worse: it runs on the path that
 * is already handling a crash, and the boundary is the last thing standing between a bad row and
 * a blank page. Nothing here may throw, whatever storage does.
 */
const screen = { width: 390, height: 844 };

describe("writing down what went wrong", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps what it was told, newest first", () => {
    recordDiagnostic({ kind: "crash", where: "Team Rankings", message: "boom" });
    recordDiagnostic({ kind: "pool-write", where: "games_2027", message: "did not land" });

    expect(readDiagnostics().map((entry) => entry.where)).toEqual(["games_2027", "Team Rankings"]);
  });

  it("drops the oldest rather than growing without end", () => {
    for (let i = 0; i < DIAGNOSTIC_LIMIT + 5; i += 1) {
      recordDiagnostic({ kind: "crash", where: `area-${i}`, message: "boom" });
    }

    const kept = readDiagnostics();
    expect(kept).toHaveLength(DIAGNOSTIC_LIMIT);
    // The newest is first and the first five are gone; a full store is what caused half of these.
    expect(kept[0]?.where).toBe(`area-${DIAGNOSTIC_LIMIT + 4}`);
    expect(kept.some((entry) => entry.where === "area-0")).toBe(false);
  });

  it("truncates a stack rather than filling storage with one", () => {
    recordDiagnostic({
      kind: "crash",
      where: "Team Rankings",
      message: "boom",
      detail: "x".repeat(10_000),
    });

    expect(readDiagnostics()[0]?.detail?.length).toBeLessThan(2_100);
  });

  it("never throws when the store will not have it", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", { value: broken, configurable: true });

    /*
     * A private window, blocked site data or a full quota. This is called from inside a caught
     * error, so a throw here turns one handled crash into an unhandled one and blanks the page —
     * which is the failure this whole module exists to make reportable.
     */
    expect(() => recordDiagnostic({ kind: "crash", where: "x", message: "y" })).not.toThrow();
    expect(readDiagnostics()).toEqual([]);
    expect(() => clearDiagnostics()).not.toThrow();

    Object.defineProperty(window, "localStorage", { value: original, configurable: true });
  });

  it("ignores anything in storage that is not one of these", () => {
    window.localStorage.setItem(
      "league_forecast_diagnostics_v1",
      JSON.stringify([{ nonsense: true }, "a string", null])
    );

    expect(readDiagnostics()).toEqual([]);
  });

  it("ignores a stored value that is not even a list", () => {
    window.localStorage.setItem("league_forecast_diagnostics_v1", "{oh dear");

    expect(readDiagnostics()).toEqual([]);
  });
});

describe("the report somebody pastes into a message", () => {
  const at = new Date("2026-09-19T12:00:00.000Z");

  it("says there is nothing rather than handing over an empty file", () => {
    const text = diagnosticsReport([], at, "TestBrowser/1.0", screen);

    expect(text).toContain("Nothing has been recorded in this browser.");
  });

  it("names the browser and the screen, because both failures it exists for are browser-specific", () => {
    const entries: DiagnosticEntry[] = [
      { at: at.toISOString(), kind: "crash", where: "Team Rankings", message: "boom" },
    ];

    const text = diagnosticsReport(entries, at, "TestBrowser/1.0", screen);

    // Safari evicting storage and a worker that will not start are the two real ones, and neither
    // is answerable without knowing which browser it was.
    expect(text).toContain("TestBrowser/1.0");
    expect(text).toContain("390×844");
    expect(text).toContain("Team Rankings");
    expect(text).toContain("boom");
  });

  it("indents a stack under its entry so a numbered list stays readable", () => {
    const entries: DiagnosticEntry[] = [
      {
        at: at.toISOString(),
        kind: "crash",
        where: "Team Rankings",
        message: "boom",
        detail: "at RankingsView\nat App",
      },
    ];

    expect(diagnosticsReport(entries, at, "b", screen)).toContain("   at RankingsView\n   at App");
  });
});
