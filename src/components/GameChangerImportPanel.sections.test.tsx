import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPoolBusy, lastPullLog, resetPullSession } from "../lib/pullSession";
import type { GcTeamResponse } from "../lib/gameChangerApi";
import type { GcImportState } from "../lib/gameChangerImport";
import type { GcPullProgress } from "../lib/gameChangerPull";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../lib/teamRankings";
import {
  addScoutGames,
  loadScoutGames,
  resetTeamRankingsStore,
  saveAgeGroups,
  saveScoutGames,
  saveScoutGamesForGroups,
  type PoolHolding,
} from "../lib/teamRankingsStorage";

/**
 * A pull run in sections, one age page at a time.
 *
 * The reason it exists is memory: a fold over the whole pool was measured at 332 MB on forty
 * thousand teams and two hundred thousand games, and that is what had been running the tab out of
 * memory an hour into a nationwide refresh. None of that is testable here — what is testable is
 * the contract that makes it safe, and every one of these is about a way of getting it wrong that
 * loses somebody's pool.
 */
/** Every pool the end-of-run tidy was handed, which is what says it saw more than one page. */
const tidied: GcImportState[] = [];
vi.mock("../hooks/usePoolTidy", () => ({
  usePoolTidy: () => ({
    busy: null,
    inspect: async () => null,
    tidy: async (state: GcImportState) => {
      tidied.push(state);
      // No change, so the panel's post-tidy save never runs and the counts stay the run's own.
      return {
        state,
        tidy: {
          named: 0,
          folded: 0,
          paired: 0,
          collapsed: 0,
          pruned: 0,
          reclaimed: 0,
          refiled: 0,
          claimed: 0,
          releveled: 0,
        },
      };
    },
  }),
}));

const asked: string[][] = [];
/**
 * Held open so the run can be looked at while it is going. Every id answers the moment it is
 * asked for, so without this the whole run is over inside one React batch and the pulling stage
 * — which is where the section is named and the count is kept — is never on screen to read.
 *
 * `holds` is the same thing one section at a time: each fetch parks until the test lets it go, so
 * what the panel does *between* two sections can be read rather than inferred from the end state.
 */
let pause: Promise<void> | null = null;
let holdEach = false;
const holds: Array<() => void> = [];
vi.mock("../lib/gameChangerClient", async () => {
  const actual = await vi.importActual<typeof import("../lib/gameChangerClient")>(
    "../lib/gameChangerClient"
  );
  return {
    ...actual,
    fetchGcTeams: vi.fn(
      async (
        ids: string[],
        options?: {
          signal?: AbortSignal;
          onProgress?: (p: {
            done: number;
            total: number;
            teamId: string;
            result: GcTeamResponse;
          }) => void;
        }
      ) => {
        asked.push(ids);
        const out = new Map<string, GcTeamResponse>();
        ids.forEach((teamId, index) => {
          if (options?.signal?.aborted) return;
          const level = LEVEL_OF.get(teamId) ?? 12;
          const result: GcTeamResponse = {
            ok: true,
            schedule: {
              profile: {
                id: teamId,
                name: `${teamId} ${level}U`,
                ageLevel: level,
                season: { season: "fall", year: 2026 },
              },
              games: [],
              fetchedAt: "2026-09-17T00:00:00.000Z",
            },
          };
          out.set(teamId, result);
          options?.onProgress?.({ done: index + 1, total: ids.length, teamId, result });
        });
        if (holdEach) await new Promise<void>((resolve) => holds.push(resolve));
        if (pause) await pause;
        return out;
      }
    ),
  };
});

const { GameChangerImportPanel } = await import("./GameChangerImportPanel");

const GROUPS: AgeGroup[] = [
  { id: "10u", name: "10U 2027", ageLevel: 10, year: 2027, seasonIds: [] },
  { id: "11u", name: "11U 2027", ageLevel: 11, year: 2027, seasonIds: [] },
];

