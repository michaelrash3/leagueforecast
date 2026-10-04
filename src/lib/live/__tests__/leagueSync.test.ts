import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSeasonStore, type SeasonState } from "../../seasonStore";
import { DEFAULT_SETTINGS, type GameLog, type Matchup } from "../../types";
import type { BaseKeeper, Known } from "../leagueBase";
import { docToSeason, encodeKey, LEAGUE_DOC_SCHEMA, seasonDocId, seasonToDoc } from "../leagueDocs";
import { liveSeason, type SeasonEntry, type SeasonParts } from "../leagueLive";
import { startLeagueSync, type LiveLeagueState } from "../leagueSync";
import { memoryLeague, settled } from "./memoryLeague";

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

const ENTRY: SeasonEntry = { id: "spring", name: "Spring", createdAt: "2027-02-01T00:00:00.000Z" };
const PARTS: SeasonState = {
  teams: ["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` })),
  matchups: [game("g1", "A", "B"), game("g2", "C", "D"), game("Row 3", "A", "C")],
  logs: {},
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS, seasonLabel: "Spring" },
};
const DOC_ID = seasonDocId("spring");
/** The cloud's document of a season, as another device made it. */
const docOf = (parts: SeasonState, entry: SeasonEntry = ENTRY) =>
  seasonToDoc(liveSeason(entry, parts));

const memoryBases = (
  events: string[] = []
): BaseKeeper & { held: Map<string, Known>; writes: number } => {
  const held = new Map<string, Known>();
  const bases = {
    held,
    writes: 0,
    read: (docId: string) => held.get(docId) ?? null,
    write: (docId: string, known: Known) => {
      bases.writes += 1;
      events.push(`base ${docId} ${known.rev}`);
      held.set(docId, known);
    },
    remove: (docId: string) => {
      held.delete(docId);
    },
  };
  return bases;
};

const last = <T>(list: readonly T[]): T | undefined => list[list.length - 1];

let clock = Date.parse("2027-04-03T18:00:00.000Z");

