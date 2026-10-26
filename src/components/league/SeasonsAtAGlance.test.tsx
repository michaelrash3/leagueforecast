import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { storedBases } from "../../lib/live/leagueBase";
import { seasonDocId } from "../../lib/live/leagueDocs";
import { writeOurTeam } from "../../lib/preferences";
import {
  listSeasons,
  readSeasonSnapshot,
  replaceLeagueSnapshot,
  type SeasonSnapshot,
} from "../../lib/storage";
import { DEFAULT_SETTINGS, type GameLog, type Settings } from "../../lib/types";
import { SeasonManager } from "./SeasonManager";

/*
 * The Seasons card's glance at every season this device holds. Placeholder names: two falls of one
 * league, the earlier one over, the later one open and under way, and a spring league of its own.
 */
const failNext = vi.hoisted(() => ({ glance: false }));
const loads = vi.hoisted(() => ({ glance: 0 }));
// A download held on its way, as on one bar at a ballpark, until the test lets it land.
const held = vi.hoisted(() => ({
  until: null as Promise<void> | null,
  land: (): void => undefined,
}));

// A download that fails, as `import()` fails when the connection drops: once, then not.
vi.mock("./SeasonsAtAGlance", async (importOriginal) => {
  loads.glance += 1;
  if (held.until) await held.until;
  if (failNext.glance) {
    failNext.glance = false;
    throw new TypeError("Failed to fetch dynamically imported module");
  }
  return importOriginal();
});

const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
const teams = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
];
const matchups = [
  { id: "g1", date: "9/6", away: "B", home: "A" },
  { id: "g2", date: "9/13", away: "A", home: "B" },
];
const season = (
  id: string,
  name: string,
  createdAt: string,
  logs: Record<string, GameLog>,
  settings: Partial<Settings> = {}
): SeasonSnapshot => ({
  id,
  name,
  createdAt,
  updatedAt: createdAt.replace("-08-", "-10-"),
  teams,
  matchups,
  logs,
  bracketLogs: {},
  settings: { ...DEFAULT_SETTINGS, seasonLabel: name, ...settings },
});

const store = () => {
  replaceLeagueSnapshot({
    activeSeasonId: "fall-26",
    seasons: [
      season(
        "fall-25",
        "Fall 2025",
        "2025-08-01T00:00:00.000Z",
        { g1: final("2", "6"), g2: final("1", "4") },
        { postseasonFormat: "none" }
      ),
      season("spring-26", "Spring 2026", "2026-02-01T00:00:00.000Z", {}),
      season("fall-26", "Fall 2026", "2026-08-01T00:00:00.000Z", { g1: final("3", "5") }),
    ],
  });
  // After the seasons, which let go of whatever was kept under ids new here.
  writeOurTeam("fall-25", "B");
};

const renderCard = (seasons = listSeasons()) =>
  render(
    <SeasonManager
      seasons={seasons}
      activeSeasonId="fall-26"
      onSwitch={vi.fn()}
      onCreate={vi.fn()}
      onDuplicate={vi.fn()}
      onDelete={vi.fn()}
    />
  );

const open = async () => {
  await userEvent.setup().click(screen.getByRole("button", { name: "Seasons at a glance" }));
  return screen.findByRole("region", { name: "Seasons at a glance" });
};

describe("the seasons at a glance", () => {
  beforeEach(() => {
    window.localStorage.clear();
    store();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    failNext.glance = false;
    // Landed even when a test fails while holding it, so the next test's download is not stuck.
    held.land();
    held.until = null;
  });

  /*
   * First, while the glance has never been downloaded: once it has, the card keeps it for the rest
   * of the visit (`viewChunk`), as the page would.
   */
  it("downloads nothing until opened, says it is loading and when the download fails, and Try again fetches it afresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    failNext.glance = true;
    held.until = new Promise<void>((resolve) => (held.land = resolve));
    renderCard(listSeasons());
    expect(loads.glance).toBe(0);
    await userEvent.setup().click(screen.getByRole("button", { name: "Seasons at a glance" }));

    // Opened over a download still on its way, the panel says so, announced, rather than stand empty.
    expect(await screen.findByRole("status")).toHaveTextContent("Loading the seasons at a glance…");
    held.until = null;
    held.land();
    expect(await screen.findByText("Seasons at a glance could not be shown")).toBeInTheDocument();
    expect(loads.glance).toBe(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Seasons at a glance" })).toBeInTheDocument();
    expect(loads.glance).toBe(2);
  });

  it("reads nothing from storage until it is opened", async () => {
    const seasons = listSeasons();
    const reads = vi.spyOn(Storage.prototype, "getItem");
    renderCard(seasons);

    const toggle = screen.getByRole("button", { name: "Seasons at a glance" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Seasons at a glance" })).toBeNull();
    expect(reads).not.toHaveBeenCalled();

    await open();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(reads).toHaveBeenCalled();
  });

  it("sets one league's seasons side by side, newest first, with how each ended", async () => {
    renderCard();
    const glance = await open();

    const headings = within(glance).getAllByRole("heading");
    expect(headings.map((heading) => heading.textContent)).toEqual(["Fall", "Spring"]);
    const names = within(glance)
      .getAllByRole("listitem")
      .map((item) => item.getAttribute("aria-label"))
      .filter(Boolean);
    expect(names).toEqual(["Fall 2026", "Fall 2025", "Spring 2026"]);

    const done = within(glance).getByRole("listitem", { name: "Fall 2025" });
    expect(within(done).getByText("Final")).toBeInTheDocument();
    expect(within(done).getByText("Regular season: Aces finished first.")).toBeInTheDocument();
    expect(within(done).getByText("Bears finished 2 of 2.")).toBeInTheDocument();

    const current = within(glance).getByRole("listitem", { name: "Fall 2026" });
    expect(within(current).getByText("Open")).toBeInTheDocument();
    expect(
      within(current).getByText("In progress: 1 of 2 played, led by Aces.")
    ).toBeInTheDocument();

    const spring = within(glance).getByRole("listitem", { name: "Spring 2026" });
    expect(within(spring).getByText("In progress: 0 of 2 played.")).toBeInTheDocument();
  });

  it("marks a season League kept live has a copy of, other than the open one, as maybe behind", async () => {
    const base = (id: string, createdAt?: string) => {
      const held = readSeasonSnapshot(id);
      if (!held) throw new Error(`no season ${id}`);
      storedBases.write(seasonDocId(id), {
        season: { ...held, ...(createdAt ? { createdAt } : {}) },
        rev: 3,
        landed: [],
      });
    };
    base("fall-25");
    base("fall-26");
    // A copy kept for a deleted season whose id this one reuses, made at another moment.
    base("spring-26", "2025-02-01T00:00:00.000Z");
    renderCard();
    const glance = await open();

    const behind = /^May be behind: this device's copy as of \d+ days ago\.$/;
    expect(
      within(within(glance).getByRole("listitem", { name: "Fall 2025" })).getByText(behind)
    ).toBeInTheDocument();
    for (const name of ["Fall 2026", "Spring 2026"]) {
      const row = within(glance).getByRole("listitem", { name });
      expect(within(row).queryByText(/May be behind/)).toBeNull();
    }
  });
});
