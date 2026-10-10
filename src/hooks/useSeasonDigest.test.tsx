import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readSeen } from "../lib/preferences";
import type { RaceSeen } from "../lib/seasonDigest";
import { createSeasonStore, type SeasonState } from "../lib/seasonStore";
import { DEFAULT_SETTINGS, type GameLog } from "../lib/types";
import { useSeasonDigest } from "./useSeasonDigest";

/*
 * What changed since this device last looked, as the page meets it (2.6): its own edits taken as
 * seen, another device's as news until acknowledged, the last look kept per season across visits,
 * and the forecast that follows an edit made here not reported as news. Placeholder teams.
 */

const final = (away: string, home: string, isFinal = true): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal,
});

const season = (logs: Record<string, GameLog> = {}): SeasonState => ({
  teams: [
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
  ],
  matchups: [
    { id: "g1", date: "2026-05-02", away: "A", home: "B" },
    { id: "g2", date: "2026-05-09", away: "B", home: "A" },
  ],
  logs,
  bracketLogs: {},
  settings: DEFAULT_SETTINGS,
});

const race = (a: RaceSeen, b: RaceSeen) => ({ A: a, B: b });

type Props = { race: Record<string, RaceSeen> | null; heard?: boolean };

const mount = (
  seasonId: string,
  data: SeasonState,
  options: {
    race?: Record<string, RaceSeen> | null;
    followed?: string | null;
    heard?: boolean;
  } = {}
) => {
  const store = createSeasonStore({ id: seasonId, season: data });
  const view = renderHook(
    (props: Props) =>
      useSeasonDigest({
        store,
        race: props.race,
        followed: options.followed ?? null,
        oddsMove: 10,
        heard: props.heard ?? false,
      }),
    { initialProps: { race: options.race ?? null, heard: options.heard ?? false } as Props }
  );
  return { store, view };
};

const kinds = (changes: { kind: string }[]) => changes.map((change) => change.kind);

