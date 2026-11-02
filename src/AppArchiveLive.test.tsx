import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { ARCHIVED_READ_ONLY } from "./lib/seasonArchive";
import type { SeasonStore } from "./lib/seasonStore";
import {
  createSeason,
  loadLogs,
  loadSettings,
  saveMatchups,
  saveSettings,
  saveTeams,
} from "./lib/storage";

beforeAll(() => prefetchAllViews());

/*
 * An archived season with League kept live (`seasonArchive.ts`): the season's store refuses an edit
 * from anywhere, not only the controls on the page; another season's mark is sent to the cloud at
 * once; and the open season's mark is refused, saying why, while the season may not be edited for
 * another reason. Placeholder names.
 */
const live = vi.hoisted(() => ({
  seasons: null as SeasonStore | null,
  kind: "live" as string,
  archiveSeason: vi.fn(async () => "sent"),
}));

vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: ({ seasons }: { seasons: SeasonStore }) => {
    live.seasons = seasons;
    return {
      state: { kind: live.kind },
      guardUndo: () => null,
      removeSeason: async () => true,
      archiveSeason: live.archiveSeason,
    };
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
  live.kind = "live";
  live.archiveSeason.mockClear();
  saveTeams([
    { id: "A", name: "Aces" },
    { id: "B", name: "Bears" },
  ]);
  saveMatchups([{ id: "g1", date: "5/1", away: "A", home: "B" }]);
});

describe("an archived season kept live", () => {
  it("refuses an edit that comes from outside the page's controls, saying why", async () => {
    saveSettings({ ...loadSettings(), archived: true });
    render(<App />);
    expect(
      await screen.findByText(/This season is archived, so it is read-only/, { selector: "div" })
    ).toBeInTheDocument();

    act(() => {
      live.seasons!.setSeason((season) => ({
        ...season,
        logs: {
          g1: {
            awayRuns: "5",
            homeRuns: "2",
            awayHits: "",
            homeHits: "",
            awayK: "",
            homeK: "",
            innings: "6",
            isFinal: true,
          },
        },
      }));
    });

    expect(await screen.findByText(ARCHIVED_READ_ONLY, { selector: "p, span, div" })).toBeVisible();
    expect(live.seasons!.get().season.logs).toEqual({});
    expect(loadLogs()).toEqual({});
  });

  it("sends another season's mark to the cloud at once", async () => {
    const other = createSeason("Fall 2026");
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    await user.click(await screen.findByRole("button", { name: "Archive Fall 2026" }));

    await waitFor(() => expect(live.archiveSeason).toHaveBeenCalledWith(other.id, true));
  });

  it("refuses the open season's mark while the season may not be edited for another reason", async () => {
    live.kind = "offline";
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("tab", { name: "Settings" }));
    const seasons = await screen.findByRole("region", { name: "Seasons" });
    const archive = within(seasons).getAllByRole("button", { name: /^Archive / })[0]!;
    await user.click(archive);

    expect(loadSettings().archived).toBeUndefined();
    expect(screen.queryByRole("region", { name: "Archived seasons" })).toBeNull();
    expect(live.archiveSeason).not.toHaveBeenCalled();
  });
});
