import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * What a reader sees, measured in the built app (2.5): League Standings in light mode and dark, on a
 * phone, a tablet and a desktop, on every view of the demo season, on the first launch with no
 * season, and while a view is still loading or has failed to.
 *
 * - Text is legible against what is actually painted behind it: 4.5:1, or 3:1 for large text (24px,
 *   or 18.66px bold), as WCAG 2 measures contrast, from the colours the browser computed, with
 *   see-through layers blended down to the first solid one.
 * - No text is smaller than 12px, but for the labels of a phone's tab bar, which are sized with the
 *   screen (`TabNav`).
 * - Nothing is wider than the screen.
 *
 * These read the rendered page and do not depend on how a font is drawn, so they hold in CI as on
 * any machine; a pixel-by-pixel comparison of screenshots would not, between one Chromium and its
 * fonts and another's. To look the states over by eye, run this file with SCREENS=1, which keeps a
 * full-page screenshot of each in `test-results/`.
 */

type Problem = { where: string; text: string; problem: string };

/**
 * Every visible run of text on the page, with what is wrong with it, if anything. Runs in the page.
 * Text drawn over a picture or a gradient is counted but not measured, as is text in a chart's
 * SVG, a control switched off (WCAG asks nothing of an inactive control), and anything hidden.
 */
const audit = (page: Page) =>
  page.evaluate(() => {
    type Rgba = [number, number, number, number];
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const paint = canvas.getContext("2d", { willReadFrequently: true });
    if (!paint) throw new Error("No 2D canvas");
    const parsed = new Map<string, Rgba>();
    /** Any CSS colour as sRGB and alpha, 0 to 1, by letting a canvas draw it. */
    const rgba = (css: string): Rgba => {
      const known = parsed.get(css);
      if (known) return known;
      paint.clearRect(0, 0, 1, 1);
      paint.fillStyle = "#000";
      paint.fillStyle = css;
      paint.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = paint.getImageData(0, 0, 1, 1).data;
      const colour: Rgba = [r / 255, g / 255, b / 255, a / 255];
      parsed.set(css, colour);
      return colour;
    };
    const over = ([r, g, b, a]: Rgba, [R, G, B]: Rgba): Rgba => [
      r * a + R * (1 - a),
      g * a + G * (1 - a),
      b * a + B * (1 - a),
      1,
    ];
    const linear = (channel: number) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    const luminance = ([r, g, b]: Rgba) =>
      0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    const contrast = (one: Rgba, two: Rgba) => {
      const [light, dark] = [luminance(one), luminance(two)].sort((x, y) => y - x);
      return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
    };
    const hex = ([r, g, b]: Rgba) =>
      `#${[r, g, b]
        .map((channel) =>
          Math.round(channel * 255)
            .toString(16)
            .padStart(2, "0")
        )
        .join("")}`;

    /** The solid colour behind an element, or null over a picture or a gradient. */
    const backdrop = (element: Element): Rgba | null => {
      const layers: Rgba[] = [];
      for (let at: Element | null = element; at; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.backgroundImage !== "none") return null;
        const colour = rgba(style.backgroundColor);
        if (colour[3] > 0) layers.push(colour);
        if (colour[3] >= 1) break;
      }
      return layers.reduceRight<Rgba>((under, layer) => over(layer, under), [1, 1, 1, 1]);
    };
    /** How see-through an element is drawn, all its ancestors' opacity multiplied in. */
    const opacity = (element: Element) => {
      let product = 1;
      for (let at: Element | null = element; at; at = at.parentElement)
        product *= Number(getComputedStyle(at).opacity);
      return product;
    };
    /** A short path to an element, to find it by. */
    const where = (element: Element) => {
      const steps: string[] = [];
      for (let at: Element | null = element; at && steps.length < 4; at = at.parentElement) {
        const id = at.id ? `#${at.id}` : "";
        const label = at.getAttribute("aria-label");
        steps.unshift(`${at.tagName.toLowerCase()}${id}${label ? `[${label.slice(0, 30)}]` : ""}`);
        if (id) break;
      }
      return steps.join(" > ");
    };

    const problems: { where: string; text: string; problem: string }[] = [];
    let measured = 0;
    let unmeasured = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const element = node.parentElement;
      if (!text || !element) continue;
      if (!element.checkVisibility({ checkOpacity: true, visibilityProperty: true })) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();
      if (box.width <= 1 || box.height <= 1) continue;
      if (
        element.closest("svg") ||
        element.closest(":disabled, [aria-disabled='true']") ||
        // Read by a screen reader, not shown: Tailwind's `sr-only` clips to a pixel.
        getComputedStyle(element).clipPath !== "none"
      ) {
        unmeasured += 1;
        continue;
      }
      const style = getComputedStyle(element);
      const size = Number.parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;
      const snippet = text.slice(0, 60);
      if (size < 12 && !element.closest("[data-tab-bar]")) {
        problems.push({ where: where(element), text: snippet, problem: `${size}px text` });
      }
      const ground = backdrop(element);
      if (!ground) {
        unmeasured += 1;
        continue;
      }
      const [r, g, b, a] = rgba(style.color);
      const ink = over([r, g, b, a * opacity(element)], ground);
      const ratio = contrast(ink, ground);
      const needed = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      measured += 1;
      if (ratio < needed) {
        problems.push({
          where: where(element),
          text: snippet,
          problem: `${ratio.toFixed(2)}:1, ${hex(ink)} on ${hex(ground)}, ${size}px${bold ? " bold" : ""}`,
        });
      }
    }
    // Against the layout viewport: a phone zooms out to fit a page that is too wide, and then the
    // window's own width grows with it and hides the overflow.
    const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    if (overflow > 0) {
      problems.push({ where: "page", text: "", problem: `${overflow}px wider than the screen` });
    }
    return { problems, measured, unmeasured };
  });

