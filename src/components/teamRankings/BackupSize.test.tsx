import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ageGroup,
  game,
  renderTeamRankings,
  seasonDate,
  team,
} from "../../test/teamRankingsHarness";

/**
 * The pool that trips the warning is two hundred thousand games, and a browser will not hold one
 * that size in localStorage — which is what jsdom gives a test. So the estimate is made to answer
 * as it would for such a pool, and what is under test is what the page does with that answer.
 * How the estimate itself is arrived at is checked against real rows in the backup lib tests.
 */
vi.mock("../../lib/teamRankingsBackup", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/teamRankingsBackup")>();
  return { ...original, estimateBackupBytes: () => 44_000_000 };
});

const openSetup = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("tab", { name: "Setup" }));
};

const smallPool = () => ({
  ageGroups: [ageGroup(10, 2027)],
  teams: [team("S-A", "Aces"), team("S-B", "Badgers")],
  games: [game("g1", "ag_10u_2027", "S-A", "S-B", 5, 1, { date: seasonDate(2027) })],
});

const stubDownload = () => {
  const created: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    created.push(blob as Blob);
    return "blob:stub";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  return created;
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a backup big enough to be worth mentioning", () => {
  it("asks first, and says how big", async () => {
    const user = userEvent.setup();
    stubDownload();
    const harness = renderTeamRankings(smallPool());
    harness.requestConfirmation.mockResolvedValue(false);
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: /download a backup/i }));

    const asked = harness.requestConfirmation.mock.calls[0]?.[0] as { message: string };
    expect(asked.message).toContain("44.0 MB");
  });

  it("builds nothing when the answer is no", async () => {
    const user = userEvent.setup();
    const created = stubDownload();
    const harness = renderTeamRankings(smallPool());
    harness.requestConfirmation.mockResolvedValue(false);
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: /download a backup/i }));

    expect(created).toHaveLength(0);
    expect(harness.toasts().join(" ")).not.toMatch(/backup downloaded/i);
  });

  it("goes ahead when the answer is yes", async () => {
    const user = userEvent.setup();
    const created = stubDownload();
    const harness = renderTeamRankings(smallPool());
    await openSetup(user);

    await user.click(screen.getByRole("button", { name: /download a backup/i }));

    expect(created).toHaveLength(1);
    expect(harness.toasts().join(" ")).toMatch(/backup downloaded/i);
  });
});
