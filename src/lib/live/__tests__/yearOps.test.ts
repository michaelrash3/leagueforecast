import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { poolFixture } from "../../../../scripts/poolFixture";
import { memoryIo } from "../../cloud/cloudRunner";
import { poolSignature } from "../../gameChangerImport";
import { deleteSquadYear } from "../../deleteSquadYear";
import { ageGroupYear } from "../../teamRankings/seasons";
import { archiveSquadYear } from "../../teamRankingsArchive";
import {
  initTeamRankingsStore,
  loadAgeGroups,
  loadArchiveIndex,
  loadArchivedSeason,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutTeams,
  saveTidyStamp,
} from "../../teamRankingsStorage";
import { archivePreviewOf, deletePreviewOf } from "../../yearSummary";
import type { SeasonReader } from "../allKnown";
import { readCloudLeague } from "../cloudLeague";
import { poolParts } from "../commands";
import { answerQuery, asksLeague, coerceQuery } from "../queries";
import {
  planYearArchive,
  poolWritesBetween,
  runYearArchive,
  runYearDelete,
  yearArchivePreview,
  yearDeletePreview,
  yearList,
} from "../yearOps";
import { docsOf, listing, seasonsOf } from "./leagueDocsFixture";

/*
 * A squad year archived or deleted on the server (`yearOps.ts`), on a store holding the seeded
 * pool, as Setup's Archive card does it on a device: the same pure functions, the tables and their
 * index written, the pool written part by part. Placeholder names throughout.
 */

const fixture = poolFixture({ seed: 7, clubsPerPage: 30 });
const AT = "2027-08-20T12:00:00.000Z";
const NONE: SeasonReader = () => ({ teams: [], matchups: [], logs: {} });

/** The League Standings seasons the fixture's pages claim, as their documents give them. */
const seasons = async (): Promise<SeasonReader> => {
  const league = await readCloudLeague(listing(docsOf(seasonsOf(fixture.seasons))));
  if (!league.ok || league.from !== "docs") throw new Error("not read from the documents");
  return league.readSeason;
};

const YEAR = 2027;

beforeEach(async () => {
  resetTeamRankingsStore();
  await initTeamRankingsStore(memoryIo());
  saveAgeGroups(fixture.ageGroups);
  saveScoutTeams(fixture.teams);
  saveScoutGames(fixture.games);
});
afterEach(() => {
  resetTeamRankingsStore();
});

describe("a year archived on the server", () => {
  it("keeps the tables and takes the year out, as the device's archive of the same pool does", async () => {
    const read = await seasons();
    const plan = planYearArchive(YEAR, read, AT);
    expect(plan.done.seasons.length).toBeGreaterThan(0);
    expect(await runYearArchive(YEAR, read, AT)).toEqual({ ok: true });

    // The pool the device's archive leaves, part for part.
    expect(loadAgeGroups()).toEqual(plan.done.state.ageGroups);
    expect(loadScoutTeams()).toEqual(plan.done.state.teams);
    expect(loadScoutGames()).toEqual(plan.done.state.games);
    expect(loadAgeGroups().some((group) => ageGroupYear(group) === YEAR)).toBe(false);
    // Its tables, under the archive, each loading back whole.
    const index = loadArchiveIndex();
    expect(index.map((entry) => entry.name)).toEqual(plan.done.seasons.map((one) => one.name));
    for (const entry of index) {
      expect((await loadArchivedSeason(entry.id))?.rows).toEqual(
        plan.done.seasons.find((one) => one.name === entry.name)?.rows
      );
    }
  });

  it("makes its tables with League Standings' games in the year, as the year's boards show it", async () => {
    const withLeague = archivePreviewOf(planYearArchive(YEAR, await seasons(), AT).done);
    const without = archivePreviewOf(planYearArchive(YEAR, NONE, AT).done);
    expect(withLeague.archivedLeagueGames).toBeGreaterThan(0);
    expect(without.archivedLeagueGames).toBe(0);
    // The preview says what the archive then does.
    expect(yearArchivePreview(planYearArchive(YEAR, await seasons(), AT))).toEqual(withLeague);
  });

  it("keeps a tidy pool's stamp, the smaller pool's, and leaves an untidy one's alone", async () => {
    const stored = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
    saveTidyStamp(poolSignature(stored));
    const read = await seasons();
    const plan = planYearArchive(YEAR, read, AT);
    await runYearArchive(YEAR, read, AT);
    expect(loadTidyStamp()).toBe(poolSignature(plan.done.state));

    resetTeamRankingsStore();
    await initTeamRankingsStore(memoryIo());
    saveAgeGroups(fixture.ageGroups);
    saveScoutTeams(fixture.teams);
    saveScoutGames(fixture.games);
    saveTidyStamp("not this pool's");
    await runYearArchive(YEAR, read, AT);
    expect(loadTidyStamp()).toBe("not this pool's");
  });

  it("does nothing for a year with nothing under it", async () => {
    const games = loadScoutGames();
    expect(await runYearArchive(2031, await seasons(), AT)).toEqual({ ok: false, why: "missing" });
    expect(loadScoutGames()).toEqual(games);
    expect(loadArchiveIndex()).toEqual([]);
  });
});

