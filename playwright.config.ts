import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * One browser, one smoke spec, against the built app.
 *
 * `vite preview` serves `dist/`, so build first: `npm run build && npm run test:e2e`. CI builds two
 * steps earlier. On Claude Code on the web a Chromium is preinstalled and downloading another is
 * blocked, so it is used when it is there and nothing is running in CI; everywhere else Playwright
 * finds its own.
 */
const preinstalled = "/opt/pw-browsers/chromium";
const executablePath = !process.env.CI && existsSync(preinstalled) ? preinstalled : undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  webServer: {
    command: "npx vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
