import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ScoutGame, ScoutRankingRow, ScoutTeam } from "../lib/teamRankings";
import { formatStartTime } from "../lib/date";
import { ageGroup } from "../test/teamRankingsHarness";
import { TeamDetailPanel, type ClubStanding } from "./TeamDetailPanel";

/*
 * The club sheet leads with the club: its place on the board on screen, nationally and in its
 * state, its record, rating and form; then the games still to come, soonest first with their
 * starts; then its results, newest first. The tools that change the club's data are folded away
 * under "Fix this club's data", closed until asked for. It opened on Rename, Unlink, Set age, Fold
 * into it and State, with no place or rating at all, and the games below the first phone screen,
 * the farthest-off first. Placeholder names throughout.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-30T12:00:00"));
});
afterAll(() => vi.useRealTimers());

const PAGE = "ag_10u_2027";
const NINE_THIRTY = "2026-10-31T13:30:00.000Z";
const SEVEN = "2026-10-31T23:00:00.000Z";

const fixture = (
  id: string,
  teamAId: string,
  teamBId: string,
  date: string,
  more: Partial<ScoutGame> = {}
): ScoutGame => ({ id, ageGroupId: PAGE, teamAId, teamBId, date, ...more });
const result = (id: string, opponent: string, date: string, runs: [number, number]) =>
  fixture(id, "S-A", opponent, date, { teamAScore: runs[0], teamBScore: runs[1] });

const games: ScoutGame[] = [
  fixture("nov-15", "S-A", "S-B", "2026-11-15"),
  fixture("oct-31-late", "S-C", "S-A", "2026-10-31", { startTs: SEVEN }),
  fixture("oct-31-early", "S-A", "S-D", "2026-10-31", { startTs: NINE_THIRTY }),
  fixture("nov-1", "S-A", "S-B", "2026-11-01"),
  result("oct-24", "S-C", "2026-10-24", [5, 3]),
  result("oct-17", "S-D", "2026-10-17", [2, 4]),
  result("oct-10", "S-B", "2026-10-10", [6, 1]),
];

const names = new Map([
  ["S-A", "Aces"],
  ["S-B", "Bears"],
  ["S-C", "Comets"],
  ["S-D", "Ducks"],
]);
const aces: ScoutTeam = {
  id: "S-A",
  name: "Aces",
  city: "Placeholder City",
  state: "KY",
  gcTeams: [{ teamId: "gc-aces", name: "Aces", ageGroupId: PAGE }],
};
const row = (teamId: string, rating: number): ScoutRankingRow =>
  ({ teamId, teamName: names.get(teamId), rank: 1, rating, comparable: true }) as ScoutRankingRow;
const rows = new Map(["S-A", "S-B", "S-C", "S-D"].map((id, at) => [id, row(id, 2 - at)]));
const STANDING: ClubStanding = {
  nationalRank: 17,
  nationalOf: 1190,
  state: "KY",
  stateRank: 7,
  stateOf: 47,
};

// One array for every render, as the page's own age groups are until they change.
const GROUPS = [ageGroup(10, 2027)];
const clubSheet = (more: { standing?: ClubStanding; readOnly?: boolean } = {}) => (
  <TeamDetailPanel
    team={aces}
    allGames={games}
    ageGroupId={PAGE}
    ageGroupName="10U 2027"
    ageGroups={GROUPS}
    teamNameById={names}
    onRename={() => undefined}
    onSetState={() => true}
    onUnlinkGc={() => undefined}
    onMergeInto={() => undefined}
    age={{ level: 10 }}
    onSetAge={() => undefined}
    mergeCandidates={[{ id: "S-B", name: "Bears" }]}
    onClose={() => undefined}
    ratingRowOf={(teamId) => rows.get(teamId)}
    {...more}
  />
);
const panel = (more: { standing?: ClubStanding; readOnly?: boolean } = {}) =>
  render(clubSheet(more));

/** The names of a list's games' opponents, in its order. */
const opponents = (list: HTMLElement) =>
  within(list)
    .getAllByRole("listitem")
    .map((item) => [...names.values()].find((name) => within(item).queryByText(name)));

