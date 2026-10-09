/**
 * How quickly League Standings answers a score being entered (2.2), measured in the built app in a
 * real browser with its CPU slowed four times, as a mid-range phone runs it. Build first, then
 * `npm run score:bench`; it serves `dist/` itself.
 *
 * Two made-up seasons, invented names only: a late one (8 teams, each pair twice, 10 games left,
 * where the exact clinch and seed analysis is on) and a mid one (12 teams, each pair twice, 54
 * games left). On the Schedule tab it types both teams' runs into a game, a key at a time as a
 * person would, and marks it Final, for several games in turn. It reports:
 *
 * - **Keystroke**: each key's interaction time, from the key to the next frame painted (the Event
 *   Timing API's `duration`, which is what Interaction to Next Paint is made of).
 * - **Final**: the same for the Final button.
 * - **Busy after**: how long the main thread is then kept busy in long tasks (over 50 ms each)
 *   recomputing the season, which is what the next keystroke or tap would wait behind.
 * - **Tab**: from a tab's click to its content drawn, Schedule to Forecast and back.
 *
 * Numbers vary a little from run to run; compare medians across a change, on one machine.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

const PORT = 4179;
const BASE = `http://localhost:${PORT}`;
const THROTTLE = 4;
const GAMES_PER_SEASON = 5;
const NAMES = [
  "Aces",
  "Bears",
  "Comets",
  "Ducks",
  "Eagles",
  "Foxes",
  "Giants",
  "Hawks",
  "Ibis",
  "Jays",
  "Kings",
  "Lions",
];

/** Each pair twice by the circle method, a round a week, the first `played` rounds scored. */
const season = (teamCount, played) => {
  const teams = NAMES.slice(0, teamCount).map((name) => ({ id: name.toLowerCase(), name }));
  const matchups = [];
  const logs = {};
  const rounds = teamCount - 1;
  for (let leg = 0; leg < 2; leg += 1) {
    for (let round = 0; round < rounds; round += 1) {
      const week = leg * rounds + round;
      const date = new Date(Date.UTC(2026, 2, 1 + week * 7)).toISOString().slice(0, 10);
      for (let slot = 0; slot < teamCount / 2; slot += 1) {
        const a = slot === 0 ? teamCount - 1 : (round + slot) % (teamCount - 1);
        const b = (round + teamCount - 1 - slot) % (teamCount - 1);
        const [away, home] = leg === 0 ? [a, b] : [b, a];
        const id = `g${matchups.length + 1}`;
        matchups.push({ id, date, away: teams[away].id, home: teams[home].id });
        if (week < played) {
          const n = matchups.length;
          const awayRuns = 2 + ((n * 7 + away * 3) % 9);
          const homeRuns = 2 + ((n * 5 + home * 3) % 9);
          logs[id] = {
            innings: "6",
            awayRuns: String(awayRuns),
            homeRuns: String(awayRuns === homeRuns ? homeRuns + 1 : homeRuns),
            awayHits: String(awayRuns + 3),
            homeHits: String(homeRuns + 3),
            awayK: "5",
            homeK: "4",
            isFinal: true,
          };
        }
      }
    }
  }
  return { teams, matchups, logs, settings: { goldCutoff: teamCount / 2 } };
};

const SEASONS = [
  { name: "late season (8 teams, 12 games left)", ...season(8, 11) },
  { name: "mid season (12 teams, 54 games left)", ...season(12, 13) },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : NaN;
};
const p90 = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.ceil(sorted.length * 0.9) - 1] : NaN;
};
const ms = (value) => `${Math.round(value)} ms`;

const stop = (server) => {
  try {
    process.kill(-server.pid);
  } catch {
    // already gone
  }
};

const serve = async () => {
  // A server already on the port would be measured in place of this build, so that is refused,
  // and this one runs in a group of its own, so stopping it stops the vite process `npx` starts.
  if (
    await fetch(BASE).then(
      () => true,
      () => false
    )
  ) {
    throw new Error(`Something is already serving ${BASE}; stop it first.`);
  }
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    stdio: "ignore",
    detached: true,
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(BASE)).ok) return server;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stop(server);
  throw new Error("vite preview did not start");
};

/** Collects every interaction's duration and every long task, from here on. */
const observe = () => {
  window.__bench = { events: [], long: [] };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.interactionId) {
        window.__bench.events.push({
          id: entry.interactionId,
          name: entry.name,
          at: entry.startTime,
          duration: entry.duration,
        });
      }
    }
  }).observe({ type: "event", durationThreshold: 16, buffered: false });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      window.__bench.long.push({ at: entry.startTime, duration: entry.duration });
    }
  }).observe({ type: "longtask", buffered: false });
};

