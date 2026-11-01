import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * What a reader sees, measured in the built app (2.5): League Standings in light mode and dark, on a
 * phone, a tablet and a desktop, on every view of the demo season, on the first launch with no
 * season, and while a view is still loading or has failed to; and Team Rankings on a seeded pool,
 * on every section, the club sheet, the full table cut to one state, and the My Team card telling
 * what moved since the last visit.
 *
 * - Text is legible against what is actually painted behind it: 4.5:1, or 3:1 for large text (24px,
 *   or 18.66px bold), as WCAG 2 measures contrast, from the colours the browser computed, with
 *   see-through layers blended down to the first solid one.
 * - No text is smaller than 12px, but for the labels of a phone's tab bar, which are sized with the
 *   screen (`TabNav`).
 * - Nothing is wider than the screen.
 * - No two of Team Rankings' buttons and links have their words touch on a line, and on a phone each
 *   is a tap area 44 px each way, but for one that shares its line with the page's own words
 *   (`controlProblems`).
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

/**
 * What is wrong with the buttons and links under `selector`, each said with `where`. Runs in the
 * page, and passes over anything hidden or read only by a screen reader.
 *
 * - Two laid out in one box whose words touch on a line, less than a space apart, read as one word.
 *   On a wide screen Scouting's What if? and Scout sat inline beside each other under a game with
 *   nothing between them, and read "What if?Scout". Only one box's: a sheet, or the tab bar, is
 *   drawn over the page's own controls without being read with them.
 * - With `taps`, one smaller than 44 px either way, the size a thumb finds without aiming (WCAG's
 *   2.5.5), with its size, but for one switched off. One that shares its line with the page's own
 *   words, a club's name in a sentence of The Weekly, is left out, as WCAG's inline exception has
 *   it: the line sizes it. Words elsewhere in its box do not make it one. Counted by the box's
 *   words, as it first was, What if? and Scout, each on a line of its own under the opponent's
 *   name, were let off by the name above them at 48 by 16 and 34 by 16 px.
 */
const controlProblems = (page: Page, selector: string, where: string, taps: boolean) =>
  page
    .evaluate(
      ({ selector, taps }) => {
        const CONTROL = "button, a[href], [role='button'], [role='tab']";
        /** The box a line belongs to: the first of `start` and its ancestors that is no inline. */
        const blockOf = (start: Element | null): Element => {
          for (let at = start; at; at = at.parentElement) {
            const display = getComputedStyle(at).display;
            if (!display.startsWith("inline") && display !== "contents") return at;
          }
          return document.body;
        };
        /** Drawn where an eye sees it, and not clipped to nothing for a screen reader up to `top`. */
        const seen = (element: Element, top: Element) => {
          if (!element.checkVisibility({ checkOpacity: true, visibilityProperty: true })) {
            return false;
          }
          for (let at: Element | null = element; at; at = at.parentElement) {
            if (getComputedStyle(at).clipPath !== "none") return false;
            if (at === top) break;
          }
          return true;
        };
        /** The words inside `within` an eye sees that `keep` chooses, each with its boxes. */
        const shown = (within: Element, keep: (text: Text) => boolean) => {
          const found: { text: Text; boxes: DOMRect[] }[] = [];
          const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node as Text;
            const parent = text.parentElement;
            if (!text.data.trim() || !parent || !seen(parent, within) || !keep(text)) continue;
            const range = document.createRange();
            range.selectNodeContents(text);
            const boxes = [...range.getClientRects()].filter(
              (box) => box.width >= 1 && box.height >= 1
            );
            if (boxes.length > 0) found.push({ text, boxes });
          }
          return found;
        };
        /** Where those words are drawn, a box a line. */
        const lines = (within: Element, keep: (text: Text) => boolean) =>
          shown(within, keep).flatMap((one) => one.boxes);
        /** A control as a reader knows it: its label, or the words it shows. */
        const nameOf = (control: Element) =>
          (
            control.getAttribute("aria-label") ??
            shown(control, () => true)
              .map((one) => one.text.data)
              .join("")
              .replace(/\s+/g, " ")
              .trim()
          ).slice(0, 40);
        /** Two boxes on one line: they overlap by more than half the shorter one's height. */
        const sameLine = (one: DOMRect, two: DOMRect) =>
          Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top) >
          Math.min(one.height, two.height) / 2;

        const found: string[] = [];
        for (const root of document.querySelectorAll(selector)) {
          const controls = [...root.querySelectorAll<HTMLElement>(CONTROL)].filter((control) => {
            const box = control.getBoundingClientRect();
            return box.width >= 1 && box.height >= 1 && seen(control, control);
          });
          const drawn = controls.map((control) => ({
            control,
            block: blockOf(control.parentElement),
            boxes: lines(control, () => true),
          }));
          drawn.forEach(({ control, block, boxes }, at) => {
            for (const other of drawn.slice(at + 1)) {
              if (other.block !== block) continue;
              if (control.contains(other.control) || other.control.contains(control)) continue;
              const gap = Math.min(
                ...boxes.flatMap((one) =>
                  other.boxes
                    .filter((two) => sameLine(one, two))
                    .map((two) => Math.max(two.left - one.right, one.left - two.right))
                )
              );
              if (gap < 2) {
                found.push(
                  `${nameOf(control)} and ${nameOf(other.control)}: ${Math.round(gap)} px apart`
                );
              }
            }
          });
          if (!taps) continue;
          for (const control of controls) {
            if (control.closest(":disabled, [aria-disabled='true'], [aria-hidden='true']"))
              continue;
            const box = control.getBoundingClientRect();
            if (box.width >= 44 && box.height >= 44) continue;
            if (getComputedStyle(control).display.startsWith("inline")) {
              const block = blockOf(control.parentElement);
              const sentence = lines(
                block,
                (text) =>
                  !text.parentElement?.closest(CONTROL) && blockOf(text.parentElement) === block
              );
              if (sentence.some((line) => sameLine(line, box))) continue;
            }
            found.push(
              `${nameOf(control)}: ${Math.round(box.width)} by ${Math.round(box.height)} px`
            );
          }
        }
        return found;
      },
      { selector, taps }
    )
    .then((found) => found.map((one) => `${where}: ${one}`));

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