const setup = ({
  cloud = memoryLeague(),
  parts = PARTS,
  events = [],
  bases = memoryBases(events),
  id = "spring",
  entry = ENTRY,
}: {
  cloud?: ReturnType<typeof memoryLeague>;
  parts?: SeasonState;
  events?: string[];
  bases?: ReturnType<typeof memoryBases>;
  id?: string;
  entry?: SeasonEntry;
} = {}) => {
  const seasons = createSeasonStore({ id, season: parts });
  const states: LiveLeagueState["kind"][] = [];
  const typing = { now: false };
  const stored = new Map<string, SeasonParts>();
  const sync = startLeagueSync({
    store: cloud.store,
    seasons,
    entryOf: (one) => (one === entry.id ? entry : { id: one, name: one, createdAt: "x" }),
    bases,
    persist: (one, data) => {
      events.push(`persist ${one} ${JSON.stringify(data.logs)}`);
      stored.set(one, data);
    },
    editing: () => typing.now,
    onState: (state) => states.push(state.kind),
    now: () => new Date(clock),
  });
  const cloudSeason = (docId = DOC_ID) => {
    const read = docToSeason(cloud.read(docId), docId);
    if (!read.ok) throw new Error(`unread: ${read.reason}`);
    return read.season;
  };
  const setLogs = (logs: Record<string, GameLog>) =>
    seasons.setSeason((prev) => ({ ...prev, logs: { ...prev.logs, ...logs } }));
  return { cloud, seasons, states, typing, sync, bases, stored, events, cloudSeason, setLogs };
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a season kept live", () => {
  it("makes the season's document from this device when the cloud has none", async () => {
    const { cloudSeason, states } = setup();
    await settled();
    expect(cloudSeason()).toMatchObject({ name: "Spring", createdAt: ENTRY.createdAt });
    expect(cloudSeason().matchups).toEqual(PARTS.matchups);
    expect(states).toEqual(["connecting", "live"]);
  });

  it("sends a score 700 ms after the last change, as one field", async () => {
    const { cloud, cloudSeason, setLogs } = setup();
    await settled();
    const written = cloud.counts.writes;
    setLogs({ g1: score("7", "4") });
    await vi.advanceTimersByTimeAsync(400);
    setLogs({ g1: score("8", "4") });
    await vi.advanceTimersByTimeAsync(699);
    expect(cloud.counts.writes).toBe(written);
    await vi.advanceTimersByTimeAsync(1);
    await settled();
    expect(cloud.counts.writes).toBe(written + 1);
    expect(cloudSeason().logs).toEqual({ g1: score("8", "4") });
  });

  it("sends at once when the page lets go of the field", async () => {
    const { cloud, sync, cloudSeason, setLogs } = setup();
    await settled();
    setLogs({ g2: score("1", "2") });
    sync.settle();
    await settled();
    expect(cloudSeason().logs.g2).toEqual(score("1", "2"));
    expect(cloud.counts.writes).toBe(2);
  });

  it("takes in another device's score at once, keeping the one being entered here", async () => {
    const { cloud, seasons, cloudSeason, setLogs } = setup();
    await settled();
    setLogs({ g2: score("3", "3") });
    cloud.edit(DOC_ID, [{ path: ["logs", encodeKey("Row 3")], value: score("5", "1") }]);
    await settled();
    expect(seasons.get().season.logs).toEqual({ g2: score("3", "3"), "Row 3": score("5", "1") });
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(cloudSeason().logs).toEqual({ g2: score("3", "3"), "Row 3": score("5", "1") });
  });

  it("holds an arrival while a field is typed in, and takes it in when the page lets go", async () => {
    const { cloud, seasons, typing, sync } = setup();
    await settled();
    typing.now = true;
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], value: score("2", "0") }]);
    await settled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seasons.get().season.logs).toEqual({});
    typing.now = false;
    sync.settle();
    expect(seasons.get().season.logs).toEqual({ g1: score("2", "0") });
  });

  it("never brings back a game another device deleted", async () => {
    const { cloud, seasons, cloudSeason, setLogs } = setup();
    await settled();
    cloud.edit(DOC_ID, [
      { path: ["matchups", "g2"], remove: true },
      { path: ["order"], value: ["g1", "Row 3"] },
    ]);
    await settled();
    expect(seasons.get().season.matchups.map((one) => one.id)).toEqual(["g1", "Row 3"]);
    setLogs({ g1: score("4", "0") });
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(cloudSeason().matchups.map((one) => one.id)).toEqual(["g1", "Row 3"]);
    expect(cloudSeason().logs).toEqual({ g1: score("4", "0") });
  });

  it("lays a write that lost the race over the one that won it", async () => {
    const { cloud, cloudSeason, setLogs, sync } = setup();
    await settled();
    setLogs({ g1: score("6", "5") });
    cloud.interfere(() => cloud.edit(DOC_ID, [{ path: ["logs", "g2"], value: score("0", "9") }]));
    sync.settle();
    await settled();
    expect(cloudSeason().logs).toEqual({ g1: score("6", "5"), g2: score("0", "9") });
    expect(cloud.counts.runs).toBeGreaterThan(cloud.counts.transactions);
  });

  it("sends nothing twice while what it sent is still on its way back", async () => {
    const { cloud, setLogs, sync } = setup();
    await settled();
    cloud.hold();
    setLogs({ g1: score("1", "1") });
    sync.settle();
    await settled();
    const transactions = cloud.counts.transactions;
    sync.settle();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cloud.counts.transactions).toBe(transactions);
    cloud.release();
    await settled();
  });

  it("keeps every part of the season an arrival leaves alone the same object", async () => {
    const { cloud, seasons } = setup();
    await settled();
    const before = seasons.get().season;
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], value: score("2", "1") }]);
    await settled();
    const after = seasons.get().season;
    expect(after.logs).not.toBe(before.logs);
    expect(after.teams).toBe(before.teams);
    expect(after.matchups).toBe(before.matchups);
    expect(after.settings).toBe(before.settings);
  });

  it("tries a failed write again, and stops for good when the rules refuse it", async () => {
    const { cloud, setLogs, sync, cloudSeason, states } = setup();
    await settled();
    cloud.failNext("unavailable");
    setLogs({ g1: score("3", "0") });
    sync.settle();
    await settled();
    expect(cloudSeason().logs).toEqual({});
    await vi.advanceTimersByTimeAsync(2_000);
    await settled();
    expect(cloudSeason().logs).toEqual({ g1: score("3", "0") });
    cloud.failNext("permission-denied");
    setLogs({ g2: score("1", "1") });
    sync.settle();
    await settled();
    expect(last(states)).toBe("refused");
    const transactions = cloud.counts.transactions;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(cloud.counts.transactions).toBe(transactions);
  });

  it("reads nothing for another device's change when nothing changed here", async () => {
    const { cloud, sync } = setup();
    await settled();
    cloud.edit(DOC_ID, [{ path: ["logs", "g2"], value: score("4", "1") }]);
    await settled();
    const transactions = cloud.counts.transactions;
    sync.settle();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cloud.counts.transactions).toBe(transactions);
  });

  it("sends a change made while a write is on its way, as soon as that write lands", async () => {
    const { cloud, setLogs, sync, cloudSeason } = setup();
    await settled();
    setLogs({ g1: score("1", "0") });
    cloud.interfere(() => {
      setLogs({ g2: score("0", "1") });
      sync.settle();
    });
    sync.settle();
    await settled();
    expect(cloudSeason().logs).toEqual({ g1: score("1", "0"), g2: score("0", "1") });
  });

  it("takes in the cloud's version on opening even with a field already being typed in", async () => {
    const cloud = memoryLeague();
    cloud.put(DOC_ID, docOf({ ...PARTS, logs: { g1: score("6", "2") } }));
    const seasons = createSeasonStore({ id: "spring", season: PARTS });
    const sync = startLeagueSync({
      store: cloud.store,
      seasons,
      entryOf: () => ENTRY,
      bases: memoryBases(),
      persist: () => {},
      editing: () => true,
      onState: () => {},
    });
    await settled();
    expect(seasons.get().season.logs).toEqual({ g1: score("6", "2") });
    sync.stop();
  });

  it("reads nothing more once what it sent has come back", async () => {
    const { cloud, setLogs, sync } = setup();
    await settled();
    setLogs({ g1: score("1", "1") });
    sync.settle();
    await settled();
    const transactions = cloud.counts.transactions;
    sync.settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cloud.counts.transactions).toBe(transactions);
  });
});

