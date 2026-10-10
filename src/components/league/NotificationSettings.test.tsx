import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_NOTIFY, type NotifyPrefs } from "../../lib/seasonDigest";
import { NotificationSettings } from "./NotificationSettings";

/*
 * Turning notifications on (2.6): the browser is asked for permission then and not before, a
 * refusal is said plainly, each kind is a choice of its own, and a test notification shows it works.
 */

const shown: string[] = [];
let permission: NotificationPermission = "default";
let answer: NotificationPermission = "granted";
const asked = vi.fn(async () => {
  permission = answer;
  return answer;
});

class FakeNotification {
  static get permission() {
    return permission;
  }
  static requestPermission = asked;
  constructor(title: string, options?: NotificationOptions) {
    shown.push(`${title}: ${options?.body ?? ""}`);
  }
}

function Harness({ followedName = "Aces" }: { followedName?: string | null }) {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_NOTIFY);
  return (
    <>
      <NotificationSettings prefs={prefs} onPrefs={setPrefs} followedName={followedName} />
      <pre data-testid="prefs">{JSON.stringify(prefs)}</pre>
    </>
  );
}

const prefs = () => JSON.parse(screen.getByTestId("prefs").textContent ?? "{}") as NotifyPrefs;

describe("NotificationSettings", () => {
  beforeEach(() => {
    shown.length = 0;
    permission = "default";
    answer = "granted";
    asked.mockClear();
    vi.stubGlobal("Notification", FakeNotification);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("asks the browser only when turned on, and turns on when allowed", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(asked).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "Aces's finals and corrected scores" })
    ).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Notify this device" }));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(prefs().on).toBe(true);
    expect(
      screen.getByRole("checkbox", { name: "Aces's finals and corrected scores" })
    ).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Send a test notification" }));
    expect(shown).toEqual(["League Standings: Notifications are on for this device."]);
  });

  it("says so, and stays off, when the browser refuses", async () => {
    answer = "denied";
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Notify this device" }));
    expect(prefs().on).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(/blocked for this site/);
  });

  it("keeps each kind a choice of its own", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("checkbox", { name: "Notify this device" }));
    await user.click(screen.getByRole("checkbox", { name: "Clinches" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Gold chance moving by/ }),
      "never"
    );
    expect(prefs()).toMatchObject({ on: true, clinches: false, oddsMove: null, finals: true });
  });

  it("says how to follow a team when none is followed", () => {
    render(<Harness followedName={null} />);
    expect(screen.getByText(/Follow a team with the Our team card/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Our team's finals and corrected scores" })
    ).toBeInTheDocument();
  });
});
