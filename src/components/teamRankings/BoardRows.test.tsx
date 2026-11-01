import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ScoutRankingRow } from "../../lib/teamRankings";
import { RankingList } from "./RankingList";

/*
 * A board's row opens its club wherever it is tapped, not on its name alone: on a phone the name
 * was a line 20 px tall and the rest of the row did nothing. One control a row, reached by the
 * keyboard, named by the club and described by the rest of the row, with nothing else to press
 * inside it. Placeholder names.
 */
const row = (teamId: string, teamName: string, record: string, rating: number) =>
  ({ teamId, teamName, record, rating, rank: 1, comparable: true }) as ScoutRankingRow;
const ROWS = [row("S-A", "Aces", "9-1", 2), { ...row("S-B", "Bears", "6-4", -0.5), isMine: true }];
const places = new Map([["S-A", "Southvale, KY"]]);

const board = (onOpen = vi.fn()) => {
  render(
    <RankingList
      rows={ROWS}
      onOpen={onOpen}
      placeOf={(teamId) => places.get(teamId)}
      movementOf={(one) => (one.teamId === "S-A" ? 3 : undefined)}
    />
  );
  return onOpen;
};

describe("a board's row", () => {
  it("is one button, the whole row, which opens its club wherever it is pressed", async () => {
    const user = userEvent.setup();
    const onOpen = board();
    const rows = screen.getAllByRole("listitem");
    for (const one of rows) expect(within(one).getAllByRole("button")).toHaveLength(1);
    // The figures, at the far end of the row from the name.
    await user.click(screen.getByText("9-1 · +2.0"));
    expect(onOpen).toHaveBeenLastCalledWith("S-A");
    await user.click(screen.getByText("Southvale, KY"));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("is named by its club and described by the rest of the row", () => {
    board();
    const aces = screen.getByRole("button", { name: "Aces" });
    expect(aces).toHaveAccessibleDescription(/^#1 Southvale, KY .+ 9-1 · \+2\.0$/);
    // Its move an image named in words, which a screen reader says in place of the triangle.
    expect(within(aces).getByRole("img", { name: "up 3 since last week" })).toHaveTextContent("▲3");
    expect(screen.getByRole("button", { name: "Bears ★" })).toHaveAccessibleDescription(
      "#2 6-4 · -0.5"
    );
  });

  it("is reached by the keyboard, a row at a time, and opens on Enter", async () => {
    const user = userEvent.setup();
    const onOpen = board();
    await user.tab();
    expect(screen.getByRole("button", { name: "Aces" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Bears ★" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith("S-B");
  });
});
