import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseKeeper, Known } from "../lib/live/leagueBase";
import { docToSeason, seasonDocId, seasonToDoc } from "../lib/live/leagueDocs";
import type { LocalSeasons } from "../lib/live/leagueSeasons";
import { createSeasonStore, type SeasonState } from "../lib/seasonStore";
import type { SeasonSnapshot } from "../lib/storage";
import { DEFAULT_SETTINGS, type GameLog } from "../lib/types";
import { memoryLeague, settled } from "../lib/live/__tests__/memoryLeague";
import { loadCloudState, saveCloudState } from "../lib/cloud/cloudState";
import { leagueMetAs } from "../lib/preferences";
import {
  deviceFirstMeeting,
  isTyping,
  useLiveLeague,
  type FirstMeeting,
  type LiveLeagueOptions,
} from "./useLiveLeague";

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

const PARTS: SeasonState = {
  teams: [
    { id: "A", name: "Club A" },
    { id: "B", name: "Club B" },
  ],
  matchups: [{ id: "g1", date: "4/3", away: "A", home: "B" }],
  logs: {},
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS, seasonLabel: "Spring" },
};
const ENTRY = { id: "spring", name: "Spring", createdAt: "2027-02-01T00:00:00.000Z" };

const memoryBases = (): BaseKeeper & { held: Map<string, Known> } => {
  const held = new Map<string, Known>();
  return {
    held,
    read: (id) => held.get(id) ?? null,
    write: (id, known) => held.set(id, known),
    remove: (id) => held.delete(id),
  };
};

const localOf = (extra: SeasonSnapshot[] = []): LocalSeasons & { held: SeasonSnapshot[] } => {
  const held: SeasonSnapshot[] = [{ ...ENTRY, ...PARTS }, ...extra];
  return {
    held,
    list: () => held.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    read: (id) => held.find((one) => one.id === id) ?? null,
    add: (more) => {
      held.push(...more);
      return true;
    },
  };
};

