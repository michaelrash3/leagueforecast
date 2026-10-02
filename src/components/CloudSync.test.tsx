import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CloudStatus, KeptVersion } from "../lib/cloud/cloudSession";
import { CloudButton, useCloudPanel } from "./CloudButton";
import type { MembersApi } from "./CloudMembers";
import { CloudPanel, savedWhen, sizeOf, type CloudActions } from "./CloudPanel";

/*
 * The cloud copy's header button and panel, as views of a status: what each status says, and which
 * button calls which action. Nothing here asks which copy wins: changes on two devices are merged,
 * and whatever a merge had to replace is listed to be brought back.
 */
const ME = { uid: "owner-1", email: "owner@example.test" };
const NOW = new Date("2026-09-28T12:00:00Z");
const saved = (over: Partial<Extract<CloudStatus, { kind: "saved" }>> = {}): CloudStatus => ({
  kind: "saved",
  account: ME,
  owed: false,
  newer: [],
  ...over,
});

/** The list as an account that is not its owner sees it: nothing. */
const NOT_OWNER: MembersApi = {
  list: async () => null,
  add: async () => undefined,
  remove: async () => undefined,
  message: String,
};

const panel = (
  status: CloudStatus,
  { onClose = vi.fn(), kept = [] as KeptVersion[], members = NOT_OWNER } = {}
) => {
  const actions: CloudActions = {
    signIn: vi.fn(),
    save: vi.fn(),
    signOut: vi.fn(),
    loadNewer: vi.fn(),
    retry: vi.fn(),
    restart: vi.fn(),
    bringBack: vi.fn(),
    dismissNotice: vi.fn(),
    reloadApp: vi.fn(),
  };
  render(
    <CloudPanel
      status={status}
      open
      onClose={onClose}
      actions={actions}
      members={members}
      kept={kept}
      now={NOW}
    />
  );
  return actions;
};

describe("the header's cloud button", () => {
  it("is not drawn while the cloud is off", () => {
    const { container } = render(
      <CloudButton status={{ kind: "off" }} onOpen={vi.fn()} className="inline-flex" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers sign-in in a browser that has never kept a copy", async () => {
    const onOpen = vi.fn();
    render(<CloudButton status={{ kind: "none" }} onOpen={onOpen} className="inline-flex" />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Cloud copy: Sign in to keep your data on every device",
      })
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says where the copy stands, and opens the panel", async () => {
    const onOpen = vi.fn();
    render(<CloudButton status={saved({ owed: true })} onOpen={onOpen} className="inline-flex" />);
    await userEvent.click(
      screen.getByRole("button", { name: "Cloud copy: Changes waiting to save to the cloud" })
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("says when another device saved newer data, and when this one was signed out", () => {
    const { rerender } = render(
      <CloudButton status={saved({ newer: ["league"] })} onOpen={vi.fn()} className="inline-flex" />
    );
    expect(
      screen.getByRole("button", { name: "Cloud copy: Newer data saved from another device" })
    ).toBeInTheDocument();
    rerender(
      <CloudButton status={{ kind: "signed-out" }} onOpen={vi.fn()} className="inline-flex" />
    );
    expect(
      screen.getByRole("button", { name: "Cloud copy: Signed out of your cloud copy" })
    ).toBeInTheDocument();
  });
});

describe("the cloud panel", () => {
  it("offers sign-in to a browser that has never kept a copy", async () => {
    const actions = panel({ kind: "none" });
    expect(screen.getByRole("dialog", { name: "Your data on every device" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(actions.signIn).toHaveBeenCalledTimes(1);
  });

  it("asks a browser that was signed out to sign in again, keeping what changed", async () => {
    const actions = panel({ kind: "signed-out" });
    expect(screen.getByText(/anything changed here meanwhile is saved then/)).toBeInTheDocument();
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

  it("saves waiting changes on request", async () => {
    const actions = panel(saved({ owed: true }));
    await userEvent.click(screen.getByRole("button", { name: "Save now" }));
    expect(actions.save).toHaveBeenCalledTimes(1);
  });

  it("holds Save now while a pull runs, and says why", () => {
    panel(saved({ owed: true, waiting: "pull" }));
    expect(screen.getByText(/will save once the pull or tidy finishes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save now" })).toBeDisabled();
  });

  it("says when a change here could not be stored, and so is not in the cloud", () => {
    panel(saved({ owed: true, waiting: "storage" }));
    expect(screen.getByText(/could not be stored on this device/)).toBeInTheDocument();
  });

  it("offers another device's newer changes, and loads them on request", async () => {
    const actions = panel(saved({ newer: ["league"] }));
    expect(screen.getByText(/Another device changed League Standings/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load them now" }));
    expect(actions.loadNewer).toHaveBeenCalledTimes(1);
  });

  it("says what a merge settled, until it has been read", async () => {
    const actions = panel(saved({ notice: "The later change was kept." }));
    expect(screen.getByText("The later change was kept.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(actions.dismissNotice).toHaveBeenCalledTimes(1);
  });

  it("lists kept versions, and brings one back only when asked twice", async () => {
    const actions = panel(saved(), {
      kept: [
        {
          group: "g1",
          keptAt: "2026-09-28T11:30:00Z",
          why: "lost",
          fromHere: true,
          what: ["Team Rankings"],
          bytes: 2_100_000,
        },
      ],
    });
    expect(
      screen.getByText(/This device's own Team Rankings, kept 30 minutes ago \(2\.1 MB\)/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Bring back…" }));
    expect(actions.bringBack).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Keep what is there" }));
    await userEvent.click(screen.getByRole("button", { name: "Bring back…" }));
    await userEvent.click(screen.getByRole("button", { name: "Bring it back" }));
    expect(actions.bringBack).toHaveBeenCalledWith("g1");
  });

  it("starts a copy that is gone again only when asked", async () => {
    const actions = panel({ kind: "gone", account: ME });
    expect(screen.getByText(/cloud copy is gone/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start it again from this browser" }));
    expect(actions.restart).toHaveBeenCalledTimes(1);
  });

  it("says the account is not on the copy's list, and offers to sign out", async () => {
    const actions = panel({ kind: "not-owner", account: ME });
    expect(
      screen.getByText(/owner@example.test is not on the list of accounts that may use this/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(actions.signOut).toHaveBeenCalledTimes(1);
  });

  it("asks for an update when a newer version of the app saved the copy", async () => {
    const actions = panel({ kind: "update", account: ME });
    expect(screen.getByText(/saved by a newer version of the app/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(actions.reloadApp).toHaveBeenCalledTimes(1);
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
    panel({ kind: "none" }, { onClose });
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
  it("opens on the button, and never while the cloud is off", async () => {
    const { rerender } = render(<Harness status={saved()} />);
    expect(screen.queryByText("panel open")).toBeNull();
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