/** Waits until no long task has run for `quiet` ms (up to 30 s), so the season has settled. */
const settle = async (page, quiet = 1_500) => {
  const started = Date.now();
  for (;;) {
    const idleFor = await page.evaluate(() => {
      const last = window.__bench.long.at(-1);
      return performance.now() - (last ? last.at + last.duration : 0);
    });
    if (idleFor >= quiet || Date.now() - started > 30_000) return;
    await page.waitForTimeout(250);
  }
};

const busySince = (page, since) =>
  page.evaluate(
    (from) =>
      window.__bench.long
        .filter((task) => task.at >= from)
        .reduce((sum, task) => sum + task.duration, 0),
    since
  );

const run = async (browser, fixture) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.evaluate((data) => {
    localStorage.clear();
    localStorage.setItem("league_teams_v1", JSON.stringify(data.teams));
    localStorage.setItem("league_matchups_v1", JSON.stringify(data.matchups));
    localStorage.setItem("league_logs_v1", JSON.stringify(data.logs));
    localStorage.setItem("league_settings_v1", JSON.stringify(data.settings));
  }, fixture);
  await page.reload();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await page.evaluate(observe);

  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  await page.locator("article[id^='game-card-']").first().waitFor();
  await settle(page);

  const keys = [];
  const finals = [];
  const busy = [];
  for (let game = 0; game < GAMES_PER_SEASON; game += 1) {
    const card = page
      .locator("article[id^='game-card-']")
      .filter({ has: page.getByRole("button", { name: "Mark game as final" }) })
      .first();
    const runs = card.locator("input[aria-label$=' Runs']");
    const before = await page.evaluate(() => window.__bench.events.length);
    await runs.nth(0).click();
    await page.keyboard.type(String(3 + (game % 6)), { delay: 120 });
    await page.keyboard.type("1", { delay: 120 });
    await runs.nth(1).click();
    await page.keyboard.type(String(2 + (game % 5)), { delay: 120 });
    await settle(page);
    const typed = await page.evaluate((from) => window.__bench.events.slice(from), before);
    const byInteraction = new Map();
    for (const entry of typed) {
      if (!entry.name.startsWith("key")) continue;
      byInteraction.set(entry.id, Math.max(byInteraction.get(entry.id) ?? 0, entry.duration));
    }
    // A key answered inside 16 ms leaves no entry (the API's floor), so it counts as 16.
    keys.push(...byInteraction.values(), ...Array(Math.max(0, 3 - byInteraction.size)).fill(16));

    const finalFrom = await page.evaluate(() => [performance.now(), window.__bench.events.length]);
    await card.getByRole("button", { name: "Mark game as final" }).click();
    await settle(page);
    const clicked = await page.evaluate((from) => window.__bench.events.slice(from), finalFrom[1]);
    finals.push(
      Math.max(
        0,
        ...clicked
          .filter((entry) => /pointer|click|mouse/.test(entry.name))
          .map((entry) => entry.duration)
      )
    );
    busy.push(await busySince(page, finalFrom[0]));
  }

  const tabs = [];
  for (const [tab, ready] of [
    ["Forecast", "section[aria-label='Championship and seed odds']"],
    ["Schedule", "article[id^='game-card-']"],
    ["Forecast", "section[aria-label='Championship and seed odds']"],
    ["Schedule", "article[id^='game-card-']"],
  ]) {
    const started = await page.evaluate(() => performance.now());
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page.locator(ready).first().waitFor();
    tabs.push({ tab, ms: (await page.evaluate(() => performance.now())) - started });
    await settle(page);
  }
  await context.close();
  return { keys, finals, busy, tabs };
};

const server = await serve();
try {
  const executablePath = existsSync("/opt/pw-browsers/chromium")
    ? "/opt/pw-browsers/chromium"
    : undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  console.log(`Score entry on the Schedule tab, CPU slowed ${THROTTLE}x, phone width:`);
  for (const fixture of SEASONS) {
    const result = await run(browser, fixture);
    console.log(`\n${fixture.name}`);
    console.log(
      `  keystroke to paint: median ${ms(median(result.keys))}, p90 ${ms(p90(result.keys))}, worst ${ms(Math.max(0, ...result.keys))} (${result.keys.filter((key) => key > 50).length} of ${result.keys.length} keys over 50 ms)`
    );
    console.log(
      `  Final to paint:     median ${ms(median(result.finals))}, worst ${ms(Math.max(...result.finals))}`
    );
    console.log(
      `  busy after a Final: median ${ms(median(result.busy))}, worst ${ms(Math.max(...result.busy))}`
    );
    console.log(
      `  tabs: ${result.tabs.map(({ tab, ms: took }) => `${tab} ${ms(took)}`).join(", ")}`
    );
  }
  await browser.close();
} finally {
  stop(server);
}
