/**
 * What is due to be refreshed, and when.
 *
 * Two cadences, because the right answer depends on how much of the season is actually moving.
 *
 * The rotation spreads the levels over a week, one or two a day. A pull of a whole team list is
 * thousands of requests and the best part of an hour, and for a pool that mostly has not changed
 * that is not worth doing nightly; spread out it is a few minutes a day, nothing is more than
 * seven days stale, and no single run is long enough to be worth interrupting.
 *
 * Daily offers every level every day. In season that is what you want — a team's last game is
 * worth more to a rating than a team's game from six days ago, and waiting for a level's turn
 * means the board is answering with a week-old week. It costs a full run's worth of requests and
 * of saving each day rather than a seventh of one, which is a real cost and is why it is a choice
 * rather than the only way.
 *
 * Nothing here schedules anything by itself — there is no server, and a browser cannot run while
 * it is closed. What this does is answer "what is due?" when the app is next opened, and a person
 * still presses the button.
 */

import {
  AGE_LEVELS,
  ageGroupLevel,
  ageGroupYear,
  type AgeGroup,
  type ScoutTeam,
} from "./teamRankings";
import { ageUnknownAsking, ageUnknownDue, type AgeUnknownList } from "./ageUnknown";

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

/**
 * How much comes round at once.
 *
 * `rotation` is the week spread by level. `daily` offers every level every day, and is the default
 * because a rating is only as current as its newest game.
 */
export type RefreshCadence = "rotation" | "daily";

export const DEFAULT_REFRESH_CADENCE: RefreshCadence = "daily";

export const isRefreshCadence = (value: unknown): value is RefreshCadence =>
  value === "rotation" || value === "daily";

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
  /** Which cadence produced this, so the copy can say what "today" covers. */
  cadence: RefreshCadence;
  /**
   * Teams with no age, due to be asked again today.
   *
   * They belong on the catch-up day and nowhere else. A team with no level is on no page, so the
   * per-level rotation above walks straight past it, for ever — and it is not a failure either, so
   * nothing retries it. The catch-up day is where the week's leftovers go, and a team nobody could
   * age is a leftover: it goes back through the same route it came in on, at most once a week,
   * until GameChanger fills its field in, a club renames it, or it plays more games against
   * opponents who do name an age. Pulling other teams cannot help — the opponent names are read
   * off this team's own schedule.
   */
  agelessIds: string[];
  /**
   * How many are still being asked about at all, due today or not.
   *
   * Set on every day rather than only on a catch-up, because the card that names this number has
   * to be able to say "none are due today" — and a card that vanishes on the days when there is
   * nothing to press reads as though the teams had gone away.
   */
  agelessTotal: number;
};

/**
 * What is due now: the levels this weekday is for, minus any already done today, and the ids
 * behind them. An empty `teamIds` means there is nothing to do — either the day has already run,
 * or nothing has been pulled at those levels yet.
 *
 * The catch-up day brings nothing of its own; the panel points it at what failed instead.
 */
/**
 * The most ageless teams one run may hold at once.
 *
 * This used to be 2,000 and used to be justified as a per-run budget — "it could be thousands".
 * That was the wrong reason for a number, and it was doing a job nobody had asked it to do: with
 * nothing else pacing the asks, the cap was the only thing standing between the list and being
 * abandoned in a week. It is now a ceiling on memory and nothing else; `ageUnknownDue`'s week gate
 * does the pacing.
 *
 * As a ceiling it is generous, because the cost it bounds is small. A run of ageless teams that
 * still have no age changes nothing in the pool — `importGcSchedule` hands the caller's state
 * straight back when a schedule cannot be filed — so it writes nothing; what it does hold is the
 * fetched schedules, in the client's `settled` map, for the life of the run. At ten thousand that
 * is tens of megabytes, which is affordable; at a hundred thousand it would not be.
 *
 * A list longer than this is not stranded: the overflow is offered on the next run rather than the
 * next week, because the gate is per team and those teams were not asked today.
 */
