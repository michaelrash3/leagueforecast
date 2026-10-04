import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudStatus } from "../lib/cloud/cloudSession";
import { loadCloudState, saveCloudState } from "../lib/cloud/cloudState";
import { writeLiveBoard } from "../lib/preferences";

/*
 * Which Team Rankings opens (`RankingsOpen`): the cloud's board for a member who turned it on, or
 * the page as it always was, decided as it opens and kept until it closes.
 */

vi.mock("../lib/cloud/cloudSession", () => ({
  poolWantsCloud: () => false,
  poolOnScreen: () => undefined,
  preparePool: async () => undefined,
}));
vi.mock("./teamRankings/LiveTeamRankings", () => ({
  LiveTeamRankings: ({ status }: { status: CloudStatus }) => (
    <p data-testid="live">cloud&apos;s board, {status.kind}</p>
  ),
}));

const { RankingsOpen } = await import("./RankingsOpen");

const ME = { uid: "uid-1", email: "member@example.com" };
const SAVED: CloudStatus = { kind: "saved", account: ME, owed: false, newer: [] };

const showToast = () => undefined;
const confirm = async () => true;

const open = (status: CloudStatus) => {
  const page = vi.fn(() => <p data-testid="page">the page</p>);
  const shown = render(
    <Suspense fallback={null}>
      <RankingsOpen status={status} page={page} showToast={showToast} confirm={confirm} />
    </Suspense>
  );
  return { page, shown };
};

beforeEach(() => {
  window.localStorage.clear();
  saveCloudState({ ...loadCloudState(), enabled: true, uid: ME.uid });
});

describe("which Team Rankings opens", () => {
  it("is the page as it always was while the switch is off", () => {
    const { page } = open(SAVED);
    expect(screen.getByTestId("page")).toBeTruthy();
    expect(screen.queryByTestId("live")).toBeNull();
    expect(page).toHaveBeenCalledWith();
  });

  it("is the cloud's board for a member who turned it on, signed in or still finding out", async () => {
    writeLiveBoard(true);
    open(SAVED);
    expect((await screen.findByTestId("live")).textContent).toBe("cloud's board, saved");
    expect(screen.queryByTestId("page")).toBeNull();
    const connecting = open({ kind: "connecting" });
    expect(await connecting.shown.findAllByTestId("live")).toHaveLength(2);
  });

  it("is the page as it always was where there is no member to read a board as", () => {
    writeLiveBoard(true);
    for (const status of [
      { kind: "signed-out" },
      { kind: "none" },
      { kind: "not-owner", account: ME },
      { kind: "update", account: ME },
    ] as CloudStatus[]) {
      const { shown } = open(status);
      expect(shown.getByTestId("page")).toBeTruthy();
      shown.unmount();
    }
    // Nor in a browser that keeps no cloud copy.
    saveCloudState({ ...loadCloudState(), enabled: false });
    expect(open(SAVED).shown.getByTestId("page")).toBeTruthy();
  });

  it("stays the one it opened as when the switch is turned while it is open", async () => {
    const { shown } = open(SAVED);
    writeLiveBoard(true);
    shown.rerender(
      <Suspense fallback={null}>
        <RankingsOpen
          status={SAVED}
          page={() => <p data-testid="page">the page</p>}
          showToast={showToast}
          confirm={confirm}
        />
      </Suspense>
    );
    expect(screen.getByTestId("page")).toBeTruthy();
    expect(screen.queryByTestId("live")).toBeNull();
  });
});
