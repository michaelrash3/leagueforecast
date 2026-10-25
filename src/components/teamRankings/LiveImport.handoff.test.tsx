import { act, render, screen, waitFor } from "@testing-library/react";
import { useCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { PullSender } from "../../lib/cloud/cloudPulls";
import {
  heldHandoff,
  holdHandoff,
  onHandoffLoaded,
  resetHandoffForTests,
} from "../../lib/crawlHandoffStore";
import type { ImportStatus } from "../../lib/live/queries";
import LiveCloudPulls, { useWatchedPulls } from "./LiveCloudPulls";
import LiveImport from "./LiveImport";

/*
 * The crawl's files handed over by the owner's userscript, taken by the cloud's Import: the
 * organizations sent as the one merge choosing the file would send, the team list into the pull
 * card and no further. Placeholder names throughout.
 */
vi.mock("../../lib/live/importStatusCache", () => ({
  cachedImportStatus: async () => null,
  keepImportStatus: async () => undefined,
}));
const status: ImportStatus = {
  due: {
    ageLevels: [9],
    heldBack: 0,
    label: "9U",
    catchUp: false,
    cadence: "daily",
    agelessTotal: 0,
    teams: 2,
    agelessDue: 0,
  },
  refreshed: [],
  orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
  agelessIds: [],
  rosterIds: [],
};
const NOW = "2026-10-25T18:00:00Z";
const TEAMS = [
  '"Team Name","Team ID","Season","Age Group"',
  '"Placeholder Owls 9U","Ab3dE5gH7jK9","Spring 2027","9U"',
].join("\r\n");
const ORGS = [
  '"Organization Name","Organization ID","Type","Season Name","Season Year","City","State","Team Count","Team IDs"',
  '"Placeholder League 9U","Pqy5Av4tHncy","league","Spring","2027","","","1","Ab3dE5gH7jK9"',
].join("\r\n");

const edits = (edit: LiveEdits["edit"], locked: string | null = null): LiveEdits => ({
  locked,
  pending: [],
  ask: vi.fn(async () => status) as LiveEdits["ask"],
  edit,
  say: vi.fn(),
  warm: vi.fn(),
});
const liveImport = (live: LiveEdits) =>
  render(<LiveImport edits={live} now={() => NOW} pulls={() => null} device="test" />);

beforeEach(() => {
  resetHandoffForTests();
  localStorage.clear();
});
afterEach(() => resetHandoffForTests());

describe("the crawl's Organizations file on the cloud's Import", () => {
  it("is sent as one merge, once, and the miner told when the copy has it", async () => {
    const told = vi.fn();
    onHandoffLoaded(told);
    const edit = vi.fn(async () => true);
    holdHandoff({
      id: "run_1",
      teams: null,
      orgs: { name: "GC_Organizations_New.csv", text: ORGS },
    });
    liveImport(edits(edit));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(edit).toHaveBeenCalledWith(
      {
        kind: "orgs.merge",
        orgs: [{ orgId: "Pqy5Av4tHncy", name: "Placeholder League 9U", teamIds: ["Ab3dE5gH7jK9"] }],
        at: NOW,
      },
      expect.anything()
    );
    await waitFor(() => expect(told).toHaveBeenCalledWith("run_1", "orgs"));
    // Sent again under the same id, it is never merged again.
    act(() => {
      holdHandoff({ id: "run_1", teams: null, orgs: { name: "x.csv", text: ORGS } });
    });
    expect(heldHandoff().orgs).toBeNull();
    expect(edit).toHaveBeenCalledTimes(1);
  });

  it("tells the miner nothing when the merge was not made", async () => {
    const told = vi.fn();
    onHandoffLoaded(told);
    const edit = vi.fn(async () => false);
    holdHandoff({ id: "run_2", teams: null, orgs: { name: "o.csv", text: ORGS } });
    liveImport(edits(edit));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(told).not.toHaveBeenCalled();
  });

  it("waits while edits are locked, as the file input does", async () => {
    const edit = vi.fn(async () => true);
    holdHandoff({ id: "run_3", teams: null, orgs: { name: "o.csv", text: ORGS } });
    liveImport(edits(edit, "Reconnecting to the cloud…"));
    await act(async () => {});
    expect(edit).not.toHaveBeenCalled();
    expect(heldHandoff().orgs?.id).toBe("run_3");
  });
});

function Pulls({ sender }: { sender: PullSender | null }) {
  const pulls = useCallback(() => sender, [sender]);
  const watching = useWatchedPulls(pulls);
  return (
    <LiveCloudPulls
      pulls={pulls}
      watching={watching}
      locked={null}
      agelessIds={[]}
      rosterIds={[]}
      playing={2027}
      device="test-device"
      now={() => NOW}
    />
  );
}

describe("the crawl's team list on the cloud's pull card", () => {
  it("is shown in the card, ready to pull, and nothing is pulled", async () => {
    const told = vi.fn();
    onHandoffLoaded(told);
    const sender: PullSender = {
      jobs: { read: vi.fn(async () => null), put: vi.fn(), askStop: vi.fn() },
      start: vi.fn(async () => ({ ok: true as const, value: { status: "queued" } })),
    };
    holdHandoff({ id: "run_4", teams: { name: "GC_Teams_New.csv", text: TEAMS }, orgs: null });
    render(<Pulls sender={sender} />);
    await waitFor(() => expect(screen.getByText("GC_Teams_New.csv")).toBeTruthy());
    expect(told).toHaveBeenCalledWith("run_4", "teams");
    expect(sender.start).not.toHaveBeenCalled();
    expect(sender.jobs.put).not.toHaveBeenCalled();
  });

  it("waits for a member signed in, as the card's own file input does", async () => {
    holdHandoff({ id: "run_5", teams: { name: "GC_Teams_New.csv", text: TEAMS }, orgs: null });
    render(<Pulls sender={null} />);
    await act(async () => {});
    expect(heldHandoff().teams?.id).toBe("run_5");
  });
});
