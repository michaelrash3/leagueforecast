/**
 * The members' views published again from the cloud copy as it stands (README, "Views a server
 * publishes"), run by the Firebase workflow once a push to main has deployed. It publishes only when
 * nothing is published, or what is was published under an older schema than this build writes
 * (`needsRepublish`): then no device of this build can draw the boards, and without this every
 * member was left on the older schema's notice until the next nightly, which GitHub starts hours
 * late. Any other time it says so and leaves the views to the rebuilds after saves and the night.
 *
 * It opens the copy as the nightly does (`openStores`), on the same Firebase key, with only `live/`
 * writable: it pulls nothing and saves nothing of the copy. The copy's pool is laid into the app's
 * pool store in memory exactly as a pull lays it (`loadPoolFrom`), refused where a newer build saved
 * it or tidied it (`copyTooNew`), and the views are built and published from it under the copy and
 * version read (`publishCopyViews`). It prints counts, sizes and timings only: this repository is
 * public, and so are its Actions logs.
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run republish
 *
 * Run under the nightly's time zone and collation (`TZ=America/New_York`, `LANG=en_US.UTF-8`), whose
 * day and order of tied rows the views are built in, and with its heap, since it holds the whole pool.
 */
import { copyTooNew, loadPoolFrom } from "../src/lib/cloud/cloudRunner.ts";
import { todayIsoDay } from "../src/lib/date.ts";
import { publishCopyViews, type CopyPublish } from "../src/lib/live/publishCopy.ts";
import { LIVE_SCHEMA, needsRepublish } from "../src/lib/live/viewStore.ts";
import { resetTeamRankingsStore } from "../src/lib/teamRankingsStorage.ts";
import { openStores } from "./cloudPool.ts";
import { mb, tellViews } from "./viewsReport.ts";

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
  exit: (code?: number) => never;
  memoryUsage: () => { rss: number };
};

const started = Date.now();
const since = (): string => `${Math.round((Date.now() - started) / 1000)} s`;

/**
 * Refusals that leave nothing for this run to answer for. A copy or a season saved during the run
 * asks for its own rebuild, which this build's functions, deployed just before, publish at this
 * build's schema (as the nightly treats them). And a later day's views, newer rules' or a newer
 * build's are what this run was for, published first by someone else.
 */
const SETTLED = new Set<Extract<CopyPublish, { ok: false }>["reason"]>([
  "copy-moved",
  "league-moved",
  "older-day",
  "older-rules",
  "newer-schema",
]);

/** The schema the published meta says it is of, as a word for the log. */
const schemaOf = (raw: unknown): string => {
  const schema = (raw as { schema?: unknown } | null)?.schema;
  return typeof schema === "number" ? String(schema) : "unknown";
};

const main = async (): Promise<void> => {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) {
    console.log("No FIREBASE_SERVICE_ACCOUNT here, so there are no views to publish.");
    process.exitCode = 1;
    return;
  }
  const opened = openStores(key, "live");
  const published = (await opened.live.readMeta())?.meta ?? null;
  if (!needsRepublish(published)) {
    console.log(
      `The published views are of schema ${schemaOf(published)} and this build writes ${LIVE_SCHEMA}: they are left to the rebuilds after saves and the night.`
    );
    return;
  }
  const loaded = await loadPoolFrom(opened.copy);
  if (!loaded) {
    console.log("There is no cloud copy, so there are no views to publish.");
    return;
  }
  const { manifest } = loaded;
  if (copyTooNew(manifest)) {
    console.log(
      "The copy was saved or tidied by a newer build than this one, so its views are that build's to publish."
    );
    return;
  }
  console.log(
    `${
      published === null
        ? "Nothing is published yet"
        : `The published views are of schema ${schemaOf(published)}, older than this build's ${LIVE_SCHEMA}`
    }: publishing the views of the copy at version ${manifest.version} (${loaded.keys} parts, ${mb(loaded.bytes)} gzipped, read in ${since()}).`
  );
  const views = await publishCopyViews({
    copyStore: opened.copy,
    liveStore: opened.live,
    manifest,
    today: todayIsoDay(),
    now: () => new Date().toISOString(),
    leagueDocs: opened.leagueDocs,
  });
  tellViews(views, false);
  if (views.ok ? !views.sweep.ok : !SETTLED.has(views.reason)) process.exitCode = 1;
};

try {
  await main();
} catch (error) {
  // The message only: nothing here quotes the key, and a stack adds nothing a public log needs.
  console.log(`The republish stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  // The store opens a channel to other tabs that would keep the process alive.
  resetTeamRankingsStore();
}
console.log(`Done in ${since()}; memory at the end ${mb(process.memoryUsage().rss)}.`);
process.exit(process.exitCode ?? 0);