/** Two pages, six ids each — enough that a section is plainly not the whole run. */
const PAGE_IDS: Record<string, string[]> = {
  "10u": Array.from({ length: 6 }, (_, i) => `TenA000000${i}0`),
  "11u": Array.from({ length: 6 }, (_, i) => `ElvA000000${i}0`),
};
const ALL_IDS = [...PAGE_IDS["10u"]!, ...PAGE_IDS["11u"]!];
const LEVEL_OF = new Map(
  Object.entries(PAGE_IDS).flatMap(([groupId, ids]) =>
    ids.map((id) => [id, groupId === "10u" ? 10 : 11] as const)
  )
);

const teams: ScoutTeam[] = Object.entries(PAGE_IDS).flatMap(([ageGroupId, ids]) =>
  ids.map((teamId) => ({
    id: `team-${teamId}`,
    name: `${teamId} ${LEVEL_OF.get(teamId)}U`,
    gcTeams: [
      {
        teamId,
        name: `${teamId} ${LEVEL_OF.get(teamId)}U`,
        ageGroupId,
        season: "fall",
        seasonYear: 2026,
        ageLevel: LEVEL_OF.get(teamId),
      },
    ],
  }))
);

/** One stored result per page, so a section that wrote over the other page would be visible. */
const games: ScoutGame[] = GROUPS.map((group) => ({
  id: `stored-${group.id}`,
  ageGroupId: group.id,
  teamAId: `team-${PAGE_IDS[group.id]![0]}`,
  teamBId: `team-${PAGE_IDS[group.id]![1]}`,
  teamAScore: 7,
  teamBScore: 3,
  date: "2026-09-10",
}));

const pool: GcImportState = { ageGroups: GROUPS, teams, games };

type Save = { holding: PoolHolding | undefined; gamePages: string[] };

const renderPanel = () => {
  const saves: Save[] = [];
  const toasts: string[] = [];
  const cursors: GcPullProgress[] = [];
  render(
    <GameChangerImportPanel
      pool={pool}
      onPersist={(next, holding) => {
        saves.push({
          holding,
          gamePages: [...new Set(next.games.map((game) => game.ageGroupId))].sort(),
        });
        /*
         * The real routing, not a stub that returns true. What a section saves is the whole
         * hazard — a page-scoped hold written as the whole pool deletes every page it is not
         * holding — and a test that never wrote could not see it happen.
         */
        saveAgeGroups(next.ageGroups);
        if (holding?.kind === "pages")
          return saveScoutGamesForGroups(holding.ageGroupIds, next.games);
        if (holding?.kind === "additions") return addScoutGames(next.games);
        const whole = saveScoutGames(next.games);
        return whole.written && whole.spared.length === 0;
      }}
      savedProgress={null}
      droppedClubs={new Set()}
      onInvented={() => {}}
      namedAges={new Map()}
      onSaveProgress={(progress) => cursors.push(progress)}
      onClearProgress={() => {}}
      onClose={() => {}}
      showToast={(message) => toasts.push(message)}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );
  return { saves, toasts, cursors };
};

const startPull = async () => {
  const user = userEvent.setup();
  const panel = renderPanel();
  await user.type(screen.getByLabelText("Teams"), ALL_IDS.join("\n"));
  await user.click(screen.getByRole("button", { name: /^Pull \d+ again$/ }));
  return { user, ...panel };
};

/*
 * The pull files only the season being played, and these teams play Fall 2026. Pinned to a day in
 * that season so the test means the same thing after August 2027 as it does now; only the date is
 * faked, so the pull's own timers run as they always do.
 */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T12:00:00"));
});
afterEach(() => vi.useRealTimers());

