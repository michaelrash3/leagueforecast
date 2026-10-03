/**
 * How long a save took to reach the members' boards (README, "Views a server publishes"), read off
 * the log: the trigger's line for each save it queued a rebuild for, and each rebuild's line. A save
 * reached them with the first live run that wrote boards of its copy at its version or later, once
 * it was made (`liveLags`); this prints how many saves there were, how many no live rebuild logged
 * here reached, and the median, 90th percentile and longest wait of the rest.
 *
 *   gcloud logging read 'jsonPayload.event="save" OR jsonPayload.end="published"' \
 *     --freshness=7d --format=json > rebuilds.json
 *   npm run live:lag -- rebuilds.json
 *
 * It takes Cloud Logging's entries (each line's fields under `jsonPayload`), or the lines alone,
 * as a JSON array or one JSON object a line. It prints counts and seconds only.
 */
import { readFileSync } from "node:fs";
import { liveLags } from "../src/lib/live/rebuild.ts";

declare const process: { argv: string[]; exitCode?: number };

/** The log's lines, whichever way they were saved: an entry's payload, or the line itself. */
const linesOf = (text: string): unknown[] => {
  const trimmed = text.trim();
  const entries: unknown[] = trimmed.startsWith("[")
    ? (JSON.parse(trimmed) as unknown[])
    : trimmed
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as unknown);
  return entries.map((entry) =>
    typeof entry === "object" && entry !== null && "jsonPayload" in entry
      ? (entry as { jsonPayload: unknown }).jsonPayload
      : entry
  );
};

const path = process.argv[2];
if (!path) {
  console.error("Usage: npm run live:lag -- <log.json>");
  process.exitCode = 2;
} else {
  const lags = liveLags(linesOf(readFileSync(path, "utf8")));
  if (!lags) {
    console.log("No save in the log.");
  } else {
    const reached = lags.saves - lags.unmatched;
    console.log(
      `${lags.saves} saves, ${lags.unmatched} reached by no live rebuild logged here.` +
        (reached === 0
          ? ""
          : ` The other ${reached} reached the boards in ${lags.medianS.toFixed(0)} s at the ` +
            `median, ${lags.p90S.toFixed(0)} s at the 90th percentile, ${lags.maxS.toFixed(0)} s at most.`)
    );
  }
}
