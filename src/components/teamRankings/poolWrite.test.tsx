import { act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GcImportState } from "../../lib/gameChangerImport";
import { loadScoutGames } from "../../lib/teamRankingsStorage";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/**
 * A pull must never take the pool down with it.
 *
 * The GameChanger panel seeds itself from its `pool` prop once, folds each fetched schedule into
 * that copy, and on every save writes the whole thing back through `saveScoutGames` — which
 * replaces every squad year and drops any year it was not handed. That contract is fine for a
 * caller that loads the whole pool first. It is ruinous for one that does not: handed an empty
 * array, the panel folds a pull into nothing and saves that over everything, deleting every year
 * the pull did not itself refetch.
 *
 * That is exactly what happened. The whole-pool read was keyed on the Setup section while the
 * panel is rendered on Import, so on the section it actually appears on it was always given `[]`.
 * Nothing caught it, because nothing asserted what the panel was handed.
 *
 * So these assert the prop itself, at the boundary where it went wrong, rather than the wiring
 * that produces it — and then the save, because getting the prop right is a fix for one caller
 * while the contract that made it ruinous is available to every caller.
 */
const seen: {
  pool: GcImportState | null;
  persist: ((next: GcImportState) => boolean) | null;
} = { pool: null, persist: null };

vi.mock("../GameChangerImportPanel", () => ({
  GameChangerImportPanel: (props: {
    pool: GcImportState;
    onPersist: (next: GcImportState) => boolean;
  }) => {
    seen.pool = props.pool;
    seen.persist = props.onPersist;
    return null;
  },
}));

describe("what the import panel is given to write back", () => {
  const groups = [ageGroup(10, 2027), ageGroup(10, 2028)];
  const teams = [team("t1", "Rays"), team("t2", "Jays")];
  const games = [
    game("g-2027", groups[0]!.id, "t1", "t2", 6, 3, { date: seasonDate(2027) }),
    game("g-2028", groups[1]!.id, "t1", "t2", 4, 1, { date: seasonDate(2028) }),
  ];

  const openImport = () => {
    seen.pool = null;
    seen.persist = null;
    return renderTeamRankings({ ageGroups: groups, teams, games, search: "?section=import" });
  };

  it("is the whole stored pool, every squad year of it", async () => {
    openImport();

    await waitFor(() => expect(seen.pool).not.toBeNull());
    // Every year, because a save from here replaces every year.
    expect(seen.pool?.games.map((entry) => entry.id).sort()).toEqual(["g-2027", "g-2028"]);
    expect(seen.pool?.teams).toHaveLength(2);
  });

  it("is never an empty array while the store has games", async () => {
    openImport();

    await waitFor(() => expect(seen.pool).not.toBeNull());
    /*
     * The failure this is really about. An empty array here is not a slow render or a missing
     * table — it is the panel about to write nothing over everything the next time a pull saves.
     */
    expect(seen.pool?.games.length).toBeGreaterThan(0);
  });

  /**
   * The same failure from the other side.
   *
   * Handing the panel the whole pool fixes this one caller. It does not fix the contract: a save
   * that says "this is the whole pool" was taken at its word, and an array cannot make that claim
   * on its caller's behalf. So the store no longer accepts it — a year it holds and the save does
   * not is left exactly as it was, and the save comes back saying which years it spared.
   *
   * These drive `onPersist` directly with the pool the bug produced, because that is the argument
   * the real panel passed on the night, and the only thing that matters is what the store does
   * with it.
   */
  it("keeps every year when the panel saves a pool it was never given", async () => {
    const harness = openImport();
    await waitFor(() => expect(seen.persist).not.toBeNull());

    // Exactly what the panel did: it folded a pull into nothing and saved that over everything.
    act(() => {
      seen.persist?.({ ageGroups: groups, teams, games: [] });
    });

    expect(
      loadScoutGames()
        .map((entry) => entry.id)
        .sort()
    ).toEqual(["g-2027", "g-2028"]);
    expect(harness.toasts().join(" ")).toMatch(/left as stored/i);
  });

  it("refuses such a save, so the pull stops rather than fetching on", async () => {
    openImport();
    await waitFor(() => expect(seen.persist).not.toBeNull());

    // The panel stops the run on a false. It is holding a pool the store will not take, so
    // everything it fetches from here cannot be kept either.
    let accepted: boolean | undefined;
    act(() => {
      accepted = seen.persist?.({ ageGroups: groups, teams, games: [] });
    });

    expect(accepted).toBe(false);
  });

  it("takes a save that does hold every year, and says nothing", async () => {
    const harness = openImport();
    await waitFor(() => expect(seen.persist).not.toBeNull());

    const edited = games.map((entry) => ({ ...entry, teamAScore: 9 }));
    let accepted: boolean | undefined;
    act(() => {
      accepted = seen.persist?.({ ageGroups: groups, teams, games: edited });
    });

    expect(accepted).toBe(true);
    expect(loadScoutGames().map((entry) => entry.teamAScore)).toEqual([9, 9]);
    expect(harness.toasts().join(" ")).not.toMatch(/left as stored/i);
  });
});