describe("a season met again", () => {
  it("keeps a game deleted while this device was closed deleted, by the base it saved", async () => {
    const cloud = memoryLeague();
    const bases = memoryBases();
    const first = setup({ cloud, bases });
    await settled();
    first.sync.stop();
    cloud.edit(DOC_ID, [
      { path: ["matchups", "g1"], remove: true },
      { path: ["order"], value: ["g2", "Row 3"] },
    ]);
    // The page opens again on the season as this device last stored it, game and all.
    const again = setup({ cloud, bases });
    await settled();
    expect(again.seasons.get().season.matchups.map((one) => one.id)).toEqual(["g2", "Row 3"]);
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(again.cloudSeason().matchups.map((one) => one.id)).toEqual(["g2", "Row 3"]);
  });

  it("sends a change made just before the page closed, which the base says is this device's", async () => {
    const cloud = memoryLeague();
    const bases = memoryBases();
    const first = setup({ cloud, bases });
    await settled();
    first.sync.stop();
    const again = setup({ cloud, bases, parts: { ...PARTS, logs: { g2: score("2", "2") } } });
    await settled();
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(again.cloudSeason().logs).toEqual({ g2: score("2", "2") });
  });

  it("never makes again a season deleted while this device was closed", async () => {
    const cloud = memoryLeague();
    const bases = memoryBases();
    const first = setup({ cloud, bases });
    await settled();
    first.sync.stop();
    cloud.remove(DOC_ID);
    const again = setup({ cloud, bases, parts: { ...PARTS, logs: { g1: score("1", "0") } } });
    await settled();
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(cloud.read(DOC_ID)).toBeUndefined();
    expect(last(again.states)).toBe("gone");
  });

  it("takes a season made since under a deleted season's id for a season of its own", async () => {
    const cloud = memoryLeague();
    const bases = memoryBases();
    // The season once called spring was met here, then deleted; a new one was made since, and the
    // season list gave it the same id.
    const old = { ...ENTRY, createdAt: "2026-12-31T00:00:00.000Z" };
    bases.write(DOC_ID, { season: liveSeason(old, PARTS), rev: 4, landed: [] });
    const { states, cloudSeason } = setup({
      cloud,
      bases,
      parts: { ...PARTS, logs: { g1: score("2", "2") } },
    });
    await settled();
    expect(last(states)).toBe("live");
    expect(cloudSeason()).toMatchObject({
      createdAt: ENTRY.createdAt,
      logs: { g1: score("2", "2") },
    });
    expect(bases.held.get(DOC_ID)?.season.createdAt).toBe(ENTRY.createdAt);
  });

  it("takes the cloud's version where the two differ and nothing says which changed", async () => {
    const cloud = memoryLeague();
    cloud.put(DOC_ID, docOf({ ...PARTS, logs: { g1: score("3", "1") } }));
    const { seasons } = setup({
      cloud,
      parts: { ...PARTS, logs: { g1: score("9", "9"), g2: score("1", "0") } },
    });
    await settled();
    expect(seasons.get().season.logs).toEqual({ g1: score("3", "1"), g2: score("1", "0") });
  });

  it("keeps apart a season started separately under the same id, writing nothing", async () => {
    const cloud = memoryLeague();
    cloud.put(DOC_ID, docOf(PARTS, { ...ENTRY, createdAt: "2026-01-01T00:00:00.000Z" }));
    const writes = cloud.counts.writes;
    const { seasons, states, setLogs, sync } = setup({
      cloud,
      parts: { ...PARTS, logs: { g1: score("1", "0") } },
    });
    await settled();
    setLogs({ g2: score("2", "2") });
    sync.settle();
    await settled();
    expect(last(states)).toBe("apart");
    expect(cloud.counts.writes).toBe(writes);
    expect(seasons.get().season.logs).toEqual({ g1: score("1", "0"), g2: score("2", "2") });
  });
});