const mount = (over: Partial<LiveLeagueOptions> = {}) => {
  const cloud = memoryLeague();
  const seasons = createSeasonStore({ id: "spring", season: PARTS });
  const added: number[] = [];
  const options: LiveLeagueOptions = {
    enabled: true,
    seasons,
    entryOf: () => ENTRY,
    entryKey: 0,
    local: localOf(),
    onSeasonsAdded: () => added.push(1),
    persist: () => {},
    adopt: () => {},
    open: async () => cloud.store,
    bases: memoryBases(),
    ...over,
  };
  const view = renderHook((props: LiveLeagueOptions) => useLiveLeague(props), {
    initialProps: options,
  });
  return { cloud, seasons, added, options, ...view };
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("League kept live on the page", () => {
  it("waits for the cloud's version before anything may be edited, then is live", async () => {
    const { result } = mount();
    expect(result.current.state.kind).toBe("connecting");
    await act(settled);
    expect(result.current.state.kind).toBe("live");
  });

  it("is off, and editable, when not turned on", async () => {
    const { result, cloud } = mount({ enabled: false });
    await act(settled);
    expect(result.current.state.kind).toBe("off");
    expect(cloud.counts.transactions).toBe(0);
  });

  it("sends a change as soon as the page lets go of the field", async () => {
    const { cloud, seasons } = mount();
    await act(settled);
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    act(() => seasons.setSeason((prev) => ({ ...prev, logs: { g1: score("3", "2") } })));
    await act(async () => {
      input.blur();
      await new Promise((done) => setTimeout(done, 5));
      await settled();
    });
    const read = docToSeason(cloud.read(seasonDocId("spring")), seasonDocId("spring"));
    expect(read.ok && read.season.logs).toEqual({ g1: score("3", "2") });
  });

  it("brings in seasons made on other devices once a visit, and says so", async () => {
    const cloud = memoryLeague();
    const fall = { ...ENTRY, id: "fall", name: "Fall", ...PARTS };
    cloud.put(seasonDocId("fall"), seasonToDoc(fall));
    const local = localOf();
    const { added } = mount({ open: async () => cloud.store, local });
    await act(settled);
    expect(local.held.map((one) => one.id)).toEqual(["spring", "fall"]);
    expect(added).toEqual([1]);
  });

  it("says when it may not open the seasons at all", async () => {
    const { result } = mount({ open: async () => null });
    await act(settled);
    expect(result.current.state.kind).toBe("refused");
  });

  it("stops when turned off, and starts afresh when turned on", async () => {
    const { result, rerender, options, cloud } = mount();
    await act(settled);
    rerender({ ...options, enabled: false });
    expect(result.current.state.kind).toBe("off");
    expect(await result.current.removeSeason("spring")).toBe(false);
    rerender({ ...options, enabled: true });
    expect(result.current.state.kind).toBe("connecting");
    await act(settled);
    expect(result.current.state.kind).toBe("live");
    expect(await result.current.removeSeason("spring")).toBe(true);
    expect(cloud.read(seasonDocId("spring"))).toBeUndefined();
  });

  it("forgets a deleted season's base, so a season made since under its id is not taken for it", async () => {
    const bases = memoryBases();
    const { result } = mount({ bases });
    await act(settled);
    expect(bases.held.has(seasonDocId("spring"))).toBe(true);
    expect(await result.current.removeSeason("spring")).toBe(true);
    expect(bases.held.has(seasonDocId("spring"))).toBe(false);
  });

  it("leaves in the cloud another season of the same id, made at another moment", async () => {
    const cloud = memoryLeague();
    const theirs = { ...ENTRY, createdAt: "2026-05-01T00:00:00.000Z", ...PARTS };
    cloud.put(seasonDocId("spring"), seasonToDoc(theirs));
    const { result } = mount({ open: async () => cloud.store });
    await act(settled);
    expect(result.current.state.kind).toBe("apart");
    expect(await result.current.removeSeason("spring")).toBe(true);
    expect(cloud.read(seasonDocId("spring"))).toBeDefined();
  });

  it("gives the season the cloud's creation time once it has taken the cloud's season in", async () => {
    const cloud = memoryLeague();
    const theirs = { ...ENTRY, createdAt: "2026-05-01T00:00:00.000Z", ...PARTS };
    cloud.put(seasonDocId("spring"), seasonToDoc(theirs));
    const adopted: [string, string][] = [];
    const seasons = createSeasonStore({
      id: "spring",
      season: { ...PARTS, teams: [], matchups: [] },
    });
    const { result } = mount({
      open: async () => cloud.store,
      seasons,
      adopt: (id, createdAt) => adopted.push([id, createdAt]),
    });
    await act(settled);
    expect(result.current.state.kind).toBe("live");
    expect(adopted).toEqual([["spring", theirs.createdAt]]);
  });

  it("keeps the base when the delete does not reach the cloud", async () => {
    const bases = memoryBases();
    const { result, cloud } = mount({ bases });
    await act(settled);
    cloud.offline();
    await expect(result.current.removeSeason("spring")).rejects.toThrow();
    expect(bases.held.has(seasonDocId("spring"))).toBe(true);
  });
});

/*
 * This device's first meeting with the cloud's seasons (1.6e): before the open season goes live,
 * with the copy's seasons as the bases of the ones both hold, and noted once done.
 */
describe("a device's first meeting with the cloud's seasons", () => {
  // The season as the copy gave it, with a game the cloud has deleted since, live elsewhere.
  const AS_COPIED: SeasonState = {
    ...PARTS,
    matchups: [...PARTS.matchups, { id: "g2", date: "4/4", away: "B", home: "A" }],
  };
  const meeting = (due: boolean) => {
    const told = { agreed: 0, done: 0 };
    const first: FirstMeeting = {
      due: () => due,
      agreed: () => {
        told.agreed += 1;
        return [{ ...ENTRY, ...AS_COPIED }];
      },
      done: () => {
        told.done += 1;
      },
    };
    return { told, first };
  };
  const deletedSince = () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("spring"), seasonToDoc({ ...ENTRY, ...PARTS }, 3));
    return cloud;
  };

  it("meets first, from the copy's seasons, so a game deleted live since stays gone", async () => {
    const cloud = deletedSince();
    const { told, first } = meeting(true);
    const seasons = createSeasonStore({ id: "spring", season: AS_COPIED });
    const { result } = mount({ seasons, open: async () => cloud.store, firstMeeting: first });
    await act(settled);
    expect(result.current.state.kind).toBe("live");
    expect(seasons.get().season.matchups.map(({ id }) => id)).toEqual(["g1"]);
    expect(told).toEqual({ agreed: 1, done: 1 });
  });

  it("goes live at once on a device that met the cloud before, and notes nothing", async () => {
    const cloud = deletedSince();
    const { told, first } = meeting(false);
    const seasons = createSeasonStore({ id: "spring", season: AS_COPIED });
    const { result } = mount({ seasons, open: async () => cloud.store, firstMeeting: first });
    await act(settled);
    expect(result.current.state.kind).toBe("live");
    expect(told).toEqual({ agreed: 0, done: 0 });
    // Met before with no base here, the season keeps what either side holds.
    expect(seasons.get().season.matchups.map(({ id }) => id)).toContain("g2");
  });

  it("neither notes a first meeting nor goes live when turned off before it is done", async () => {
    const cloud = deletedSince();
    const { told, first } = meeting(true);
    let letList = (): void => undefined;
    const held = new Promise<void>((resolve) => (letList = resolve));
    const { result, rerender, options } = mount({
      open: async () => ({
        ...cloud.store,
        list: async () => {
          await held;
          return cloud.store.list();
        },
      }),
      firstMeeting: first,
    });
    await act(settled);
    rerender({ ...options, enabled: false });
    letList();
    await act(settled);
    expect(told.done).toBe(0);
    expect(result.current.state.kind).toBe("off");
  });

  it("leaves no sync listening once turned off before the first meeting is done (1.6e review)", async () => {
    // The page's state reads off whenever it is turned off, so the store is what can tell.
    for (const fails of [false, true]) {
      const cloud = deletedSince();
      const { first } = meeting(true);
      let letList = (): void => undefined;
      const held = new Promise<void>((resolve) => (letList = resolve));
      const { rerender, options, unmount } = mount({
        open: async () => ({
          ...cloud.store,
          list: async () => {
            await held;
            if (fails) throw new Error("offline");
            return cloud.store.list();
          },
        }),
        firstMeeting: first,
      });
      await act(settled);
      rerender({ ...options, enabled: false });
      letList();
      await act(settled);
      expect(cloud.listeners(seasonDocId("spring"))).toBe(0);
      unmount();
    }
  });

  it("tells the page of seasons brought down by a first meeting cut short (1.6e review)", async () => {
    const cloud = deletedSince();
    cloud.put(
      seasonDocId("fall"),
      seasonToDoc({ ...ENTRY, id: "fall", name: "Fall", ...PARTS }, 2)
    );
    const { first } = meeting(true);
    let letList = (): void => undefined;
    const held = new Promise<void>((resolve) => (letList = resolve));
    const { rerender, options, added } = mount({
      open: async () => ({
        ...cloud.store,
        list: async () => {
          await held;
          return cloud.store.list();
        },
      }),
      firstMeeting: first,
    });
    await act(settled);
    rerender({ ...options, enabled: false });
    letList();
    await act(settled);
    // In storage, though the page no longer wanted League live: its list is read again.
    expect((options.local as ReturnType<typeof localOf>).held.map(({ id }) => id)).toContain(
      "fall"
    );
    expect(added.length).toBeGreaterThan(0);
  });

  it("is this device's own, as the account its cloud record is for", () => {
    window.localStorage.clear();
    saveCloudState({ ...loadCloudState(), enabled: true, uid: "member-uid" });
    expect(deviceFirstMeeting.due()).toBe(true);
    deviceFirstMeeting.done();
    expect(leagueMetAs()).toBe("member-uid");
    expect(deviceFirstMeeting.due()).toBe(false);
    // With no base kept from the copy, it agreed on no seasons.
    expect(deviceFirstMeeting.agreed()).toEqual([]);
    window.localStorage.clear();
  });

  it("goes live all the same when the first meeting's list will not come, and meets again next time", async () => {
    const cloud = deletedSince();
    const { told, first } = meeting(true);
    const { result } = mount({
      open: async () => ({ ...cloud.store, list: () => Promise.reject(new Error("offline")) }),
      firstMeeting: first,
    });
    await act(settled);
    expect(result.current.state.kind).toBe("live");
    expect(told.done).toBe(0);
  });
});

describe("a field being typed in", () => {
  it("is a text box or a text area, and not a select, a button or a box to tick", () => {
    const of = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };
    expect(isTyping(of('<input type="text">'))).toBe(true);
    expect(isTyping(of('<input type="number">'))).toBe(true);
    expect(isTyping(of("<select></select>"))).toBe(false);
    expect(isTyping(of("<textarea></textarea>"))).toBe(true);
    expect(isTyping(of('<input type="checkbox">'))).toBe(false);
    expect(isTyping(of("<button></button>"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
