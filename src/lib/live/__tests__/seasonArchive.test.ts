import { describe, expect, it } from "vitest";
import { archiveGroups, isArchived } from "../../seasonArchive";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import { sendArchiveMark } from "../archiveSeason";
import type { BaseKeeper, Known } from "../leagueBase";
import { LEAGUE_DOC_SCHEMA, seasonDocId, seasonToDoc } from "../leagueDocs";
import { meetSeasons, type LocalSeasons } from "../leagueSeasons";
import { memoryLeague } from "./memoryLeague";

/*
 * A season put away once it is over: kept apart in the lists, read-only, and the same on every
 * device the owner uses. The mark is a setting (`Settings.archived`), so it reaches the cloud as a
 * setting does; these are the two ways it travels that no setting needed before: sent for a season
 * that is not open, and carried down at the visit's meeting to a season this device holds.
 */

const season = (id: string, archived?: boolean): SeasonSnapshot => ({
  id,
  name: `Season ${id}`,
  createdAt: "2027-01-02T00:00:00.000Z",
  teams: [
    { id: "A", name: "Club A" },
    { id: "B", name: "Club B" },
  ],
  matchups: [{ id: "g1", date: "4/3", away: "A", home: "B" }],
  logs: {},
  bracketLogs: {},
  settings: {
    ...DEFAULT_SETTINGS,
    seasonLabel: `Season ${id}`,
    ...(archived === undefined ? {} : { archived }),
  },
});

const localOf = (seasons: SeasonSnapshot[]) => {
  const held = [...seasons];
  const local: LocalSeasons = {
    list: () => held.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
    read: (id) => held.find((one) => one.id === id) ?? null,
    add: (more) => {
      held.push(...more);
      return true;
    },
    markArchived: (id, archived) => {
      const at = held.findIndex((one) => one.id === id);
      const found = held[at];
      if (!found) return false;
      held[at] = { ...found, settings: { ...found.settings, archived } };
      return true;
    },
  };
  return { local, held: () => held };
};

const basesOf = (known: Record<string, Known> = {}) => {
  const held = new Map<string, Known>(
    Object.entries(known).map(([id, one]) => [seasonDocId(id), one])
  );
  const bases: BaseKeeper = {
    read: (docId) => held.get(docId) ?? null,
    write: (docId, one) => held.set(docId, one),
    remove: (docId) => held.delete(docId),
  };
  return { bases, held };
};

const archivedHere = (held: SeasonSnapshot[], id: string) =>
  isArchived(held.find((one) => one.id === id)?.settings ?? DEFAULT_SETTINGS);

describe("an archived season", () => {
  it("reads as archived only when its setting says so", () => {
    expect(isArchived(DEFAULT_SETTINGS)).toBe(false);
    expect(isArchived({ ...DEFAULT_SETTINGS, archived: false })).toBe(false);
    expect(isArchived({ ...DEFAULT_SETTINGS, archived: true })).toBe(true);
  });

  it("is listed after the seasons in use, each group in the list's own order", () => {
    const list = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    expect(archiveGroups(list, new Set(["c", "a"]))).toEqual({
      inUse: [{ id: "b" }, { id: "d" }],
      archived: [{ id: "a" }, { id: "c" }],
    });
  });
});

describe("the mark sent for a season that is not open", () => {
  it("writes the one setting, raising an older layout and stepping the write number", async () => {
    const cloud = memoryLeague();
    const docId = seasonDocId("fall");
    cloud.put(docId, { ...seasonToDoc(season("fall"), 4), schema: LEAGUE_DOC_SCHEMA - 1 });
    const { bases, held } = basesOf({ fall: { season: season("fall"), rev: 4, landed: [] } });

    const sent = await sendArchiveMark({
      store: cloud.store,
      bases,
      season: season("fall", true),
      archived: true,
      now: "2027-06-01T12:00:00.000Z",
    });

    expect(sent).toBe("sent");
    const doc = cloud.read(docId);
    expect(doc?.rev).toBe(5);
    expect(doc?.schema).toBe(LEAGUE_DOC_SCHEMA);
    expect(doc?.updatedAt).toBe("2027-06-01T12:00:00.000Z");
    expect((doc?.settings as Record<string, unknown>).archived).toBe(true);
    // Nothing else of the season is written: its games are as the cloud had them.
    expect(doc?.matchups).toEqual(seasonToDoc(season("fall"), 4).matchups);
    // Kept as this device's own write, so the meeting and the season's next opening never take it
    // for another device's change.
    expect(held.get(docId)?.landed).toEqual([
      {
        rev: 5,
        changes: [
          { path: ["settings", "archived"], value: true },
          { path: ["schema"], value: LEAGUE_DOC_SCHEMA },
          { path: ["updatedAt"], value: "2027-06-01T12:00:00.000Z" },
          { path: ["rev"], value: 5 },
        ],
      },
    ]);
  });

  it("writes nothing when the cloud's season already says so", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall", true), 4));
    const before = cloud.counts.writes;
    const sent = await sendArchiveMark({
      store: cloud.store,
      bases: basesOf().bases,
      season: season("fall", true),
      archived: true,
      now: "2027-06-01T12:00:00.000Z",
    });
    expect(sent).toBe("none");
    expect(cloud.counts.writes).toBe(before);
  });

  it("makes no season the cloud does not hold, and writes none made at another moment", async () => {
    const cloud = memoryLeague();
    expect(
      await sendArchiveMark({
        store: cloud.store,
        bases: basesOf().bases,
        season: season("fall", true),
        archived: true,
        now: "2027-06-01T12:00:00.000Z",
      })
    ).toBe("absent");
    expect(cloud.read(seasonDocId("fall"))).toBeUndefined();

    cloud.put(seasonDocId("fall"), {
      ...seasonToDoc(season("fall"), 2),
      createdAt: "2027-03-09T00:00:00.000Z",
    });
    expect(
      await sendArchiveMark({
        store: cloud.store,
        bases: basesOf().bases,
        season: season("fall", true),
        archived: true,
        now: "2027-06-01T12:00:00.000Z",
      })
    ).toBe("apart");
    expect((cloud.read(seasonDocId("fall"))?.settings as Record<string, unknown>).archived).toBe(
      undefined
    );
  });
});

