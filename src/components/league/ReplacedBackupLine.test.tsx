import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { FullBackup } from "../../lib/backup";
import type { ReplacedBackup } from "../../lib/replacedBackup";
import { ReplacedBackupLine } from "./ReplacedBackupLine";

/*
 * Settings' line for what the last full restore replaced, kept on this device until the next
 * restore (`replacedBackup.ts`): the toast's download is gone with the toast.
 */
const kept = (at: string): ReplacedBackup => ({
  at,
  backup: { exportedAt: at, seasons: [] } as unknown as FullBackup,
});

describe("what the last restore replaced, in Settings", () => {
  it("says nothing where nothing is kept", async () => {
    const { container } = render(<ReplacedBackupLine read={async () => null} save={vi.fn()} />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("offers what is kept as a download, as long as it is kept", async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const held = kept(new Date().toISOString());
    render(<ReplacedBackupLine read={async () => held} save={save} />);

    const button = await screen.findByRole("button", { name: "Download replaced data" });
    expect(screen.getByText(/kept on this device until the next restore/)).toBeInTheDocument();
    await user.click(button);
    expect(save).toHaveBeenCalledWith(held.backup);
  });

  it("reads again when a restore keeps what it replaced", async () => {
    let held: ReplacedBackup | null = null;
    let told: (() => void) | undefined;
    render(
      <ReplacedBackupLine
        read={async () => held}
        save={vi.fn()}
        listen={(heard) => {
          told = heard;
          return () => undefined;
        }}
      />
    );
    await act(async () => {});
    expect(screen.queryByRole("button")).toBeNull();

    held = kept(new Date().toISOString());
    await act(async () => told?.());
    expect(await screen.findByRole("button", { name: "Download replaced data" })).toBeVisible();
  });
});