describe("a season that may not be written", () => {
  it("writes nothing while offline, and sends what waited once back", async () => {
    const { cloud, states, setLogs, cloudSeason, bases } = setup();
    await settled();
    cloud.offline();
    await settled();
    expect(last(states)).toBe("offline");
    setLogs({ g1: score("5", "5") });
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(cloudSeason().logs).toEqual({});
    const saved = bases.writes;
    cloud.online();
    await settled();
    expect(last(states)).toBe("live");
    // Back with nothing new: nothing merged or kept again.
    expect(bases.writes).toBe(saved);
    await vi.advanceTimersByTimeAsync(2_000);
    await settled();
    expect(cloudSeason().logs).toEqual({ g1: score("5", "5") });
  });

  it("refuses a document a later version of the app wrote", async () => {
    const cloud = memoryLeague();
    cloud.put(DOC_ID, { ...docOf(PARTS), schema: LEAGUE_DOC_SCHEMA + 1 });
    const writes = cloud.counts.writes;
    const { states, setLogs, sync, seasons } = setup({ cloud });
    await settled();
    setLogs({ g1: score("1", "0") });
    sync.settle();
    await settled();
    expect(last(states)).toBe("newer");
    expect(cloud.counts.writes).toBe(writes);
    expect(seasons.get().season.logs).toEqual({ g1: score("1", "0") });
    // A readable version later in the visit does not lift the stop.
    cloud.put(DOC_ID, docOf(PARTS));
    await settled();
    expect(last(states)).toBe("newer");
  });

  it("never writes back a season deleted on another device", async () => {
    const { cloud, states, setLogs, sync } = setup();
    await settled();
    cloud.remove(DOC_ID);
    await settled();
    expect(last(states)).toBe("gone");
    setLogs({ g1: score("1", "0") });
    sync.settle();
    await settled();
    expect(cloud.read(DOC_ID)).toBeUndefined();
  });
});

