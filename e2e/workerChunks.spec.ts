import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

/**
 * The three workers have to be in the build.
 *
 * Vite finds a worker by matching the whole `new Worker(new URL("./x.worker.ts", import.meta.url),
 * { type: "module" })` expression at one place in the source. It is a syntactic match, not a value
 * it can follow, so moving any part of that expression behind a helper splits it in two and no
 * chunk is emitted. Nothing complains: the build succeeds, `typeof Worker` is still a function, and
 * the app starts — it just runs the rankings fit, the pool tidy and every simulation on the main
 * thread instead. On a nationwide pool the tidy alone is twenty seconds of frozen tab, which the
 * browser reloads, which cancels the tidy before it can record that it ran, which starts it again
 * on the next load.
 *
 * That happened. Every unit test passed throughout, because they stub `Worker`, and the build was
 * green, because a build with no workers in it is a valid build. The only thing that would have
 * caught it is looking at what was actually emitted, so that is what this does.
 */
test("every worker is emitted as its own chunk", () => {
  const assets = readdirSync("dist/assets");
  const chunkFor = (name: string) =>
    assets.filter((file) => file.startsWith(`${name}-`) && file.endsWith(".js"));

  for (const worker of ["sim.worker", "rankings.worker", "tidy.worker"]) {
    expect(
      chunkFor(worker),
      `No chunk for ${worker}. Its \`new Worker(new URL(...))\` expression has probably been split up, so this job now runs on the main thread.`
    ).toHaveLength(1);
  }
});
