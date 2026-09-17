/**
 * Runs the recency sweep over a pool exported from the app, and prints what it found.
 *
 * A research tool rather than a feature: the question it answers — how fast does a rating go off,
 * and does weighting old games down predict better — is asked once, against a season that has
 * already happened, and the answer becomes a constant in the app. It lives in `scripts/` for that
 * reason, and it reads the same JSON backup the Setup page writes so there is no second export
 * format to keep true.
 *
 *   npm run recency:sweep -- <backup.json>
 *
 * Every page in the file is swept separately. That matters: a page is one age level in one squad
 * year, and two of them are two independent samples rather than one bigger one. A half-life that
 * wins on both is worth believing; one that wins on either alone is a coin landing.
 */
import { readFileSync } from "node:fs";
import { parseTeamRankingsJson, type TeamRankingsBackup } from "../src/lib/teamRankingsBackup.ts";
import {
  backtestScoutRatings,
  compareRecencySchemes,
  describeDecayCurve,
  type ScoutBacktestResult,
} from "../src/lib/scoutBacktest.ts";
import { RECENCY_SCHEMES } from "../src/lib/ratingRecency.ts";
import {
  ageGroupLevel,
  ageGroupYear,
  countsTowardRating,
  scoutRatingGames,
  type AgeGroup,
} from "../src/lib/teamRankings.ts";

/**
 * The Node globals this script needs. Declared here rather than via `@types/node`, for the same
 * reason `api/gc-team.ts` and `scripts/verify-gc-pull.ts` do it: installing that package changes
 * global timer typings for the browser project too.
 */
declare const process: { argv: string[]; exitCode?: number };
declare const console: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };

const DAY_MS = 24 * 60 * 60 * 1000;

const read = (path: string): TeamRankingsBackup => {
  const pool = parseTeamRankingsJson(readFileSync(path, "utf8"));
  if (!pool) {
    throw new Error(
      `${path} is not a Team Rankings backup. Export one from Setup — the button writes the JSON this reads.`
    );
  }
  return pool;
};

const pageName = (group: AgeGroup): string => {
  const level = ageGroupLevel(group);
  const year = ageGroupYear(group);
  return level === undefined || year === undefined ? group.name : `${level}U ${year}`;
};

/**
 * What the page is made of, before any of it is fitted.
 *
 * Printed first because the sweep's numbers are only worth reading if these are: a page with
 * eighty played games cannot separate schemes whose predictions differ by a fraction of a run, and
 * it is better to see that in the header than to infer it from a suspiciously tidy result.
 */
const describePage = (backup: TeamRankingsBackup, group: AgeGroup): string[] => {
  const rated = scoutRatingGames(group.id, backup.teams, backup.games, backup.ageGroups);
  const played = rated.filter((entry) => countsTowardRating(entry.game));
  const dated = played.filter((entry) => entry.game.date);
  const days = dated
    .map((entry) => Date.parse(entry.game.date!))
    .filter((at) => Number.isFinite(at))
    .sort((a, b) => a - b);
  const teams = new Set(played.flatMap(({ game }) => [game.teamAId, game.teamBId]));

  const lines = [
    `${played.length} played games, ${teams.size} teams, ${dated.length} of them dated`,
  ];
  if (days.length >= 2) {
    const first = days[0]!;
    const last = days[days.length - 1]!;
    lines.push(
      `${new Date(first).toISOString().slice(0, 10)} to ${new Date(last).toISOString().slice(0, 10)}` +
        ` (${Math.round((last - first) / DAY_MS)} days)`
    );
    // The blocks a season really has, which is the thing a day half-life cannot see.
    const gaps: string[] = [];
    for (let i = 1; i < days.length; i += 1) {
      const gap = Math.round((days[i]! - days[i - 1]!) / DAY_MS);
      if (gap >= 30) {
        gaps.push(`${gap}d gap after ${new Date(days[i - 1]!).toISOString().slice(0, 10)}`);
      }
    }
    lines.push(gaps.length > 0 ? `breaks: ${gaps.join("; ")}` : "no break of a month or more");
  }
  return lines;
};

const pct = (value: number | null): string =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const runs = (value: number | null): string => (value === null ? "—" : value.toFixed(3));