describe("another season opened", () => {
  it("sends a change still waiting to the season it was made in", async () => {
    const { cloud, seasons, setLogs, cloudSeason } = setup();
    await settled();
    setLogs({ g1: score("4", "2") });
    const fall: SeasonState = {
      ...PARTS,
      teams: [
        { id: "X", name: "Club X" },
        { id: "Y", name: "Club Y" },
      ],
      matchups: [game("f1", "X", "Y")],
      settings: { ...DEFAULT_SETTINGS, seasonLabel: "Fall" },
    };
    seasons.open("fall", fall);
    await settled();
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(cloudSeason().logs).toEqual({ g1: score("4", "2") });
    expect(cloudSeason().teams.map((team) => team.id)).toEqual(["A", "B", "C", "D"]);
    const fallDoc = docToSeason(cloud.read(seasonDocId("fall")), seasonDocId("fall"));
    expect(fallDoc.ok && fallDoc.season.teams.map((team) => team.id)).toEqual(["X", "Y"]);
  });
});

describe("an undo while live", () => {
  it("puts back what no other device has changed since the step", async () => {
    const { cloud, seasons, sync } = setup();
    await settled();
    const takenAt = clock;
    const snapshot = { ...seasons.get().season };
    // This device deletes g1; a minute later another device scores g2.
    seasons.setSeason((prev) => ({
      ...prev,
      matchups: prev.matchups.filter((one) => one.id !== "g1"),
    }));
    sync.settle();
    await settled();
    clock += 60_000;
    cloud.edit(DOC_ID, [{ path: ["logs", "g2"], value: score("7", "7") }]);
    await settled();
    const undone = sync.guardUndo(snapshot, takenAt);
    expect(undone.matchups.map((one) => one.id)).toEqual(["g1", "g2", "Row 3"]);
    expect(undone.logs).toEqual({ g2: score("7", "7") });
  });
});

