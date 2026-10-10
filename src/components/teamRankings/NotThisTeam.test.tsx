import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  loadAgeGroups,
  loadNotThisTeam,
  loadScoutGames,
  loadScoutGamesForYear,
  loadScoutTeams,
  loadTidyStamp,
} from "../../lib/teamRankingsStorage";
import { poolSignature } from "../../lib/gameChangerImport";
import { refusalOf } from "../../lib/notThisTeam";
import type { ScoutGame, ScoutTeam } from "../../lib/teamRankings";
import { ageGroup, renderTeamRankings, team, type Pool } from "../../test/teamRankingsHarness";

/*
 * "Not this team" on a visitor's page, which keeps its pool in this browser: a game a club has only
 * because a name on another club's schedule was matched to it is offered beside the game, and
 * pressing it takes the game off the club onto a stand-in of the name, with an Undo. Placeholder
 * names throughout.
 */
beforeAll(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-09-28T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const page = ageGroup(9, 2027);
const pulled = (id: string, name: string, state: string): ScoutTeam =>
  team(id, name, {
    state,
    gcTeams: [{ teamId: `gc${id}`, name: `${name} 9U`, ageGroupId: page.id, ageLevel: 9 }],
  });
const hawks = pulled("S-HAWK", "Prairie Hawks", "IL");
const eagles = pulled("S-EAGL", "Eagles", "KY");
const owls = pulled("S-OWLS", "Prairie Owls", "IL");

/** A row of `club`'s own schedule. */
const rowOf = (
  club: ScoutTeam,
  gameId: string,
  against: ScoutTeam,
  scores: [number, number],
  date: string
): ScoutGame => ({
  id: `gc_gc${club.id}_${gameId}`,
  ageGroupId: page.id,
  teamAId: club.id,
  teamBId: against.id,
  teamAScore: scores[0],
  teamBScore: scores[1],
  date,
  source: { kind: "gamechanger", teamId: `gc${club.id}`, gameId },
});

const comets = team("S-COME", "Comets", { nameOnly: true });
/** The "Eagles" the Owls of the Hawks' own state play, which nobody has pulled. */
const ourEagles = team("S-EAGLIL", "Eagles", { nameOnly: true });

// The Hawks' 3-5 loss to "Eagles", which the name filed onto the Eagles of another state.
const byName = rowOf(hawks, "808", eagles, [3, 5], "2026-08-08");
const pool = (): Pool => ({
  ageGroups: [page],
  teams: [hawks, eagles, owls, comets, ourEagles],
  games: [
    byName,
    // The Eagles' own game that day, which is what let the name file onto them.
    rowOf(eagles, "e1", comets, [6, 2], "2026-08-08"),
    rowOf(owls, "o1", ourEagles, [4, 1], "2026-08-22"),
  ],
  search: "?age=9&year=2027",
});

const openClub = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(await screen.findByRole("button", { name: /show all \d+ teams/i }));
  await user.click(within(screen.getByRole("table")).getByRole("button", { name }));
  return screen.getByRole("region", { name });
};

/** The panel's line for the game against `opponent`. */
const gameLine = (panel: HTMLElement, opponent: string) =>
  within(panel)
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(opponent)) as HTMLElement;

const stored = (id: string) => loadScoutGamesForYear(2027).find((entry) => entry.id === id);

describe("Not this team, on a page kept in this browser", () => {
  it("is offered beside a game the club has by a name alone, and nowhere else", async () => {
    const user = userEvent.setup();
    renderTeamRankings(pool());
    const panel = await openClub(user, "Eagles");
    const offered = within(gameLine(panel, "Prairie Hawks")).getByRole("button", {
      name: "Not this team",
    });
    expect(offered).toBeInTheDocument();
    // Its own schedule's game is its own.
    expect(
      within(gameLine(panel, "Comets")).queryByRole("button", { name: "Not this team" })
    ).toBeNull();
    // The club whose schedule wrote the name has the game by its own word.
    await user.click(within(panel).getByRole("button", { name: "Close" }));
    await user.click(
      within(screen.getByRole("table")).getByRole("button", { name: "Prairie Hawks" })
    );
    const theirs = screen.getByRole("region", { name: "Prairie Hawks" });
    expect(within(theirs).queryByRole("button", { name: "Not this team" })).toBeNull();
  });

  it("takes the game off the club onto the stand-in of the name, its record with it, and Undo puts it back", async () => {
    const user = userEvent.setup();
    const harness = renderTeamRankings(pool());
    const panel = await openClub(user, "Eagles");
    expect(within(panel).getByText(/^2-0 in 9U 2027, from 2 games\./)).toBeInTheDocument();
    await user.click(
      within(gameLine(panel, "Prairie Hawks")).getByRole("button", { name: "Not this team" })
    );
    // Onto the "Eagles" a pull of the Hawks would have filed it against, had the name found nobody.
    await waitFor(() => expect(stored(byName.id)?.teamBId).toBe(ourEagles.id));
    expect(loadScoutTeams().map((entry) => entry.id)).toEqual(pool().teams.map((t) => t.id));
    const after = screen.getByRole("region", { name: "Eagles" });
    expect(within(after).getByText(/^1-0 in 9U 2027, from 1 game\./)).toBeInTheDocument();
    expect(within(after).queryByText("Prairie Hawks")).toBeNull();

    const call = harness.showToast.mock.calls.find((entry) =>
      String(entry[0]).startsWith("Taken off Eagles")
    )!;
    expect(call[1]).toMatchObject({ tone: "undo", actionLabel: "Undo" });
    act(() => (call[1] as { onAction: () => void }).onAction());
    await waitFor(() => expect(stored(byName.id)).toEqual(byName));
    expect(screen.getByRole("region", { name: "Eagles" })).toHaveTextContent(
      /2-0 in 9U 2027, from 2 games\./
    );
  });

  it("is remembered, so the tidy the change sets off does not file the name back", async () => {
    // No "Eagles" of the Hawks' state to reuse: a stand-in is made, the pool is not the one the
    // tidy last saw, and the tidy runs. Its refile would put the row straight back on the Eagles,
    // the one club of the name next door with a game that day, were the refusal not kept.
    const user = userEvent.setup();
    const { teams, games, ...rest } = pool();
    renderTeamRankings({
      ...rest,
      teams: teams.filter((each) => each.id !== ourEagles.id),
      games: games.filter((each) => each.teamBId !== ourEagles.id),
    });
    const panel = await openClub(user, "Eagles");
    await user.click(
      within(gameLine(panel, "Prairie Hawks")).getByRole("button", { name: "Not this team" })
    );
    expect([...loadNotThisTeam()]).toEqual([
      refusalOf(`gc${hawks.id}`, "Eagles", `gc${eagles.id}`),
    ]);
    await waitFor(() =>
      expect(loadTidyStamp()).toBe(
        poolSignature({
          ageGroups: loadAgeGroups(),
          teams: loadScoutTeams(),
          games: loadScoutGames(),
        })
      )
    );
    expect(stored(byName.id)?.teamBId).not.toBe(eagles.id);
  });
});
