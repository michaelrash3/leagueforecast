import { describe, expect, it } from "vitest";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS, type GameLog, type Matchup } from "../../types";
import { encodeKey } from "../leagueDocs";
import {
  fieldsChanged,
  guardedUndo,
  layOver,
  liveSeason,
  partsOf,
  sameSeason,
  writesFor,
} from "../leagueLive";

const score = (away: string, home: string): GameLog => ({
  awayRuns: away,
  awayHits: "",
  awayK: "",
  homeRuns: home,
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const game = (id: string, away: string, home: string): Matchup => ({
  id,
  date: "4/3",
  away,
  home,
});

const BASE: SeasonSnapshot = liveSeason(
  { id: "spring", name: "Spring", createdAt: "2027-02-01T00:00:00.000Z" },
  {
    teams: ["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` })),
    matchups: [game("g1", "A", "B"), game("g2", "C", "D"), game("Row 3", "A", "C")],
    logs: { g1: score("1", "0") },
    bracketLogs: {},
    settings: DEFAULT_SETTINGS,
  }
);
const withLogs = (season: SeasonSnapshot, logs: Record<string, GameLog>): SeasonSnapshot => ({
  ...season,
  logs: { ...season.logs, ...logs },
});
/** The record as Firestore hands it back: its fields in an order of its own. */
const reordered = <T extends object>(record: T): T =>
  Object.fromEntries(Object.entries(record).reverse()) as T;

describe("laying this device's changes over the cloud's", () => {
  it("keeps both devices' scores for two games", () => {
    const local = withLogs(BASE, { g2: score("4", "3") });
    const remote = withLogs(BASE, { "Row 3": score("2", "5") });
    expect(layOver(BASE, local, remote).logs).toEqual({
      g1: score("1", "0"),
      g2: score("4", "3"),
      "Row 3": score("2", "5"),
    });
  });

  it("settles a score both changed toward this device's, which it is about to write", () => {
    const local = withLogs(BASE, { g1: score("7", "4") });
    const remote = withLogs(BASE, { g1: score("6", "4") });
    expect(layOver(BASE, local, remote).logs.g1).toEqual(score("7", "4"));
  });

  it("never brings back what another device deleted and this one never touched", () => {
    const remote = { ...BASE, matchups: BASE.matchups.filter((one) => one.id !== "g2") };
    const local = withLogs(BASE, { g1: score("3", "3") });
    const merged = layOver(BASE, local, remote);
    expect(merged.matchups.map((one) => one.id)).toEqual(["g1", "Row 3"]);
    expect(merged.logs.g1).toEqual(score("3", "3"));
  });

  it("takes the cloud's version of a record the two hold differently when they first meet", () => {
    const local = withLogs(BASE, { g1: score("9", "9"), g2: score("1", "1") });
    const remote = withLogs(BASE, { g1: score("2", "0") });
    const merged = layOver(null, local, remote);
    expect(merged.logs).toEqual({ g1: score("2", "0"), g2: score("1", "1") });
  });

  it("takes a record merely read back in another order as unchanged", () => {
    const remote = {
      ...withLogs(BASE, { g2: score("4", "4") }),
      logs: { g1: reordered(score("1", "0")), g2: score("4", "4") },
      settings: reordered(DEFAULT_SETTINGS),
    };
    const local = withLogs(BASE, { g1: score("5", "0") });
    expect(layOver(BASE, local, remote).logs.g1).toEqual(score("5", "0"));
  });
});

describe("what a write sends", () => {
  it("is each changed field and when it was saved, and nothing for no change", () => {
    const merged = withLogs(BASE, { "Row 3": score("2", "5") });
    expect(writesFor(BASE, 4, merged, "2027-04-03T18:00:00.000Z")).toEqual([
      { path: ["logs", encodeKey("Row 3")], value: score("2", "5") },
      { path: ["updatedAt"], value: "2027-04-03T18:00:00.000Z" },
      { path: ["rev"], value: 5 },
    ]);
    expect(writesFor({ ...BASE, updatedAt: "earlier" }, 4, BASE, "now")).toEqual([]);
  });

  it("reads two versions alike whatever order or save time they carry", () => {
    const back = { ...BASE, updatedAt: "2027-04-03", logs: { g1: reordered(score("1", "0")) } };
    expect(sameSeason(BASE, back)).toBe(true);
    expect(sameSeason(BASE, withLogs(BASE, { g2: score("1", "1") }))).toBe(false);
    expect(fieldsChanged(BASE, withLogs(BASE, { "Row 3": score("1", "1") }))).toEqual([
      `logs/${encodeKey("Row 3")}`,
    ]);
  });
});

describe("an undo on a shared season", () => {
  const touchedOnly =
    (...paths: string[]) =>
    (path: string) =>
      paths.includes(path);

  it("puts back a deleted game and its score, and keeps a score another device entered since", () => {
    const snapshot = partsOf(BASE);
    // This device deleted g1 and its score; another device then scored g2.
    const afterDelete = {
      ...BASE,
      matchups: BASE.matchups.filter((one) => one.id !== "g1"),
      logs: {},
    };
    const current = withLogs(afterDelete, { g2: score("8", "2") });
    const undone = guardedUndo(snapshot, current, touchedOnly("logs/g2"));
    expect(undone.matchups.map((one) => one.id)).toEqual(["g1", "g2", "Row 3"]);
    expect(undone.logs).toEqual({ g1: score("1", "0"), g2: score("8", "2") });
  });

  it("leaves a record another device changed since the step as that device left it", () => {
    const snapshot = partsOf(BASE);
    // This device changed g1's and Row 3's scores; another device then changed both again, and
    // deleted g2.
    const current = {
      ...withLogs(BASE, { g1: score("4", "4"), "Row 3": score("6", "1") }),
      matchups: BASE.matchups.filter((one) => one.id !== "g2"),
    };
    const undone = guardedUndo(
      snapshot,
      current,
      touchedOnly("logs/g1", `logs/${encodeKey("Row 3")}`, "matchups/g2")
    );
    expect(undone.logs.g1).toEqual(score("4", "4"));
    expect(undone.logs["Row 3"]).toEqual(score("6", "1"));
    expect(undone.matchups.map((one) => one.id)).toEqual(["g1", "Row 3"]);
    // Untouched by anyone else, the same step is undone whole.
    expect(guardedUndo(snapshot, current, () => false).logs.g1).toEqual(score("1", "0"));
  });

  it("puts settings back only when the step replaced them, and never one changed elsewhere since", () => {
    const current = {
      ...BASE,
      settings: { ...DEFAULT_SETTINGS, winPoints: 3, goldCutoff: 2 },
    };
    expect(guardedUndo(partsOf(BASE), current, () => false).settings).toEqual(DEFAULT_SETTINGS);
    const { settings: _kept, ...noSettings } = partsOf(BASE);
    expect(guardedUndo(noSettings, current, () => false).settings).toEqual(current.settings);
    const undone = guardedUndo(partsOf(BASE), current, touchedOnly("settings/goldCutoff"));
    expect(undone.settings).toMatchObject({ winPoints: DEFAULT_SETTINGS.winPoints, goldCutoff: 2 });
  });

  it("is the snapshot itself when no other device changed anything", () => {
    const snapshot = partsOf(withLogs(BASE, { g2: score("1", "2") }));
    const current = { ...BASE, teams: [...BASE.teams].reverse(), logs: {} };
    expect(partsOf(guardedUndo(snapshot, current, () => false))).toEqual(snapshot);
  });
});
