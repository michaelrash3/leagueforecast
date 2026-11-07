import { useMemo, useState } from "react";
import { answerableToday } from "../lib/agelessQueue";
import { type AgeUnknownList, withRulesMoved } from "../lib/ageUnknown";
import { todayIsoDay } from "../lib/date";
import { type DeletedClubs, isDeletedClub } from "../lib/deletedGames";
import { type GcTeamListEntry, PASTE_HANDFUL, squadYearsForGcSeason } from "../lib/gameChangerApi";
import { type GcImportState, vouchedByImport } from "../lib/gameChangerImport";
import { leagueLinkedClubsOf } from "../lib/live/allKnown";
import type { NamedAges } from "../lib/namedAges";
import { orgAgesByTeam, type OrgMembership, withOrgAges } from "../lib/orgMembership";
import { isRefusedClub, type RefusedClubs } from "../lib/refusedClubs";
import { readStoredSeason } from "../lib/storage";
import { MIN_AGE_LEVEL, pulledGcTeamIds, segmentOn } from "../lib/teamRankings";
import { loadAgeUnknown, loadOrgMembership, loadRealClubs } from "../lib/teamRankingsStorage";
import { isTooYoungClub, type TooYoungClubs } from "../lib/tooYoungClubs";

/** No row of a paste vouched for, one set for every paste, so the list read waits on a real change. */
const NONE_VOUCHED: ReadonlySet<string> = new Set<string>();

/**
 * The team list as GameChanger's export gave it: pasted, less the levels this app does not rank
 * and the ids earlier pulls turned away or found too young; split once against the pool into the
 * teams new to it, those seen and those to refresh; with the rows whose name says they are no team
 * that an owner vouched for kept; and the seasons the list covers, to choose among. Beside it, the
 * teams GameChanger answered for that nobody could age, and the Organizations file kept, with the
 * age each team's organizations agree on, the asks they make, and how many waiting teams a file can
 * age (`ageless`, `membership`, `orgAges`, `asks`, `waitingOrgAged`).
 *
 * GameChangerImportPanel.tsx worked these out among its other values. They moved here whole and are
 * called where they were, so their state and memos keep their place among the panel's.
 */
export type GcTeamListInputs = {
  droppedClubs: DeletedClubs;
  namedAges: NamedAges;
  pool: GcImportState;
  read: { entries: GcTeamListEntry[]; skipped: string[] };
  refused: RefusedClubs;
  text: string;
  tooYoung: TooYoungClubs;
};

