import { describe, expect, it } from "vitest";
import type { SeasonSnapshot } from "../../storage";
import { DEFAULT_SETTINGS } from "../../types";
import type { BaseKeeper } from "../leagueBase";
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

const basesOf = (ids: string[] = []): BaseKeeper & { held: Map<string, SeasonSnapshot> } => {
  const held = new Map<string, SeasonSnapshot>(ids.map((id) => [seasonDocId(id), season(id)]));
  return {
    held,
    read: (docId) => held.get(docId) ?? null,
    write: (docId, one) => held.set(docId, one),
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
    expect(bases.held.has(seasonDocId("summer"))).toBe(true);
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
