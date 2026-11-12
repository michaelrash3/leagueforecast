/**
 * Draws the app's icons as PNGs from the two SVGs in `public/`: `node scripts/renderIcons.mjs`.
 *
 * iOS takes a home-screen icon only as a PNG. Given the SVG, as `index.html` gave it, it puts a
 * small picture of the page on the home screen in place of an icon, and an Android launcher that
 * will not draw an SVG does much the same from the manifest. The SVGs stay the source: change one
 * and run this again. The letters are drawn in whatever the machine running it has for a heavy
 * sans-serif, Inter Black where these were made, which is the one thing a PNG fixes and the SVG
 * leaves to each device.
 *
 * - `apple-touch-icon.png`, 180px, from the maskable drawing: iOS rounds the corners itself and
 *   fills anything see-through with black, so it is given the square that runs to every edge.
 * - `icon-192.png` and `icon-512.png`, the sizes an installable app is asked for.
 * - `icon-maskable-512.png`, for a launcher that cuts its own shape.
 * - `og.png`, 1200 by 630: the picture a link to the site is shown with in a text thread or a chat
 *   (`src/lib/linkPreview.ts`). The icon's mark, the app's name and a line saying what it is for.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const ICONS = [
  { from: "icon-maskable.svg", to: "apple-touch-icon.png", size: 180 },
  { from: "icon.svg", to: "icon-192.png", size: 192 },
  { from: "icon.svg", to: "icon-512.png", size: 512 },
  { from: "icon-maskable.svg", to: "icon-maskable-512.png", size: 512 },
];

// The Chromium Claude Code on the web has ready, where there is one, as `playwright.config.ts` does.
const preinstalled = "/opt/pw-browsers/chromium";
const browser = await chromium.launch(
  existsSync(preinstalled) ? { executablePath: preinstalled } : {}
);
try {
  for (const { from, to, size } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = readFileSync(join(publicDir, from), "utf8");
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`
    );
    await page.screenshot({ path: join(publicDir, to), omitBackground: true });
    await page.close();
    console.log(`${to}: ${size}px from ${from}`);
  }
  // The icon's mark by itself, cut to its own edges: on the card's ground, which is the icon's,
  // the icon's square and the letters under the mark would not show.
  const path = /<path[^>]*\/>/.exec(readFileSync(join(publicDir, "icon.svg"), "utf8"))?.[0];
  if (!path) throw new Error("icon.svg has no mark to draw");
  const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="118 178 276 168">${path}</svg>`;
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<style>
    html, body { margin: 0; }
    body { width: 1200px; height: 630px; box-sizing: border-box; padding: 96px; background: #0f172a;
      color: #fff; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
      display: flex; flex-direction: column; justify-content: center; }
    svg { display: block; width: 210px; height: 128px; }
    h1 { margin: 44px 0 0; font-size: 104px; line-height: 1; font-weight: 900; letter-spacing: -0.04em; }
    p { margin: 28px 0 0; max-width: 900px; font-size: 40px; line-height: 1.3; font-weight: 600; color: #cbd5e1; }
    i { display: block; margin-top: 44px; width: 136px; height: 8px; border-radius: 4px; background: #38bdf8; }
  </style>${mark}
  <h1>League Forecast</h1>
  <p>Standings, power ratings and playoff odds.</p><i></i>`);
  await card.screenshot({ path: join(publicDir, "og.png") });
  await card.close();
  console.log("og.png: 1200 by 630");
} finally {
  await browser.close();
}
