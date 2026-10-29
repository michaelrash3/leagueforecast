import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HeadToHeadMatrix, type H2HCell } from "./HeadToHeadMatrix";

/*
 * The grid's squares were colour alone, and its legend called one game a "series". Each square now
 * carries the row team's record against the column's, and says ahead, behind or even. Placeholder
 * names.
 */
const teams = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
];
const cells: Record<string, H2HCell> = { "A|B": "win", "B|A": "loss" };
const records: Record<string, string> = { "A|B": "2-1", "B|A": "1-2" };

describe("the head-to-head grid", () => {
  it("puts each pair's record in its square and says who is ahead", () => {
    render(
      <HeadToHeadMatrix
        teams={teams}
        cellFor={(row, col) => (row === col ? "self" : (cells[`${row}|${col}`] ?? "none"))}
        recordFor={(row, col) => records[`${row}|${col}`] ?? ""}
      />
    );
    expect(screen.getByLabelText("Aces vs Bears: ahead 2-1")).toHaveTextContent("2-1");
    expect(screen.getByLabelText("Bears vs Aces: behind 1-2")).toHaveTextContent("1-2");
    expect(screen.getByLabelText("Aces vs Aces: same team")).toHaveTextContent("");
  });
});