/** Audits the page as it stands, keeping a screenshot when SCREENS is set. */
const check = async (page: Page, info: TestInfo, state: string): Promise<Problem[]> => {
  // Colours as they settle, not halfway through a tab's fade from one to the next.
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }",
  });
  if (process.env.SCREENS) {
    await page.screenshot({ path: info.outputPath(`${state}.png`), fullPage: true });
  }
  const { problems, measured } = await audit(page);
  // A page that measured nothing has not been checked at all.
  expect(measured, `text measured in ${state}`).toBeGreaterThan(0);
  return problems.map((problem) => ({ ...problem, where: `${state}: ${problem.where}` }));
};

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

/** A League view, by its tab, or on a phone, More and then the view (2.4). */
const openView = async (page: Page, name: string) => {
  await page.getByRole("tablist", { name: "Main views" }).waitFor();
  if (await tab(page, name).isVisible()) await tab(page, name).click();
  else {
    await page.getByRole("button", { name: /^More/ }).click();
    await page
      .getByRole("group", { name: "More main views" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await expect(page.getByRole("status").filter({ hasText: /^Loading / })).toHaveCount(0);
  await expect(page.locator('[role="tabpanel"]')).toBeVisible();
};

const VIEWS = [
  "Dashboard",
  "Schedule",
  "Standings",
  "Forecast",
  "Power Ratings",
  "League Stats",
  "Data Quality",
  "Settings",
];

const SIZES = [
  { name: "phone", viewport: { width: 360, height: 800 }, mobile: true },
  { name: "tablet", viewport: { width: 768, height: 1024 }, mobile: true },
  { name: "desktop", viewport: { width: 1280, height: 900 }, mobile: false },
] as const;

test.describe.configure({ mode: "parallel" });

for (const scheme of ["light", "dark"] as const) {
  for (const size of SIZES) {
    test.describe(`${size.name}, ${scheme}`, () => {
      test.use({
        viewport: size.viewport,
        colorScheme: scheme,
        isMobile: size.mobile,
        hasTouch: size.mobile,
      });

      test("the first launch, with no season", async ({ page }, info) => {
        await page.goto("/");
        await expect(page.getByRole("button", { name: "Load Demo" }).first()).toBeVisible();
        expect(await check(page, info, `${size.name}-${scheme}-empty`)).toEqual([]);
      });

      test("every view of a season", async ({ page }, info) => {
        await page.goto("/");
        await openView(page, "Settings");
        await page.getByRole("button", { name: "Load Demo" }).click();
        const confirm = page.getByRole("button", { name: "Load demo" });
        if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
        const problems: Problem[] = [];
        for (const view of VIEWS) {
          await openView(page, view);
          problems.push(...(await check(page, info, `${size.name}-${scheme}-${view}`)));
        }
        expect(problems).toEqual([]);
      });
    });
  }
}

test.describe("a view that is loading, or failed to load", () => {
  for (const scheme of ["light", "dark"] as const) {
    test.describe(scheme, () => {
      test.use({ viewport: { width: 360, height: 800 }, colorScheme: scheme, isMobile: true });

      test("says so legibly", async ({ page }, info) => {
        // League Stats' code is held back, then refused: first the placeholder, then the failure.
        let release: (() => void) | undefined;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(/\/assets\/TeamStatsView-[^/]+\.js$/, async (route) => {
          await held;
          await route.abort();
        });
        await page.goto("/");
        await openView(page, "Settings");
        await page.getByRole("button", { name: "Load Demo" }).click();
        const confirm = page.getByRole("button", { name: "Load demo" });
        if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
        await page.getByRole("button", { name: /^More/ }).click();
        await page
          .getByRole("group", { name: "More main views" })
          .getByRole("button", { name: "League Stats", exact: true })
          .click();
        await expect(page.getByRole("status").filter({ hasText: /^Loading / })).toBeVisible();
        const problems = await check(page, info, `phone-${scheme}-loading`);
        release?.();
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        problems.push(...(await check(page, info, `phone-${scheme}-failed`)));
        expect(problems).toEqual([]);
      });
    });
  }
});
