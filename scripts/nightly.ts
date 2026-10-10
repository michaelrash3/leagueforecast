/**
 * The nightly refresh (README, "The nightly refresh on GitHub"): the Refresh button pressed on the
 * cloud copy by one of GitHub's servers, set for around midnight Eastern, so every device
 * opens on teams pulled overnight and nobody's tab has to stay open for it.
 *
 * It opens the cloud copy with the Firebase key GitHub keeps for deploys (`FIREBASE_SERVICE_ACCOUNT`,
 * `cloudPool.ts`), works out tonight's rota from the copy's own settings as the button does, asks
 * GameChanger for every team due through the proxy's own handler in this process
 * (`handlerFetch.ts`), and files them into the copy (`runCloudPull`), keeping what it replaced as
 * an earlier version any device can bring back. Then it publishes every board of the copy it saved
 * for members to read (`publishCopyViews`, README "Views a server publishes"). The day is the
 * user's: the workflow runs it with `TZ=America/New_York`, and `LANG=en_US.UTF-8` for the order
 * the members' browsers put tied rows in.
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run nightly              a dry run: saves nothing
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run nightly -- --live --limit 50
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run nightly -- --live
 *
 * A dry run does everything but the saves, and says what the copy's and the views' would have been,
 * the views built from the copy the pull would have saved. Either way, and however the refresh
 * ended, it ends by saying how the rebuilds after saves have gone (`describeRebuilds`), read from
 * their ledger. `--limit N`
 * pulls only the first N teams due, and leaves the day unlogged. It prints counts, sizes and
 * timings only: this repository is public, and so are its Actions logs.
 */
import { appendFileSync } from "node:fs";
import type { CloudStore } from "../src/lib/cloud/cloudEngine.ts";
import type { CloudManifest } from "../src/lib/cloud/cloudManifest.ts";
import { runCloudPull, type CloudPullStage } from "../src/lib/cloud/cloudRunner.ts";
import {
  nightlyEndsTurn,
  nightlyTakesTurn,
  type NightlyTurn,
} from "../src/lib/cloud/refreshGate.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import { fetchGcTeams } from "../src/lib/gameChangerClient.ts";
import { dryLiveStore, publishCopyViews, publishFailedRun } from "../src/lib/live/publishCopy.ts";
import { describeRebuilds, rebuildsTrouble } from "../src/lib/live/rebuildReport.ts";
import { resetTeamRankingsStore } from "../src/lib/teamRankingsStorage.ts";
import { openStores } from "./cloudPool.ts";
import { sweepStaleUploads } from "../src/lib/cloud/uploads.ts";
import { handlerFetch } from "./handlerFetch.ts";
import { mb, tellViews } from "./viewsReport.ts";

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
  exit: (code?: number) => never;
  memoryUsage: () => { rss: number };
  resourceUsage: () => { maxRSS: number };
};

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const force = argv.includes("--force");
const limitAt = argv.indexOf("--limit");
const limit = limitAt >= 0 ? Number(argv[limitAt + 1]) : undefined;
if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
  console.log("--limit wants a whole number of teams.");
  process.exit(2);
}

const started = Date.now();
const since = (): string => `${Math.round((Date.now() - started) / 1000)} s`;

/**
 * `store` with its writes counted and not made: what a dry run saves, which is nothing, and what
 * it would have saved.
 */
const dryRun = (
  store: CloudStore
): {
  store: CloudStore;
  pieces: () => number;
  bytes: () => number;
  manifest: () => CloudManifest | null;
} => {
  let pieces = 0;
  let bytes = 0;
  let manifest: CloudManifest | null = null;
  return {
    store: {
      readManifest: () => store.readManifest(),
      getChunk: (id) => store.getChunk(id),
      putChunk: async (_id, data) => {
        pieces += 1;
        bytes += data.length;
      },
      commitManifest: async (_expected, next) => {
        manifest = next;
        return true;
      },
      deleteChunk: async () => undefined,
    },
    pieces: () => pieces,
    bytes: () => bytes,
    manifest: () => manifest,
  };
};

/** The rebuilds' ledger, read on the stores' sign-in once they are open (`tellRebuilds`). */
let readLedger: (() => Promise<unknown>) | null = null;

/**
 * Hands the workflow a word for the steps after this one (`steps.refresh.outputs.<name>`), where it
 * runs on GitHub; anywhere else there is nobody to hand it to.
 */
