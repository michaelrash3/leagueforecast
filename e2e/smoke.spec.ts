import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The one path everything else depends on, driven through a real browser: a season loads, a
 * score goes in, the standings move, and the backup that leaves the browser holds what was typed.
 * Unit tests cover each piece; this is the check that the pieces are wired to each other.
 */

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

/** Every "W-L" cell on the standings table, top to bottom. */
const records = async (page: Page): Promise<string[]> =>
  (await page.locator("td").allTextContents())
    .map((text) => text.trim())
    .filter((text) => /^\d+-\d+(-\d+)?$/.test(text));

/** Wins plus losses plus ties across the table: one final adds exactly two. */
const gamesPlayed = (cells: string[]): number =>
  cells.reduce(
    (sum, cell) => sum + cell.split("-").reduce((inner, part) => inner + Number(part), 0),
    0
  );

test("a season loads, a score moves the standings, and the backup carries it", async ({ page }) => {
  await page.goto("/");

  // A demo season, from Settings. A browser that already has data is asked first.
  await tab(page, "Settings").click();
  await page.getByRole("button", { name: "Load Demo" }).click();
  const confirm = page.getByRole("button", { name: "Load demo" });
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();

  await tab(page, "Standings").click();
  const before = await records(page);
  expect(before.length).toBeGreaterThan(0);

  // The first open game on the schedule, scored 5–3 and marked final.
  await tab(page, "Schedule").click();
  const runs = page.getByLabel(/ Runs$/);
  await expect(runs.first()).toBeVisible();
  const away = (await runs.nth(0).getAttribute("aria-label"))!.replace(/ Runs$/, "");
  const home = (await runs.nth(1).getAttribute("aria-label"))!.replace(/ Runs$/, "");
  await runs.nth(0).fill("5");
  await runs.nth(1).fill("3");
  await page
    .getByRole("button", { name: /Mark game as final/ })
    .first()
    .click();

  // Exactly one more game in the table, and the two sides are the ones that moved.
  await tab(page, "Standings").click();
  await expect.poll(async () => gamesPlayed(await records(page))).toBe(gamesPlayed(before) + 2);
  await expect(page.getByRole("link", { name: new RegExp(away) }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(home) }).first()).toBeVisible();

  // The backup that leaves the browser holds the score just typed, and says it was just taken.
  await tab(page, "Settings").click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Backup JSON" }).click(),
  ]);
  const path = await download.path();
  expect(path).not.toBeNull();
  const backup = JSON.parse(readFileSync(path!, "utf8")) as {
    seasons?: {
      logs?: Record<string, { awayRuns?: string; homeRuns?: string; isFinal?: boolean }>;
    }[];
  };
  const logs = Object.values(backup.seasons?.[0]?.logs ?? {});
  expect(logs.some((log) => log.isFinal && log.awayRuns === "5" && log.homeRuns === "3")).toBe(
    true
  );
  await expect(page.getByTestId("freshness")).toContainText("Last backup: today");
});
