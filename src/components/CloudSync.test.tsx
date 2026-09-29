import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CloudStatus } from "../lib/cloud/cloudSession";
import { CloudButton, useCloudPanel } from "./CloudButton";
import { CloudPanel, savedWhen, sizeOf, type CloudActions } from "./CloudPanel";

/*
 * The cloud copy's header button and panel, as views of a status: what each status says, which
 * button calls which action, and when the panel opens without being asked.
 */
const ME = { uid: "owner-1", email: "owner@example.test" };
const NOW = new Date("2026-09-28T12:00:00Z");
const saved = (over: Partial<Extract<CloudStatus, { kind: "saved" }>> = {}): CloudStatus => ({
  kind: "saved",
  account: ME,
  owed: false,
  waitingForPull: false,
  ...over,
});
const asking: Extract<CloudStatus, { kind: "choose" }> = {
  kind: "choose",
  account: ME,
  firstTime: true,
  cloudSavedAt: "2026-09-28T11:00:00Z",
  cloudOnly: { labels: [], bytes: 0 },
};

const panel = (status: CloudStatus, onBackup = vi.fn(), onClose = vi.fn()) => {
  const actions: CloudActions = {
    signIn: vi.fn(),
    save: vi.fn(),
    signOut: vi.fn(),
    choose: vi.fn(),
    loadNewer: vi.fn(),
    retry: vi.fn(),
    restart: vi.fn(),
  };
  render(
    <CloudPanel
      status={status}
      open
      onClose={onClose}
      onBackup={onBackup}
      actions={actions}
      now={NOW}
    />
  );
  return actions;
};

