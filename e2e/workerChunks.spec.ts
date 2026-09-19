import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * Every worker has to be in the build.
 *
 * Vite finds a worker by matching the whole `new Worker(new URL("./x.worker.ts", import.meta.url),
 * { type: "module" })` expression at one place in the source. It is a syntactic match, not a value
 * it can follow, so moving any part of that expression into another module splits it in two and no
 * chunk is emitted. Nothing complains: the build succeeds, `typeof Worker` is still a function, and
 * the app starts — it just runs the rankings fit, the pool tidy and every simulation on the main
 * thread instead. On a nationwide pool the tidy alone is twenty seconds of frozen tab, which the
 * browser reloads, which cancels the tidy before it can record that it ran, which starts it again
 * on the next load.
 *
 * That happened. Every unit test passed throughout, because they stub `Worker`, and the build was
 * green, because a build with no workers in it is a valid build. The only thing that would have
 * caught it is looking at what was actually emitted, so that is what this does.
 *
 * The list comes from the source directory rather than being written out here, so a worker added
 * later is covered by this the day it is added rather than the day someone remembers to add it.
 */
const workerNames = readdirSync("src/workers")
  .filter((file) => file.endsWith(".worker.ts"))
  .map((file) => file.replace(/\.ts$/, ""));

test("every worker in src/workers is emitted as its own chunk", () => {
  expect(workerNames.length, "no worker sources found — has src/workers moved?").toBeGreaterThan(0);

  const assets = readdirSync("dist/assets");
  const missing = workerNames.filter(
    (name) => !assets.some((file) => file.startsWith(`${name}-`) && file.endsWith(".js"))
  );

  expect(
    missing,
    `No chunk emitted for: ${missing.join(", ")}. The \`new Worker(new URL(...))\` expression has probably been split across modules, so this job now runs on the main thread.`
  ).toEqual([]);
});