describe("a year deleted on the server", () => {
  it("takes the year out, its archived tables with it, as the device's delete does", async () => {
    await runYearArchive(YEAR, await seasons(), AT);
    expect(loadArchiveIndex().length).toBeGreaterThan(0);
    // A year that is only archived tables now is still one to delete.
    expect(yearList().find((one) => one.year === YEAR)).toMatchObject({ pages: 0, games: 0 });
    const tables = loadArchiveIndex();
    expect(yearDeletePreview({ ...planOf(YEAR) })).toMatchObject({ tables: tables.length });
    expect(await runYearDelete(YEAR)).toEqual({ ok: true });
    expect(loadArchiveIndex()).toEqual([]);
    for (const entry of tables) expect(await loadArchivedSeason(entry.id)).toBeNull();
  });

  it("leaves the pool the device's delete leaves", async () => {
    const stored = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
    const expected = deleteSquadYear(YEAR, stored, []);
    expect(yearDeletePreview(planOf(YEAR))).toEqual(deletePreviewOf(expected));
    expect(await runYearDelete(YEAR)).toEqual({ ok: true });
    expect(loadAgeGroups()).toEqual(expected.state.ageGroups);
    expect(loadScoutTeams()).toEqual(expected.state.teams);
    expect(loadScoutGames()).toEqual(expected.state.games);
  });

  it("does nothing for a year with nothing under it", async () => {
    expect(await runYearDelete(2031)).toEqual({ ok: false, why: "missing" });
    expect(loadAgeGroups()).toEqual(fixture.ageGroups);
  });
});

describe("the questions the card asks first", () => {
  it("are answered as the archive and the delete would go, the archive's with League Standings in", async () => {
    const read = await seasons();
    const archive = coerceQuery({ kind: "year.archivePreview", year: YEAR });
    const remove = coerceQuery({ kind: "year.deletePreview", year: YEAR });
    if (!archive || !remove) throw new Error("not read");
    expect([asksLeague(archive), asksLeague(remove)]).toEqual([true, false]);
    expect(answerQuery(archive, read)).toEqual({
      kind: "year.archivePreview",
      preview: yearArchivePreview(planYearArchive(YEAR, read, AT)),
    });
    expect(answerQuery(remove)).toEqual({
      kind: "year.deletePreview",
      preview: yearDeletePreview(planOf(YEAR)),
    });
    expect(answerQuery({ kind: "year.list" })).toEqual({ kind: "year.list", years: yearList() });
  });
});

describe("the years the card lists", () => {
  it("are each year with a page or a table, newest first, counted as the store counts them", () => {
    const listed = yearList();
    const years = [...new Set(fixture.ageGroups.map((group) => ageGroupYear(group)))]
      .filter((year): year is number => year !== undefined)
      .sort((a, b) => b - a);
    expect(listed.map((one) => one.year)).toEqual(years);
    for (const one of listed) {
      const pages = fixture.ageGroups.filter((group) => ageGroupYear(group) === one.year);
      const ids = new Set(pages.map((group) => group.id));
      expect(one.pages).toBe(pages.length);
      expect(one.games).toBe(fixture.games.filter((game) => ids.has(game.ageGroupId)).length);
      expect(one.archives).toBe(0);
    }
  });
});

describe("the writes between two pools", () => {
  it("are the parts and years that are not the very same records, and nothing else", () => {
    const stored = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
    const parts = poolParts(stored);
    expect(poolWritesBetween(parts, parts)).toEqual([]);
    const done = archiveSquadYear(YEAR, { teams: stored.teams, games: stored.games }, stored, AT);
    const writes = poolWritesBetween(parts, poolParts(done.state));
    expect(
      writes.map((write) => (write.part === "games" ? `games:${write.year}` : write.part))
    ).toEqual(["groups", "teams", `games:${YEAR}`]);
    // A copy of the same records is a write: identity, not likeness, says what changed.
    const copied = poolParts({ ...stored, teams: stored.teams.map((team) => ({ ...team })) });
    expect(poolWritesBetween(parts, copied).map((write) => write.part)).toEqual(["teams"]);
  });
});

/** The delete's plan for `year` on the store as it stands. */
const planOf = (year: number) => {
  const stored = { ageGroups: loadAgeGroups(), teams: loadScoutTeams(), games: loadScoutGames() };
  return {
    stored,
    done: deleteSquadYear(year, stored, loadArchiveIndex()),
    wasTidy: false,
  };
};
