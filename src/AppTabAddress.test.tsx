import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { saveMatchups, saveTeams } from "./lib/storage";

/*
 * The League tab lives in the address (`leagueTab.ts`), so a reload, or "Reload update" after a
 * deploy, comes back to the tab it left rather than to the Dashboard. Placeholder names.
 */

beforeAll(() => prefetchAllViews());

const tabParam = () => new URLSearchParams(window.location.search).get("tab");
const tab = (name: string) => screen.getByRole("tab", { name });

describe("the League tab in the address", () => {
  beforeEach(() => {
    window.localStorage.clear();
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
    ]);
    saveMatchups([{ id: "g1", date: "5/3", away: "A", home: "B" }]);
  });

  it("opens on the tab the address names", async () => {
    window.history.replaceState(null, "", "/?tab=standings");
    render(<App />);

    await waitFor(() => expect(tab("Standings")).toHaveAttribute("aria-selected", "true"));
  });

  it("writes the tab as it changes, and leaves the Dashboard out", async () => {
    window.history.replaceState(null, "", "/");
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("tab", { name: "Schedule" }));
    await waitFor(() => expect(tabParam()).toBe("games"));

    await user.click(tab("Dashboard"));
    await waitFor(() => expect(tabParam()).toBeNull());
  });

  it("opens on the Dashboard for a tab it does not know", async () => {
    window.history.replaceState(null, "", "/?tab=nowhere");
    render(<App />);

    await waitFor(() => expect(tab("Dashboard")).toHaveAttribute("aria-selected", "true"));
  });

  it("shows the season at a glance on the Dashboard only", async () => {
    window.history.replaceState(null, "", "/");
    render(<App />);
    const user = userEvent.setup();
    const strip = () => screen.queryByLabelText("League pulse summary");

    await waitFor(() => expect(strip()).not.toBeNull());
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    await waitFor(() => expect(strip()).toBeNull());
  });
});
