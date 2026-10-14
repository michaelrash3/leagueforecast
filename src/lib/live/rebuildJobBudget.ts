import { shiftIsoDay } from "../date";
import { reserveRun, runCost, type Ledger, type ReserveRefusal } from "./rebuildLedger";
import { REBUILD_SIZE } from "./rebuildWorkerProtocol";

export const REBUILD_JOB_MAX_S = 7200;
export const REBUILD_JOB_CLEANUP_S = 120;
export const REBUILD_JOB_MIN_S = 180;

/** Reserve only within the owner's existing caps; the job has no five-minute request deadline. */
export const reserveRebuildJob = (ledger: Ledger | null, day: string, at: string, by: string) => {
  const daySeconds = ledger
    ? Math.floor(
        (ledger.caps.dayGiBs - (ledger.day === day ? ledger.dayGiBs : 0)) / REBUILD_SIZE.gib
      )
    : 0;
  const month = day.slice(0, 7);
  const monthSeconds = ledger
    ? Math.floor(
        Math.min(
          (ledger.caps.monthGiBs - (ledger.month === month ? ledger.monthGiBs : 0)) /
            REBUILD_SIZE.gib,
          (ledger.caps.monthVcpuS - (ledger.month === month ? ledger.monthVcpuS : 0)) /
            REBUILD_SIZE.cpu
        )
      )
    : 0;
  const spanS = Math.max(REBUILD_JOB_MIN_S, Math.min(REBUILD_JOB_MAX_S, daySeconds, monthSeconds));
  const answer = reserveRun(ledger, day, at, {
    ceiling: runCost(spanS, REBUILD_SIZE),
    spanS,
    task: "ranking-rebuild",
    by,
    engine: "job-v1",
  });
  return {
    ...answer,
    ...(!answer.ok && answer.why === "day-cap" && monthSeconds < REBUILD_JOB_MIN_S
      ? { why: "month-cap" as const }
      : {}),
    spanS,
    limiting: monthSeconds <= daySeconds ? "month-cap" : "day-cap",
  };
};

const newYorkMidnight = (day: string): number => {
  const target = Date.parse(`${day}T00:00:00Z`);
  let at = target;
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let n = 0; n < 3; n++) {
    const parts = Object.fromEntries(
      format.formatToParts(at).map(({ type, value }) => [type, value])
    );
    const local = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const delta = target - local;
    at += delta;
    if (delta === 0) break;
  }
  return at;
};

/** Budget refusals queue themselves again; no new save is needed to restart ranking updates. */
export const rebuildRetryAt = (
  why: ReserveRefusal | "budget",
  day: string,
  nowMs: number,
  ledger?: Ledger | null
): Date => {
  if (why === "busy")
    return new Date(
      Math.max(
        nowMs + 60_000,
        Date.parse(ledger?.open?.until ?? "") || Date.parse(ledger?.open?.at ?? "") + 320_000 || 0
      )
    );
  const next =
    why === "month-cap"
      ? `${new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 1)).toISOString().slice(0, 10)}`
      : shiftIsoDay(day, 1);
  return new Date(newYorkMidnight(next) + 60_000);
};
