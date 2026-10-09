import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TabNav, type TabNavItem } from "./TabNav";

/*
 * The tab row both halves share (2.4): every tab on a wide screen; on a phone the main ones and a
 * More list, a tab with an urgent badge out in the row, and the keyboard a tablist is expected to
 * have either way.
 */

type View = "dashboard" | "games" | "standings" | "model" | "power" | "quality" | "settings";

const LABELS: Record<View, string> = {
  dashboard: "Dashboard",
  games: "Schedule",
  standings: "Standings",
  model: "Forecast",
  power: "Power Ratings",
  quality: "Data Quality",
  settings: "Settings",
};

const items = (badges: Partial<Record<View, TabNavItem<View>["badge"]>> = {}) =>
  (Object.keys(LABELS) as View[]).map((key) => ({
    key,
    label: LABELS[key],
    tabId: `tab-${key}`,
    controls: `panel-${key}`,
    ...(badges[key] ? { badge: badges[key] } : {}),
  }));

function Row({
  narrow,
  badges,
  start = "dashboard",
  onTour = () => undefined,
}: {
  narrow: boolean;
  badges?: Partial<Record<View, TabNavItem<View>["badge"]>>;
  start?: View;
  onTour?: () => void;
}) {
  const [current, setCurrent] = useState<View>(start);
  return (
    <>
      <TabNav
        label="Main views"
        items={items(badges)}
        current={current}
        onSelect={setCurrent}
        narrow={narrow}
        primary={["dashboard", "games", "standings", "model"]}
        actions={[{ label: "Take the tour", onSelect: onTour }]}
      />
      <p>Showing {LABELS[current]}</p>
      <button type="button">Elsewhere</button>
    </>
  );
}

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent);

describe("the tab row on a wide screen", () => {
  it("holds every tab, and no More", () => {
    render(<Row narrow={false} />);
    expect(tabNames()).toEqual(Object.values(LABELS));
    expect(screen.queryByRole("button", { name: /^More/ })).toBeNull();
  });

  it("moves with the arrow keys, wrapping, and Home and End go to either end", async () => {
    const user = userEvent.setup();
    render(<Row narrow={false} />);
    const dashboard = screen.getByRole("tab", { name: "Dashboard" });
    // One tab at a time takes the focus from Tab: the open one.
    expect(dashboard).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Schedule" })).toHaveAttribute("tabindex", "-1");
    dashboard.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Schedule" })).toHaveFocus();
    expect(screen.getByText("Showing Schedule")).toBeInTheDocument();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("the tab row on a phone", () => {
  it("keeps the main tabs in the row and the rest under More", async () => {
    const user = userEvent.setup();
    render(<Row narrow />);
    expect(tabNames()).toEqual(["Dashboard", "Schedule", "Standings", "Forecast"]);
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    const list = screen.getByRole("group", { name: "More main views" });
    expect(
      within(list)
        .getAllByRole("button")
        .map((button) => button.textContent)
    ).toEqual(["Power Ratings", "Data Quality", "Settings", "Take the tour"]);
    await user.click(within(list).getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Showing Settings")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "More main views" })).toBeNull();
    // The open view is under More, and More says which.
    expect(screen.getByRole("button", { name: "More: Settings" })).toBeInTheDocument();
    // With no tab in the row open, Tab still lands on one of them.
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveAttribute("tabindex", "0");
  });

  it("closes More on Escape, back to its button, and on a tap elsewhere", async () => {
    const user = userEvent.setup();
    const onTour = vi.fn();
    render(<Row narrow onTour={onTour} />);
    await user.click(screen.getByRole("button", { name: "More" }));
    within(screen.getByRole("group")).getByRole("button", { name: "Power Ratings" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("group")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("group")).toBeNull();

    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(onTour).toHaveBeenCalledOnce();
  });

  it("shows a view under More whose badge is urgent across the top of the bar", async () => {
    const user = userEvent.setup();
    render(
      <Row narrow badges={{ quality: { count: 2, describe: "2 need attention", urgent: true } }} />
    );
    // No sixth tab, which would not fit a phone's width.
    expect(tabNames()).toEqual(["Dashboard", "Schedule", "Standings", "Forecast"]);
    await user.click(screen.getByRole("button", { name: "Data Quality: 2 need attention" }));
    expect(screen.getByText("Showing Data Quality")).toBeInTheDocument();
    // Once it is the open view, the strip has done its work.
    expect(screen.queryByRole("button", { name: "Data Quality: 2 need attention" })).toBeNull();
  });

  it("describes a badged tab rather than renaming it", () => {
    render(
      <Row
        narrow={false}
        badges={{ quality: { count: 2, describe: "2 need attention", urgent: true } }}
      />
    );
    expect(screen.getByRole("tab", { name: "Data Quality" })).toHaveAccessibleDescription(
      "2 need attention"
    );
  });

  it("puts the badges of what is under More on More", async () => {
    const user = userEvent.setup();
    render(<Row narrow badges={{ settings: { count: 1, describe: "Add the season's teams" } }} />);
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAccessibleDescription("Settings: Add the season's teams");
    await user.click(more);
    expect(
      within(screen.getByRole("group")).getByRole("button", { name: "Settings" })
    ).toHaveAccessibleDescription("Add the season's teams");
  });
});
