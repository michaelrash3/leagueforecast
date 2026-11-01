/**
 * How often the refresh offers each level, apart from the schedule that works the rest of it out
 * (`gameChangerSchedule.ts`, which re-exports it): the pool's store reads a kept cadence back and
 * loads at start, while only Team Rankings runs the schedule.
 */

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
