import {
  ageFromGradYearInName,
  ageLevelFromLooseName,
  ageLevelFromName,
  ageSpanFromName,
} from "./gameChangerApi";
import type { GcImportState } from "./gameChangerImport";
import { ageGroupLevel, ageGroupYear, gcLinkSquadYearIn, type ScoutTeam } from "./teamRankings";

/**
 * Pulled clubs that look filed at the wrong age: the Cincinnati Hornets problem, across the pool.
 *
 * A club is filed where GameChanger's age field puts it, and a club that sets the field to one age
 * and plays another sits on the wrong board all season: every game against the level it really
 * plays reads as playing up or down, and its rating carries an edge it never earned. Two readings
 * find them, each a rule about evidence rather than a guess, and each measured on the pools of 26
 * and 28 September 2026 before it was written here.
 *
 * - **Its name and its opponents disagree with the filing.** The GameChanger name of one of its
 *   squads that year states an age N other than the level it is filed at (the squads' names, not
 *   the club's, which often drops the age), at least two distinct pulled opponents are filed at N,
 *   and N is the strict majority of the pulled opponents whose level is known. 214 clubs on the
 *   26 September pool, 170 of them filed younger than the name, and 201 on the 28th, 162 of them
 *   younger; the commonest moves are 11U to 12U, 10U to 11U and 9U to 10U.
 * - **Its opponents alone disagree.** No age anywhere in the name; at least three distinct pulled
 *   opponents at one other level, 80% or more of those whose level is known, met in at least two
 *   different weeks. 39 clubs, then 41, the Cincinnati Hornets *Fall Ball* among them (filed 8U,
 *   playing 9U). The week rule is what keeps out a club that played up at one tournament.
 *
 * Opponents are read off every row of the squad year, played or not, since a schedule names who a
 * club plays before any result exists; a row withdrawn by its own schedule, or a club against
 * itself, says nothing. A club whose age somebody set by hand is not listed: that is an answer.
 */
export type WrongAgeClub = {
  teamId: string;
  name: string;
  state?: string;
  /** The squad year it was read in, and its GameChanger ids in that year. */
  year: number;
  gcTeamIds: string[];
  /** The level it is filed at. */
  filed: number;
  /** The level the evidence points at. */
  suggested: number;
  /** Which reading found it. */
  reason: "name" | "opponents";
  /** Distinct pulled opponents filed at the suggested level, and of every known level. */
  opponentsAtSuggested: number;
  opponentsKnown: number;
  /** Weeks (Monday to Sunday) with a game against the suggested level. */
  weeks: number;
};

/** The age a club's name states, by the import's own ladder: a bracket's older end first. */
const nameAge = (name: string, year: number): number | undefined =>
  ageSpanFromName(name)?.high ??
  ageLevelFromName(name) ??
  ageFromGradYearInName(name, year) ??
  ageLevelFromLooseName(name);

/** The Sunday ending a date's week, so Friday to Sunday of one weekend is one week. */
const weekOf = (date: string | undefined): string | undefined => {
  if (!date) return undefined;
  const at = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(at)) return undefined;
  const day = new Date(at).getUTCDay();
  return new Date(at + ((7 - day) % 7) * 86_400_000).toISOString().slice(0, 10);
};

const SEASON_ORDER: Record<string, number> = { fall: 0, winter: 1, spring: 2, summer: 3 };

