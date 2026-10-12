import { describe, expect, it } from "vitest";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import type { BaseKeeper, Known } from "../leagueBase";
import { docToSeason, LEAGUE_DOC_SCHEMA, seasonDocId, seasonToDoc } from "../leagueDocs";
import { meetSeasons, type LocalSeasons } from "../leagueSeasons";
import { memoryLeague } from "./memoryLeague";

const season = (id: string, name = `Season ${id}`): SeasonSnapshot => ({
  id,
  name,
  createdAt: `2027-01-0${id.length}T00:00:00.000Z`,
  teams: [
    { id: "A", name: "Club A" },
    { id: "B", name: "Club B" },
  ],
  matchups: [{ id: "g1", date: "4/3", away: "A", home: "B" }],
  logs: {},
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS, seasonLabel: name },
});

const localOf = (seasons: SeasonSnapshot[]): LocalSeasons & { held: SeasonSnapshot[] } => {
  const held = [...seasons];
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

const basesOf = (ids: string[] = []): BaseKeeper & { held: Map<string, Known> } => {
  const held = new Map<string, Known>(
    ids.map((id) => [seasonDocId(id), { season: season(id), rev: 3, landed: [] }])
  );
  return {
    held,
    read: (docId) => held.get(docId) ?? null,
    write: (docId, known) => held.set(docId, known),
    remove: (docId) => held.delete(docId),
  };
};

describe("this device's seasons met with the cloud's", () => {
  it("brings down a season made on another device, whole", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("Fall 2026"), seasonToDoc(season("Fall 2026")));
    const local = localOf([season("spring")]);
    const met = await meetSeasons({
      store: cloud.store,
      local,
      bases: basesOf(),
      openId: () => "spring",
    });
    expect(met.added).toEqual(["Fall 2026"]);
    expect(local.held.map((one) => one.id)).toEqual(["spring", "Fall 2026"]);
    expect(local.held[1]?.matchups).toEqual(season("x").matchups);
  });

  it("sends up a season only this device holds, and keeps its base", async () => {
    const cloud = memoryLeague();
    const bases = basesOf();
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), season("summer")]),
      bases,
      openId: () => "spring",
    });
    expect(met.sent).toEqual(["summer"]);
    const read = docToSeason(cloud.read(seasonDocId("summer")), seasonDocId("summer"));
    expect(read.ok && read.season.name).toBe("Season summer");
    expect(read.ok && read.rev).toBe(1);
    expect(bases.held.get(seasonDocId("summer"))).toEqual({
      season: season("summer"),
      rev: 1,
      landed: [],
    });
  });

  it("brings a season down with its base, so a deletion elsewhere later is a deletion", async () => {
    const cloud = memoryLeague();
    const fall = season("fall");
    cloud.put(seasonDocId("fall"), seasonToDoc(fall, 4));
    const local = localOf([season("spring")]);
    const bases = basesOf();
    const meet = () => meetSeasons({ store: cloud.store, local, bases, openId: () => "spring" });
    await meet();
    expect(bases.held.get(seasonDocId("fall"))).toEqual({ season: fall, rev: 4, landed: [] });
    cloud.remove(seasonDocId("fall"));
    const met = await meet();
    expect(met.gone).toEqual(["fall"]);
    expect(met.sent).toEqual([]);
    expect(cloud.read(seasonDocId("fall"))).toBeUndefined();
  });

  it("keeps no base for a season this device could not add to its list", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall")));
    const bases = basesOf();
    const met = await meetSeasons({
      store: cloud.store,
      local: { ...localOf([season("spring")]), add: () => false },
      bases,
      openId: () => "spring",
    });
    expect(met.added).toEqual([]);
    expect(bases.held.size).toBe(0);
  });

  it("sends up a season made since under a deleted season's id, as a season of its own", async () => {
    const cloud = memoryLeague();
    const bases = basesOf(["old"]);
    const remade = { ...season("old", "Old again"), createdAt: "2027-03-01T00:00:00.000Z" };
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), remade]),
      bases,
      openId: () => "spring",
    });
    expect(met.gone).toEqual([]);
    expect(met.sent).toEqual(["old"]);
    const read = docToSeason(cloud.read(seasonDocId("old")), seasonDocId("old"));
    expect(read.ok && read.season.name).toBe("Old again");
    expect(bases.held.get(seasonDocId("old"))?.season.createdAt).toBe(remade.createdAt);
  });

  it("leaves the season on screen to the live store", async () => {
    const cloud = memoryLeague();
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring")]),
      bases: basesOf(),
      openId: () => "spring",
    });
    expect(met.sent).toEqual([]);
    expect(cloud.read(seasonDocId("spring"))).toBeUndefined();
  });

  it("never sends back a season deleted on another device", async () => {
    const cloud = memoryLeague();
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), season("old")]),
      bases: basesOf(["old"]),
      openId: () => "spring",
    });
    expect(met.gone).toEqual(["old"]);
    expect(cloud.read(seasonDocId("old"))).toBeUndefined();
  });

  it("never sends back a deleted season it met with no creation time of its own", async () => {
    const cloud = memoryLeague();
    const bases = basesOf();
    // A season from before creation times were kept, met in the cloud and deleted there since.
    bases.write(seasonDocId("old"), {
      season: { ...season("old"), createdAt: "" },
      rev: 2,
      landed: [],
    });
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), season("old")]),
      bases,
      openId: () => "spring",
    });
    expect(met.gone).toEqual(["old"]);
    expect(cloud.read(seasonDocId("old"))).toBeUndefined();
  });

  it("brings down no season a later version of the app wrote", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("next"), {
      ...seasonToDoc(season("next")),
      schema: LEAGUE_DOC_SCHEMA + 1,
    });
    const local = localOf([season("spring")]);
    const met = await meetSeasons({
      store: cloud.store,
      local,
      bases: basesOf(),
      openId: () => "spring",
    });
    expect(met.unread).toEqual(["next"]);
    expect(local.held.map((one) => one.id)).toEqual(["spring"]);
  });
});

