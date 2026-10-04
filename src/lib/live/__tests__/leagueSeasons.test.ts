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
