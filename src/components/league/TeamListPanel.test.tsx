import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TeamListPanel } from "./TeamListPanel";

/*
 * A rename the season refuses (another team's name) leaves the saved name in the box rather than
 * the refused one, which was never saved. Placeholder names.
 */
const teams = [
  { id: "ACES", name: "Aces" },
  { id: "BEAR", name: "Bears" },
];

const draw = (onRename: (teamId: string, name: string) => boolean) =>
  render(
    <TeamListPanel
      teams={teams}
      locked={false}
      hasGames={false}
      onAdd={() => true}
      onRename={onRename}
      onRemove={vi.fn()}
      onLock={vi.fn()}
      onUnlock={vi.fn()}
    />
  );

describe("renaming a team on the open list", () => {
  it("shows the saved name again when the season refuses the new one", () => {
    const onRename = vi.fn(() => false);
    draw(onRename);
    const box = screen.getByLabelText("Name of Bears");
    fireEvent.change(box, { target: { value: "Aces" } });
    fireEvent.blur(box);
    expect(onRename).toHaveBeenCalledWith("BEAR", "Aces");
    expect(box).toHaveValue("Bears");
  });

  it("keeps a name the season took", () => {
    const onRename = vi.fn(() => true);
    draw(onRename);
    const box = screen.getByLabelText("Name of Bears");
    fireEvent.change(box, { target: { value: "Bobcats" } });
    fireEvent.blur(box);
    expect(box).toHaveValue("Bobcats");
  });
});
