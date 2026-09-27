import { expect, test, type Page } from "@playwright/test";

/**
 * The Forecast tab on a phone, where the postseason is entered before the Schedule has it.
 *
 * The bracket laid its rounds side by side in columns at least 280px wide and as wide as their
 * longest line ("Model score: 8-9 · 53% win chance for the bracket pick"), so on a 360px screen
 * each game card was 421 to 438px inside a 286px scroller: all 18 run boxes and Set Final buttons
 * of the demo's two brackets sat past the edge, behind a sideways swipe nothing pointed to. On a
 * phone the rounds now stack, one under another, each card the scroller's width.
 */
const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

/** The demo season's Forecast tab, and its brackets. */
const forecast = async (page: Page) => {
  await page.goto("/");
  await tab(page, "Settings").click();
  await page.getByRole("button", { name: "Load Demo" }).click();
  const confirm = page.getByRole("button", { name: "Load demo" });
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();

  await tab(page, "Forecast").click();
  await page.locator('section[aria-label="Championship and seed odds"]').waitFor();
  const brackets = page.locator('section[aria-label="Bracket prediction model"]');
  await expect(brackets.first()).toBeVisible();
  return brackets;
};

test.describe("on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("the bracket's rounds still run left to right", async ({ page }) => {
    const brackets = await forecast(page);
    const rounds = await brackets
      .first()
      .locator(".overflow-x-auto > div > div")
      .evaluateAll((columns) => columns.map((column) => column.getBoundingClientRect()));
    expect(rounds.length).toBeGreaterThan(1);
    rounds.slice(1).forEach((round, at) => {
      expect(round.top).toBe(rounds[at]!.top);
      expect(round.left).toBeGreaterThan(rounds[at]!.right);
    });
  });
});

test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });

test("on a phone every bracket score box sits on screen and the title odds read as a chart", async ({
  page,
}) => {
  const brackets = await forecast(page);

  const controls = await brackets.evaluateAll((sections) =>
    sections.flatMap((section) => {
      const scroller = section.querySelector(".overflow-x-auto")!.getBoundingClientRect();
      return [...section.querySelectorAll("article input, article button")].map((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= scroller.left - 0.5 && box.right <= scroller.right + 0.5;
      });
    })
  );
  // Both of the demo's brackets: six games, a Set Final and two run boxes each.
  expect(controls.length).toBe(18);
  expect(controls.filter((inside) => !inside)).toHaveLength(0);

  // A bar a reader can compare, not the 10px left beside a name, a percent and a finals figure.
  const bar = await page
    .locator('section[aria-label="Championship and seed odds"] ul > li > div')
    .first()
    .boundingBox();
  expect(bar!.width).toBeGreaterThan(100);
});
