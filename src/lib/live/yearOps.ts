import { deleteSquadYear } from "../deleteSquadYear";
import { poolSignature } from "../gameChangerImport";
import { dedupeLeagueFixtures, leagueStandIns } from "../teamRankings";
import { archiveSquadYear, type StoredPool } from "../teamRankingsArchive";
import {
  forgetArchivedSeason,
  loadAgeGroups,
  loadArchiveIndex,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
  saveArchivedSeasons,
  saveTidyStamp,
  storedGamesByYear,
} from "../teamRankingsStorage";
import {
  archivePreviewOf,
  deletePreviewOf,
  summariseYears,
  type YearArchivePreview,
  type YearDeletePreview,
  type YearSummary,
} from "../yearSummary";
import { deriveAllKnown, type SeasonReader } from "./allKnown";
import { poolParts, type PoolParts, type PoolWrite } from "./commands";
import { writePool } from "./runPoolCommand";

/**
 * A squad year archived or deleted on the server (1.6), as Setup's Archive card does it on a
 * device (`TeamRankingsView`'s `archiveYear` and `deleteYear`): the same pure functions on the pool
 * the edit function keeps (`archiveSquadYear`, `deleteSquadYear`), the archived tables and their
 * index written into its store, and the pool written part by part. The edit run commits it all to
 * the copy as one save (`runEdit`), so a year is never half archived in the copy, which the device's
 * own order of writes was there to prevent.
 *
 * The pool is written whole, part by part, not laid down record by record as the device does
 * (`changeBetween`): nothing is taken back, and a year's archive throws out thousands of clubs, each
 * of which, as its own step, would scan every game and keep a roster of its own until the batch
 * ended (`MAX_COMMAND_STEPS`). The edit function runs one edit at a time on a pool brought to the
 * copy before it, and a save that lands meanwhile runs the archive again on top of it.
 */

/** The pool as the page holds it: every page, the roster, and every stored game. */
const storedNow = (): StoredPool => ({
  ageGroups: loadAgeGroups(),
  teams: loadScoutTeams(),
  games: loadScoutGames(),
});

/**
 * The writes that take the pool from `before` to `after`: each part, and each year's games, that
 * is not the very same records in the same order. The functions that make `after` keep the records
 * they do not change, so identity says what changed.
 */
export const poolWritesBetween = (before: PoolParts, after: PoolParts): PoolWrite[] => {
  const same = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((item, at) => item === b[at]);
  const writes: PoolWrite[] = [];
  if (!same(before.groups, after.groups))
    writes.push({ part: "groups", groups: [...after.groups] });
  if (!same(before.teams, after.teams)) writes.push({ part: "teams", teams: [...after.teams] });
  const years = new Set([...before.games.keys(), ...after.games.keys()]);
  for (const year of years) {
    const was = before.games.get(year) ?? [];
    const now = after.games.get(year) ?? [];
    if (!same(was, now)) writes.push({ part: "games", year, games: [...now] });
  }
  return writes;
};

/**
 * Year `year` archived as the page archives it, on the process's store, with `seasons` the League
 * Standings seasons the boards are built with: the tables are made from the year as its boards
 * show it, League Standings' games in it (`deriveAllKnown`, as the board builds the year), and what
 * survives is the stored pool alone.
 */
export const planYearArchive = (year: number, seasons: SeasonReader, at: string) => {
  const stored = storedNow();
  const known = deriveAllKnown({
    ageGroups: stored.ageGroups,
    teams: stored.teams,
    yearGames: loadScoutGamesForYear(year),
    readSeason: seasons,
  });
  const shown = {
    teams: known.teams,
    games: dedupeLeagueFixtures(
      [...known.derivedGames, ...stored.games],
      leagueStandIns(known.teams, stored.ageGroups)
    ),
  };
  return {
    stored,
    done: archiveSquadYear(year, shown, stored, at),
    // Whether the pool was tidy before, as the page asks: a tidy pool with a year taken from it
    // has nothing new to tidy, so it keeps its stamp.
    wasTidy: loadTidyStamp() === poolSignature(stored),
  };
};

/** What the confirmation says of an archive before it is made (`year.archivePreview`). */
export const yearArchivePreview = (plan: ReturnType<typeof planYearArchive>): YearArchivePreview =>
  archivePreviewOf(plan.done);

/** Year `year` deleted as the page deletes it, on the process's store. */
export const planYearDelete = (year: number) => {
  const stored = storedNow();
  return {
    stored,
    done: deleteSquadYear(year, stored, loadArchiveIndex()),
    wasTidy: loadTidyStamp() === poolSignature(stored),
  };
};

/** What the confirmation says of a year's delete before it is made (`year.deletePreview`). */
export const yearDeletePreview = (plan: ReturnType<typeof planYearDelete>): YearDeletePreview =>
  deletePreviewOf(plan.done);

/** Every year with anything to archive or delete, as the card lists them (`year.list`). */
export const yearList = (): YearSummary[] =>
  summariseYears(loadAgeGroups(), storedGamesByYear(), loadArchiveIndex());

/**
 * What a year's archive or delete came to on the store: done, or `missing` (nothing is filed under
 * the year) or `unsaved` (the store would not take a write).
 */
export type YearRun = { ok: true } | { ok: false; why: "missing" | "unsaved" };

/**
 * Archives `year` on the process's store: the tables and their index, then the pool without the
 * year, then the tidy stamp where the pool was tidy. Nothing reaches the copy until the edit's
 * commit, so a write refused part way leaves only the store to be read afresh.
 */
export const runYearArchive = async (
  year: number,
  seasons: SeasonReader,
  at: string
): Promise<YearRun> => {
  const { stored, done, wasTidy } = planYearArchive(year, seasons, at);
  if (done.seasons.length === 0 && done.unranked.length === 0) return { ok: false, why: "missing" };
  if (!(await saveArchivedSeasons(done.seasons))) return { ok: false, why: "unsaved" };
  if (!writePool(poolWritesBetween(poolParts(stored), poolParts(done.state)))) {
    return { ok: false, why: "unsaved" };
  }
  if (wasTidy && !saveTidyStamp(poolSignature(done.state))) return { ok: false, why: "unsaved" };
  return { ok: true };
};

/** Deletes `year` on the process's store: the pool without it, the tidy stamp, its tables. */
export const runYearDelete = async (year: number): Promise<YearRun> => {
  const { stored, done, wasTidy } = planYearDelete(year);
  if (done.pages.length === 0 && done.archiveIds.length === 0) return { ok: false, why: "missing" };
  if (!writePool(poolWritesBetween(poolParts(stored), poolParts(done.state)))) {
    return { ok: false, why: "unsaved" };
  }
  if (wasTidy && !saveTidyStamp(poolSignature(done.state))) return { ok: false, why: "unsaved" };
  for (const id of done.archiveIds) {
    if (!(await forgetArchivedSeason(id))) return { ok: false, why: "unsaved" };
  }
  return { ok: true };
};
