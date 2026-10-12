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

/**
 * A League view, opened as a person would: its tab, or on a phone, where only the main views have
 * one, More and then the view (2.4).
 */
const openView = async (page: Page, name: string) => {
  // The row first: asked before the page has drawn it, no tab is visible yet, and a desktop has
  // no More to fall back on.
  await page.getByRole("tablist", { name: "Main views" }).waitFor();
  if (await tab(page, name).isVisible()) return tab(page, name).click();
  await page.getByRole("button", { name: /^More/ }).click();
  await page
    .getByRole("group", { name: "More main views" })
    .getByRole("button", { name, exact: true })
    .click();
};

/** The demo season's Forecast tab, and its brackets. */
const forecast = async (page: Page) => {
  await page.goto("/");
  await openView(page, "Settings");
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

/*
 * The header on a phone. The theme toggle sat at the end of the controls, and fell to a row of its
 * own under the season picker whenever the season's name was long — the demo's is — and on Team
 * Rankings always, pushing the page 54px down the first screen: measured from the title, the demo's
 * Standings started at 435.5px and Team Rankings at 151px, against 381.5px and 97px with the toggle
 * in the title row, the logo's size, where it costs nothing. The cloud button shares that row, and
 * beside it the title at its full size took a second line, starting Standings at 409.5px; a size
 * smaller on a phone it keeps to one, and Standings starts at 379.5px.
 */
test.describe("the header on a phone", () => {
  test.use({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });

  /**
   * Where the toggle and the page start, measured from the title rather than the screen: the tab
   * switch keeps Settings' scroll, so the screen's top is wherever Load Demo was.
   */
  const header = async (page: Page) => {
    /*
     * The app's own title, by name: Team Rankings draws a heading of its own at that level, and an
     * unnamed one found both whenever the page had drawn before it was measured.
     */
    const title = (await page
      .getByRole("heading", { level: 1, name: "League Forecast" })
      .boundingBox())!;
    const toggle = (await page
      .getByRole("button", { name: /Switch to (dark|light) mode/ })
      .filter({ visible: true })
      .boundingBox())!;
    const main = (await page.locator("main").first().boundingBox())!;
    return {
      toggleMiddle: toggle.y + toggle.height / 2 - title.y,
      titleHeight: title.height,
      mainBelowTitle: main.y - title.y,
    };
  };

  test("keeps the theme toggle in the title row and the page high", async ({ page }) => {
    await page.goto("/");
    await openView(page, "Settings");
    await page.getByRole("button", { name: "Load Demo" }).click();
    const confirm = page.getByRole("button", { name: "Load demo" });
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
    await tab(page, "Standings").click();

    const league = await header(page);
    // On the title's line: its middle within the title's box.
    expect(league.toggleMiddle).toBeGreaterThan(0);
    expect(league.toggleMiddle).toBeLessThan(league.titleHeight);
    expect(league.mainBelowTitle).toBeLessThanOrEqual(400);

    await tab(page, "Team Rankings").click();
    // Measured once the page has drawn, not whenever the click happens to land.
    await page.getByRole("heading", { level: 1, name: "Team Rankings" }).waitFor();
    const rankings = await header(page);
    expect(rankings.mainBelowTitle).toBeLessThanOrEqual(120);
  });
});

/*
 * League Standings' tab bar on a phone (2.4): the views a season is read and scored in, each cell
 * and More wholly on screen with its label inside it, at the narrowest phones in use and at 125%
 * browser zoom (a 360px phone is then 288px of page), and the rest a press of More away. A tablet
 * keeps every tab in its row.
 */
test.describe("the League tab bar", () => {
  const checkBar = async (page: Page, width: number) => {
    const cells = [
      ...(await page.getByRole("tablist", { name: "Main views" }).getByRole("tab").all()),
      page.getByRole("button", { name: /^More/ }),
    ];
    for (const cell of cells) {
      const { x, width: wide } = (await cell.boundingBox())!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + wide).toBeLessThanOrEqual(width + 0.5);
      // The label inside its cell, not spilling into the next one.
      const spill = await cell.evaluate((node) => node.scrollWidth - node.clientWidth);
      expect(spill).toBeLessThanOrEqual(0);
    }
  };

  for (const [name, width] of [
    ["320px", 320],
    ["360px", 360],
    ["390px", 390],
    ["a 360px phone at 125% zoom", 288],
  ] as const) {
    test(`at ${name} keeps the main views on screen and the rest under More`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await page.goto("/");
      const bar = page.getByRole("tablist", { name: "Main views" });
      await expect(bar.getByRole("tab")).toHaveText([
        "Dashboard",
        "Schedule",
        "Standings",
        "Forecast",
      ]);
      await checkBar(page, width);

      await page.getByRole("button", { name: "More" }).click();
      const more = page.getByRole("group", { name: "More main views" });
      const box = (await more.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await more.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(page.getByRole("button", { name: "More: Settings" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Load Demo" })).toBeVisible();
    });
  }

  test("leaves the bottom of a page above the bar", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/");
    await openView(page, "Settings");
    await page.getByRole("button", { name: "Load Demo" }).click();
    const confirm = page.getByRole("button", { name: "Load demo" });
    if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
    await tab(page, "Standings").click();
    // Drawn first: the view loads on demand (2.1), and an empty page scrolls nowhere.
    await expect(page.getByRole("heading", { name: "Standings", level: 2 })).toBeVisible();
    const bar = (await page.getByRole("tablist", { name: "Main views" }).boundingBox())!;
    // The last thing on the page, scrolled as far down as it goes, clear of the bar.
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 100_000);
        return page
          .locator("main")
          .evaluate((main) => main.lastElementChild?.getBoundingClientRect().bottom ?? Infinity);
      })
      .toBeLessThanOrEqual(bar.y);
  });

  test("on a tablet holds every view in a row, with no More", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");
    await expect(page.getByRole("tablist", { name: "Main views" }).getByRole("tab")).toHaveCount(8);
    await expect(page.getByRole("button", { name: /^More/ })).toHaveCount(0);
  });
});