describe("useSeasonDigest", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts a season this device never looked at from the cloud's first word", () => {
    const { store, view } = mount("s1", season());
    act(() => store.apply(season({ g1: final("4", "2") })));
    expect(view.result.current.changes).toEqual([]);
    act(() => store.apply(season({ g1: final("4", "2"), g2: final("1", "3") })));
    expect(kinds(view.result.current.changes)).toEqual(["final"]);
  });

  it("takes this device's own edits as seen, and another device's as news until acknowledged", () => {
    const { store, view } = mount("s1", season());
    act(() => view.result.current.acknowledge());
    act(() => store.setSeason(season({ g1: final("4", "2") })));
    expect(view.result.current.changes).toEqual([]);
    act(() => store.apply(season({ g1: final("4", "2"), g2: final("1", "3") })));
    expect(kinds(view.result.current.changes)).toEqual(["final"]);
    act(() => view.result.current.acknowledge());
    expect(view.result.current.changes).toEqual([]);
  });

  it("keeps the last look on the device, so news that came while away is still news", () => {
    const first = mount("s1", season({ g1: final("4", "2") }));
    act(() => first.view.result.current.acknowledge());
    first.view.unmount();
    expect(readSeen("s1")?.games.g1?.final).toBe("4-2");

    // Opened again later: the cloud's version, with another device's scores, arrives.
    const later = mount("s1", season({ g1: final("4", "2") }));
    act(() => later.store.apply(season({ g1: final("5", "2"), g2: final("1", "3") })));
    expect(kinds(later.view.result.current.changes)).toEqual(["corrected", "final"]);
  });

  it("keeps the newest look of a season written twice", () => {
    const { store, view } = mount("s1", season());
    act(() => view.result.current.acknowledge());
    act(() => store.apply(season({ g1: final("4", "2") })));
    act(() => view.result.current.acknowledge());
    expect(readSeen("s1")?.games.g1?.final).toBe("4-2");
  });

  it("does not make the cloud's first word news when the page reloads before it", () => {
    mount("s1", season()).view.unmount();
    const again = mount("s1", season());
    act(() => again.store.apply(season({ g1: final("4", "2") })));
    expect(again.view.result.current.changes).toEqual([]);
  });

  it("starts looking once the cloud is heard, even when it brought nothing this device lacked", () => {
    const { store, view } = mount("s1", season());
    act(() => store.setSeason(season({ g1: final("4", "2") })));
    expect(readSeen("s1")).toBeNull();
    view.rerender({ race: null, heard: true });
    expect(readSeen("s1")?.games.g1?.final).toBe("4-2");
    // So the first news to arrive is news, not taken for the cloud's first word.
    act(() => store.apply(season({ g1: final("4", "2"), g2: final("1", "3") })));
    expect(kinds(view.result.current.changes)).toEqual(["final"]);
  });

  it("keeps the look begun when the cloud was heard, so what comes while away is news", () => {
    mount("s1", season(), { heard: true }).view.unmount();
    const later = mount("s1", season());
    act(() => later.store.apply(season({ g1: final("4", "2") })));
    expect(kinds(later.view.result.current.changes)).toEqual(["final"]);
  });

  it("keeps the last looks of the twelve seasons opened most recently", () => {
    const clock = vi.spyOn(Date, "now");
    for (let at = 0; at < 13; at += 1) {
      clock.mockReturnValue(1_000 + at);
      const { view } = mount(`s${at}`, season());
      act(() => view.result.current.acknowledge());
      view.unmount();
    }
    clock.mockRestore();
    expect(readSeen("s0")).toBeNull();
    expect(readSeen("s1")).not.toBeNull();
    expect(readSeen("s12")).not.toBeNull();
  });

  it("brings each season's own last look when another is opened", () => {
    const first = mount("s1", season());
    act(() => first.view.result.current.acknowledge());
    act(() => first.store.open("s2", season({ g1: final("1", "0") })));
    // Never looked at on this device: nothing to report.
    expect(first.view.result.current.changes).toEqual([]);
    act(() => first.view.result.current.acknowledge());
    act(() => first.store.open("s1", season({ g2: final("2", "2") })));
    // Looked at empty; it has a final now.
    expect(kinds(first.view.result.current.changes)).toEqual(["final"]);
  });

  it("takes the same season opened afresh, from a file, as this device's own doing", () => {
    const { store, view } = mount("s1", season());
    act(() => view.result.current.acknowledge());
    act(() => store.open("s1", season({ g1: final("4", "2") })));
    expect(view.result.current.changes).toEqual([]);
  });

  describe("the race", () => {
    const start = race({ status: "Alive", gold: 50 }, { status: "Alive", gold: 50 });

    it("does not report the forecast that follows an edit made here", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() => store.setSeason((now) => ({ ...now, logs: { g1: final("4", "2") } })));
      view.rerender({ race: null });
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Alive", gold: 20 }),
      });
      expect(view.result.current.changes).toEqual([]);
    });

    it("reports the forecast that follows news from elsewhere", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() => store.apply(season({ g1: final("4", "2") })));
      view.rerender({ race: null });
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Alive", gold: 20 }),
      });
      expect(kinds(view.result.current.changes)).toEqual(["final", "clinched"]);
    });

    it("does not report the forecast that follows a setting changed here", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() => store.setSeason({ ...season(), settings: { ...DEFAULT_SETTINGS, goldCutoff: 1 } }));
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Eliminated", gold: 0 }),
      });
      expect(view.result.current.changes).toEqual([]);
    });

    it("reports the forecast that settles after news was acknowledged without it", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() => store.apply(season({ g1: final("4", "2") })));
      view.rerender({ race: null });
      act(() => view.result.current.acknowledge());
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Alive", gold: 20 }),
      });
      expect(kinds(view.result.current.changes)).toEqual(["clinched"]);
    });

    it("reports the forecast after an edit here when news from elsewhere is still unread", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() => store.apply(season({ g2: final("1", "3") })));
      act(() => store.setSeason(season({ g1: final("4", "2"), g2: final("1", "3") })));
      view.rerender({ race: race({ status: "Alive", gold: 75 }, { status: "Alive", gold: 25 }) });
      expect(kinds(view.result.current.changes)).toEqual(["final", "odds"]);
    });

    it("keeps the forecast that settles as the cloud is heard as where the race starts", () => {
      const { store, view } = mount("s1", season(), { followed: "A" });
      view.rerender({ race: start, heard: true });
      act(() => store.apply(season({ g1: final("4", "2") })));
      view.rerender({ race: null, heard: true });
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Alive", gold: 20 }),
        heard: true,
      });
      expect(kinds(view.result.current.changes)).toEqual(["final", "clinched"]);
    });

    it("owes nothing after the first forecast it takes as where the race starts", () => {
      const { store, view } = mount("s1", season(), { followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() => store.setSeason((now) => ({ ...now, logs: { g1: final("4", "2") } })));
      view.rerender({ race: start });
      act(() =>
        store.apply({ ...store.get().season, settings: { ...DEFAULT_SETTINGS, goldCutoff: 1 } })
      );
      view.rerender({ race: null });
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Eliminated", gold: 0 }),
      });
      expect(kinds(view.result.current.changes)).toEqual(["clinched", "eliminated"]);
    });

    it("takes the forecast after a team is linked to its club here as its own", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      act(() =>
        store.setSeason((now) => ({
          ...now,
          teams: [
            { id: "A", name: "Aces", scoutTeamId: "placeholder-club" },
            { id: "B", name: "Bears" },
          ],
        }))
      );
      view.rerender({ race: null });
      view.rerender({ race: race({ status: "Alive", gold: 75 }, { status: "Alive", gold: 25 }) });
      expect(view.result.current.changes).toEqual([]);
    });

    it("reports a forecast another device's setting moved after an edit here that moved nothing", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      act(() => view.result.current.acknowledge());
      // Runs typed into a game still being played: the forecast reads none of them.
      act(() => store.setSeason((now) => ({ ...now, logs: { g1: final("2", "1", false) } })));
      act(() => store.setSeason((now) => ({ ...now, logs: { g1: final("3", "1", false) } })));
      // Another device moves the cut line, and the odds follow it.
      act(() =>
        store.apply({
          ...store.get().season,
          settings: { ...DEFAULT_SETTINGS, goldCutoff: 1 },
        })
      );
      view.rerender({ race: null });
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Eliminated", gold: 0 }),
      });
      expect(kinds(view.result.current.changes)).toEqual(["clinched", "eliminated"]);
    });

    it("keeps the last look's race when news is acknowledged before the forecast settles", () => {
      const first = mount("s1", season(), { race: start, followed: "A" });
      act(() => first.view.result.current.acknowledge());
      first.view.unmount();
      // Opened again with another device's final already held here, the odds still worked out.
      const later = mount("s1", season({ g1: final("4", "2") }), { followed: "A" });
      expect(kinds(later.view.result.current.changes)).toEqual(["final"]);
      act(() => later.view.result.current.acknowledge());
      later.view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Alive", gold: 20 }),
      });
      expect(kinds(later.view.result.current.changes)).toEqual(["clinched"]);
    });

    it("takes the race from the forecast of the cloud's first word, not the one before it", () => {
      const decided = race({ status: "Clinched", gold: 100 }, { status: "Eliminated", gold: 0 });
      const both = season({ g1: final("4", "2"), g2: final("1", "3") });
      const { store, view } = mount("s1", season(), {
        race: race({ status: "Alive", gold: 55 }, { status: "Alive", gold: 45 }),
        followed: "A",
      });
      act(() => store.apply(both));
      view.rerender({ race: null });
      view.rerender({ race: decided });
      expect(view.result.current.changes).toEqual([]);
      view.unmount();
      // Nor on the next visit, from the look kept.
      const later = mount("s1", both, { race: decided, followed: "A" });
      expect(later.view.result.current.changes).toEqual([]);
    });

    it("keeps the race when the cloud's first word moved nothing the forecast reads", () => {
      const { store, view } = mount("s1", season(), { race: start, followed: "A" });
      // Runs another device typed into a game still being played: the same forecast.
      act(() => store.apply({ ...store.get().season, logs: { g1: final("2", "1", false) } }));
      act(() => store.apply({ ...store.get().season, logs: { g1: final("4", "2") } }));
      view.rerender({ race: null });
      view.rerender({
        race: race({ status: "Clinched", gold: 100 }, { status: "Alive", gold: 20 }),
      });
      expect(kinds(view.result.current.changes)).toEqual(["final", "clinched"]);
    });
  });
});