const output = (name: string, value: string): void => {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${name}=${value}\n`);
};

/**
 * How the rebuilds after saves have gone, said at the end of every run however the refresh ended,
 * since a night that failed is when it is most wanted. Said and never judged: the rebuilds are not
 * this run's work, and a night turned red by them would read as a refresh that failed. Whether
 * they are failing goes to the workflow as a word (`rebuildsTrouble`), for the alarm of their own
 * it raises or settles (`runAlarms.ts`); a ledger not read hands over nothing, which leaves that
 * alarm as it is.
 */
const tellRebuilds = async (): Promise<void> => {
  if (!readLedger) return;
  try {
    const ledger = await readLedger();
    for (const line of describeRebuilds(ledger)) console.log(line);
    const trouble = rebuildsTrouble(ledger);
    if (trouble) output("rebuilds", trouble);
  } catch (error) {
    console.log(
      `The rebuilds' ledger could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

const main = async (): Promise<void> => {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) {
    console.log("No FIREBASE_SERVICE_ACCOUNT here, so there is no cloud copy to refresh.");
    process.exitCode = 1;
    return;
  }
  const opened = openStores(key, live);
  readLedger = opened.readLedger;
  const dry = live ? null : dryRun(opened.copy);
  console.log(
    `${live ? "Live" : "Dry run (nothing is saved)"}: the Refresh rota${
      limit ? `, its first ${limit} teams` : ""
    }${force ? ", run again whatever has been done today" : ""}, on ${new Date().toISOString()} (${
      process.env.TZ ?? "the server's own time zone"
    }).`
  );

  let lastTenth = -1;
  const onStage = (stage: CloudPullStage): void => {
    if (stage.stage === "fetching") {
      const tenth = stage.total === 0 ? 10 : Math.floor((10 * stage.done) / stage.total);
      if (tenth === lastTenth) return;
      lastTenth = tenth;
      console.log(
        `  ${since()}: ${stage.done} of ${stage.total} teams asked, ${stage.failed} not answered.`
      );
      return;
    }
    console.log(
      `  ${since()}: ${stage.stage}${stage.stage === "saving" ? ` (try ${stage.attempt})` : ""}.`
    );
  };

  // The nightly's turn at the refresh gate (README, "Refresh now in the cloud"): a live run waits
  // for a "Refresh now" under way to end, so the two never ask GameChanger about the same teams at
  // once, and names itself there while it pulls, so a press meanwhile is told the nightly is
  // pulling. A dry run writes nothing, the gate included, and takes no turn.
  let turn: NightlyTurn | null = null;
  if (live) {
    try {
      turn = await nightlyTakesTurn({
        gate: opened.gate,
        readJob: opened.readJob,
        now: () => new Date(),
        sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
      });
      if (turn.waitedMs > 0) {
        console.log(
          `  ${since()}: waited ${Math.round(turn.waitedMs / 1000)} s for a refresh started from the app${
            turn.stillRunning ? ", which is still running; pulling beside it" : " to end"
          }.`
        );
      }
      if (!turn.at) console.log("  The refresh gate kept moving; pulling without taking it.");
    } catch (error) {
      console.log(
        `  The refresh gate could not be read (${error instanceof Error ? error.message : String(error)}); pulling without it.`
      );
    }
  }
  const held = turn?.at ?? null;
  let result: Awaited<ReturnType<typeof runCloudPull>>;
  try {
    result = await runCloudPull(
      { kind: "rota", ...(force ? { force } : {}), ...(limit ? { limit } : {}) },
      {
        store: dry?.store ?? opened.copy,
        fetchTeams: (ids, options) => fetchGcTeams(ids, { ...options, fetchImpl: handlerFetch() }),
        now: () => new Date(),
        device: "nightly",
        keep: true,
        onStage,
      }
    );
  } finally {
    // Given back as soon as GameChanger is done with; the boards after ask it nothing.
    if (held) {
      await nightlyEndsTurn(opened.gate, held).catch(() =>
        console.log(
          "  The refresh gate could not be given back; it opens by itself within 90 minutes."
        )
      );
    }
  }

  console.log(
    `Ended ${result.end} in ${since()}: ${result.asked} teams asked, ${result.answered} answered, ${result.failed} not; ${result.filed} filed, ${result.gamesAdded} games added and ${result.gamesUpdated} updated.`
  );
  if (result.changed.length > 0) {
    const what = dry
      ? `would have saved ${result.changed.length} values (${dry.pieces()} new pieces, ${mb(dry.bytes())} gzipped)`
      : `saved ${result.changed.length} values; the copy is at version ${result.version}`;
    console.log(
      `  It ${what}${result.replays > 0 ? `, after filing again ${result.replays} time(s) onto a copy another device saved` : ""}.`
    );
  } else if (["finished", "stopped", "gave-up"].includes(result.end)) {
    console.log("  Nothing in the copy changed, so nothing was saved.");
  }
  // Built from the copy the store now holds, and only when it holds one (`CloudPullResult.manifest`).
  if (result.manifest) {
    try {
      const views = await publishCopyViews({
        copyStore: dry?.store ?? opened.copy,
        liveStore: dry ? dryLiveStore(opened.live) : opened.live,
        manifest: result.manifest,
        today: todayIsoDay(),
        now: () => new Date().toISOString(),
        leagueDocs: opened.leagueDocs,
      });
      tellViews(views, dry !== null);
      // A save during the run, and views a newer build published first (a deploy that landed
      // meanwhile), are no fault of the run's; anything else that stops is (`publishFailedRun`).
      if (publishFailedRun(views)) process.exitCode = 1;
    } catch (error) {
      console.log(
        `Publishing the views stopped: ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    }
  }
  // Backups the owner staged for the server that nothing used within a day (`uploads.ts`).
  try {
    const swept = await sweepStaleUploads(opened.uploads, new Date().toISOString(), live);
    if (swept.stale > 0) {
      console.log(
        live
          ? `  ${swept.deleted} of ${swept.stale} staged backups a day old deleted.`
          : `  ${swept.stale} staged backups a day old would have been deleted.`
      );
    }
  } catch (error) {
    console.log(
      `  The staged backups were not swept: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  console.log(
    `  Memory at the end: ${mb(process.memoryUsage().rss)} (at most ${mb(process.resourceUsage().maxRSS * 1024)}).`
  );
  if (
    result.end === "gave-up" ||
    result.end === "copy-kept-changing" ||
    result.end === "copy-replaced" ||
    result.end === "no-copy"
  ) {
    process.exitCode = 1;
  }
};

try {
  await main();
} catch (error) {
  // The message only: nothing here quotes the key, and a stack adds nothing a public log needs.
  console.log(`The refresh stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // The store opens a channel to other tabs that would keep the process alive.
  resetTeamRankingsStore();
}
await tellRebuilds();
process.exit(process.exitCode ?? 0);
