import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadAgeGroups,
  loadScoutGames,
  loadScoutTeams,
  loadTidyStamp,
} from "../../lib/teamRankingsStorage";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
  type Harness,
  type Pool,
} from "../../test/teamRankingsHarness";

/*
 * Undo puts back what Remove took, roster and all.
 *
 * Remove team deletes the club itself when nothing else holds it, and the Undo tested the roster
 * captured at Remove, which still had the club: it was never written back, and its games came back
 * naming an id nobody held. The tidy a removal sets off also prunes a stand-in nothing stands on
 * any more, so undoing a game against one brought the game back and not its opponent.
 */
const page = ageGroup(10, 2027);
const date = seasonDate(2027);
const pulled = (id: string, name: string) =>
  team(id, name, {
    state: "OH",
    gcTeams: [{ teamId: `gc${id}`, name: `${name} 10U`, ageGroupId: page.id, ageLevel: 10 }],
  });
/** Rays beat the Jays, and a "Dayton Ducks" known only by the name on Rays' schedule. */
const pool = (extra: Partial<Pool> = {}): Pool => ({
  ageGroups: [page],
  teams: [
    pulled("S-RAYS", "Rays"),
    pulled("S-JAYS", "Jays"),
    pulled("S-OWLS", "Owls"),
    team("S-DUCKS", "Dayton Ducks", { nameOnly: true }),
  ],
  games: [
    game("g1", page.id, "S-OWLS", "S-JAYS", 6, 3, { date }),
    game("g2", page.id, "S-RAYS", "S-DUCKS", 7, 2, {
      date,
      source: { kind: "gamechanger", teamId: "gcS-RAYS", gameId: "x2" },
    }),
    game("g3", page.id, "S-RAYS", "S-JAYS", 5, 4, {
      date,
      source: { kind: "gamechanger", teamId: "gcS-RAYS", gameId: "x3" },
    }),
  ],
  ...extra,
});

const held = () => new Set(loadScoutTeams().map((entry) => entry.id));
/** Stored games that name a team the roster does not hold. */
const orphans = () => {
  const roster = held();
  return loadScoutGames()
    .filter((entry) => !roster.has(entry.teamAId) || !roster.has(entry.teamBId))
    .map((entry) => entry.id);
};
const undo = (harness: Harness, message: string) => {
  const call = harness.showToast.mock.calls.find((entry) => entry[0] === message)!;
  act(() => (call[1] as { onAction: () => void }).onAction());
};
const removeFromTable = async (name: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /show all \d+ teams/i }));
  const row = within(screen.getByRole("table")).getByRole("button", { name }).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Remove" }));
};

describe("Undo after Remove team", () => {
  it("puts the club back in the roster", async () => {
    const harness = renderTeamRankings(pool());
    await removeFromTable("Rays");
    await waitFor(() => expect(harness.toasts()).toContain("Rays removed."));
    expect(held().has("S-RAYS")).toBe(false);

    undo(harness, "Rays removed.");

    expect(held().has("S-RAYS")).toBe(true);
    expect(loadScoutGames().map((entry) => entry.id)).toEqual(["g1", "g2", "g3"]);
    expect(orphans()).toEqual([]);
    await waitFor(() =>
      expect(within(screen.getByRole("table")).getByRole("button", { name: "Rays" })).toBeTruthy()
    );
  });

  it("puts back the stand-in the tidy pruned while the club was gone", async () => {
    const harness = renderTeamRankings(pool());
    const stampBefore = loadTidyStamp();
    await removeFromTable("Rays");
    await waitFor(() => expect(loadTidyStamp()).not.toBe(stampBefore));
    expect(held().has("S-DUCKS")).toBe(false);

    undo(harness, "Rays removed.");

    expect(held().has("S-RAYS")).toBe(true);
    expect(held().has("S-DUCKS")).toBe(true);
    expect(orphans()).toEqual([]);
  });

  it("puts back a stand-in only a claimed row was filed against", async () => {
    // The Jays' schedule listed the 5-4 game against "Rays Baseball", a name and nothing more,
    // and Rays' own copy claimed it: the row is kept on the game, filed against that stand-in.
    const claimed = {
      teamId: "gcS-JAYS",
      gameId: "j3",
      filedAgainst: "S-RAYS-SI",
      ownScore: 4,
      opponentScore: 5,
      onSideB: true,
    };
    const base = pool();
    const harness = renderTeamRankings({
      ...base,
      teams: [...base.teams, team("S-RAYS-SI", "Rays Baseball", { nameOnly: true })],
      games: base.games.map((entry) =>
        entry.id === "g3" ? { ...entry, alsoRows: [claimed] } : entry
      ),
    });
    const stampBefore = loadTidyStamp();
    await removeFromTable("Rays");
    await waitFor(() => expect(loadTidyStamp()).not.toBe(stampBefore));
    expect(held().has("S-RAYS-SI")).toBe(false);

    undo(harness, "Rays removed.");

    expect(held().has("S-RAYS-SI")).toBe(true);
    expect(loadScoutGames().find((entry) => entry.id === "g3")?.alsoRows).toEqual([claimed]);
  });

  it("puts the ★ back when the club was this page's own team", async () => {
    const harness = renderTeamRankings(pool({ ageGroups: [{ ...page, myTeamId: "S-RAYS" }] }));
    await removeFromTable("Rays");
    await waitFor(() => expect(loadAgeGroups()[0]?.myTeamId).toBeUndefined());

    undo(harness, "Rays removed.");

    expect(loadAgeGroups()[0]?.myTeamId).toBe("S-RAYS");
    expect(held().has("S-RAYS")).toBe(true);
  });
});

describe("Undo after Remove game", () => {
  /*
   * The day the game is dated. The Games tab lists today's games (`gamesWindow.ts`).
   */
  beforeAll(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-12T12:00:00"));
  });
  afterAll(() => vi.useRealTimers());

  it("puts back the stand-in the tidy pruned while the game was gone", async () => {
    const harness = renderTeamRankings(pool({ search: "?section=games" }));
    const user = userEvent.setup();
    const stampBefore = loadTidyStamp();
    const ducksGame = (await screen.findByText(/Dayton Ducks/)).closest("li")!;
    await user.click(within(ducksGame).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(loadTidyStamp()).not.toBe(stampBefore));
    expect(held().has("S-DUCKS")).toBe(false);

    undo(harness, "Game removed.");

    expect(loadScoutGames().some((entry) => entry.id === "g2")).toBe(true);
    expect(held().has("S-DUCKS")).toBe(true);
    expect(orphans()).toEqual([]);
  });
});