export const AGELESS_PER_CATCH_UP = 10_000;

export type DueRefreshOptions = {
  /** Keeps a run to the season being played rather than dragging every past year round with it. */
  seasonYear?: number;
  ageless?: AgeUnknownList;
  /**
   * The ids somebody has named an age for, so a team that was left alone is asked once more.
   * Structural, so the caller can pass the `NamedAges` map straight in.
   */
  namedAges?: { has: (teamId: string) => boolean };
  cadence?: RefreshCadence;
  /**
   * Ignore what has already been done today and offer the lot.
   *
   * The log exists so opening the app twice in an evening does not pull twice. But a person who
   * has just fixed a link, or who knows a tournament finished an hour ago, is asking for something
   * the log cannot know about, and "come back tomorrow" is the wrong answer to that.
   */
  force?: boolean;
};

export const dueRefresh = (
  now: Date,
  log: RefreshLog,
  ageGroups: AgeGroup[],
  teams: ScoutTeam[],
  {
    seasonYear,
    ageless = [],
    namedAges,
    cadence = DEFAULT_REFRESH_CADENCE,
    force = false,
  }: DueRefreshOptions = {}
): DueRefresh => {
  /*
   * On the daily cadence every level is on today's list and every day is a catch-up day. The
   * second half matters as much as the first: teams with no age are on no page, so the per-level
   * walk goes straight past them for ever, and on the rotation Friday is the only thing that ever
   * asks about them. A cadence with no Friday would have quietly stopped asking.
   */
  const entry =
    cadence === "daily"
      ? { day: now.getDay() as Weekday, label: "Today", ageLevels: AGE_LEVELS, catchUp: true }
      : refreshDayFor(now.getDay() as Weekday);
  const outstanding = force
    ? entry.ageLevels
    : entry.ageLevels.filter((level) => !refreshedToday(log, level, now));
  return {
    ageLevels: outstanding,
    teamIds: gcTeamIdsForLevels(outstanding, ageGroups, teams, seasonYear),
    label: entry.label,
    catchUp: Boolean(entry.catchUp),
    cadence,
    agelessIds: entry.catchUp ? ageUnknownDue(ageless, AGELESS_PER_CATCH_UP, now, namedAges) : [],
    agelessTotal: ageUnknownAsking(ageless, now, namedAges),
  };
};

/** A line for the panel: what today is for, and whether it is still to do. */
export const describeDue = (due: DueRefresh): string => {
  if (due.cadence === "daily") {
    const ageless =
      due.agelessTotal > 0
        ? ` Plus ${due.agelessTotal.toLocaleString()} team${
            due.agelessTotal === 1 ? "" : "s"
          } still waiting on an age.`
        : "";
    if (due.ageLevels.length === 0) return `Every age group has been refreshed today.${ageless}`;
    if (due.teamIds.length === 0)
      return `Every age group is due today, but nothing has been pulled yet.${ageless}`;
    return `Every age group is due today — ${due.teamIds.length.toLocaleString()} team${
      due.teamIds.length === 1 ? "" : "s"
    } to refresh.${ageless}`;
  }
  if (due.catchUp) {
    const ageless =
      due.agelessTotal > 0
        ? ` — and ${due.agelessTotal.toLocaleString()} team${
            due.agelessTotal === 1 ? "" : "s"
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

/** What a cadence covers, in one line, for the control that chooses between them. */
export const describeCadence = (cadence: RefreshCadence): string =>
  cadence === "daily"
    ? "Every age group, every day. A full run each time, so the longest and the most current."
    : "One or two age levels a day, round the week. Short runs; nothing older than seven days.";

/** The rotation as lines, so the panel can show the week without knowing how it is built. */
export const describeRotation = (): string[] =>
  WEEKLY_ROTATION.map((entry) =>
    entry.catchUp
      ? `${entry.label}: catch up on failures, and teams still waiting on an age`
      : `${entry.label}: ${entry.ageLevels.map((level) => `${level}U`).join(", ") || "—"}`
  );
