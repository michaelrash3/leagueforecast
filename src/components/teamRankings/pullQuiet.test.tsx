import { act, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GcImportState } from "../../lib/gameChangerImport";
import { beginPull, endPull, resetPullSession, type PullSession } from "../../lib/pullSession";
import * as storage from "../../lib/teamRankingsStorage";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/**
 * What the view does while a pull is running, which until now was: everything, over and over.
 *
 * A pull saves every few hundred teams and can run for the better part of an hour. Each save
 * bumped the pool revision, and every bump made this view decode the pool again — the year on
 * screen, and on the Import section the whole pool, every year of it. On a synthetic pool of two
 * hundred thousand games that measured at about 110 ms of decode on top of the 250 ms of encode
 * the save itself costs, on the one thread that also has to draw the page.
 *
 * The Import copy was waste twice over: the GameChanger panel seeds itself from that prop once and
 * never reads it again, so the whole pool was being decoded for nobody at all.
 */
const seen: { pool: GcImportState | null; persist: ((next: GcImportState) => boolean) | null } = {
  pool: null,
  persist: null,
};

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

const groups = [ageGroup(10, 2027), ageGroup(10, 2028)];
const teams = [team("t1", "Rays"), team("t2", "Jays")];
const games = [
  game("g-2027", groups[0]!.id, "t1", "t2", 6, 3, { date: seasonDate(2027) }),
  game("g-2028", groups[1]!.id, "t1", "t2", 4, 1, { date: seasonDate(2028) }),
];

describe("a pull's own saves", () => {
  let session: PullSession | null = null;

  afterEach(() => {
    if (session) endPull(session);
    session = null;
    resetPullSession();
    vi.restoreAllMocks();
  });

  const openImport = () => {
    seen.pool = null;
    seen.persist = null;
    return renderTeamRankings({ ageGroups: groups, teams, games, search: "?section=import" });
  };

  it("do not make the view decode the whole pool again", async () => {
    openImport();
    await waitFor(() => expect(seen.persist).not.toBeNull());

    const readWholePool = vi.spyOn(storage, "loadScoutGames");
    // Inside `act`, so the view has seen the claim before the first save lands.
    act(() => {
      session = beginPull("2026-09-19T12:00:00.000Z");
    });

    // Three saves, the way a run of a few thousand teams makes them.
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        seen.persist?.({ ageGroups: groups, teams, games });
      });
    }

    expect(readWholePool).not.toHaveBeenCalled();
  });

  it("read it once when the run lets go of the pool, so nothing stays stale", async () => {
    openImport();
    await waitFor(() => expect(seen.persist).not.toBeNull());

    act(() => {
      session = beginPull("2026-09-19T12:00:00.000Z");
    });
    act(() => {
      seen.persist?.({ ageGroups: groups, teams, games });
    });

    const readWholePool = vi.spyOn(storage, "loadScoutGames");
    act(() => {
      if (session) endPull(session);
      session = null;
    });

    await waitFor(() => expect(readWholePool).toHaveBeenCalled());
  });

  it("still re-read it for a save that is not a pull, so an edit shows at once", async () => {
    openImport();
    await waitFor(() => expect(seen.persist).not.toBeNull());

    const readWholePool = vi.spyOn(storage, "loadScoutGames");
    // No session claimed: this is somebody merging two clubs or logging a game by hand.
    act(() => {
      seen.persist?.({ ageGroups: groups, teams, games });
    });

    expect(readWholePool).toHaveBeenCalled();
  });
});
