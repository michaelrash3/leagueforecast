import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/*
 * Team Rankings' sections load on demand (`sections.ts`): opening Team Rankings fetched every
 * section's code, though the page opens on the rankings and shows one section at a time. A section
 * starts loading when its tab is pointed at or focused, the games once the rankings are drawn and
 * the page is idle; a placeholder stands in while one loads, and a load that fails is that
 * section's Try again, which fetches it afresh.
 *
 * The harness loads every section's code before it draws (`teamRankingsHarness`), so two chunks
 * are made here instead, whose loads each test holds or fails by hand: the archive's and the
 * tournament panel's.
 */
const loads = vi.hoisted(() => ({
  asked: [] as string[],
  archiveFails: false,
  tournamentHeld: Promise.resolve(),
}));

vi.mock("./sections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sections")>();
  const { viewChunk } = await import("../viewChunk");
  const archiveSection = viewChunk(
    () =>
      loads.archiveFails
        ? Promise.reject(new Error("The archive's code could not be fetched."))
        : import("./ArchiveSection").then((module) => module.ArchiveSection),
    "ArchiveSection"
  );
  const tournamentPanel = viewChunk(
    () =>
      loads.tournamentHeld
        .then(() => import("./TournamentPanel"))
        .then((module) => module.TournamentPanel),
    "TournamentPanel"
  );
  return {
    ...actual,
    archiveSection,
    tournamentPanel,
    prefetchSection: (section: Parameters<typeof actual.prefetchSection>[0]) => {
      loads.asked.push(section);
      return actual.prefetchSection(section);
    },
    resetSection: (section: Parameters<typeof actual.resetSection>[0]) => {
      if (section === "archive") archiveSection.reset();
      actual.resetSection(section);
    },
  };
});

const on = seasonDate(2027);
const pool = () => ({
  ageGroups: [ageGroup(10, 2027, { myTeamId: "S-ACE" })],
  teams: [team("S-ACE", "Aces"), team("S-BEA", "Bears"), team("S-COM", "Comets")],
  games: [
    game("g1", "ag_10u_2027", "S-ACE", "S-BEA", 6, 4, { date: on }),
    game("g2", "ag_10u_2027", "S-BEA", "S-COM", 7, 2, { date: on }),
    game("g3", "ag_10u_2027", "S-COM", "S-ACE", 1, 9, { date: on }),
  ],
});

/** A wide screen, where every section's tab is in the row. */
beforeEach(() => {
  loads.asked = [];
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("min-width"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Team Rankings' sections, loaded on demand", () => {
  it("starts a section's load when its tab is pointed at or focused", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.hover(screen.getByRole("tab", { name: "Setup" }));
    expect(loads.asked).toContain("setup");
    screen.getByRole("tab", { name: "Archive" }).focus();
    expect(loads.asked).toContain("archive");
  });

  it("loads the games once the rankings are drawn and the page has been idle", () => {
    vi.useFakeTimers();
    renderTeamRankings(pool());
    act(() => vi.advanceTimersByTime(1_000));
    expect(loads.asked).not.toContain("games");
    act(() => vi.advanceTimersByTime(500));
    expect(loads.asked).toContain("games");
  });

  it("says a section's code is loading, then that it failed, and Try again fetches it afresh", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    loads.archiveFails = true;
    const user = userEvent.setup();
    renderTeamRankings({ ...pool(), search: "?section=archive" });
    expect(screen.getByRole("status")).toHaveTextContent("Loading the archive…");
    expect(await screen.findByText("The archive could not be shown")).toBeInTheDocument();
    // Only the section failed: the tabs above it still go elsewhere.
    expect(screen.getByRole("tab", { name: "Rankings" })).toBeEnabled();
    loads.archiveFails = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Finished seasons" })).toBeInTheDocument();
  });

  it("keeps the scouting report on screen while the tournament panel's code loads", async () => {
    let release: () => void = () => undefined;
    loads.tournamentHeld = new Promise<void>((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    renderTeamRankings(pool());
    await user.click(screen.getByRole("tab", { name: "Scouting" }));
    expect(await screen.findByRole("heading", { name: "Scouting report" })).toBeInTheDocument();
    expect(screen.queryByText("Loading the scouting report…")).toBeNull();
    expect(screen.queryByRole("region", { name: "Tournament field" })).toBeNull();
    await act(async () => release());
    expect(await screen.findByRole("region", { name: "Tournament field" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scouting report" })).toBeInTheDocument();
  });
});
