import { afterEach, expect, it, vi } from "vitest";
import { cachedImportStatus, keepImportStatus } from "../importStatusCache";
import type { ImportStatus } from "../queries";
const saved = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../../idb", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../idb")>()),
  idbGet: async (key: string) => saved.get(key) ?? null,
  idbSet: async (key: string, value: unknown) => {
    saved.set(key, value);
    return true;
  },
}));
afterEach(() => saved.clear());
const status: ImportStatus = {
  due: {
    ageLevels: [12],
    heldBack: 0,
    label: "12U",
    catchUp: false,
    cadence: "daily",
    agelessTotal: 0,
    teams: 120,
    agelessDue: 0,
  },
  refreshed: [{ level: 12, day: "2026-10-12" }],
  orgs: { orgs: 0, teams: 0, aged: 0, waitingAged: 0 },
  agelessIds: [],
  rosterIds: [],
};
it("keeps a validated import status for the same account without requiring a browser pool", async () => {
  await keepImportStatus("member-a", status, "2026-10-13T05:00:00Z");
  expect(await cachedImportStatus("member-a")).toEqual({
    answer: status,
    at: "2026-10-13T05:00:00Z",
  });
  expect(await cachedImportStatus("member-b")).toBeNull();
  expect(await cachedImportStatus(null)).toBeNull();
});
it("ignores damaged or incompatible status snapshots", async () => {
  saved.set("league_forecast_live_view_v1:import-status:member", {
    at: "now",
    answer: { due: "bad" },
  });
  expect(await cachedImportStatus("member")).toBeNull();
});
