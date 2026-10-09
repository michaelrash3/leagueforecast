import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LeagueSeasonsCard } from "./LeagueSeasonsCard";
import { seasonYearOptions, type AgeGroup } from "../../lib/teamRankings";
import { ageGroup, game, renderTeamRankings, team } from "../../test/teamRankingsHarness";
import { loadAgeGroups } from "../../lib/teamRankingsStorage";

/*
 * Setup's "Your league seasons" card puts a League Standings season on an age page, with the year
 * filled in for it. That year was the name's year read as written, else the oldest year the picker
 * offers: right in 2026, and a year behind from the August the next squad year began, so a league
 * season started in the autumn of 2027 was put on last season's page by the button's own default.
 */
const season = (id: string, name: string) => ({ id, name, createdAt: "2027-08-02T12:00:00Z" });

const card = (seasons: ReturnType<typeof season>[], ageGroups: AgeGroup[]) =>
  render(
    <LeagueSeasonsCard
      seasons={seasons}
      ageGroups={ageGroups}
      yearOptions={seasonYearOptions(ageGroups)}
      onAssign={() => {}}
    />
  );

/** What the card offers to press, so a failure prints the label it did offer. */
const offered = () => screen.getAllByRole("button").map((button) => button.textContent);

afterEach(() => vi.useRealTimers());

describe("the year the league seasons card fills in", () => {
  it("is the season being played for a name that says no year", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-20T12:00:00"));
    // Last year's pages and this year's, as a pool looks once the 2028 pull has run.
    card([season("s-new", "Rec league")], [ageGroup(9, 2027), ageGroup(10, 2028)]);
    // Squad year 2028 is Fall 2027 to Summer 2028, the one being played on 20 August 2027.
    expect(offered()).toEqual(["Put on 9U 2028"]);
  });

  it("reads 'Fall 2027' as squad year 2028, the way GameChanger's Fall 2027 is filed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-20T12:00:00"));
    card([season("s-fall", "Fall 2027 10U")], [ageGroup(9, 2027), ageGroup(10, 2028)]);
    expect(offered()).toEqual(["Put on 10U 2028"]);
  });

  it("reads a fall a year on, a spring by its own year, and a bare year as written", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T12:00:00"));
    card(
      [
        season("s-fall26", "Fall 2026 9U"),
        season("s-spring", "Spring 2027 9U"),
        season("s-bare", "Travel 2026 9U"),
      ],
      [ageGroup(9, 2027)]
    );
    expect(offered()).toEqual(["Put on 9U 2027", "Put on 9U 2027", "Put on 9U 2026"]);
  });

  it("keeps the page a season is already on", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-08-20T12:00:00"));
    const lastYear = { ...ageGroup(9, 2027), seasonIds: ["s-held"] };
    card([season("s-held", "Rec league")], [lastYear, ageGroup(10, 2028)]);
    // Settled on its page, so the only thing to press is taking it off.
    expect(offered()).toEqual(["Take off"]);
  });
});

/*
 * What the default did to the numbers: an autumn-2027 league season pressed onto last year's page
 * had its "9/18" games read a year early, onto the finished Fall 2026 board.
 */
describe("pressing the filled-in button in September 2027", () => {
  const final = (away: number, home: number) => ({
    awayRuns: String(away),
    awayHits: "",
    awayK: "",
    homeRuns: String(home),
    homeHits: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  const autumn2027 = (ageGroups = [ageGroup(10, 2027), ageGroup(10, 2028)]) =>
    renderTeamRankings({
      ageGroups,
      teams: [team("S-A", "Last Year Aces"), team("S-B", "Last Year Bats")],
      games: [
        game("old1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: "2026-09-12" }),
        game("old2", "ag_10u_2027", "S-A", "S-B", 6, 2, { date: "2027-04-10" }),
      ],
      seasons: [{ id: "default", name: "Fall 2027 10U", createdAt: "2027-08-02T12:00:00Z" }],
      league: {
        teams: [
          { id: "L-H", name: "Hornets This Fall" },
          { id: "L-W", name: "Wasps This Fall" },
        ],
        matchups: [
          { id: "m1", date: "9/11", away: "L-H", home: "L-W" },
          { id: "m2", date: "9/18", away: "L-H", home: "L-W" },
        ],
        logs: { m1: final(7, 3), m2: final(8, 1) },
      },
      search: "?view=rankings&section=setup",
    });

  it("puts this autumn's league season on this season's page", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2027-09-20T12:00:00"));
    const user = userEvent.setup();
    const harness = autumn2027();
    await user.click(screen.getByRole("button", { name: /^Put on 10U/ }));
    const onPage = loadAgeGroups().find((group) => group.seasonIds.includes("default"));
    expect(onPage?.name).toBe("10U 2028");
    expect(harness.toasts()).toContain("League season added to 10U 2028.");
  });

  it("makes the page when there is none for its age yet, and says so", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2027-09-20T12:00:00"));
    const user = userEvent.setup();
    const harness = autumn2027([ageGroup(10, 2027)]);
    await user.click(screen.getByRole("button", { name: /^Put on 10U 2028/ }));
    expect(loadAgeGroups().find((group) => group.seasonIds.includes("default"))?.name).toBe(
      "10U 2028"
    );
    expect(harness.toasts()).toContain("10U 2028 created, with your league season on it.");
  });

  it("and leaves the finished Fall 2026 board without this autumn's league teams", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2027-09-20T12:00:00"));
    const user = userEvent.setup();
    autumn2027();
    await user.click(screen.getByRole("button", { name: /^Put on 10U/ }));
    await user.click(screen.getByRole("tab", { name: "Rankings" }));
    await user.click(screen.getByRole("button", { name: /Fall 2026/ }));
    const fall2026 = screen
      .getByRole("heading", { name: /National top 25 · Fall 2026/ })
      .closest("div")!.parentElement as HTMLElement;
    // Played in September 2027, so they have no business on the Fall 2026 table.
    expect(within(fall2026).queryByText("Hornets This Fall")).toBeNull();
  });
});