describe("a pull run in sections", () => {
  beforeEach(() => {
    asked.length = 0;
    tidied.length = 0;
    pause = null;
    holdEach = false;
    holds.length = 0;
    resetPullSession();
    resetTeamRankingsStore();
    window.localStorage.clear();
    saveAgeGroups(GROUPS);
    saveScoutGames(games);
  });
  afterEach(() => resetPullSession());

  it("fetches each page on its own, covering every id exactly once", async () => {
    await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    expect(asked).toHaveLength(2);
    expect([...asked.flat()].sort()).toEqual([...ALL_IDS].sort());
    // In the order a season reads, so a run that is stopped half way has done the younger pages.
    expect(asked[0]).toEqual(PAGE_IDS["10u"]);
  });

  it("names the pages it is holding, so the save cannot delete the ones it is not", async () => {
    /*
     * This is the whole hazard. A section holds one page's games; saved as the whole pool it would
     * empty every other page — which is the bug the whole-pool write contract was built to make
     * impossible, and a section is exactly the caller that legitimately holds part of a pool.
     */
    const { saves } = await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    const scoped = saves.filter((save) => save.holding?.kind === "pages");
    expect(scoped.length).toBeGreaterThan(0);
    scoped.forEach((save) => {
      const owned = save.holding?.kind === "pages" ? save.holding.ageGroupIds : [];
      expect(owned).toHaveLength(1);
      // And it holds nothing from a page it did not name.
      save.gamePages.forEach((page) => expect(owned).toContain(page));
    });
    // Both pages were the owner of at least one save, so neither ran as somebody else's stray.
    expect(
      new Set(
        scoped.flatMap((save) => (save.holding?.kind === "pages" ? save.holding.ageGroupIds : []))
      )
    ).toEqual(new Set(["10u", "11u"]));
  });

  it("leaves every page it was not pulling exactly as it found it", async () => {
    await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    expect(
      loadScoutGames()
        .map((game) => game.id)
        .sort()
    ).toEqual(["stored-10u", "stored-11u"]);
  });

  it("holds the pool once, so nothing can take it between two sections", async () => {
    /*
     * Six claims would be six moments where a tidy could take the slot and leave the pool half
     * refreshed with the cursor saying the rest was done. A second claim is refused, so a run that
     * claimed per section would stop dead after the first with "a pull is already running".
     */
    const { toasts } = await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    expect(toasts.some((line) => /already running/i.test(line))).toBe(false);
    // And it is handed back when the run is over, not held for the rest of the session.
    expect(isPoolBusy()).toBe(false);
  });

  it("counts the whole run in the bar, not the section that is going", async () => {
    let release!: () => void;
    pause = new Promise<void>((resolve) => (release = resolve));
    await startPull();

    // Six of twelve, not six of six: the bar is the run's, and it carries on across the sections.
    await waitFor(() =>
      expect(screen.getByText(new RegExp(`of ${ALL_IDS.length} pulled`))).toBeInTheDocument()
    );
    release();
    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
  });

  it("says which age group is going, and how many there are", async () => {
    let release!: () => void;
    pause = new Promise<void>((resolve) => (release = resolve));
    await startPull();

    await waitFor(() => expect(screen.getByText(/Age group 1 of 2/)).toBeInTheDocument());
    expect(screen.getByText("10U 2027")).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
  });

  it("ends the run once, with a summary covering every section", async () => {
    await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    // One review screen for the run, and it counts all twelve rather than the last six.
    expect(screen.getAllByText(/schedules? read/i)).toHaveLength(1);
    expect(screen.getByText(new RegExp(`${ALL_IDS.length} schedules read`))).toBeInTheDocument();
    // And the pool was tidied once, not once per page: it walks every game several times over.
    expect(tidied).toHaveLength(1);
  });

  it("does not end the run while a section is still going", async () => {
    /*
     * The tidy, the summary and the review screen belong to the last section. Run at the end of
     * every one of them, the pool is tidied six times over, the slot is handed back while five
     * pages are still to fetch, and the review screen appears over a run that is still going.
     */
    holdEach = true;
    await startPull();

    await waitFor(() => expect(holds).toHaveLength(1));
    holds.shift()!();
    // The second section is away, and the first has not ended the run on its way out.
    await waitFor(() => expect(holds).toHaveLength(1));
    expect(tidied).toHaveLength(0);
    expect(screen.queryByText(/schedules? read/i)).not.toBeInTheDocument();
    expect(isPoolBusy()).toBe(true);

    holds.shift()!();
    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
  });

  it("hands the tidy the whole pool, not the page the last section was holding", async () => {
    /*
     * The tidy names stand-ins from the other side's schedule, folds clubs holding several ids and
     * collapses the rows those folds make — none of which it can do without seeing every side. A
     * sectioned run has been holding one page at a time, so the ending has to put the pool back in
     * hand before handing it over.
     */
    await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    expect(tidied).toHaveLength(1);
    expect([...new Set(tidied[0]!.games.map((game) => game.ageGroupId))].sort()).toEqual([
      "10u",
      "11u",
    ]);
  });

  it("records one segment a section, and the run's own ask above them", async () => {
    /*
     * The tracker already models several segments to a run — a first go, a Resume, a Retry — so a
     * section is a shape it had. What it must not do is take the last section's numbers for the
     * run's: an hour spent on twelve schedules, recorded as an estimate for six, is a report that
     * reads as if the pull went twice as badly as it did.
     */
    await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    const log = lastPullLog();
    expect(log?.segments).toHaveLength(2);
    expect(log?.paste?.asked).toBe(ALL_IDS.length);
  });

  it("carries the cursor across the sections rather than starting it again", async () => {
    /*
     * The cursor is the run's, not the section's. Handed back the one the run started from, a
     * section would throw away what the sections before it settled — and a resume would fetch all
     * of them again, which on a nationwide pool is the hour this is meant to save.
     */
    const { cursors } = await startPull();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    const settled = cursors[cursors.length - 1]?.settled ?? [];
    expect([...settled].sort()).toEqual([...ALL_IDS].sort());
  });

  it("gives a run stopped in its first section the ending it is owed", async () => {
    /*
     * The tidy, the summary and the review screen fall to the last section — and a run stopped in
     * its second of six has no last section coming. Without this it stops on the progress bar,
     * with an untidied pool and nothing on screen to say what it got.
     */
    let release!: () => void;
    pause = new Promise<void>((resolve) => (release = resolve));
    const { user } = await startPull();

    await waitFor(() => expect(screen.getByText(/Age group 1 of 2/)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /^Stop$/ }));
    release();

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    // The second page was never asked for, and the slot is not held for the rest of the session.
    expect(asked).toHaveLength(1);
    expect(isPoolBusy()).toBe(false);
  });
});

describe("a pull with nothing to section", () => {
  beforeEach(() => {
    asked.length = 0;
    tidied.length = 0;
    pause = null;
    holdEach = false;
    holds.length = 0;
    resetPullSession();
    resetTeamRankingsStore();
    window.localStorage.clear();
    saveAgeGroups(GROUPS);
    saveScoutGames(games);
  });
  afterEach(() => resetPullSession());

  it("runs as one pull, holding the whole pool as it always did", async () => {
    /*
     * Sectioning a single page holds exactly what an unsectioned run holds, pays a second fold to
     * arrive there, and takes the duplicate-fixture trade for nothing in return.
     */
    const user = userEvent.setup();
    const { saves } = renderPanel();
    await user.type(screen.getByLabelText("Teams"), PAGE_IDS["10u"]!.join("\n"));
    await user.click(screen.getByRole("button", { name: /^Pull \d+ again$/ }));

    await waitFor(() => expect(screen.getByText(/schedules? read/i)).toBeInTheDocument());
    expect(asked).toHaveLength(1);
    expect(saves.every((save) => save.holding === undefined)).toBe(true);
    expect(screen.queryByText(/Age group 1 of/)).not.toBeInTheDocument();
  });
});