export function useGcTeamList({
  droppedClubs,
  namedAges,
  pool,
  read,
  refused,
  text,
  tooYoung,
}: GcTeamListInputs) {
  /**
   * The rows whose name says they are no team that the import would pull all the same: a club the
   * owner vouched for (`vouchedByImport`), against the real list and League Standings as the run
   * hands them to the importer. Left out with the rest, such a club could never be refreshed from a
   * paste, though the import files it.
   *
   * Only a row whose id is on the real list or carried by a club in the pool can be one, since
   * that is all the import's gate reads; so the League pass, a walk of the pool's games, is run only
   * when a paste holds such a row, not for every paste with a practice page somewhere in it.
   */
  const vouched = useMemo(() => {
    const named = read.entries.filter((entry) => entry.notATeam);
    if (named.length === 0) return NONE_VOUCHED;
    const real = loadRealClubs();
    const pulled = pulledGcTeamIds(pool.teams);
    const held = named.filter((entry) => real.has(entry.teamId) || pulled.has(entry.teamId));
    if (held.length === 0) return NONE_VOUCHED;
    const isVouched = vouchedByImport(
      pool,
      new Set([...real, ...leagueLinkedClubsOf(pool, readStoredSeason)])
    );
    const ids = held.filter((entry) => isVouched(entry.teamId)).map((entry) => entry.teamId);
    return ids.length === 0 ? NONE_VOUCHED : new Set(ids);
  }, [read, pool]);

  const listRead = useMemo(() => {
    // Wiffle ball is a different game, so those rows never cost a request. Counted separately from
    // the too-young ones because they are a different kind of "not for us" and the panel says so.
    const baseball = read.entries.filter((entry) => !entry.notBaseball);
    // A high school squad plays its own season against other high school squads, so its results
    // join nothing ranked here. Dropped on the same terms and for the same reason as the wiffle
    // rows — before a request is spent — and counted apart, because a reader who pasted a list
    // full of them deserves to be told which kind of "not for us" ate it.
    const club = baseball.filter((entry) => !entry.highSchool);
    // And the third kind of "not for us": GameChanger's own field saying adult or college. Same
    // terms again — refused before a request, counted apart — because a list of men's-league
    // teams vanishing silently is indistinguishable from a list that failed to parse.
    const youth = club.filter((entry) => !entry.notYouth);
    // And a page whose name says it is no team at all — a practice, a test, an old page marked do
    // not use — on the same terms, counted apart so the pill can say what it was. Read off the
    // name on every paste rather than remembered, since a coach can rename the page. A club the
    // owner vouched for is kept, as the import keeps it, and goes on as any row: on no pill.
    const teams = youth.filter((entry) => !entry.notATeam || vouched.has(entry.teamId));
    const oldEnough = teams.filter(
      (entry) =>
        !isTooYoungClub(tooYoung, entry.teamId) &&
        (entry.ageLevel === undefined || entry.ageLevel >= MIN_AGE_LEVEL)
    );
    /*
     * And a club somebody threw out. The importer refuses it whatever list names it, but only once
     * its profile and games have been fetched, and each refusal was then a row under "Worth a
     * look". Re-pasting a list is how the rows that never made it in are retried, and on the
     * seasoned list 20,146 of the 53,385 rows a re-paste sent were clubs already thrown out: 38% of
     * the requests, spent on answers already given, and the refusals buried the real reasons.
     */
    const entries = oldEnough.filter((entry) => !isDeletedClub(droppedClubs, entry.teamId));
    return {
      ...read,
      entries,
      tooYoung: teams.length - oldEnough.length,
      thrownOut: oldEnough.length - entries.length,
      notBaseball: read.entries.length - baseball.length,
      highSchool: baseball.length - club.length,
      notYouth: club.length - youth.length,
      notATeam: youth.length - teams.length,
      // Counted here rather than again at run time: on a nationwide export this is a forty
      // megabyte split, and once is enough.
      lines: text ? text.split(/\r?\n/).length : 0,
    };
  }, [read, text, tooYoung, droppedClubs, vouched]);

  /**
   * The seasons a pull files: the one being played, unless somebody ticks another.
   *
   * A season in this app's sense, the baseball year from August to July (`segmentOn`), so 2027 is
   * Fall 2026 through Summer 2027. A crawl that searched every season of a calendar year hands over
   * last spring's and summer's squads beside this fall's, and a finished year's team adds nothing
   * to the tables being read now. Held against the list it was chosen for, so a new list starts
   * from the season being played again rather than from whatever the last one asked for.
   */
  const currentSeasonYear = segmentOn(todayIsoDay()).year;
  const [seasonChoice, setSeasonChoice] = useState<{ text: string; years: number[] } | null>(null);
  const seasonYears = useMemo(
    () =>
      seasonChoice !== null && seasonChoice.text === text
        ? seasonChoice.years
        : [currentSeasonYear],
    [seasonChoice, text, currentSeasonYear]
  );
  const toggleSeasonYear = (year: number) => {
    const next = seasonYears.includes(year)
      ? seasonYears.filter((kept) => kept !== year)
      : [...seasonYears, year].sort((a, b) => b - a);
    setSeasonChoice({ text, years: next });
  };

  /**
   * The list less the rows from seasons nobody asked for.
   *
   * Only a row whose Season column says so is dropped here, before a request is spent on it. A row
   * that does not say is kept and settled when it arrives, by GameChanger's own season: the run
   * hands the same years to the importer, which refuses the rest (`seasonYears`).
   */
  const parsed = useMemo(() => {
    const wanted = new Set(seasonYears);
    const bySeason = new Map<number, number>();
    /** Every year a row could be, so either reading of a winter can be ticked. */
    const readable = new Set<number>();
    const entries: GcTeamListEntry[] = [];
    let noSeason = 0;
    for (const entry of listRead.entries) {
      if (!entry.season) {
        noSeason += 1;
        entries.push(entry);
        continue;
      }
      /*
       * A winter's label names either year it straddles (`squadYearsForGcSeason`), so a "Winter
       * 2027" row is this season's as much as next's until its schedule says which: kept where
       * either year is ticked and counted under that one, and the import files it by its games.
       */
      const readings = squadYearsForGcSeason(entry.season);
      readings.forEach((reading) => readable.add(reading));
      const year =
        readings.find((reading) => wanted.has(reading)) ?? readings[readings.length - 1]!;
      bySeason.set(year, (bySeason.get(year) ?? 0) + 1);
      if (wanted.has(year)) entries.push(entry);
    }
    /*
     * And the rows an earlier pull fetched and turned away: for what the team is, or as a season
     * that is still not asked for. A list with no Season column is where this pays — every paste
     * of it asked GameChanger again about teams it had already answered for.
     */
    const kept = entries.filter((entry) => !isRefusedClub(refused, entry.teamId, seasonYears));
    const turnedAway = entries
      .filter((entry) => isRefusedClub(refused, entry.teamId, seasonYears))
      .map((entry) => entry.teamId);
    return {
      ...listRead,
      entries: kept,
      turnedAway,
      otherSeason: listRead.entries.length - entries.length,
      bySeason,
      readable,
      noSeason,
    };
  }, [listRead, seasonYears, refused]);

  /**
   * The years the picker offers: the one being played, the one before, and any the list's rows
   * could be — both readings of a winter's label, so the one its schedule is dated in can be
   * ticked whichever that is.
   */
  const seasonOptions = useMemo(
    () =>
      [...new Set([currentSeasonYear, currentSeasonYear - 1, ...parsed.readable])].sort(
        (a, b) => b - a
      ),
    [currentSeasonYear, parsed.readable]
  );

  /**
   * The list less the teams already here.
   *
   * A team list grows rather than changes — a few dozen clubs added to an export of several
   * thousand — so an import is for the ones nobody has pulled yet. Re-fetching the rest would cost
   * the same minutes the first run did to learn nothing: keeping a schedule current is the weekly
   * rota's job, and it is a separate thing from adding a club to the pool.
   */
  const split = useMemo(() => {
    const pulled = pulledGcTeamIds(pool.teams);
    const fresh = parsed.entries.filter((entry) => !pulled.has(entry.teamId));
    const seen = parsed.entries.length - fresh.length;
    /*
     * A handful pasted by hand is a different thing from an export. Somebody who types one team's
     * id in wants that team pulled now, whether or not it is already here — that is how a schedule
     * that changed today gets read before the rota comes round — so a short list with nothing new
     * in it is offered as a refresh rather than refused.
     */
    const refresh =
      fresh.length === 0 && parsed.entries.length > 0 && parsed.entries.length <= PASTE_HANDFUL
        ? parsed.entries
        : [];
    return { fresh, seen, refresh };
  }, [parsed.entries, pool.teams]);

  /**
   * The teams GameChanger answered for and nobody could age.
   *
   * Held in state rather than read on every render: the run rewrites it at the end, and the rota
   * (`useGcPullSchedule`, called after this) has to see the new one without the panel being closed
   * and reopened.
   */
  const [ageless, setAgeless] = useState<AgeUnknownList>(() => loadAgeUnknown());
  /**
   * The organizations the user's Organizations file named, with the teams under each, and the age
   * each such team's organizations agree on. Read when a pull files a team GameChanger left
   * ageless, and by the rota, which asks straight away about a waiting team a file can now age.
   */
  const [membership, setMembership] = useState<OrgMembership>(() => loadOrgMembership());
  const orgAges = useMemo(() => orgAgesByTeam(membership), [membership]);
  const asks = useMemo(
    () =>
      withRulesMoved(withOrgAges(namedAges, orgAges, membership.savedAt), ageless, answerableToday),
    [namedAges, orgAges, membership.savedAt, ageless]
  );
  const waitingOrgAged = useMemo(
    () => ageless.filter((entry) => orgAges.has(entry.teamId)).length,
    [ageless, orgAges]
  );

  return {
    ageless,
    asks,
    currentSeasonYear,
    membership,
    orgAges,
    parsed,
    seasonOptions,
    seasonYears,
    setAgeless,
    setMembership,
    split,
    toggleSeasonYear,
    waitingOrgAged,
  };
}
