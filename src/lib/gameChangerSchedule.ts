/**
 * Which age groups get refreshed on which day.
 *
 * A pull of a whole team list is thousands of requests and the best part of an hour, which is not
 * something to do every night for data that mostly has not changed. Spreading it by age group over
 * the week turns it into a few minutes a day: each level comes round once a week, every level is
 * no more than seven days stale, and no single run is long enough to be worth interrupting.
 *
 * Nothing here schedules anything by itself — there is no server, and a browser cannot run while
 * it is closed. What this does is answer "what is due?" when the app is next opened, which for a
 * nightly rotation usually amounts to the same thing.
 */

import { ageGroupLevel, ageGroupYear, type AgeGroup, type ScoutTeam } from "./teamRankings";
import { ageUnknownDue, type AgeUnknownList } from "./ageUnknown";

/** Sunday is 0, as `Date.getDay` has it. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type RefreshDay = {
  day: Weekday;
  label: string;
  /** The levels due that day. Empty on the catch-up day, which takes whatever was missed. */
  ageLevels: number[];
  /** A day that re-tries what failed earlier in the week rather than taking levels of its own. */
  catchUp?: boolean;
};

/**
 * The rotation. Youngest first on Sunday because those are the biggest fields — 8U and 9U are most
 * of a typical list — and a week that starts with the long day keeps the catch-up day near the end
 * of it, where there is something to catch up on.
 *
 * Rearranging this is the whole of changing the schedule; nothing else reads a day or a level.
 */
export const WEEKLY_ROTATION: RefreshDay[] = [
  { day: 0, label: "Sunday", ageLevels: [8, 9] },
  { day: 1, label: "Monday", ageLevels: [16, 17] },
  { day: 2, label: "Tuesday", ageLevels: [10, 11] },
  { day: 3, label: "Wednesday", ageLevels: [18] },
  { day: 4, label: "Thursday", ageLevels: [12, 13] },
  { day: 5, label: "Friday", ageLevels: [], catchUp: true },
  { day: 6, label: "Saturday", ageLevels: [14, 15] },
];

export const refreshDayFor = (day: Weekday): RefreshDay =>
  WEEKLY_ROTATION.find((entry) => entry.day === day) ?? {
    day,
    label: "Today",
    ageLevels: [],
  };

/** Which levels a given day is for. */
export const levelsDueOn = (day: Weekday): number[] => refreshDayFor(day).ageLevels;

/** The day a level comes round on, for saying so in the interface. */
export const dayForLevel = (ageLevel: number): RefreshDay | undefined =>
  WEEKLY_ROTATION.find((entry) => entry.ageLevels.includes(ageLevel));

/** A calendar day, as "YYYY-MM-DD" in the viewer's own zone — the unit "once a day" is counted in. */
export const localDayKey = (now: Date): string => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/** When each level was last refreshed, by level, as a day key. */
export type RefreshLog = Record<string, string>;

export const markRefreshed = (log: RefreshLog, ageLevels: number[], now: Date): RefreshLog => {
  const key = localDayKey(now);
  const next = { ...log };
  ageLevels.forEach((level) => {
    next[String(level)] = key;
  });
  return next;
};

/** Whether a level has already had its turn today. */
export const refreshedToday = (log: RefreshLog, ageLevel: number, now: Date): boolean =>
  log[String(ageLevel)] === localDayKey(now);

/**
 * The GameChanger ids to refresh for these levels: every id on every team whose games are filed
 * under an age group at one of those levels. A team is refreshed by the id it was pulled as, one
 * per GameChanger season, because that is what a schedule is fetched by.
 *
 * `seasonYear`, when given, keeps a rotation to the season being played rather than dragging every
 * past year round with it.
 */
