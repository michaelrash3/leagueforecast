import { coerceLedger, type Ledger } from "./rebuildLedger";

/**
 * What the nightly says of the rebuilds after saves, read off their ledger (`rebuildLedger.ts`):
 * the switch, then the runs, failures and compute of the last day a run was reserved on and of its
 * month, against their caps, then the failures in a row and a run not yet settled. It is how the
 * owner tells from the nightly's log whether the dry runs go well before turning them live,
 * without opening Google's logs. Counts, days and times only: the log is public, and nothing in
 * the ledger names anyone, though the ids of the task and the handling a run was reserved by are
 * left out as nothing a reader needs.
 *
 * The day is the ledger's own, not the nightly's: it runs a few hours into a New York day that has
 * seldom had a save yet, so the day it reads is the one before, or the last that had a run.
 */
export const describeRebuilds = (raw: unknown): string[] => {
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
    ...(ledger.month === ""
      ? []
      : [
          `  ${ledger.month}: ${runsOf(ledger.monthRuns, ledger.monthFailed)}; ${count(ledger.monthGiBs)} of ${count(caps.monthGiBs)} GiB-seconds and ${count(ledger.monthVcpuS)} of ${count(caps.monthVcpuS)} vCPU-seconds.`,
        ]),
    `  ${
      ledger.pausedDay === null
        ? `${ledger.failures} failed in a row, of the ${caps.failures} that pause them`
        : `Paused for ${ledger.pausedDay}, after ${ledger.failures} failed in a row`
    }; ${ledger.open ? `a run reserved at ${ledger.open.at} has not settled` : "no run open"}.`,
  ];
};

const switchOf = (ledger: Ledger): string => {
  if (!ledger.on) return "off";
  return ledger.mode === "dry" ? "on, dry: each builds every board and publishes none" : "on, live";
};

const count = (value: number): string => value.toLocaleString("en-US");

const runsOf = (runs: number, failed: number): string =>
  `${count(runs)} ${runs === 1 ? "run" : "runs"}, ${count(failed)} failed`;
