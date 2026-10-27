import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLUB_SHEET_MARK,
  forgetClubSheetHistory,
  leftClubSheet,
  markClubSheet,
} from "../../lib/clubSheetHistory";
import { useConfirmation } from "../../hooks/useConfirmation";
import { TeamNameCombobox } from "../TeamNameCombobox";
import { ClubSheet } from "./ClubSheet";

/*
 * A club's panel in a sheet over the board (`ClubSheet`), closed by its own Close, Esc, the shade
 * beside it, or Back, which leaves the history entry opening it added (`clubSheetHistory.ts`).
 */

/** A board with one club to open, as both Team Rankings screens open one. */
function Board() {
  const [open, setOpen] = useState<string | null>(null);
  const shut = () => setOpen(null);
  const close = () => {
    shut();
    leftClubSheet();
  };
  return (
    <>
      <button
        type="button"
        onClick={() => {
          markClubSheet();
          setOpen("Aces");
        }}
      >
        Open Aces
      </button>
      {open && (
        <ClubSheet label={open} onShut={shut} onClose={close}>
          <h2>{open}</h2>
          <input aria-label="Team name" />
          <button type="button" onClick={close}>
            Close
          </button>
        </ClubSheet>
      )}
    </>
  );
}

const markedNow = () =>
  (window.history.state as Record<string, unknown> | null)?.[CLUB_SHEET_MARK] === true;

/** Waits for a `history.back()` to land, which jsdom does a task later. */
const settled = () => act(() => new Promise<void>((done) => setTimeout(done, 20)));

beforeEach(() => {
  forgetClubSheetHistory();
  window.history.replaceState(null, "", "/?view=rankings");
});
afterEach(async () => {
  await settled();
  document.body.style.overflow = "";
});

describe("a club's sheet", () => {
  it("opens over the board with focus inside, and Esc puts the reader back where they were", async () => {
    render(<Board />);
    const opener = screen.getByRole("button", { name: "Open Aces" });
    await userEvent.click(opener);
    const sheet = screen.getByRole("dialog", { name: "Aces" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(sheet).toHaveFocus();
    expect(document.body.style.overflow).toBe("hidden");
    expect(markedNow()).toBe(true);

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
    // The entry it added is taken back: Back from here leaves the page, as before it opened.
    await settled();
    expect(markedNow()).toBe(false);
    expect(window.location.search).toBe("?view=rankings");
  });

  it("closes on Back, and its own Close takes back the entry it added", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(markedNow()).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    expect(markedNow()).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await settled();
    expect(markedNow()).toBe(false);
    // Opened again, the sheet adds its entry again, and Back closes it again.
    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    expect(markedNow()).toBe(true);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open, with its entry, when opened again before the last close's Back has landed", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    act(() => {
      screen.getByRole("button", { name: "Close" }).click();
      screen.getByRole("button", { name: "Open Aces" }).click();
    });
    await settled();
    expect(screen.getByRole("dialog", { name: "Aces" })).toBeInTheDocument();
    expect(markedNow()).toBe(true);
    act(() => window.history.back());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps Tab inside, and leaves an Esc a box inside has used alone", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    const name = screen.getByRole("textbox", { name: "Team name" });
    const close = screen.getByRole("button", { name: "Close" });
    await userEvent.tab();
    expect(name).toHaveFocus();
    await userEvent.tab();
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(name).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();

    // A list a box had open, closed by the box, which says so.
    name.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.preventDefault();
    });
    name.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Aces" })).toBeInTheDocument();
  });

  it("closes a name box's list on the first Esc, and itself on the next", async () => {
    function WithBox() {
      const [name, setName] = useState("");
      const [open, setOpen] = useState(true);
      return open ? (
        <ClubSheet label="Aces" onShut={() => setOpen(false)} onClose={() => setOpen(false)}>
          <TeamNameCombobox
            id="sheet-name"
            value={name}
            onChange={setName}
            options={["Aces", "Bears"]}
            placeholder="Team name"
          />
        </ClubSheet>
      ) : null;
    }
    render(<WithBox />);
    await userEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Aces" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("leaves Tab and Esc to a confirmation opened over it", async () => {
    // As the app asks before folding a club into another: its dialog drawn outside the sheet.
    function WithConfirm() {
      const [open, setOpen] = useState(true);
      const [answer, setAnswer] = useState<boolean | null>(null);
      const { state, dialogRef, request, resolve } = useConfirmation();
      return (
        <>
          {open && (
            <ClubSheet label="Aces" onShut={() => setOpen(false)} onClose={() => setOpen(false)}>
              <button
                type="button"
                onClick={() => void request({ title: "Fold Aces?", message: "" }).then(setAnswer)}
              >
                Fold into it
              </button>
            </ClubSheet>
          )}
          {state && (
            <section ref={dialogRef} role="dialog" aria-modal="true" aria-label={state.title}>
              <button type="button" onClick={() => resolve(false)}>
                Cancel
              </button>
              <button type="button" onClick={() => resolve(true)}>
                Confirm
              </button>
            </section>
          )}
          <output>{answer === null ? "unanswered" : String(answer)}</output>
        </>
      );
    }
    render(<WithConfirm />);
    const fold = screen.getByRole("button", { name: "Fold into it" });
    await userEvent.click(fold);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveFocus();

    // Esc dismisses the confirmation only: the sheet stays, with focus back on what asked.
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Fold Aces?" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Aces" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("false");
    expect(fold).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes from the shade beside it", async () => {
    render(<Board />);
    await userEvent.click(screen.getByRole("button", { name: "Open Aces" }));
    const shade = screen.getByRole("dialog").previousElementSibling;
    expect(shade).not.toBeNull();
    if (shade) await userEvent.click(shade);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