export const gcTeamIdsForLevels = (
  ageLevels: number[],
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  seasonYear?: number
): string[] => {
  const wanted = new Set(ageLevels);
  const pages = new Set(
    ageGroups
      .filter((group) => {
        const level = ageGroupLevel(group);
        if (level === undefined || !wanted.has(level)) return false;
        return seasonYear === undefined || ageGroupYear(group) === seasonYear;
      })
      .map((group) => group.id)
  );
  if (pages.size === 0) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  teams.forEach((team) => {
    (team.gcTeams ?? []).forEach((link) => {
      if (!pages.has(link.ageGroupId) || seen.has(link.teamId)) return;
      seen.add(link.teamId);
      ids.push(link.teamId);
    });
  });
  return ids;
};

export type DueRefresh = {
  /** The levels this day is for; empty on the catch-up day. */
  ageLevels: number[];
  /** GameChanger ids to fetch. */
  teamIds: string[];
  /** The day's own description, for the prompt. */
  label: string;
  catchUp: boolean;
  /**
   * Teams with no age, due to be asked again today.
   *
   * They belong on the catch-up day and nowhere else. A team with no level is on no page, so the
   * per-level rotation above walks straight past it, for ever — and it is not a failure either, so
   * nothing retries it. The catch-up day is where the week's leftovers go, and a team nobody could
   * age is a leftover: it goes back through the same route it came in on, every week, until
   * GameChanger fills its field in, a club renames it, or enough of its opponents are pulled that
   * their names settle it between them.
   */
  agelessIds: string[];
};

/**
 * What is due now: the levels this weekday is for, minus any already done today, and the ids
 * behind them. An empty `teamIds` means there is nothing to do — either the day has already run,
 * or nothing has been pulled at those levels yet.
 *
 * The catch-up day brings nothing of its own; the panel points it at what failed instead.
 */
/**
 * The most ageless teams asked about in one catch-up day.
 *
 * A cap rather than the whole list, because it could be thousands and the catch-up day also has
 * the week's failures to get through. `ageUnknownDue` hands over the stalest first, so a list
 * longer than this still comes round instead of the same head of it being asked every week.
 */
export const AGELESS_PER_WEEK = 2_000;

export const dueRefresh = (
  now: Date,
  log: RefreshLog,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  seasonYear?: number,
  ageless: AgeUnknownList = []
): DueRefresh => {
  const entry = refreshDayFor(now.getDay() as Weekday);
  const outstanding = entry.ageLevels.filter((level) => !refreshedToday(log, level, now));
  return {
    ageLevels: outstanding,
    teamIds: gcTeamIdsForLevels(outstanding, ageGroups, teams, seasonYear),
    label: entry.label,
    catchUp: Boolean(entry.catchUp),
    agelessIds: entry.catchUp ? ageUnknownDue(ageless, AGELESS_PER_WEEK) : [],
  };
};

/** A line for the panel: what today is for, and whether it is still to do. */
export const describeDue = (due: DueRefresh): string => {
  if (due.catchUp) {
    const ageless =
      due.agelessIds.length > 0
        ? ` — and ${due.agelessIds.length.toLocaleString()} team${
            due.agelessIds.length === 1 ? "" : "s"
          } still waiting on an age`
        : "";
    return `${due.label} is the catch-up day — anything that failed this week${ageless}.`;
  }
  const entry = WEEKLY_ROTATION.find((day) => day.label === due.label);
  const forToday = entry?.ageLevels ?? [];
  if (forToday.length === 0) return `Nothing is scheduled for ${due.label}.`;
  const levels = forToday.map((level) => `${level}U`).join(" and ");
  if (due.ageLevels.length === 0) return `${levels} already refreshed today.`;
  if (due.teamIds.length === 0) return `${levels} are due today, but nothing has been pulled yet.`;
  return `${levels} due today — ${due.teamIds.length} team${
    due.teamIds.length === 1 ? "" : "s"
  } to refresh.`;
};

/** The rotation as lines, so the panel can show the week without knowing how it is built. */
export const describeRotation = (): string[] =>
  WEEKLY_ROTATION.map((entry) =>
    entry.catchUp
      ? `${entry.label}: catch up on failures, and teams still waiting on an age`
      : `${entry.label}: ${entry.ageLevels.map((level) => `${level}U`).join(", ") || "—"}`
  );
