import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetCloudGuard } from "../../cloud/cloudGuard";
import { createSeasonStore } from "../../seasonStore";
import {
  getActiveSeasonId,
  listSeasons,
  loadBracketLogs,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  saveMatchups,
  saveTeams,
  writeSeasonData,
} from "../../storage";
import { adoptTabTurn } from "../../tabTurn";
import { createTabTurn } from "../../tabTurnChannel";
import type { GameLog, Matchup } from "../../types";
import { storedBases } from "../leagueBase";
import { docToSeason, seasonDocId } from "../leagueDocs";
import { startLeagueSync } from "../leagueSync";
import { memoryLeague, settled } from "./memoryLeague";

/*
 * League kept live over this browser's own storage (`writeSeasonData`) and its kept bases
 * (`storedBases`), both of which can refuse a write: every League write in a window another window
 * has the turn from (`tabTurn.ts`), and any write once storage is full. A base says what this
 * device knows the cloud's document holds, so one kept ahead of the season in storage makes the
 * next opening read whatever the base has and storage lacks as deleted here, and send that.
 */

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
const game = (id: string, away: string, home: string): Matchup => ({ id, date: "4/3", away, home });
const ids = (games: readonly Matchup[]) => games.map((one) => one.id);

const backing = new Map<string, string>();
/** Keys whose writes storage refuses for room, as a full browser storage does. */
let full: (key: string) => boolean = () => false;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  backing.clear();
  full = () => false;
  resetCloudGuard();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => backing.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (full(key)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      backing.set(key, value);
    },
    removeItem: (key: string) => {
      backing.delete(key);
    },
  });
  saveTeams(["A", "B", "C", "D"].map((id) => ({ id, name: `Club ${id}` })));
  saveMatchups([game("g1", "A", "B"), game("g2", "C", "D")]);
});
afterEach(() => {
  adoptTabTurn(null);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const DOC_ID = seasonDocId("default");

/** The open season kept live in a window of this browser, opened on what storage holds. */
const openWindow = (cloud: ReturnType<typeof memoryLeague>) => {
  const seasons = createSeasonStore({
    id: getActiveSeasonId(),
    season: {
      teams: loadTeams(),
      matchups: loadMatchups(),
      logs: loadLogs(),
      bracketLogs: loadBracketLogs(),
      settings: loadSettings(),
    },
  });
  const sync = startLeagueSync({
    store: cloud.store,
    seasons,
    entryOf: (id) => listSeasons().find((season) => season.id === id),
    bases: storedBases,
    persist: writeSeasonData,
    editing: () => false,
    onState: () => {},
  });
  return { seasons, sync };
};

/** Read-only, as another window that has the turn answers this one. */
const readOnly = () => {
  const turn = createTabTurn({ channel: null, openedAt: 0, id: "t", claimed: () => false });
  adoptTabTurn({ ...turn, readOnly: () => true });
};

const cloudSeason = (cloud: ReturnType<typeof memoryLeague>) => {
  const read = docToSeason(cloud.read(DOC_ID), DOC_ID);
  if (!read.ok) throw new Error(`unread: ${read.reason}`);
  return read.season;
};

describe("a window another has the turn from, kept live", () => {
  it("keeps what another device sent when the season next opens where it may be written", async () => {
    const cloud = memoryLeague();
    // The window with the turn makes the season's document, and is closed.
    const writer = openWindow(cloud);
    await settled();
    writer.sync.stop();
    await settled();
    // A second window, read-only, hears another device add a game and score the first.
    readOnly();
    const watcher = openWindow(cloud);
    await settled();
    cloud.edit(DOC_ID, [
      { path: ["matchups", "g3"], value: game("g3", "A", "C") },
      { path: ["order"], value: ["g1", "g2", "g3"] },
      { path: ["logs", "g1"], value: score("3", "1") },
    ]);
    await settled();
    expect(ids(watcher.seasons.get().season.matchups)).toEqual(["g1", "g2", "g3"]);
    // Storage took none of it: the window may not write League.
    expect(ids(loadMatchups())).toEqual(["g1", "g2"]);
    watcher.sync.stop();
    await settled();
    // The season opens again where it may be written: Use here, a reload, a new window.
    adoptTabTurn(null);
    const next = openWindow(cloud);
    await settled();
    await vi.advanceTimersByTimeAsync(5_000);
    await settled();
    expect(ids(cloudSeason(cloud).matchups)).toEqual(["g1", "g2", "g3"]);
    expect(cloudSeason(cloud).logs).toEqual({ g1: score("3", "1") });
    expect(ids(next.seasons.get().season.matchups)).toEqual(["g1", "g2", "g3"]);
    expect(loadLogs()).toEqual({ g1: score("3", "1") });
    next.sync.stop();
  });
});

describe("a base storage has no room for", () => {
  it("leaves no older base behind, so another device's correction since stands", async () => {
    const cloud = memoryLeague();
    const here = openWindow(cloud);
    await settled();
    // A score sent from here: storage takes the season, but not the base, a whole document.
    full = (key) => key.startsWith("lf_league_base_");
    here.seasons.setSeason((prev) => ({ ...prev, logs: { g1: score("3", "1") } }));
    here.sync.settle();
    await settled();
    expect(cloudSeason(cloud).logs).toEqual({ g1: score("3", "1") });
    expect(loadLogs()).toEqual({ g1: score("3", "1") });
    full = () => false;
    here.sync.stop();
    await settled();
    // Another device corrects the score while this one is closed.
    cloud.edit(DOC_ID, [{ path: ["logs", "g1"], value: score("4", "1") }]);
    const again = openWindow(cloud);
    await settled();
    await vi.advanceTimersByTimeAsync(5_000);
    await settled();
    expect(cloudSeason(cloud).logs).toEqual({ g1: score("4", "1") });
    expect(again.seasons.get().season.logs).toEqual({ g1: score("4", "1") });
    again.sync.stop();
  });
});
