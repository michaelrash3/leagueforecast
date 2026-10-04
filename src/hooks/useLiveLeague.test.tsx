import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BaseKeeper } from "../lib/live/leagueBase";
import { docToSeason, seasonDocId, seasonToDoc } from "../lib/live/leagueDocs";
import type { LocalSeasons } from "../lib/live/leagueSeasons";
import { createSeasonStore, type SeasonState } from "../lib/seasonStore";
import type { SeasonSnapshot } from "../lib/storage";
import { DEFAULT_SETTINGS, type GameLog } from "../lib/types";
import { memoryLeague, settled } from "../lib/live/__tests__/memoryLeague";
import { isTyping, useLiveLeague, type LiveLeagueOptions } from "./useLiveLeague";

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

const memoryBases = (): BaseKeeper => {
  const held = new Map<string, SeasonSnapshot>();
  return { read: (id) => held.get(id) ?? null, write: (id, one) => held.set(id, one) };
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
});

describe("a field being typed in", () => {
  it("is a text box, a select or a text area, and not a button or a box to tick", () => {
    const of = (html: string) => {
      document.body.innerHTML = html;
      return document.body.firstElementChild;
    };
    expect(isTyping(of('<input type="text">'))).toBe(true);
    expect(isTyping(of('<input type="number">'))).toBe(true);
    expect(isTyping(of("<select></select>"))).toBe(true);
    expect(isTyping(of("<textarea></textarea>"))).toBe(true);
    expect(isTyping(of('<input type="checkbox">'))).toBe(false);
    expect(isTyping(of("<button></button>"))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
