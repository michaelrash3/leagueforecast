import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDefaultAge } from "../../lib/preferences";
import { ageGroup, renderTeamRankings, team, type Pool } from "../../test/teamRankingsHarness";

/*
 * Choosing the age Team Rankings opens on. The pages are stored with 12U first, which is where the
 * view opened before a default existed, so opening anywhere else is the default's doing.
 */

const pinClock = (iso: string) => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(iso));
};
afterEach(() => vi.useRealTimers());

const pool = (extra: Partial<Pool> = {}): Pool => ({
  ageGroups: [ageGroup(12, 2027), ageGroup(9, 2027), ageGroup(10, 2027), ageGroup(10, 2028)],
  teams: [team("S-A", "Owls", { state: "KY" })],
  games: [],
  ...extra,
});

const ageNav = () => screen.getByRole("navigation", { name: "Age level" });
const openAge = () =>
  within(ageNav())
    .getAllByRole("button")
    .find((button) => button.getAttribute("aria-current") === "page")?.textContent;

describe("a default age for Team Rankings", () => {
  it("is kept when picked, and opens there the next time", async () => {
    pinClock("2026-10-02T12:00:00");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const first = renderTeamRankings(pool());
    expect(openAge()).toBe("12U");

    await user.click(within(ageNav()).getByRole("button", { name: "9U" }));
    await user.click(screen.getByRole("button", { name: "Open on 9U by default" }));
    expect(readDefaultAge()).toEqual({ level: 9, year: 2027 });
    expect(screen.getByTestId("default-age")).toHaveTextContent(
      "Opens on 9U by default, then 10U in 2028."
    );
    first.unmount();

    renderTeamRankings(pool({ defaultAge: { level: 9, year: 2027 } }));
    expect(openAge()).toBe("9U");
  });

  it("moves up with the team: 9U picked in 2027 opens 10U in 2028", () => {
    pinClock("2027-10-02T12:00:00");
    renderTeamRankings(pool({ defaultAge: { level: 9, year: 2027 } }));
    expect(openAge()).toBe("10U");
    expect(screen.getByTestId("default-age")).toHaveTextContent(
      "Opens on 10U by default, then 11U in 2029."
    );
  });

  it("still opens 9U 2027 while the 2028 pages have yet to be made", () => {
    pinClock("2027-10-02T12:00:00");
    renderTeamRankings(
      pool({
        ageGroups: [ageGroup(12, 2027), ageGroup(9, 2027)],
        defaultAge: { level: 9, year: 2027 },
      })
    );
    expect(openAge()).toBe("9U");
  });

  it("gives way to a link that names another age", () => {
    pinClock("2026-10-02T12:00:00");
    renderTeamRankings(pool({ defaultAge: { level: 9, year: 2027 }, search: "?age=10&year=2027" }));
    expect(openAge()).toBe("10U");
  });

  it("is forgotten by Clear", async () => {
    pinClock("2026-10-02T12:00:00");
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderTeamRankings(pool({ defaultAge: { level: 9, year: 2027 } }));
    await user.click(
      within(screen.getByTestId("default-age")).getByRole("button", { name: "Clear" })
    );
    expect(readDefaultAge()).toBeNull();
    expect(screen.getByRole("button", { name: "Open on 9U by default" })).toBeInTheDocument();
  });
});
