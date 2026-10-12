import type { ScoutTeam } from "./teamRankings/types";

/** A small deduction in the same run units as the rating, rather than a separate ranking. */
export const MAX_CIRCULAR_SCHEDULE_DEDUCTION = 1;

type SchedulePair = { a: string; b: string; weight: number };
type Meeting = { games: number; weight: number };

/**
 * How much a club's opponents recycle that club's own opponent circle.
 *
 * For each opponent, read its other games: what share stayed among the original club's
 * opponents? Average that share over the club's own games. Repeated internal games are not
 * outside evidence, and one outside game only gradually opens the circle. Recency weights
 * are the same ones handed to the rating fit.
 *
 * An opponent known only from other schedules cannot establish that its own schedule is closed.
 * It contributes no deduction. Require three opponents and six games for the club, and at least
 * three other games against two sides for an opponent, before calling the overlap evidence.
 * This deliberately measures the observed two-step circle, not an inferred league membership.
 */
export const circularScheduleDeductions = (
  teams: readonly Pick<ScoutTeam, "id" | "nameOnly" | "placeholder">[],
  pairs: Iterable<SchedulePair>
): Map<string, number> => {
  const real = new Set(teams.filter((team) => !team.placeholder).map((team) => team.id));
  const known = new Set(
    teams.filter((team) => !team.placeholder && !team.nameOnly).map((team) => team.id)
  );
  const schedules = new Map<string, Map<string, Meeting>>();
  const record = (a: string, b: string, weight: number) => {
    let schedule = schedules.get(a);
    if (!schedule) {
      schedule = new Map();
      schedules.set(a, schedule);
    }
    const meeting = schedule.get(b) ?? { games: 0, weight: 0 };
    meeting.games += 1;
    meeting.weight += weight;
    schedule.set(b, meeting);
  };
  for (const { a, b, weight } of pairs) {
    if (a === b || !real.has(a) || !real.has(b) || !Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    record(a, b, weight);
    record(b, a, weight);
  }

  const deductions = new Map<string, number>();
  for (const [id, opponents] of schedules) {
    if (!known.has(id) || opponents.size < 3) continue;
    let games = 0;
    let weight = 0;
    for (const meeting of opponents.values()) {
      games += meeting.games;
      weight += meeting.weight;
    }
    if (games < 6) continue;

    let circularWeight = 0;
    for (const [opponent, meeting] of opponents) {
      if (!known.has(opponent)) continue;
      let otherGames = 0;
      let otherOpponents = 0;
      let otherWeight = 0;
      let insideWeight = 0;
      for (const [other, otherMeeting] of schedules.get(opponent)!) {
        if (other === id) continue;
        otherGames += otherMeeting.games;
        otherOpponents += 1;
        otherWeight += otherMeeting.weight;
        if (opponents.has(other)) insideWeight += otherMeeting.weight;
      }
      if (otherGames < 3 || otherOpponents < 2) continue;
      circularWeight += meeting.weight * (insideWeight / otherWeight);
    }
    const deduction = Math.min(
      MAX_CIRCULAR_SCHEDULE_DEDUCTION,
      MAX_CIRCULAR_SCHEDULE_DEDUCTION * (circularWeight / weight)
    );
    if (deduction > 0) deductions.set(id, deduction);
  }
  return deductions;
};
