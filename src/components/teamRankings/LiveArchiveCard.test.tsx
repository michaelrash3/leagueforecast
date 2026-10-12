import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { PoolCommand } from "../../lib/live/commands";
import type { AnswerOf, QueryKind, QueryOf } from "../../lib/live/queries";
import {
  archiveConfirmation,
  archivedSaid,
  deleteConfirmation,
  nothingUnder,
  type YearArchivePreview,
  type YearDeletePreview,
  type YearSummary,
} from "../../lib/yearSummary";
import { LiveArchiveCard, YEARS_READING } from "./LiveArchiveCard";

/*
 * Setup's Archive card on the live page (`LiveArchiveCard`): the years as the server lists them,
 * and a year archived or deleted by the server, asked about first in the device card's own words.
 * The edit function is a stand-in that answers each question from a table. Placeholder names.
 */

const YEARS: YearSummary[] = [
  { year: 2027, pages: 1, games: 1, teams: 2, archives: 0 },
  { year: 2026, pages: 3, games: 8, teams: 7, archives: 0 },
];
const ARCHIVE: YearArchivePreview = {
  tables: [{ name: "9U · Fall 2025", rows: 3 }],
  droppedGames: 8,
  droppedTeams: 6,
  archivedLeagueGames: 0,
  unranked: [{ name: "8U 2026", games: 2 }],
};
const DELETE: YearDeletePreview = {
  pages: ["8U 2026", "9U 2026", "10U 2026"],
  droppedGames: 8,
  droppedTeams: 6,
  unlinkedTeams: 0,
  tables: 0,
  leagueSeasons: 0,
};

const setUp = ({
  archive = ARCHIVE,
  remove = DELETE,
  confirmed = true,
  made = true,
  locked = null,
}: {
  archive?: YearArchivePreview;
  remove?: YearDeletePreview;
  confirmed?: boolean;
  made?: boolean;
  locked?: string | null;
} = {}) => {
  const asked: QueryKind[] = [];
  const answers: { [K in QueryKind]?: AnswerOf<K> } = {
    "year.list": { kind: "year.list", years: YEARS },
    "year.archivePreview": { kind: "year.archivePreview", preview: archive },
    "year.deletePreview": { kind: "year.deletePreview", preview: remove },
  };
  const ask = vi.fn(async <K extends QueryKind>(query: QueryOf<K>) => {
    asked.push(query.kind);
    return (answers[query.kind] as AnswerOf<K> | undefined) ?? null;
  });
  const edit = vi.fn(async (_command: PoolCommand, _said: { done: string }) => made);
  const say = vi.fn();
  const edits: LiveEdits = {
    locked,
    pending: [],
    edit,
    ask: ask as LiveEdits["ask"],
    warm: () => undefined,
    say,
  };
  const confirm = vi.fn(async () => confirmed);
  render(<LiveArchiveCard edits={edits} confirm={confirm} currentYear={2027} />);
  return { asked, edit, say, confirm };
};

const pick = async (year: string) => {
  fireEvent.change(await screen.findByLabelText("Baseball year"), { target: { value: year } });
};

describe("the live Archive card", () => {
  it("asks nothing while edits are off, which would only say the lock again", () => {
    const { asked } = setUp({ locked: "Offline · editing is off." });
    expect(screen.getByText(YEARS_READING)).toBeTruthy();
    expect(asked).toEqual([]);
  });

  it("says it is reading, then lists the years the server counts, as the device's card does", async () => {
    setUp();
    expect(screen.getByText(YEARS_READING)).toBeTruthy();
    await pick("2026");
    expect(screen.getByText(/holds 3 pages, 8 games and 7 teams/)).toBeTruthy();
    expect(screen.queryByText(YEARS_READING)).toBeNull();
  });

  it("archives a year once confirmed in the device's words, and reads the years again", async () => {
    const { asked, edit, confirm } = setUp();
    await pick("2026");
    fireEvent.click(screen.getByRole("button", { name: "Archive this year" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(archiveConfirmation(2026, ARCHIVE));
    const [command, said] = edit.mock.calls[0] ?? [];
    expect(command).toMatchObject({ kind: "year.archive", year: 2026 });
    expect(command?.kind === "year.archive" && Date.parse(command.at)).toBeGreaterThan(0);
    expect(said).toEqual({ done: archivedSaid(2026, ARCHIVE) });
    await waitFor(() => expect(asked).toEqual(["year.list", "year.archivePreview", "year.list"]));
  });

  it("deletes a year once confirmed in the device's words", async () => {
    const { edit, confirm } = setUp();
    await pick("2026");
    fireEvent.click(screen.getByRole("button", { name: "Delete this year" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(deleteConfirmation(2026, DELETE));
    expect(edit.mock.calls[0]).toEqual([
      { kind: "year.delete", year: 2026 },
      { done: "2026 deleted." },
    ]);
  });

  it("sends nothing when the confirmation is declined, or when nothing is under the year", async () => {
    const declined = setUp({ confirmed: false });
    await pick("2026");
    fireEvent.click(screen.getByRole("button", { name: "Archive this year" }));
    await waitFor(() => expect(declined.confirm).toHaveBeenCalledTimes(1));
    expect(declined.edit).not.toHaveBeenCalled();
  });

  it("says nothing is under a year without asking to confirm, for either", async () => {
    const empty = setUp({
      archive: { ...ARCHIVE, tables: [], unranked: [] },
      remove: { ...DELETE, pages: [], tables: 0 },
    });
    await pick("2026");
    fireEvent.click(screen.getByRole("button", { name: "Archive this year" }));
    await waitFor(() => expect(empty.say).toHaveBeenCalledWith(nothingUnder(2026)));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete this year" })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete this year" }));
    await waitFor(() => expect(empty.say).toHaveBeenCalledTimes(2));
    expect(empty.confirm).not.toHaveBeenCalled();
    expect(empty.edit).not.toHaveBeenCalled();
  });

  it("reads the years again only after an edit that was made", async () => {
    const { asked, edit } = setUp({ made: false });
    await pick("2026");
    fireEvent.click(screen.getByRole("button", { name: "Delete this year" }));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Delete this year" })).not.toBeDisabled()
    );
    expect(asked).toEqual(["year.list", "year.deletePreview"]);
  });
});
