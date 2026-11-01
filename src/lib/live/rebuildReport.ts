import { shiftIsoDay } from "../date";
import { isRecord } from "../validate";
import { deferralReason } from "./rebuildJobControl";
import { coerceLedger, type Ledger } from "./rebuildLedger";

/**
 * What the nightly says of the rebuilds after saves, read off their ledger (`rebuildLedger.ts`):
 * the switch, then the runs, failures and compute of the ledger's day and of the last day before
 * it that had a run, and of its month, against their caps, the edits' own month and the questions
 * left unanswered, then the failures in a row and a run not yet settled. It is how the
 * owner tells from the nightly's log whether the dry runs go well before turning them live,
 * without opening Google's logs. Counts, days and times only: the log is public, and nothing in
 * the ledger names anyone, though the ids of the task and the handling a run was reserved by are
 * left out as nothing a reader needs.
 *
 * The day is the ledger's own, not the nightly's: the day its last reserve was made on, refused or
 * not. The nightly runs a few hours into a New York day, so that is mostly the day before, and the
 * day before that which had a run is said too (`lastDay`), so a save just after midnight or a day
 * of refusals at a cap does not hide the last day the rebuilds ran.
 *
 * `onGithub` is whether the pulls run on GitHub, the dispatch token set (`rebuildsRun`), which the
 * nightly's workflow tells it: then no rebuild runs on Google, and a deferral is said as such
 * (`heldBack`).
 */
export const describeRebuilds = (
  raw: unknown,
  job: unknown = null,
  now: number = Date.now(),
  onGithub = false
): string[] => {
  if (raw === null || raw === undefined) {
    return ["Rebuilds after saves: there is no ledger in ops/rebuild, so they are off."];
  }
  const ledger = coerceLedger(raw);
  if (!ledger) {
    return ["Rebuilds after saves: ops/rebuild is not a ledger this build reads, so they are off."];
  }
  const { caps } = ledger;
  return [
    `Rebuilds after saves: ${switchOf(ledger)}.`,
    ledger.day === ""
      ? "  None has run yet."
      : `  ${ledger.day}: ${runsOf(ledger.dayRuns, ledger.dayFailed)}; ${count(ledger.dayGiBs)} of ${count(caps.dayGiBs)} GiB-seconds.`,
    ...(ledger.lastDay
      ? [
          `  Before that, ${ledger.lastDay.day}: ${runsOf(ledger.lastDay.runs, ledger.lastDay.failed)}; ${count(ledger.lastDay.gibs)} GiB-seconds.`,
        ]
      : []),
    ...(ledger.month === ""
      ? []
      : [
          `  ${ledger.month}: ${runsOf(ledger.monthRuns, ledger.monthFailed)}; ${count(ledger.monthGiBs)} of ${count(caps.monthGiBs)} GiB-seconds and ${count(ledger.monthVcpuS)} of ${count(caps.monthVcpuS)} vCPU-seconds.`,
        ]),
    ...(ledger.editMonthGiBs > 0 || ledger.editMonthVcpuS > 0
      ? [
          `  Edits and questions, ${ledger.month}: ${count(ledger.editMonthGiBs)} of ${count(caps.editMonthGiBs)} GiB-seconds and ${count(ledger.editMonthVcpuS)} of ${count(caps.editMonthVcpuS)} vCPU-seconds.`,
        ]
      : []),
    ...askedOf(ledger),
    ...(ledger.dayUnanswered > 0 || ledger.lastUnanswered
      ? [
          `  Questions left unanswered after a turn: ${count(ledger.dayUnanswered)} on ${ledger.day}${
            ledger.lastUnanswered
              ? `; before that, ${count(ledger.lastUnanswered.count)} on ${ledger.lastUnanswered.day}`
              : ""
          }.`,
        ]
      : []),
    ...heldBack(job, now, onGithub),
    `  ${
      ledger.pausedDay === null
        ? `${ledger.failures} failed in a row, of the ${caps.failures} that pause them`
        : `Paused for ${ledger.pausedDay}, after ${ledger.failures} failed in a row`
    }; ${ledger.open ? `a run reserved at ${ledger.open.at} has not settled` : "no run open"}.`,
  ];
};

/**
 * Whether the ledger shows the rebuilds in trouble, for the alarm the nightly raises
 * (`runAlarms.ts`): `off` while they are switched off, or there is no ledger at all, whatever it
 * kept from before, since then nothing of theirs runs and no reserve ever clears the failures or the
 * pause it holds (`reserveRun`), so an alarm raised over those would be commented on every night
 * until the console was edited; `paused` while it records a pause, which stands until the next
 * reserve clears it; `failing` with any failure in a row and no pause; and `none` with neither.
 * Null for a ledger this build cannot read, which says nothing either way, so an alarm already
 * raised is left as it is.
 */