describe("the header's cloud button", () => {
  it("is not drawn by a build with no Firebase setting", () => {
    const { container } = render(
      <CloudButton status={{ kind: "off" }} onOpen={vi.fn()} className="inline-flex" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("says where the copy stands, and opens the panel", async () => {
    const onOpen = vi.fn();
    render(<CloudButton status={saved({ owed: true })} onOpen={onOpen} className="inline-flex" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Cloud copy: Changes waiting to save to the cloud" })
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("asks to be looked at when the copy needs an answer", () => {
    render(<CloudButton status={asking} onOpen={vi.fn()} className="inline-flex" />);
    expect(
      screen.getByRole("button", { name: "Cloud copy: Your cloud copy needs an answer" })
    ).toBeInTheDocument();
  });
});

describe("the cloud panel", () => {
  it("offers sign-in to a browser that keeps no copy", async () => {
    const actions = panel({ kind: "signed-out" });
    expect(screen.getByRole("dialog", { name: "Your data on every device" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(actions.signIn).toHaveBeenCalledTimes(1);
  });

  it("says who is signed in and when it last saved, with nothing to save now", async () => {
    const actions = panel(saved({ syncedAt: "2026-09-28T11:55:00Z" }));
    expect(screen.getByText(/owner@example\.test/)).toBeInTheDocument();
    expect(screen.getByText("Everything is saved. Last saved 5 minutes ago.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save now" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  it("saves waiting changes on request, but not while a pull runs", async () => {
    const actions = panel(saved({ owed: true }));
    await userEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(actions.save).toHaveBeenCalledTimes(1);
  });

  it("holds Save now while a pull runs, and says why", () => {
    panel(saved({ owed: true, waitingForPull: true }));
    expect(screen.getByText(/will save once the pull finishes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save now" })).toBeDisabled();
  });

  it("asks which copy wins, and offers a backup of this browser first", async () => {
    const onBackup = vi.fn();
    const actions = panel(asking, onBackup);
    expect(screen.getByText(/both hold data, and it is not the same/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Download a backup/ }));
    expect(onBackup).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: /Use the cloud copy/ }));
    expect(actions.choose).toHaveBeenLastCalledWith("cloud");
    await userEvent.click(screen.getByRole("button", { name: /Keep this browser's data/ }));
    expect(actions.choose).toHaveBeenLastCalledWith("device");
  });

  it("offers another device's newer save", async () => {
    const actions = panel({
      kind: "newer",
      account: ME,
      cloudSavedAt: "2026-09-28T11:30:00Z",
      owed: false,
    });
    expect(screen.getByText(/saved newer data 30 minutes ago/)).toBeInTheDocument();
    expect(screen.getByText(/loading it loses nothing/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load it now" }));
    expect(actions.loadNewer).toHaveBeenCalledTimes(1);
  });

  it("says this browser's own changes are kept when it loads another device's", () => {
    panel({ kind: "newer", account: ME, cloudSavedAt: "2026-09-28T11:30:00Z", owed: true });
    expect(screen.getByText(/changes made here are kept/)).toBeInTheDocument();
    expect(screen.queryByText(/loses nothing/)).toBeNull();
  });

  it("warns what keeping this browser's data would take out of the cloud", () => {
    panel({
      ...asking,
      cloudOnly: { labels: ["Team Rankings data"], bytes: 61_400_000 },
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      /has Team Rankings data this browser does not \(61\.4 MB\)/
    );
  });

  it("says nothing of the kind when this browser holds everything the copy does", () => {
    panel(asking);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("starts a copy that is gone again only when asked", async () => {
    const actions = panel({ kind: "gone", account: ME });
    expect(screen.getByText(/cloud copy is gone/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start it again from this browser" }));
    expect(actions.restart).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  it("says the copy is another account's, and offers to sign out", async () => {
    const actions = panel({ kind: "not-owner", account: ME });
    expect(screen.getByText(/belongs to a different Google account/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  it("shows what went wrong, with a way to try again", async () => {
    const actions = panel({ kind: "error", account: ME, message: "Could not reach the cloud." });
    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the cloud.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(actions.retry).toHaveBeenCalledTimes(1);
  });

  it("offers sign-in again after a sign-in that failed", async () => {
    const actions = panel({ kind: "error", account: null, message: "Allow pop-ups." });
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(actions.signIn).toHaveBeenCalledTimes(1);
  });

  it("shows how far a save or load has got", () => {
    panel({
      kind: "working",
      account: ME,
      label: "Saving to the cloud…",
      progress: [3, 12],
    });
    const bar = screen.getByRole("progressbar", { name: "Saving to the cloud…" });
    expect(bar).toHaveAttribute("aria-valuenow", "3");
    expect(bar).toHaveAttribute("aria-valuemax", "12");
  });

  it("closes on Escape from inside it, once", () => {
    const onClose = vi.fn();
    panel({ kind: "signed-out" }, vi.fn(), onClose);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function Harness({ status }: { status: CloudStatus }) {
  const cloud = useCloudPanel(status);
  return (
    <>
      <CloudButton status={status} onOpen={cloud.show} className="inline-flex" />
      {cloud.showing && <p>panel open</p>}
      <button type="button" onClick={cloud.hide}>
        hide
      </button>
    </>
  );
}

describe("when the panel shows", () => {
  it("opens by itself for the question, once each time it is asked", async () => {
    const { rerender } = render(<Harness status={saved()} />);
    expect(screen.queryByText("panel open")).toBeNull();

    rerender(<Harness status={asking} />);
    expect(screen.getByText("panel open")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "hide" }));
    expect(screen.queryByText("panel open")).toBeNull();

    // The same question, read again: it stays where it was put.
    rerender(<Harness status={{ ...asking }} />);
    expect(screen.queryByText("panel open")).toBeNull();
    // Asked afresh, after another save: it opens again.
    rerender(<Harness status={{ ...asking, cloudSavedAt: "2026-09-28T11:45:00Z" }} />);
    expect(screen.getByText("panel open")).toBeInTheDocument();
  });

  it("opens on the button, and never in a build with no Firebase setting", async () => {
    const { rerender } = render(<Harness status={saved()} />);
    await userEvent.click(screen.getByRole("button", { name: /Cloud copy/ }));
    expect(screen.getByText("panel open")).toBeInTheDocument();
    rerender(<Harness status={{ kind: "off" }} />);
    expect(screen.queryByText("panel open")).toBeNull();
  });
});

describe("a size, as the panel says it", () => {
  it("is megabytes to one place, or kilobytes, never zero", () => {
    expect(sizeOf(61_400_000)).toBe("61.4 MB");
    expect(sizeOf(830_000)).toBe("830 KB");
    expect(sizeOf(12)).toBe("1 KB");
  });
});

describe("when a save is said to have been", () => {
  it("counts minutes for the first hour, and says earlier for a time it cannot read", () => {
    expect(savedWhen("2026-09-28T11:59:30Z", NOW)).toBe("just now");
    expect(savedWhen("2026-09-28T11:59:00Z", NOW)).toBe("1 minute ago");
    expect(savedWhen("2026-09-28T11:05:00Z", NOW)).toBe("55 minutes ago");
    expect(savedWhen(undefined, NOW)).toBe("earlier");
    expect(savedWhen("not a time", NOW)).toBe("earlier");
    // Past the hour it is a clock time, and "today" only if it is today where the test runs.
    const earlier = "2026-09-28T08:00:00Z";
    const sameDay = new Date(earlier).toDateString() === NOW.toDateString();
    expect(savedWhen(earlier, NOW)).toMatch(sameDay ? /^today at / : /^\w{3} \d+ at /);
    expect(savedWhen("2026-09-20T08:00:00Z", NOW)).toMatch(/^\w{3} \d+ at /);
  });
});