describe("the mark carried down at the visit's meeting", () => {
  const meet = (
    cloud: ReturnType<typeof memoryLeague>,
    local: LocalSeasons,
    bases: BaseKeeper,
    openId = "spring"
  ) => meetSeasons({ store: cloud.store, local, bases, openId: () => openId });

  it("archives a season held here that another device archived", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall", true), 6));
    const { local, held } = localOf([season("spring"), season("fall")]);
    const { bases } = basesOf({ fall: { season: season("fall"), rev: 5, landed: [] } });

    const met = await meet(cloud, local, bases);

    expect(met.archived).toEqual(["fall"]);
    expect(archivedHere(held(), "fall")).toBe(true);
  });

  it("and brings one back that another device unarchived", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall", false), 6));
    const { local, held } = localOf([season("spring"), season("fall", true)]);
    const { bases } = basesOf({ fall: { season: season("fall", true), rev: 5, landed: [] } });

    const met = await meet(cloud, local, bases);

    expect(met.archived).toEqual(["fall"]);
    expect(archivedHere(held(), "fall")).toBe(false);
  });

  it("keeps a mark changed here since this device last took the season in, and sends it", async () => {
    // Archived here while offline, so its own send did not go.
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall"), 6));
    const { local, held } = localOf([season("spring"), season("fall", true)]);
    const { bases } = basesOf({ fall: { season: season("fall"), rev: 6, landed: [] } });

    const met = await meet(cloud, local, bases);

    expect(met.archived).toEqual([]);
    expect(met.archiveSent).toEqual(["fall"]);
    expect(archivedHere(held(), "fall")).toBe(true);
    const doc = cloud.read(seasonDocId("fall"));
    expect((doc?.settings as Record<string, unknown>).archived).toBe(true);
    expect(doc?.rev).toBe(7);
  });

  it("sends nothing and changes nothing where the cloud already agrees", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall", true), 6));
    const before = cloud.counts.writes;
    const { local, held } = localOf([season("spring"), season("fall", true)]);
    const { bases } = basesOf({ fall: { season: season("fall"), rev: 5, landed: [] } });

    const met = await meet(cloud, local, bases);

    expect(met.archived).toEqual([]);
    expect(met.archiveSent).toEqual([]);
    expect(cloud.counts.writes).toBe(before);
    expect(archivedHere(held(), "fall")).toBe(true);
  });

  it("reads this device's own landed write as its own, and another's after it as news", async () => {
    // Archived here and sent (write 6); another device then brought it back (write 7).
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall", false), 7));
    const { local, held } = localOf([season("spring"), season("fall", true)]);
    const { bases } = basesOf({
      fall: {
        season: season("fall"),
        rev: 5,
        landed: [{ rev: 6, changes: [{ path: ["settings", "archived"], value: true }] }],
      },
    });

    await meet(cloud, local, bases);

    expect(archivedHere(held(), "fall")).toBe(false);
  });

  it("takes the cloud's mark for a season held with no base of its own", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall", true), 3));
    const { local, held } = localOf([season("spring"), season("fall")]);

    await meet(cloud, local, basesOf().bases);

    expect(archivedHere(held(), "fall")).toBe(true);
  });

  it("leaves alone the open season, which the live store keeps, and one made at another moment", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("spring"), seasonToDoc(season("spring", true), 3));
    cloud.put(seasonDocId("fall"), {
      ...seasonToDoc(season("fall", true), 3),
      createdAt: "2027-03-09T00:00:00.000Z",
    });
    const { local, held } = localOf([season("spring"), season("fall")]);

    const met = await meet(cloud, local, basesOf().bases);

    expect(met.archived).toEqual([]);
    expect(archivedHere(held(), "spring")).toBe(false);
    expect(archivedHere(held(), "fall")).toBe(false);
  });
});
