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
} finally {
  await browser.close();
}