export const rebuildsTrouble = (raw: unknown): "off" | "paused" | "failing" | "none" | null => {
  if (raw === null || raw === undefined) return "off";
  const ledger = coerceLedger(raw);
  if (!ledger) return null;
  if (!ledger.on) return "off";
  return ledger.pausedDay !== null ? "paused" : ledger.failures > 0 ? "failing" : "none";
};

/**
 * More questions than this left unanswered in a New York day raise the nightly's alarm. A device
 * asks one again on a timer at most three times a season a day (`useScoutBridge`), so a day past
 * it is a server that cannot answer, a worker out of memory say, and not one member's bad minute.
 */
export const UNANSWERED_ALARM = 20;

/**
 * The questions the ledger counts unanswered on `today` (New York's, the nightly's) or the day
 * before, for the alarm the nightly raises (`runAlarms.ts`): `over`, the day with the most and its
 * count, where that is past `UNANSWERED_ALARM`; `fine` otherwise; and nothing where there is no
 * ledger this build reads, which leaves the alarm as it is. Both days are read since a charge
 * after midnight moves the ledger on before the nightly reads it (`lastUnanswered`), and none
 * older, which the nightly of the day after it judged. The edits are charged whatever the
 * rebuilds' switch says, so this is read either way.
 */
export const unansweredWord = (raw: unknown, today: string): string => {
  const ledger = coerceLedger(raw);
  if (!ledger) return "";
  const recent = [today, shiftIsoDay(today, -1)];
  let most = { day: today, count: 0 };
  for (const one of [{ day: ledger.day, count: ledger.dayUnanswered }, ledger.lastUnanswered]) {
    if (one && recent.includes(one.day) && one.count > most.count) most = one;
  }
  return most.count > UNANSWERED_ALARM ? `over ${most.day} ${most.count}` : "fine";
};

/**
 * The line saying the rebuild job is deferred (`rebuildJobControl.ts`), why and until when, or
 * none. Without it the nightly said nothing amiss in the middle of October 2026, while every save
 * waited for the first of November. Only a budget's deferral is lifted by a cap raised in
 * ops/rebuild, so only it says so.
 *
 * Where the pulls run on GitHub no rebuild runs on Google, whatever the deferral: each save's
 * boards go out by the boards' publish on GitHub, and a rebuild's task deferred publishes through
 * it when it comes, so no save waits for the date. Said as before, the line had the owner waiting
 * on 1 November, and looking to raise a cap, from 24 October 2026, when the pulls moved.
 */
const heldBack = (job: unknown, now: number, onGithub: boolean): string[] => {
  if (!isRecord(job) || typeof job.deferredUntil !== "string") return [];
  const until = Date.parse(job.deferredUntil);
  if (!(until > now)) return [];
  const at = new Date(until).toISOString();
  if (onGithub) {
    return [
      `  Replaced by the boards' publish on GitHub, which publishes each save: none waits for the deferral until ${at}.`,
    ];
  }
  switch (deferralReason(job.detail)) {
    case "day-cap":
    case "month-cap":
    case "budget":
      return [
        `  Held back by their budget until ${at}: saves wait for then, or for a cap raised in ops/rebuild.`,
      ];
    case "busy":
      return [`  Waiting until ${at} for a rebuild still running to end.`];
    case "failing":
      return [`  Paused until ${at} after failures in a row.`];
    default:
      return [`  Deferred until ${at}.`];
  }
};

/**
 * The month's questions by kind, the most asked first and then by name (`editMonthAsked`), read
 * off the ledger the nightly reads already: which of them use the edit function most, and, once
 * their answers are published beside the boards, how far each has fallen. Kinds and counts only.
 */
const askedOf = (ledger: Ledger): string[] => {
  const kinds = Object.entries(ledger.editMonthAsked ?? {}).sort(
    ([a, one], [b, other]) => other - one || (a < b ? -1 : a > b ? 1 : 0)
  );
  if (kinds.length === 0) return [];
  const said = kinds.map(([kind, asked]) => `${kind} ${count(asked)}`).join(", ");
  return [`  Questions asked, ${ledger.month}: ${said}.`];
};

const switchOf = (ledger: Ledger): string => {
  if (!ledger.on) return "off";
  return ledger.mode === "dry" ? "on, dry: each builds every board and publishes none" : "on, live";
};

const count = (value: number): string => value.toLocaleString("en-US");

const runsOf = (runs: number, failed: number): string =>
  `${count(runs)} ${runs === 1 ? "run" : "runs"}, ${count(failed)} failed`;