/*
 * A device meeting the cloud's seasons for the first time (1.6e), holding them as the cloud copy
 * last gave them: a season the cloud holds too takes the copy's as its base, so the open season's
 * first meeting is three-way rather than everything either side holds.
 */
describe("a first meeting, from the seasons the copy gave", () => {
  /** The copy's season `id` with game `g2` in it, which the cloud may have deleted since. */
  const agreedOf = (id: string): SeasonSnapshot => ({
    ...season(id),
    matchups: [...season(id).matchups, { id: "g2", date: "4/4", away: "B", home: "A" }],
  });

  it("takes the copy's season as the base of one the cloud holds too, before any write of its", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall"), 4));
    const bases = basesOf();
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), agreedOf("fall")]),
      bases,
      openId: () => "spring",
      agreed: [agreedOf("fall"), agreedOf("spring")],
    });
    expect(met.agreed).toEqual(["fall"]);
    expect(bases.held.get(seasonDocId("fall"))).toEqual({
      season: agreedOf("fall"),
      rev: 0,
      landed: [],
    });
    // The season on screen too, when the cloud holds it.
    cloud.put(seasonDocId("spring"), seasonToDoc(season("spring"), 2));
    const again = basesOf();
    await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring")]),
      bases: again,
      openId: () => "spring",
      agreed: [agreedOf("spring")],
    });
    expect(again.held.get(seasonDocId("spring"))?.rev).toBe(0);
  });

  it("takes none where a meeting is not the first, or the season has a base of its own", async () => {
    const cloud = memoryLeague();
    cloud.put(seasonDocId("fall"), seasonToDoc(season("fall"), 4));
    cloud.put(seasonDocId("winter"), seasonToDoc(season("winter"), 4));
    const bases = basesOf(["winter"]);
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), season("fall"), season("winter")]),
      bases,
      openId: () => "spring",
    });
    expect(met.agreed).toEqual([]);
    expect(bases.held.has(seasonDocId("fall"))).toBe(false);
    const first = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), season("fall"), season("winter")]),
      bases,
      openId: () => "spring",
      agreed: [agreedOf("winter")],
    });
    expect(first.agreed).toEqual([]);
    expect(bases.held.get(seasonDocId("winter"))?.rev).toBe(3);
  });

  it("sends up a season the cloud lacks, and takes no base for one made at another moment", async () => {
    const cloud = memoryLeague();
    const remade = { ...season("fall"), createdAt: "2027-03-01T00:00:00.000Z" };
    cloud.put(seasonDocId("fall"), seasonToDoc(remade, 4));
    const bases = basesOf();
    const met = await meetSeasons({
      store: cloud.store,
      local: localOf([season("spring"), remade, agreedOf("summer")]),
      bases,
      openId: () => "spring",
      agreed: [agreedOf("fall"), agreedOf("summer")],
    });
    // The copy's fall is another season than the one under its id here and in the cloud.
    expect(met.agreed).toEqual([]);
    expect(bases.held.has(seasonDocId("fall"))).toBe(false);
    // A season the cloud lacks may never have reached it: sent, rather than taken as deleted.
    expect(met.sent).toEqual(["summer"]);
    expect(bases.held.get(seasonDocId("summer"))?.rev).toBe(1);
  });

  describe("long after another device went live (1.6e review)", () => {
    // Every device went live with fall and winter, and winter was then deleted live. No device
    // kept live writes League to the copy, so the copy still holds winter as it was.
    const afterWinterDeleted = () => {
      const cloud = memoryLeague();
      cloud.put(seasonDocId("fall"), seasonToDoc(agreedOf("fall"), 6));
      return cloud;
    };

    it("does not send back a season deleted live, from a copy no device has written since", async () => {
      const cloud = afterWinterDeleted();
      // A device wiped by Delete everything, or new, takes the copy's League in, and meets.
      const bases = basesOf();
      const met = await meetSeasons({
        store: cloud.store,
        local: localOf([agreedOf("spring"), agreedOf("fall"), agreedOf("winter")]),
        bases,
        openId: () => "spring",
        agreed: [agreedOf("fall"), agreedOf("winter")],
      });
      expect(met.sent).toEqual([]);
      expect(cloud.read(seasonDocId("winter"))).toBeUndefined();
      // Met as one deleted elsewhere, with the copy's as its base, so never sent from here.
      expect(met.gone).toEqual(["winter"]);
      expect(bases.held.get(seasonDocId("winter"))).toEqual({
        season: agreedOf("winter"),
        rev: 0,
        landed: [],
      });
    });

    it("sends one changed here since the copy, which is better sent back than lost", async () => {
      const cloud = afterWinterDeleted();
      const changed = { ...agreedOf("winter"), name: "Winter, renamed here" };
      const met = await meetSeasons({
        store: cloud.store,
        local: localOf([agreedOf("spring"), agreedOf("fall"), changed]),
        bases: basesOf(),
        openId: () => "spring",
        agreed: [agreedOf("fall"), agreedOf("winter")],
      });
      expect(met.sent).toEqual(["winter"]);
    });

    it("sends one the cloud lacks while it holds only seasons this device sent", async () => {
      // This device's own first meeting, cut short after sending fall: winter never got there.
      const cloud = afterWinterDeleted();
      const bases = basesOf();
      bases.write(seasonDocId("fall"), { season: agreedOf("fall"), rev: 1, landed: [] });
      const met = await meetSeasons({
        store: cloud.store,
        local: localOf([agreedOf("spring"), agreedOf("fall"), agreedOf("winter")]),
        bases,
        openId: () => "spring",
        agreed: [agreedOf("fall"), agreedOf("winter")],
      });
      expect(met.sent).toEqual(["winter"]);
    });

    it("counts a season of the copy's another device sent that this one no longer holds", async () => {
      const cloud = afterWinterDeleted();
      const met = await meetSeasons({
        store: cloud.store,
        local: localOf([agreedOf("spring"), agreedOf("winter")]),
        bases: basesOf(),
        openId: () => "spring",
        agreed: [agreedOf("fall"), agreedOf("winter")],
      });
      expect(met.added).toEqual(["fall"]);
      expect(met.sent).toEqual([]);
      expect(met.gone).toEqual(["winter"]);
    });

    it("counts one this device brought down at a meeting cut short and no longer holds", async () => {
      const cloud = afterWinterDeleted();
      // Fall came down with its base before the meeting was cut short, and was deleted here since:
      // its base is the document's, not one this device sent.
      const bases = basesOf();
      bases.write(seasonDocId("fall"), { season: agreedOf("fall"), rev: 6, landed: [] });
      const met = await meetSeasons({
        store: cloud.store,
        local: localOf([agreedOf("spring"), agreedOf("winter")]),
        bases,
        openId: () => "spring",
        agreed: [agreedOf("fall"), agreedOf("winter")],
      });
      expect(met.sent).toEqual([]);
      expect(met.gone).toEqual(["winter"]);
    });

    it("leaves the open season to the live store, with the base that says it was deleted", async () => {
      const cloud = afterWinterDeleted();
      const bases = basesOf();
      await meetSeasons({
        store: cloud.store,
        local: localOf([agreedOf("fall"), agreedOf("winter")]),
        bases,
        openId: () => "winter",
        agreed: [agreedOf("fall"), agreedOf("winter")],
      });
      expect(cloud.read(seasonDocId("winter"))).toBeUndefined();
      expect(bases.held.get(seasonDocId("winter"))?.rev).toBe(0);
    });
  });
});
