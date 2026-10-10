/**
 * The members' views published again from the cloud copy as it stands (README, "Views a server
 * publishes"), run by the Firebase workflow once a push to main has deployed. It publishes only when
 * nothing is published, or what is was published under an older schema than this build writes
 * (`needsRepublish`): then no device of this build can draw the boards, and without this every
 * member was left on the older schema's notice until the next nightly, which GitHub starts hours
 * late. Any other time it says so and leaves the views to the rebuilds after saves and the night.
 *
 * What it does, and when it has done it, is `republishViews`'s, where it is tested: the copy laid
 * into the app's pool store in memory exactly as a pull lays it (`loadPoolFrom`), refused where a
 * newer build saved it or tidied it (`copyTooNew`), the views built and published from it under the
 * copy and version read, tried again on the copy as it then stands when a save moved it meanwhile,
 * and the run failed only where the views still want publishing at its end. It opens the copy as
 * the nightly does, on the same Firebase key, with only `live/` writable (`openStores`,
 * `restServerStores`): it pulls nothing and saves nothing of the copy. It prints counts, sizes and
 * timings only: this repository is public, and so are its Actions logs.
 *
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" npm run republish
 *
 * Run under the nightly's time zone and collation (`TZ=America/New_York`, `LANG=en_US.UTF-8`), whose
 * day and order of tied rows the views are built in, and with its heap, since it holds the whole pool.
 */
import { todayIsoDay } from "../src/lib/date.ts";
import { republishViews, REPUBLISH_TRIES } from "../src/lib/live/republish.ts";
import { LIVE_SCHEMA } from "../src/lib/live/viewStore.ts";
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

/** The schema the published meta says it is of, as a word for the log. */
const schemaOf = (raw: unknown): string => {
  const schema = (raw as { schema?: unknown } | null)?.schema;
  return typeof schema === "number" ? String(schema) : "unknown";
};

/** What is published, in a few words for the log. */
const publishedAs = (raw: unknown): string =>
  raw === null || raw === undefined
    ? "nothing is published"
    : `the published views are of schema ${schemaOf(raw)}`;

const main = async (): Promise<void> => {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) {
    console.log("No FIREBASE_SERVICE_ACCOUNT here, so there are no views to publish.");
    process.exitCode = 1;
    return;
  }
  const opened = openStores(key, "live");
  const result = await republishViews({
    copyStore: opened.copy,
    liveStore: opened.live,
    leagueDocs: opened.leagueDocs,
    today: todayIsoDay,
    now: () => new Date().toISOString(),
    onLoaded: (loaded, published, attempt) =>
      console.log(
        `${attempt > 1 ? `Try ${attempt} of ${REPUBLISH_TRIES}: ` : ""}${publishedAs(published)}, and this build writes ${LIVE_SCHEMA}: publishing the views of the copy at version ${loaded.manifest.version} (${loaded.keys} parts, ${mb(loaded.bytes)} gzipped, read in ${since()}).`
      ),
    onViews: (views) => tellViews(views, false),
  });
  const said: Record<typeof result.end, string> = {
    "not-needed": `${publishedAs(result.found)} and this build writes ${LIVE_SCHEMA}: they are left to the rebuilds after saves and the night.`,
    "no-copy": "There is no cloud copy, so there are no views to publish.",
    "newer-copy":
      "The copy was saved or tidied by a newer build than this one, so its views are that build's to publish.",
    published: `Published in ${result.tries} ${result.tries === 1 ? "try" : "tries"}.`,
    "published-since": `Not published by this run, but ${publishedAs(result.now)} now, which this build need not replace.`,
    refused: `Not published after ${result.tries} ${result.tries === 1 ? "try" : "tries"}, and ${publishedAs(result.now)} still: members of this build are left on the notice.`,
  };
  console.log(said[result.end].charAt(0).toUpperCase() + said[result.end].slice(1));
  if (!result.ok) process.exitCode = 1;
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
