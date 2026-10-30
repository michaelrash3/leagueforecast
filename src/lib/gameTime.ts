/**
 * Games in the order they are played: by day, then by start time, where GameChanger gave one
 * (`startTs`, an instant in UTC). A game with no start is listed after the day's timed games, since
 * it could be any time that day. Two games of one day otherwise kept their stored order, which put
 * a doubleheader's second game first as often as not.
 */
type Timed = { date?: string; startTs?: string };

/** A start in milliseconds, or undefined where there is none or it does not read. */
const startMs = (startTs: string | undefined): number | undefined => {
  if (!startTs) return undefined;
  const ms = Date.parse(startTs);
  return Number.isFinite(ms) ? ms : undefined;
};

/** Untimed after timed, either way round; null when both are timed. */
const untimedLast = (x: number | undefined, y: number | undefined): number | null =>
  x === undefined || y === undefined ? (x === undefined ? 1 : 0) - (y === undefined ? 1 : 0) : null;

/** Two games of one day, the earlier start first. */
export const byStart = (a: Timed, b: Timed): number => {
  const x = startMs(a.startTs);
  const y = startMs(b.startTs);
  return untimedLast(x, y) ?? (x as number) - (y as number);
};

/** Earliest first: by day ("2026-09-20" sorts as text), then by start. */
export const byGameTime = (a: Timed, b: Timed): number =>
  (a.date ?? "").localeCompare(b.date ?? "") || byStart(a, b);

/** Newest first: the latest day first, and in it the latest start first, untimed games last. */
export const byGameTimeNewest = (a: Timed, b: Timed): number => {
  const day = (b.date ?? "").localeCompare(a.date ?? "");
  if (day !== 0) return day;
  const x = startMs(a.startTs);
  const y = startMs(b.startTs);
  return untimedLast(x, y) ?? (y as number) - (x as number);
};

/**
 * A start as whole minutes since 1970, the form the published lists carry it in (a game's minute
 * is all the order needs); undefined where there is none.
 */
export const startMinutes = (startTs: string | undefined): number | undefined => {
  const ms = startMs(startTs);
  return ms === undefined ? undefined : Math.round(ms / 60_000);
};

/** The start a published list's minutes stand for. */
export const startTsOfMinutes = (minutes: number): string =>
  new Date(minutes * 60_000).toISOString();