describe("the club sheet", () => {
  it("leads with the club's place on the board, nationally and in its state, and its rating", () => {
    panel({ standing: STANDING });
    const sheet = screen.getByRole("region", { name: "Aces" });
    const lead = within(sheet)
      .getByText(/nationally/)
      .closest("p")!;
    expect(lead).toHaveTextContent("#17 of 1,190 nationally · #7 of 47 in KY · rating +2.0");
    // Before the record, the form and every game.
    const text = sheet.textContent ?? "";
    expect(text.indexOf("nationally")).toBeLessThan(text.indexOf("2-1 in 10U 2027"));
    expect(text.indexOf("2-1 in 10U 2027")).toBeLessThan(text.indexOf("Coming up"));
  });

  it("gives a club the board does not list no place", () => {
    panel();
    const sheet = screen.getByRole("region", { name: "Aces" });
    expect(sheet).not.toHaveTextContent("nationally");
    expect(sheet).toHaveTextContent("2-1 in 10U 2027, from 3 games.");
  });

  it("lists the games to come soonest first, with their starts, then the results newest first", () => {
    panel({ standing: STANDING });
    const coming = screen.getByRole("list", { name: "Coming up" });
    expect(opponents(coming)).toEqual(["Ducks", "Comets", "Bears", "Bears"]);
    expect(within(coming).getAllByRole("listitem")[0]).toHaveTextContent(
      `Sat, Oct 31 · ${formatStartTime(NINE_THIRTY)}`
    );
    expect(within(coming).getAllByRole("listitem")[2]).toHaveTextContent("Sun, Nov 1");
    const results = screen.getByRole("list", { name: "Results" });
    expect(opponents(results)).toEqual(["Comets", "Ducks", "Bears"]);
    expect(within(results).getAllByRole("listitem")[0]).toHaveTextContent("5–3 · Sat, Oct 24");
  });

  it("folds the tools that change the club's data away until asked for", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    panel({ standing: STANDING });
    const fold = screen.getByRole("button", { name: "Fix this club's data" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    for (const tool of ["Rename", "Unlink", "Set age", "Fold into it"])
      expect(screen.queryByRole("button", { name: tool })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "State" })).toBeNull();

    // A button, so the keyboard reaches it and a screen reader hears whether it is open.
    fold.focus();
    await user.keyboard("{Enter}");
    expect(fold).toHaveAttribute("aria-expanded", "true");
    const tools = document.getElementById(fold.getAttribute("aria-controls") ?? "")!;
    for (const tool of ["Rename", "Unlink", "Set age", "Fold into it"])
      expect(within(tools).getByRole("button", { name: tool })).toBeInTheDocument();
    expect(within(tools).getByRole("textbox", { name: "State" })).toBeInTheDocument();
    expect(within(tools).getByRole("link", { name: "Aces" })).toHaveAttribute(
      "href",
      "https://web.gc.com/teams/gc-aces"
    );

    await user.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
  });

  it("names the fold for what it holds where nothing on the panel can change the club", () => {
    panel({ standing: STANDING, readOnly: true });
    expect(screen.queryByRole("button", { name: "Fix this club's data" })).toBeNull();
    expect(screen.getByRole("button", { name: "This club's data" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  /*
   * A sheet left open past midnight, its games the same array: the split into games to come and
   * results was worked out once for those games, and kept yesterday's day until they changed.
   */
  it("moves a day's games to the results once the day has gone, the sheet left open", () => {
    const { rerender } = panel({ standing: STANDING });
    expect(opponents(screen.getByRole("list", { name: "Coming up" }))).toEqual([
      "Ducks",
      "Comets",
      "Bears",
      "Bears",
    ]);
    vi.setSystemTime(new Date("2026-11-01T08:00:00"));
    try {
      rerender(clubSheet({ standing: STANDING }));
      // Saturday's two, still with no score, are past now; Sunday's is today's.
      expect(opponents(screen.getByRole("list", { name: "Coming up" }))).toEqual([
        "Bears",
        "Bears",
      ]);
      expect(opponents(screen.getByRole("list", { name: "Results" }))).toHaveLength(5);
    } finally {
      vi.setSystemTime(new Date("2026-10-30T12:00:00"));
    }
  });

  it("never prints a day as stored", () => {
    panel({ standing: STANDING });
    expect(screen.getByRole("region", { name: "Aces" }).textContent).not.toMatch(
      /\d{4}-\d{2}-\d{2}/
    );
  });
});
