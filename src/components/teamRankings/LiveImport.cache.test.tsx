import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { LiveEdits } from "../../hooks/useLiveEdits";
import type { ImportStatus } from "../../lib/live/queries";
import LiveImport from "./LiveImport";

vi.mock("../../lib/live/importStatusCache", () => ({
  cachedImportStatus: async () => ({ answer: saved, at: "2026-10-13T04:00:00Z" }),
  keepImportStatus: async () => undefined,
}));
const saved: ImportStatus = {
  due: {
    ageLevels: [12],
    heldBack: 0,
    label: "12U",
    catchUp: false,
    cadence: "daily",
    agelessTotal: 1,
    teams: 120,
    agelessDue: 1,
  },
  refreshed: [{ level: 12, day: "2026-10-12" }],
  orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
  agelessIds: ["gcWAITING001"],
  rosterIds: [],
};

it("shows saved import status while the server is still answering, then replaces it with fresh status", async () => {
  let answer: ((status: ImportStatus) => void) | undefined;
  const ask = vi.fn(
    () =>
      new Promise<ImportStatus>((resolve) => {
        answer = resolve;
      })
  ) as LiveEdits["ask"];
  const edits: LiveEdits = {
    locked: null,
    pending: [],
    ask,
    edit: vi.fn(),
    say: vi.fn(),
    warm: vi.fn(),
  };
  render(
    <LiveImport edits={edits} now={() => "2026-10-13T05:00:00Z"} pulls={() => null} device="test" />
  );
  expect(
    await screen.findByText("Showing saved refresh status while checking for updates.")
  ).toBeTruthy();
  expect(screen.queryByText("Reading the cloud’s refresh…")).toBeNull();
  expect(screen.getByLabelText("Every age group, daily")).toBeChecked();
  expect(screen.queryByRole("button", { name: /Ask again about/ })).toBeNull();
  await waitFor(() => expect(answer).toBeTypeOf("function"));
  answer!({ ...saved, due: { ...saved.due, cadence: "rotation" } });
  await waitFor(() =>
    expect(
      screen.queryByText("Showing saved refresh status while checking for updates.")
    ).toBeNull()
  );
  expect(screen.getByLabelText("One or two levels a day")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "The week" }));
  expect(screen.getByRole("button", { name: "Hide the week" })).toBeTruthy();
});
