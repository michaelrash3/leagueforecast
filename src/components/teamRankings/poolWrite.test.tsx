import { waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GcImportState } from "../../lib/gameChangerImport";
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
 * that produces it.
 */
const seen: { pool: GcImportState | null } = { pool: null };

vi.mock("../GameChangerImportPanel", () => ({
  GameChangerImportPanel: (props: { pool: GcImportState }) => {
    seen.pool = props.pool;
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
});
