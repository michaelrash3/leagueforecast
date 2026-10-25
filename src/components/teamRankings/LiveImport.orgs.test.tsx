import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { ImportStatus } from "../../lib/live/queries";
import LiveImport from "./LiveImport";

/*
 * An Organizations file read on a cloud device: a tournament is left out of what is merged, since
 * its name is a bracket's age, not a team's own. Placeholder names throughout.
 */
vi.mock("../../lib/live/importStatusCache", () => ({
  cachedImportStatus: async () => null,
  keepImportStatus: async () => undefined,
}));
const status: ImportStatus = {
  due: {
    ageLevels: [],
    heldBack: 0,
    label: "",
    catchUp: false,
    cadence: "daily",
    agelessTotal: 0,
    teams: 0,
    agelessDue: 0,
  },
  refreshed: [],
  orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
  agelessIds: [],
  rosterIds: [],
};
const HEADER = "Organization Name,Organization ID,Type,Team IDs";
const orgFile = (rows: string[]) =>
  new File([[HEADER, ...rows].join("\n")], "GC_Organizations.csv", { type: "text/csv" });

const editsWith = (edit: LiveEdits["edit"]): LiveEdits => ({
  locked: null,
  pending: [],
  ask: vi.fn(async () => status) as LiveEdits["ask"],
  edit,
  say: vi.fn(),
  warm: vi.fn(),
});

describe("reading an Organizations file on a cloud device", () => {
  it("merges the leagues and leaves the tournament out", async () => {
    let merged: Parameters<LiveEdits["edit"]>[0] | null = null;
    const edit: LiveEdits["edit"] = vi.fn(async (command) => {
      merged = command;
      return true;
    });
    render(
      <LiveImport
        edits={editsWith(edit)}
        now={() => "2026-10-25T18:00:00Z"}
        pulls={() => null}
        device="test"
      />
    );
    await screen.findByLabelText("Organizations CSV");
    fireEvent.change(screen.getByLabelText("Organizations CSV"), {
      target: {
        files: [
          orgFile([
            '"NKB 11u","orgNKB0011","league","teamHYBRID01"',
            '"NB 14u","orgNB0014","tournament","teamHYBRID01"',
          ]),
        ],
      },
    });
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect(merged).toMatchObject({
      kind: "orgs.merge",
      orgs: [{ orgId: "orgNKB0011", name: "NKB 11u", teamIds: ["teamHYBRID01"] }],
    });
  });
});