/**
 * Team Rankings' pool for these checks, as an older version of the app kept it, in `localStorage`,
 * which the store moves into IndexedDB as it opens: one page of twelve clubs in two states, eight
 * weekends played and the next ones ahead, some with starts. The page's clock is held on a Friday
 * of that autumn, so the board, the card and the Games tab's day are the same on every run, and the
 * club marked as ours was last looked at two days before, last of the twelve, so the card opens on
 * what moved since. Placeholder names throughout.
 */
const RANKINGS_NOW = new Date("2026-10-30T12:00:00");
const RANKINGS_PAGE = "ag_10u_2027";
const CLUBS = [
  "Aces",
  "Bears",
  "Comets",
  "Ducks",
  "Eagles",
  "Falcons",
  "Giants",
  "Hawks",
  "Jays",
  "Knights",
  "Lions",
  "Mustangs",
].map((name, at) => ({
  id: `S-${name.toUpperCase()}`,
  name,
  state: at % 2 === 0 ? "KY" : "OH",
  city: at % 2 === 0 ? "Southvale" : "Northvale",
}));
const dayAfter = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const rankingsPool = (): Record<string, string> => {
  const ids = CLUBS.map((club) => club.id);
  const games: Record<string, unknown>[] = [];
  // Eight rounds of a round robin, a Saturday apart, the circle method: the first club stays put.
  for (let round = 0; round < 8; round += 1) {
    const order = [ids[0]!, ...ids.slice(1).map((_, at) => ids[1 + ((at + round) % 11)]!)];
    for (let pair = 0; pair < 6; pair += 1) {
      const a = order[pair]!;
      const b = order[11 - pair]!;
      // The club listed earlier wins, by a margin that varies, and every fifth game the other.
      const [winner, loser] =
        ids.indexOf(a) < ids.indexOf(b) === ((round + pair) % 5 !== 0) ? [a, b] : [b, a];
      games.push({
        id: `r${round}-${pair}`,
        ageGroupId: RANKINGS_PAGE,
        teamAId: winner,
        teamBId: loser,
        teamAScore: 5 + ((round + pair) % 4),
        teamBScore: 1 + (pair % 3),
        date: dayAfter("2026-09-05", round * 7),
      });
    }
  }
  // Still to play: ours on Saturday at two starts, Sunday with none, and the week after.
  const ahead = (id: string, a: string, b: string, date: string, startTs?: string) => ({
    id,
    ageGroupId: RANKINGS_PAGE,
    teamAId: a,
    teamBId: b,
    date,
    ...(startTs ? { startTs } : {}),
  });
  games.push(
    ahead("n1", "S-ACES", "S-HAWKS", "2026-10-31", "2026-10-31T14:30:00.000Z"),
    ahead("n2", "S-JAYS", "S-ACES", "2026-10-31", "2026-10-31T19:00:00.000Z"),
    ahead("n3", "S-ACES", "S-LIONS", "2026-11-01"),
    ahead("n4", "S-BEARS", "S-COMETS", "2026-10-31", "2026-10-31T15:00:00.000Z"),
    ahead("n5", "S-ACES", "S-DUCKS", "2026-11-07")
  );
  const look = {
    v: 1,
    at: RANKINGS_NOW.getTime() - 48 * 3_600_000,
    teamId: "S-ACES",
    board: "Fall 2026",
    national: 12,
    nationalOf: 12,
    state: "KY",
    stateRank: 6,
    record: "0-8",
    rating: -4,
  };
  return {
    league_forecast_scout_age_groups_v1: JSON.stringify([
      {
        id: RANKINGS_PAGE,
        name: "10U 2027",
        ageLevel: 10,
        year: 2027,
        seasonIds: [],
        myTeamId: "S-ACES",
      },
    ]),
    league_forecast_scout_teams_v1: JSON.stringify(CLUBS),
    league_forecast_scout_games_v1: JSON.stringify(games),
    "lf_my_team_look_v1_S-ACES": JSON.stringify(look),
  };
};

