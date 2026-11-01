import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { resetPullSession } from "../lib/pullSession";
import type { GcImportState } from "../lib/gameChangerImport";
import { GameChangerImportPanel } from "./GameChangerImportPanel";

/*
 * What the pull says of a long list pasted in, before anything is asked of GameChanger: its
 * counts, with their commas at a thousand and more, and the time it will take in minutes said as
 * a person says it. It printed "About 1 minute(s) of requests" and "2 line(s) ignored".
 */
const emptyPool: GcImportState = { ageGroups: [], teams: [], games: [] };

const panel = () =>
  render(
    <GameChangerImportPanel
      pool={emptyPool}
      onPersist={() => true}
      savedProgress={null}
      droppedClubs={new Set()}
      onInvented={() => {}}
      namedAges={new Map()}
      onSaveProgress={() => {}}
      onClearProgress={() => {}}
      onClose={() => {}}
      showToast={() => {}}
      refreshLog={{}}
      onRefreshLog={() => {}}
    />
  );

/** `count` made-up GameChanger ids, twelve letters and digits each as GameChanger's are. */
const ids = (count: number) =>
  Array.from({ length: count }, (_, at) => `Club${String(at).padStart(8, "0")}`);

const paste = (lines: string[]) =>
  fireEvent.change(screen.getByLabelText("Teams"), { target: { value: lines.join("\n") } });

describe("a long list pasted in", () => {
  beforeEach(() => {
    resetPullSession();
    localStorage.clear();
  });

  it("counts it with commas, and a line or two it could not read in words", () => {
    panel();
    paste([...ids(1_234), "not an id at all", "nor this"]);
    expect(screen.getByText("1,234 teams")).toBeInTheDocument();
    expect(screen.getByText("2 lines ignored")).toBeInTheDocument();
    expect(screen.queryByText(/\(s\)/)).toBeNull();
  });

  it("says one line, and one minute, as one", () => {
    panel();
    paste([...ids(1_234), "not an id at all"]);
    expect(screen.getByText("1 line ignored")).toBeInTheDocument();
    expect(screen.getByText("About 1 minute of requests.")).toBeInTheDocument();
  });

  it("says minutes where there are more than one", () => {
    panel();
    paste(ids(6_000));
    expect(screen.getByText("6,000 teams")).toBeInTheDocument();
    expect(screen.getByText("About 2 minutes of requests.")).toBeInTheDocument();
  });
});