/** How much better than calling every game even, which is what a rating has to beat to be one. */
const lift = (result: ScoutBacktestResult): string => {
  const { meanAbsoluteError: error, baselineError: baseline } = result;
  if (error === null || baseline === null || baseline === 0) return "—";
  return `${(((baseline - error) / baseline) * 100).toFixed(1)}%`;
};

const sweepPage = (backup: TeamRankingsBackup, group: AgeGroup, gapDays: number): void => {
  console.log(`\n${"=".repeat(78)}\n${pageName(group)}\n${"=".repeat(78)}`);
  describePage(backup, group).forEach((line) => console.log(`  ${line}`));

  const ranked = compareRecencySchemes(
    group.id,
    backup.teams,
    backup.games,
    backup.ageGroups,
    RECENCY_SCHEMES,
    { gapDays }
  );
  const usable = ranked.filter((result) => result.sampleSize > 0);
  if (usable.length === 0) {
    console.log("\n  Nothing to hold out. This page cannot answer the question.");
    return;
  }

  const control = usable.find((result) => result.recencyKey === "none");
  console.log(`\n  Held out ${usable[0]!.sampleSize} games, ${gapDays} day gap after the cut.\n`);
  console.log(
    `  ${"scheme".padEnd(14)}${"runs off".padStart(10)}${"vs even".padStart(10)}` +
      `${"called".padStart(9)}${"vs control".padStart(12)}`
  );
  usable.forEach((result) => {
    const delta =
      control?.meanAbsoluteError == null || result.meanAbsoluteError == null
        ? "—"
        : `${control.meanAbsoluteError - result.meanAbsoluteError >= 0 ? "-" : "+"}${Math.abs(
            control.meanAbsoluteError - result.meanAbsoluteError
          ).toFixed(3)}`;
    console.log(
      `  ${result.recencyKey.padEnd(14)}${runs(result.meanAbsoluteError).padStart(10)}` +
        `${lift(result).padStart(10)}${pct(result.winnerAccuracy).padStart(9)}${delta.padStart(12)}`
    );
  });

  /*
   * The curve, for the control and the winner. This is the part that answers the question the
   * headline cannot: a scheme can lose overall and still be the right one, if it is behind over a
   * fortnight and well ahead across a winter.
   */
  const winner = usable[0]!;
  [control, winner === control ? undefined : winner].forEach((result) => {
    if (!result) return;
    console.log(`\n  How fast it goes off — ${result.recencyKey}:`);
    const lines = describeDecayCurve(result);
    if (lines.length === 0) console.log("    (nothing held out far enough to say)");
    lines.forEach((line) => console.log(`    ${line}`));
  });
};

const main = (): void => {
  const [path, gapArg] = process.argv.slice(2);
  if (!path) {
    console.error("usage: npm run recency:sweep -- <backup.json> [gapDays]");
    process.exitCode = 1;
    return;
  }
  const gapDays = gapArg === undefined ? 14 : Number(gapArg);
  const backup = read(path);

  console.log(
    `Pool: ${backup.ageGroups.length} pages, ${backup.teams.length} teams, ${backup.games.length} games`
  );
  console.log(
    "A weight is a count, and every scheme averages one, so what separates them is only which\n" +
      "games count more than others — never how much evidence the fit is handed in total."
  );

  // Biggest first: the page most likely to be able to answer anything leads the report.
  const pages = [...backup.ageGroups].sort((a, b) => {
    const count = (group: AgeGroup) =>
      backup.games.filter((game) => game.ageGroupId === group.id).length;
    return count(b) - count(a);
  });
  pages.forEach((group) => sweepPage(backup, group, gapDays));

  console.log(
    `\n${"=".repeat(78)}\nA scheme is worth believing when it wins on more than one page and its\n` +
      "curve says why. One page's winner is a coin landing."
  );
  // Also the plain backtest, so the ratings themselves are seen to be worth having at all.
  pages.forEach((group) => {
    const plain = backtestScoutRatings(group.id, backup.teams, backup.games, backup.ageGroups);
    if (plain.sampleSize === 0) return;
    const { meanAbsoluteError: error, baselineError: baseline } = plain;
    const won = error !== null && baseline !== null && error < baseline;
    console.log(
      `${pageName(group)}: unweighted ratings ${won ? "beat" : "lose to"} "it'll be close" by` +
        ` ${lift(plain).replace("-", "")} over ${plain.sampleSize} games.`
    );
  });
};

main();
