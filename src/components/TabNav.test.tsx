import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ShortcutsHelp } from "./ShortcutsHelp";
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
      {/* The panel as League draws it, named by the tab that opened it. */}
      <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`}>
        <p>Showing {LABELS[current]}</p>
      </div>
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
    // And the focus it had waits on More, which now names the view, not on the page's body.
    expect(screen.getByRole("button", { name: "More: Data Quality" })).toHaveFocus();
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

  it("closes More when a tab in the bar is tapped instead", async () => {
    const user = userEvent.setup();
    render(<Row narrow />);
    const more = screen.getByRole("button", { name: "More" });
    // Pressed as Safari presses a button, without giving it the focus, so that the tap is all
    // there is to close the list by.
    fireEvent.click(more);
    expect(more).not.toHaveFocus();
    await user.click(screen.getByRole("tab", { name: "Schedule" }));
    expect(screen.getByText("Showing Schedule")).toBeInTheDocument();
    // Left open, the list would stay drawn over the view just chosen.
    expect(screen.queryByRole("group")).toBeNull();
    expect(more).toHaveAttribute("aria-expanded", "false");
  });

  it("closes More when the keyboard leaves it, past its end or back past its button", async () => {
    const user = userEvent.setup();
    render(<Row narrow />);
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    await user.keyboard("{Enter}");
    // Through Power Ratings, Data Quality, Settings and the tour, and on out of the list.
    await user.tab();
    expect(
      within(screen.getByRole("group")).getByRole("button", { name: "Power Ratings" })
    ).toHaveFocus();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(screen.getByRole("group")).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
    expect(screen.queryByRole("group")).toBeNull();

    more.focus();
    await user.keyboard("{Enter}");
    await user.tab({ shift: true });
    expect(screen.getByRole("tab", { name: "Dashboard" })).toHaveFocus();
    expect(screen.queryByRole("group")).toBeNull();
  });

  it("keeps More open while the focus goes nowhere, as Safari's does on a tap in the list", () => {
    render(<Row narrow />);
    const more = screen.getByRole("button", { name: "More" });
    more.focus();
    fireEvent.click(more);
    // Safari moves the focus off More and onto nothing as a button in the list is pressed.
    fireEvent.blur(more, { relatedTarget: null });
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "Settings" }));
    expect(screen.getByText("Showing Settings")).toBeInTheDocument();
  });

  it("puts the focus back on More once a view is chosen from its list", async () => {
    const user = userEvent.setup();
    render(<Row narrow />);
    // By keyboard: the list's button goes with the list, and the focus would fall to the body.
    screen.getByRole("button", { name: "More" }).focus();
    await user.keyboard("{Enter}");
    await user.tab();
    await user.tab();
    await user.tab();
    expect(
      within(screen.getByRole("group")).getByRole("button", { name: "Settings" })
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByText("Showing Settings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More: Settings" })).toHaveFocus();

    // And by a tap.
    await user.click(screen.getByRole("button", { name: "More: Settings" }));
    await user.click(
      within(screen.getByRole("group")).getByRole("button", { name: "Power Ratings" })
    );
    expect(screen.getByRole("button", { name: "More: Power Ratings" })).toHaveFocus();
  });

  it("runs an action with the focus on More, for a dialog it opens to give back on closing", async () => {
    const user = userEvent.setup();
    // League's keyboard shortcuts: an action under More opening a dialog with a focus trap, which
    // gives the focus back on closing to wherever it was when the dialog opened.
    function WithShortcuts() {
      const [showing, setShowing] = useState(false);
      return (
        <>
          <TabNav
            label="Main views"
            items={items()}
            current="dashboard"
            onSelect={() => undefined}
            narrow
            primary={["dashboard", "games", "standings", "model"]}
            actions={[{ label: "Keyboard shortcuts", onSelect: () => setShowing(true) }]}
          />
          <ShortcutsHelp open={showing} shortcuts={[]} onClose={() => setShowing(false)} />
        </>
      );
    }
    render(<WithShortcuts />);
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(more).toHaveFocus();
  });

  it("names the open panel when its view is under More, where it has no tab", async () => {
    const user = userEvent.setup();
    render(<Row narrow />);
    expect(screen.getByRole("tabpanel", { name: "Dashboard" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      within(screen.getByRole("group")).getByRole("button", { name: "Data Quality" })
    );
    expect(screen.getByRole("tabpanel", { name: "Data Quality" })).toBeInTheDocument();
    // Still named with the list open over it, and only one element carries the id.
    await user.click(screen.getByRole("button", { name: "More: Data Quality" }));
    expect(screen.getByRole("tabpanel", { name: "Data Quality" })).toBeInTheDocument();
    expect(document.querySelectorAll("#tab-quality")).toHaveLength(1);
  });

  it("marks the open view in the bar by more than the colour of its label", async () => {
    const user = userEvent.setup();
    render(<Row narrow start="standings" />);
    /*
     * The classes the open cell has that a closed one does not, leaving out its text colours:
     * active against inactive measured 2.67:1 in light mode and 2.63:1 in dark, under the 3:1 a
     * state carried by colour alone needs.
     */
    const beyondColour = (open: HTMLElement, closed: HTMLElement) => {
      const shut = new Set(closed.className.split(/\s+/));
      return open.className
        .split(/\s+/)
        .filter((name) => !shut.has(name) && !/^(?:dark:)?text-/.test(name));
    };
    const schedule = screen.getByRole("tab", { name: "Schedule" });
    expect(beyondColour(screen.getByRole("tab", { name: "Standings" }), schedule)).not.toEqual([]);
    expect(beyondColour(schedule, screen.getByRole("tab", { name: "Forecast" }))).toEqual([]);
    // More is marked the same way while the open view is behind it.
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(within(screen.getByRole("group")).getByRole("button", { name: "Settings" }));
    expect(
      beyondColour(screen.getByRole("button", { name: "More: Settings" }), schedule)
    ).not.toEqual([]);
  });

  it("keeps More's list within the screen's height, scrolling inside itself", async () => {
    const user = userEvent.setup();
    render(<Row narrow />);
    await user.click(screen.getByRole("button", { name: "More" }));
    /*
     * The list sits above a bar fixed to the screen, so a page scroll cannot reach what runs off
     * its top: at 320 by 256 (1280 by 1024 at 400% zoom) Power Ratings measured wholly above the
     * screen. A height of its own, and a scroll of its own past it.
     */
    const list = screen.getByRole("group");
    expect(list.className).toMatch(/(?:^|\s)max-h-\[[^\]]*dvh[^\]]*\]/);
    expect(list.className).toMatch(/(?:^|\s)overflow-y-auto(?:\s|$)/);
  });
});