describe("what the review of 1.2 found", () => {
  it("takes a value the reader rewrites for what it reads as, not an edit made here for ever", async () => {
    const { cloud, seasons, setLogs, sync, cloudSeason } = setup();
    await settled();
    // A leading zero, and a Final with no score: the reader makes them "7" and not final.
    setLogs({ g1: { ...score("07", "3") }, g2: { ...score("", ""), isFinal: true } });
    sync.settle();
    await settled();
    expect(cloudSeason().logs.g1).toEqual(score("7", "3"));
    // Another device corrects both games; this device's versions do not win them back.
    cloud.edit(DOC_ID, [
      { path: ["logs", "g1"], value: score("5", "3") },
      { path: ["logs", "g2"], value: score("8", "1") },
    ]);
    await settled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cloudSeason().logs).toEqual({ g1: score("5", "3"), g2: score("8", "1") });
    expect(seasons.get().season.logs).toMatchObject({ g1: score("5", "3"), g2: score("8", "1") });
  });

  it("sends a score changed back to what it was while its own write waited, typing all along", async () => {
    const { seasons, setLogs, typing, sync, cloudSeason } = setup();
    await settled();
    typing.now = true;
    setLogs({ g1: score("7", "0") });
    await vi.advanceTimersByTimeAsync(700);
    await settled();
    expect(cloudSeason().logs).toEqual({ g1: score("7", "0") });
    // Still in the field, the score is taken back out.
    seasons.setSeason((prev) => ({ ...prev, logs: {} }));
    typing.now = false;
    sync.settle();
    await settled();
    expect(cloudSeason().logs).toEqual({});
    expect(seasons.get().season.logs).toEqual({});
  });

  it("sends a setting changed and changed back before its own write came back", async () => {
    const { cloud, seasons, sync, cloudSeason } = setup();
    await settled();
    cloud.hold();
    const flip = (winPoints: number) =>
      seasons.setSeason((prev) => ({ ...prev, settings: { ...prev.settings, winPoints } }));
    flip(3);
    sync.settle();
    await settled();
    flip(DEFAULT_SETTINGS.winPoints);
    sync.settle();
    await settled();
    cloud.release();
    await settled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(cloudSeason().settings.winPoints).toBe(DEFAULT_SETTINGS.winPoints);
    expect(seasons.get().season.settings.winPoints).toBe(DEFAULT_SETTINGS.winPoints);
  });

  it("takes in the latest of what waited while a field was typed in, a change since undone included", async () => {
    const { cloud, seasons, typing, sync } = setup();
    await settled();
    typing.now = true;
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], value: score("4", "2") }]);
    await settled();
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], remove: true }]);
    await settled();
    typing.now = false;
    sync.settle();
    await settled();
    expect(seasons.get().season.logs).toEqual({});
  });

  it("writes no name back and forth between devices whose lists name the season differently", async () => {
    const cloud = memoryLeague();
    const unlabelled = { ...PARTS, settings: { ...PARTS.settings, seasonLabel: "" } };
    const one = setup({ cloud, parts: unlabelled, entry: { ...ENTRY, name: "Alpha" } });
    await settled();
    const two = setup({ cloud, parts: unlabelled, entry: { ...ENTRY, name: "Beta" } });
    await settled();
    two.setLogs({ g1: score("1", "0") });
    await vi.advanceTimersByTimeAsync(5_000);
    await settled();
    const writes = cloud.counts.writes;
    await vi.advanceTimersByTimeAsync(20_000);
    await settled();
    expect(cloud.counts.writes).toBe(writes);
    expect(one.seasons.get().season.logs).toEqual({ g1: score("1", "0") });
  });

  it("listens again after a listener ends, and is live once it hears the cloud", async () => {
    const { cloud, states, seasons } = setup();
    await settled();
    cloud.failWatch(DOC_ID, "unavailable");
    await settled();
    expect(last(states)).toBe("offline");
    await vi.advanceTimersByTimeAsync(2_000);
    await settled();
    expect(cloud.listeners(DOC_ID)).toBe(1);
    expect(last(states)).toBe("live");
    cloud.edit(DOC_ID, [{ path: ["logs", "g2"], value: score("3", "1") }]);
    await settled();
    expect(seasons.get().season.logs).toEqual({ g2: score("3", "1") });
  });

  it("keeps apart a season of the same id another device made a moment before this one", async () => {
    const cloud = memoryLeague();
    const { states, sync, setLogs } = setup({ cloud, parts: { ...PARTS, logs: {} } });
    // Both found no season; the other device's lands between this one's read and its write.
    cloud.interfere(() =>
      cloud.put(DOC_ID, docOf(PARTS, { ...ENTRY, createdAt: "2026-06-01T00:00:00.000Z" }))
    );
    await settled();
    setLogs({ g1: score("1", "1") });
    sync.settle();
    await settled();
    expect(last(states)).toBe("apart");
    const read = docToSeason(cloud.read(DOC_ID), DOC_ID);
    expect(read.ok && read.season.logs).toEqual({});
  });

  it("writes the season to storage before it keeps a base that holds it", async () => {
    const events: string[] = [];
    const { cloud } = setup({ events });
    await settled();
    events.length = 0;
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], value: score("6", "6") }]);
    await settled();
    const persisted = events.findIndex((one) => one.startsWith("persist") && one.includes("6"));
    const kept = events.findIndex((one) => one.startsWith("base"));
    expect(persisted).toBeGreaterThanOrEqual(0);
    expect(kept).toBeGreaterThan(persisted);
  });

  it("raises the season's write number by one with every write", async () => {
    const { cloud, setLogs, sync } = setup();
    await settled();
    expect(cloud.read(DOC_ID)?.rev).toBe(1);
    setLogs({ g1: score("1", "0") });
    sync.settle();
    await settled();
    expect(cloud.read(DOC_ID)?.rev).toBe(2);
    cloud.edit(DOC_ID, [{ path: ["logs", "g2"], value: score("2", "0") }]);
    await settled();
    setLogs({ g1: score("3", "0") });
    sync.settle();
    await settled();
    expect(cloud.read(DOC_ID)?.rev).toBe(4);
  });

  it("takes in, while a field is typed in, an arrival that changes nothing on screen", async () => {
    const { cloud, typing, setLogs, bases } = setup();
    await settled();
    typing.now = true;
    setLogs({ g1: score("3", "2") });
    // Another device writes the same game; this device's own change to it stands over theirs.
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], value: score("5", "5") }]);
    await settled();
    expect(bases.held.get(DOC_ID)?.rev).toBe(2);
    typing.now = false;
  });

  it("stops writing when a key too long for the cloud is added while live", async () => {
    const { cloud, seasons, states, sync } = setup();
    await settled();
    const writes = cloud.counts.writes;
    seasons.setSeason((prev) => ({
      ...prev,
      matchups: [...prev.matchups, game("x ".repeat(800), "A", "B")],
      logs: { g1: score("1", "0") },
    }));
    sync.settle();
    await settled();
    expect(last(states)).toBe("unstorable");
    expect(cloud.counts.writes).toBe(writes);
  });

  it("keeps apart a season made elsewhere since under a deleted season's id, base or none", async () => {
    const cloud = memoryLeague();
    const bases = memoryBases();
    // This device met the season before; it was deleted elsewhere, and another made there since.
    bases.write(DOC_ID, { season: liveSeason(ENTRY, PARTS), rev: 4, landed: [] });
    cloud.put(
      DOC_ID,
      docOf(
        { ...PARTS, logs: { g2: score("8", "0") } },
        {
          ...ENTRY,
          createdAt: "2027-05-01T00:00:00.000Z",
        }
      )
    );
    const writes = cloud.counts.writes;
    const { seasons, states } = setup({
      cloud,
      bases,
      parts: { ...PARTS, logs: { g1: score("1", "0") } },
    });
    await settled();
    expect(last(states)).toBe("apart");
    expect(cloud.counts.writes).toBe(writes);
    expect(seasons.get().season.logs).toEqual({ g1: score("1", "0") });
  });

  it("writes nothing over a season made elsewhere since under its id, before the listener says so", async () => {
    const { cloud, setLogs, sync, states } = setup();
    await settled();
    // Deleted and made again on another device; the listener has not said so yet.
    cloud.hold();
    cloud.remove(DOC_ID);
    cloud.put(DOC_ID, docOf(PARTS, { ...ENTRY, createdAt: "2027-05-01T00:00:00.000Z" }));
    const writes = cloud.counts.writes;
    setLogs({ g1: score("1", "0") });
    sync.settle();
    await settled();
    expect(last(states)).toBe("apart");
    expect(cloud.counts.writes).toBe(writes);
    cloud.release();
    await settled();
  });

  it("keeps a season with an id too long for any key out of the cloud, read-only", async () => {
    const long = "x ".repeat(800);
    const cloud = memoryLeague();
    const { states } = setup({
      cloud,
      parts: {
        ...PARTS,
        matchups: [...PARTS.matchups, game(long, "A", "B")],
      },
    });
    await settled();
    expect(last(states)).toBe("unstorable");
    expect(cloud.read(DOC_ID)).toBeUndefined();
  });
});
