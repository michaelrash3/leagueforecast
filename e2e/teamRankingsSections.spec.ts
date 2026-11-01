import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Team Rankings in the built app, whose sections each load their own code when first opened
 * (`teamRankings/sections.ts`). The unit tests load every section before they draw, so a fault that
 * shows only in a section's built chunk, or in the tidy worker's, would pass them; this opens each
 * section from the build, and runs one look at the pool through the worker.
 *
 * What the page fetched is read by source module, off each script's source map, since a module
 * shared by two chunks lands in a file named after whichever module the bundler picks. The pool is
 * seeded as an older version of the app kept it, in `localStorage`, which the store moves into
 * IndexedDB as it opens. Nothing leaves the machine: every request to another host is refused.
 */

const PAGE = "ag_10_2027";
const groups = [{ id: PAGE, name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] }];
const teams = [
  { id: "S-ACES", name: "Aces" },
  { id: "S-BEARS", name: "Bears" },
  { id: "S-COMETS", name: "Comets" },
  { id: "S-DUCKS", name: "Ducks" },
];
const game = (id: string, a: string, b: string, aRuns: number, bRuns: number, date: string) => ({
  id,
  ageGroupId: PAGE,
  teamAId: a,
  teamBId: b,
  teamAScore: aRuns,
  teamBScore: bRuns,
  date,
});
const games = [
  game("g1", "S-ACES", "S-BEARS", 6, 2, "2026-09-12"),
  game("g2", "S-BEARS", "S-COMETS", 3, 1, "2026-09-13"),
  game("g3", "S-COMETS", "S-DUCKS", 5, 4, "2026-09-19"),
  game("g4", "S-DUCKS", "S-ACES", 2, 9, "2026-09-26"),
];

/** The source modules a built script holds, as its source map lists them. */
const modulesOf = (file: string): string[] => {
  try {
    const map = JSON.parse(readFileSync(`dist/assets/${file}.map`, "utf8")) as {
      sources: string[];
    };
    return map.sources.map((source) => source.replace(/^(\.\.\/)+/, ""));
  } catch {
    return [];
  }
};

/** Whether a script the page fetched holds the module. A worker's own bundle holds its own copy. */
const holds = (fetched: readonly string[], module: string): boolean =>
  fetched.some((file) => !file.includes(".worker-") && modulesOf(file).includes(module));

/** The page with the pool in place: the script files it fetched, and whatever it said went wrong. */
const openWithPool = async (page: Page) => {
  const fetched: string[] = [];
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && !text.includes("net::ERR_FAILED"))
      failures.push(`console: ${text}`);
    // A worker that fails is answered on the page, which would hide that it failed.
    if (/worker failed/i.test(text)) failures.push(`console: ${text}`);
  });
  await page.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === "localhost" || hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith("/assets/") && pathname.endsWith(".js"))
      fetched.push(pathname.replace("/assets/", ""));
  });
  await page.addInitScript(
    (pool) => {
      // Once a visit, so a reload keeps whatever the page made of the pool.
      if (window.sessionStorage.getItem("e2e-seeded")) return;
      window.sessionStorage.setItem("e2e-seeded", "1");
      window.localStorage.setItem(
        "league_forecast_scout_age_groups_v1",
        JSON.stringify(pool.groups)
      );
      window.localStorage.setItem("league_forecast_scout_teams_v1", JSON.stringify(pool.teams));
      window.localStorage.setItem("league_forecast_scout_games_v1", JSON.stringify(pool.games));
    },
    { groups, teams, games }
  );
  return { fetched, failures };
};

const GAMES = "src/components/teamRankings/GamesSection.tsx";
const IMPORT = "src/components/GameChangerImportPanel.tsx";
const SCOUTING = "src/components/teamRankings/ScoutingSection.tsx";
const TOURNAMENT = "src/components/teamRankings/TournamentPanel.tsx";
const ARCHIVE = "src/components/teamRankings/ArchiveSection.tsx";
const SETUP = "src/components/teamRankings/SetupSection.tsx";
/** The tidy and the look at the pool, which opening the page leaves to the worker and Setup. */
const TIDY = "src/lib/gameChangerImport.ts";
const INSPECTION = "src/lib/poolHealth.ts";

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true });

test("Team Rankings opens with none of its sections' code, and each section draws from its own", async ({
  page,
}) => {
  const { fetched, failures } = await openWithPool(page);
  await page.goto("/?view=rankings");
  await expect(page.getByText("Aces").first()).toBeVisible();
  // The games' too, unless the page has already been idle long enough to fetch them (below).
  const atOpen = [IMPORT, SCOUTING, TOURNAMENT, ARCHIVE, SETUP, TIDY, INSPECTION];
  expect(atOpen.filter((module) => holds(fetched, module))).toEqual([]);
  await expect.poll(() => holds(fetched, GAMES)).toBe(true);

  for (const [section, module, drawn] of [
    ["Games", GAMES, page.getByRole("button", { name: "Add Game" })],
    ["Scouting", SCOUTING, page.getByRole("heading", { name: "Scouting report" })],
    ["Archive", ARCHIVE, page.getByRole("heading", { name: "Finished seasons" })],
    ["Import", IMPORT, page.getByText("Pull from GameChanger").first()],
    ["Setup", SETUP, page.getByRole("button", { name: /Check the pool|Look again/ })],
  ] as const) {
    await tab(page, section).click();
    await expect(drawn).toBeVisible();
    expect(holds(fetched, module), section).toBe(true);
  }
  expect(holds(fetched, TOURNAMENT)).toBe(true);
  expect(failures).toEqual([]);
});

test("Setup's look at the pool is answered by the tidy worker", async ({ page }) => {
  const { fetched, failures } = await openWithPool(page);
  await page.goto("/?view=rankings&section=setup");
  await page.getByRole("button", { name: "Check the pool" }).click();
  await expect(page.getByRole("button", { name: "Look again" })).toBeVisible({ timeout: 30_000 });
  expect(fetched.some((file) => file.startsWith("tidy.worker-"))).toBe(true);
  expect(failures).toEqual([]);
});