export const filedAtWrongAge = (state: GcImportState, year: number): WrongAgeClub[] => {
  const levelOf = new Map(state.ageGroups.map((group) => [group.id, ageGroupLevel(group)]));
  const yearOfPage = new Map(state.ageGroups.map((group) => [group.id, ageGroupYear(group)]));
  const yearOf = gcLinkSquadYearIn(state.ageGroups);

  /** A pulled club's level in the year: its latest season's link, as the boards file it. */
  const clubLevel = new Map<string, number>();
  const byId = new Map<string, ScoutTeam>();
  const setByHand = new Set<string>();
  /** The GameChanger names of its squads in the year, which keep the age a club's name drops. */
  const squadNames = new Map<string, string[]>();
  const squadIds = new Map<string, string[]>();
  state.teams.forEach((team) => {
    byId.set(team.id, team);
    let latest: { order: number; level: number } | undefined;
    for (const link of team.gcTeams ?? []) {
      if (yearOf(link) !== year) continue;
      if (link.ageFrom === "you") setByHand.add(team.id);
      squadNames.set(team.id, [...(squadNames.get(team.id) ?? []), link.name]);
      squadIds.set(team.id, [...(squadIds.get(team.id) ?? []), link.teamId]);
      const level = levelOf.get(link.ageGroupId) ?? link.ageLevel;
      if (level === undefined) continue;
      const order = SEASON_ORDER[(link.season ?? "").trim().toLowerCase()] ?? -1;
      if (!latest || order > latest.order) latest = { order, level };
    }
    if (latest) clubLevel.set(team.id, latest.level);
  });

  /** Each pulled club's opponents, by the opponent's own level, with the weeks they met. */
  const met = new Map<string, Map<number, { opponents: Set<string>; weeks: Set<string> }>>();
  const note = (us: string, them: string, week: string | undefined) => {
    if (!clubLevel.has(us)) return;
    const level = clubLevel.get(them);
    if (level === undefined) return;
    const levels = met.get(us) ?? new Map<number, { opponents: Set<string>; weeks: Set<string> }>();
    const at = levels.get(level) ?? { opponents: new Set<string>(), weeks: new Set<string>() };
    at.opponents.add(them);
    if (week) at.weeks.add(week);
    levels.set(level, at);
    met.set(us, levels);
  };
  state.games.forEach((game) => {
    if (yearOfPage.get(game.ageGroupId) !== year) return;
    if (game.teamAId === game.teamBId || game.withdrawn === true) return;
    const week = weekOf(game.date);
    note(game.teamAId, game.teamBId, week);
    note(game.teamBId, game.teamAId, week);
  });

  const out: WrongAgeClub[] = [];
  met.forEach((levels, teamId) => {
    if (setByHand.has(teamId)) return;
    const team = byId.get(teamId);
    const filed = clubLevel.get(teamId);
    if (!team || filed === undefined) return;
    const known = [...levels.values()].reduce((sum, at) => sum + at.opponents.size, 0);
    const found = (suggested: number, reason: WrongAgeClub["reason"]): WrongAgeClub => {
      const at = levels.get(suggested);
      return {
        teamId,
        name: team.name,
        ...(team.state ? { state: team.state } : {}),
        year,
        gcTeamIds: squadIds.get(teamId) ?? [],
        filed,
        suggested,
        reason,
        opponentsAtSuggested: at?.opponents.size ?? 0,
        opponentsKnown: known,
        weeks: at?.weeks.size ?? 0,
      };
    };
    const stated = (squadNames.get(teamId) ?? [])
      .map((name) => nameAge(name, year))
      .find((age) => age !== undefined);
    if (stated !== undefined) {
      const atStated = levels.get(stated)?.opponents.size ?? 0;
      if (stated !== filed && atStated >= 2 && atStated * 2 > known)
        out.push(found(stated, "name"));
      return;
    }
    // The other level most of its opponents are filed at, if one is.
    let top: { level: number; count: number } | undefined;
    levels.forEach((at, level) => {
      if (level === filed) return;
      if (!top || at.opponents.size > top.count) top = { level, count: at.opponents.size };
    });
    if (!top) return;
    const weeks = levels.get(top.level)?.weeks.size ?? 0;
    if (top.count >= 3 && top.count >= 0.8 * known && weeks >= 2) {
      out.push(found(top.level, "opponents"));
    }
  });
  // The furthest off first, then the strongest evidence, then by name.
  return out.sort(
    (a, b) =>
      Math.abs(b.suggested - b.filed) - Math.abs(a.suggested - a.filed) ||
      b.opponentsAtSuggested - a.opponentsAtSuggested ||
      a.name.localeCompare(b.name)
  );
};
