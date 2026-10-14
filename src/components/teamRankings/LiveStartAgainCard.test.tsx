import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { PoolCommand } from "../../lib/live/commands";
import type { AnswerOf, QueryKind, QueryOf } from "../../lib/live/queries";
import type { YearSummary } from "../../lib/yearSummary";
import { LiveStartAgainCard, STARTED_AGAIN, startAgainConfirmation } from "./LiveStartAgainCard";

/*
 * Starting Team Rankings again on the live page (`LiveStartAgainCard`): what the cloud holds asked
 * of the server when the button is pressed, confirmed with those counts, and the start sent to the
 * server with an Undo. The edit function is a stand-in that answers from a table.
 */

const YEARS: YearSummary[] = [
  { year: 2027, pages: 2, games: 1_250, teams: 40, archives: 0 },
  { year: 2026, pages: 3, games: 8, teams: 7, archives: 2 },
];

const setUp = ({
  years = YEARS as YearSummary[] | null,
  confirmed = true,
}: { years?: YearSummary[] | null; confirmed?: boolean } = {}) => {
  const asked: QueryKind[] = [];
  const ask = vi.fn(async <K extends QueryKind>(query: QueryOf<K>) => {
    asked.push(query.kind);
    return (years === null ? null : { kind: "year.list", years }) as AnswerOf<K> | null;
  });
  const edit = vi.fn(
    async (_command: PoolCommand, _said: { done: string; undo?: boolean }) => true
  );
  const say = vi.fn();
  const edits: LiveEdits = {
    locked: null,
    pending: [],
    edit,
    ask: ask as LiveEdits["ask"],
    warm: () => undefined,
    say,
  };
  const confirm = vi.fn(async () => confirmed);
  render(<LiveStartAgainCard edits={edits} confirm={confirm} />);
  const press = () =>
    fireEvent.click(screen.getByRole("button", { name: "Start Team Rankings again" }));
  return { asked, edit, say, confirm, press };
};

describe("starting Team Rankings again on the live page", () => {
  it("confirms immediately without waiting for pool reads, then sends the start with an Undo", async () => {
    const { asked, edit, confirm, press } = setUp();
    press();
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(asked).toEqual([]);
    expect(confirm).toHaveBeenCalledWith(startAgainConfirmation());
    expect(edit.mock.calls[0]).toEqual([
      { kind: "copy.reset" },
      { done: STARTED_AGAIN, undo: true },
    ]);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start Team Rankings again" })).not.toBeDisabled()
    );
  });

  it("counts what goes in the confirmation, and says League Standings stays", () => {
    const { message, confirmLabel } = startAgainConfirmation(YEARS);
    expect(message).toContain(
      "holds 5 pages, 1,258 stored games, 2 archived tables across 2 squad years"
    );
    expect(message).toContain("League Standings is left as it is.");
    expect(message).toContain("kept as an earlier version, so it can be brought back");
    expect(message).toContain("each nightly refresh that changes anything keeps one too");
    expect(confirmLabel).toBe("Start again");
    expect(startAgainConfirmation([{ ...YEARS[1]!, archives: 0, pages: 1 }]).message).toContain(
      "holds 1 page, 8 stored games across 1 squad year."
    );
  });

  it("shows a working status and prevents another reset while the server is answering", async () => {
    const { edit, press } = setUp();
    let finish: ((done: boolean) => void) | undefined;
    edit.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    press();
    expect(await screen.findByRole("status")).toHaveTextContent("Saving an earlier version");
    expect(screen.getByRole("button", { name: "Starting again in the cloud…" })).toBeDisabled();
    finish?.(true);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start Team Rankings again" })).not.toBeDisabled()
    );
  });

  it("sends nothing when the confirmation is declined, or no answer comes", async () => {
    const declined = setUp({ confirmed: false });
    declined.press();
    await waitFor(() => expect(declined.confirm).toHaveBeenCalledTimes(1));
    expect(declined.edit).not.toHaveBeenCalled();
  });

  it("can start again when the cloud's year list cannot answer", async () => {
    const unanswered = setUp({ years: null });
    unanswered.press();
    await waitFor(() => expect(unanswered.edit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start Team Rankings again" })).not.toBeDisabled()
    );
    expect(unanswered.confirm).toHaveBeenCalledWith(startAgainConfirmation());
    expect(unanswered.asked).toEqual([]);
  });

  it("lets the server decide whether there is anything to reset", async () => {
    const empty = setUp({ years: [] });
    empty.press();
    await waitFor(() => expect(empty.edit).toHaveBeenCalledTimes(1));
    expect(empty.asked).toEqual([]);
    expect(empty.confirm).toHaveBeenCalledWith(startAgainConfirmation());
  });
});