/** A Team Rankings section, by its tab, or on a phone, More and then the section. */
const openSection = async (page: Page, name: string) => {
  if (await tab(page, name).isVisible()) await tab(page, name).click();
  else {
    await page.getByRole("button", { name: /^More/ }).click();
    await page
      .getByRole("group", { name: "More team rankings section" })
      .getByRole("button", { name, exact: true })
      .click();
  }
  await expect(page.getByRole("status").filter({ hasText: /^Loading / })).toHaveCount(0);
};

/** The Forecast's sections in their order (`FORECAST_SECTIONS`); it opens on the first. */
const FORECAST_SECTIONS = ["Outlook", "Brackets", "Playoff machine", "Games", "Season"];

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
          if (view !== "Forecast") continue;
          // The Forecast shows one section at a time; each is checked, not only the first.
          for (const section of FORECAST_SECTIONS.slice(1)) {
            await page.getByRole("button", { name: section, exact: true }).click();
            problems.push(
              ...(await check(page, info, `${size.name}-${scheme}-${view}-${section}`))
            );
          }
        }
        expect(problems).toEqual([]);
      });

      test("Team Rankings, on a seeded pool", async ({ page }, info) => {
        await page.clock.setFixedTime(RANKINGS_NOW);
        await page.addInitScript((keys) => {
          // Once a visit, so a reload keeps whatever the page made of the pool.
          if (window.sessionStorage.getItem("e2e-seeded")) return;
          window.sessionStorage.setItem("e2e-seeded", "1");
          for (const [key, value] of Object.entries(keys)) window.localStorage.setItem(key, value);
        }, rankingsPool());
        await page.goto("/?view=rankings");
        const card = page.getByRole("region", { name: "My team" });
        await expect(card.getByRole("region", { name: "Since you last looked" })).toBeVisible();
        await expect(page.getByRole("heading", { name: /^National top 25/ })).toBeVisible();
        const phone = size.name === "phone";
        const state = `${size.name}-${scheme}-rankings`;
        const problems = await check(page, info, state);
        const controls = await controlProblems(page, "#main-content", state, phone);

        // The full table, cut to one state's clubs, where each row also carries its place on the
        // whole board in grey.
        await page.getByRole("button", { name: /^Show all \d+ teams$/ }).click();
        await page.locator("#scout-state-filter").selectOption("KY");
        await expect(page.getByText(/Showing 6 of 12 teams\./)).toBeVisible();
        problems.push(...(await check(page, info, `${size.name}-${scheme}-full-table`)));
        controls.push(...(await controlProblems(page, "#main-content", "full table", phone)));
        await page.getByRole("button", { name: "Hide the full table" }).click();

        // The club sheet, from the card's name.
        await card.getByRole("button", { name: /Aces/ }).first().click();
        const sheet = page.getByRole("dialog", { name: "Aces" });
        await expect(sheet.getByRole("region", { name: "Aces" })).toBeVisible();
        problems.push(...(await check(page, info, `${size.name}-${scheme}-club`)));
        controls.push(...(await controlProblems(page, "#main-content", "club", phone)));
        await sheet.getByRole("button", { name: "Close" }).click();
        await expect(sheet).toHaveCount(0);

        for (const section of ["Games", "Scouting", "Import", "Archive", "Setup"]) {
          await openSection(page, section);
          problems.push(...(await check(page, info, `${size.name}-${scheme}-${section}`)));
          // Taps in the sections a parent reads at the field; Import, Archive and Setup are the
          // owner's.
          const field = section === "Games" || section === "Scouting";
          controls.push(...(await controlProblems(page, "#main-content", section, phone && field)));
        }
        expect(problems).toEqual([]);
        expect(controls).toEqual([]);
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
