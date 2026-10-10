import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { dropScenario, keepScenario, readScenarios } from "./lib/savedScenarios";
import type { SeasonStore } from "./lib/seasonStore";
import {
  getActiveSeasonId,
  loadLogs,
  loadMatchups,
  loadSettings,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
} from "./lib/storage";
import type { GameLog } from "./lib/types";

/*
 * Saved playoff scenarios (2.7): the playoff machine's picks kept under a name on this device,
 * opened again, renamed, copied, deleted; quick picks; a scenario that tells when the season has
 * moved on under it; and a shared link that asks before keeping anything and never touches the
 * season. Placeholder teams.
 */

beforeAll(() => prefetchAllViews());

// League kept live, so another device's change can arrive while the playoff machine is open.
const live = vi.hoisted(() => ({ store: null as SeasonStore | null }));
vi.mock("./hooks/useLiveLeague", () => ({
  useLiveLeague: ({ seasons }: { seasons: SeasonStore }) => {
    live.store = seasons;
    return { state: { kind: "live" }, guardUndo: () => null, removeSeason: async () => true };
  },
}));

const final = (awayRuns: string, homeRuns: string): GameLog => ({
  awayRuns,
  homeRuns,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});

const STORED = "lf_league_scenarios_v1";
const storedNames = () =>
  Object.values(
    JSON.parse(window.localStorage.getItem(STORED) ?? "{}") as Record<string, unknown[]>
  )
    .flat()
    .map((one) => (one as { name: string }).name)
    .sort();

const openMachine = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("tab", { name: "Forecast" }));
  return screen.findByRole("region", { name: "Playoff machine" });
};

const pick = async (
  user: ReturnType<typeof userEvent.setup>,
  machine: HTMLElement,
  game: string,
  team: string
) =>
  user.click(
    within(within(machine).getByRole("group", { name: game })).getByRole("button", { name: team })
  );

const pressed = (machine: HTMLElement, game: string) =>
  within(within(machine).getByRole("group", { name: game }))
    .getAllByRole("button")
    .filter((button) => button.getAttribute("aria-pressed") === "true")
    .map((button) => button.textContent);

describe("saved playoff scenarios", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      })
    );
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
      { id: "D", name: "Ducks" },
    ]);
    saveMatchups([
      { id: "g1", date: "5/1", away: "A", home: "B" },
      { id: "g2", date: "5/1", away: "C", home: "D" },
      { id: "g3", date: "5/8", away: "D", home: "A" },
      { id: "g4", date: "5/8", away: "B", home: "C" },
    ]);
    saveLogs({ g1: final("6", "2"), g2: final("5", "3") });
    saveSettings({ ...loadSettings(), goldCutoff: 2 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    live.store = null;
  });

  it("keeps picks under a name, opens them again later, and renames, copies and deletes them", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.click(within(machine).getByRole("button", { name: "Save as a scenario" }));
    const name = within(machine).getByRole("textbox", { name: "Name the scenario" });
    expect(name).toHaveValue("Scenario 1");
    await user.clear(name);
    await user.type(name, "Ducks win");
    await user.click(within(machine).getByRole("button", { name: "Save" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Saved “Ducks win” on this device."
    );
    first.unmount();

    // Another visit: the picks went with the page, the scenario did not.
    render(<App />);
    machine = await openMachine(user);
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await user.selectOptions(picker, "Ducks win");
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.click(within(machine).getByRole("button", { name: "Rename" }));
    const renamed = within(machine).getByRole("textbox", { name: "New name" });
    await user.clear(renamed);
    await user.type(renamed, "Ducks upset");
    await user.click(within(machine).getByRole("button", { name: "Save name" }));
    expect(picker).toHaveDisplayValue("Ducks upset");

    // A change, saved as a copy: the copy has it, the one copied stays as it was.
    await pick(user, machine, "Bears at Comets", "Bears");
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeEnabled();
    await user.click(within(machine).getByRole("button", { name: "Duplicate" }));
    expect(picker).toHaveDisplayValue("Ducks upset (copy)");
    await user.selectOptions(picker, "Ducks upset");
    expect(pressed(machine, "Bears at Comets")).toEqual(["Sim"]);
    await user.selectOptions(picker, "Ducks upset (copy)");
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);

    await user.click(within(machine).getByRole("button", { name: "Delete" }));
    await user.click(within(machine).getByRole("button", { name: "Delete it" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Deleted “Ducks upset (copy)”. Its picks are still here, unsaved."
    );
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);
    expect(storedNames()).toEqual(["Ducks upset"]);
    // Kept on this device, never in the season.
    expect(Object.keys(loadLogs()).sort()).toEqual(["g1", "g2"]);
  });

  it("makes quick picks: favorites, the rest, and one team winning or losing out", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.click(within(machine).getByRole("button", { name: "Fill the rest with favorites" }));
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).not.toEqual(["Sim"]);

    await user.selectOptions(within(machine).getByRole("combobox", { name: "Team" }), "Aces");
    await user.click(within(machine).getByRole("button", { name: "Wins out" }));
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Aces"]);
    await user.click(within(machine).getByRole("button", { name: "Loses out" }));
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
  });

  it("says what the picks make certain that the season as it stands does not", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Aces");
    await pick(user, machine, "Bears at Comets", "Comets");
    const table = within(machine).getByRole("table", { name: "Standings with your picks" });
    const teamCell = (name: string) =>
      within(within(table).getByText(name).closest("tr")!).getAllByRole("cell")[1]!.textContent;
    expect(teamCell("Aces")).toBe("AcesClinches");
    expect(teamCell("Comets")).toBe("CometsClinches");
    expect(teamCell("Bears")).toBe("BearsOut");
    expect(teamCell("Ducks")).toBe("DucksOut");
  });

  it("says nothing of a place the season as it stands has already settled", async () => {
    // One to go in: the Aces 2-0, through already, and nobody else able to reach two wins.
    saveSettings({ ...loadSettings(), goldCutoff: 1 });
    saveLogs({ g1: final("6", "2"), g2: final("3", "5"), g3: final("1", "4") });
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Bears at Comets", "Bears");
    const table = within(machine).getByRole("table", { name: "Standings with your picks" });
    expect(within(table).queryByText("Clinches")).toBeNull();
    expect(within(table).queryByText("Out")).toBeNull();
  });

  it("tells when the season has moved on under a scenario, and brings it up to date", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await pick(user, machine, "Bears at Comets", "Bears");
    await user.click(within(machine).getByRole("button", { name: "Save as a scenario" }));
    await user.click(within(machine).getByRole("button", { name: "Save" }));
    first.unmount();

    // Since: Ducks at Aces was played, and Bears at Comets became Bears at Ducks.
    saveLogs({ ...loadLogs(), g3: final("9", "1") });
    saveMatchups(loadMatchups().map((game) => (game.id === "g4" ? { ...game, home: "D" } : game)));
    render(<App />);
    machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    expect(
      within(picker).getByRole("option", { name: "Scenario 1 (out of date)" })
    ).toBeInTheDocument();
    await user.selectOptions(picker, "Scenario 1 (out of date)");
    const notice = within(machine)
      .getByText("The season has moved on since “Scenario 1” was saved")
      .closest("div")!;
    expect(
      within(notice)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(["Ducks at Aces was played (9–1).", "Bears at Comets is now Bears at Ducks."]);
    // Left out of what is shown: the game given other teams plays out as the model has it,
    // and is filled like any other game not picked, with its favorite rather than the old pick.
    expect(pressed(machine, "Bears at Ducks")).toEqual(["Sim"]);
    await user.click(within(machine).getByRole("button", { name: "Fill the rest with favorites" }));
    const filled = pressed(machine, "Bears at Ducks");
    expect(filled).toEqual(["Ducks"]);

    await user.click(within(notice).getByRole("button", { name: "Bring it up to date" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Brought up to date: 2 picks no longer applied and were taken out."
    );
    expect(within(machine).queryByText(/The season has moved on/)).toBeNull();
    expect(within(picker).getByRole("option", { name: "Scenario 1" })).toBeInTheDocument();
    // The pick made since, not yet saved, is still there to save.
    expect(pressed(machine, "Bears at Ducks")).toEqual(filled);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("counts a pick only on the game it was made on, when another device changes the game", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const arrive = (home: string) =>
      act(() => {
        const store = live.store;
        if (!store) throw new Error("No season store");
        const season = store.get().season;
        store.apply({
          ...season,
          matchups: season.matchups.map((game) => (game.id === "g4" ? { ...game, home } : game)),
        });
      });

    await pick(user, machine, "Bears at Comets", "Bears");
    arrive("D");
    expect(pressed(machine, "Bears at Ducks")).toEqual(["Sim"]);

    // Picked again, by a quick pick this time, it counts on the game as it is now, and only that.
    await user.selectOptions(within(machine).getByRole("combobox", { name: "Team" }), "Bears");
    await user.click(within(machine).getByRole("button", { name: "Wins out" }));
    expect(pressed(machine, "Bears at Ducks")).toEqual(["Bears"]);
    arrive("C");
    expect(pressed(machine, "Bears at Comets")).toEqual(["Sim"]);
  });

  /** Saves the picks shown as a scenario under its suggested name, and gives it as stored. */
  const saveScenario = async (user: ReturnType<typeof userEvent.setup>, machine: HTMLElement) => {
    await user.click(within(machine).getByRole("button", { name: "Save as a scenario" }));
    await user.click(within(machine).getByRole("button", { name: "Save" }));
    const [stored] = readScenarios(getActiveSeasonId());
    if (!stored) throw new Error("Not saved");
    return stored;
  };

  /** A moment after `at`, as another tab's change is stamped. */
  const later = (at: string, seconds: number) =>
    new Date(Date.parse(at) + seconds * 1000).toISOString();

  it("renames and saves the open scenario as stored, keeping what another tab saved of it (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const stored = await saveScenario(user, machine);

    // Another tab, the same scenario open there: a pick added and saved.
    keepScenario({
      ...stored,
      picks: { ...stored.picks, g4: { winnerId: "B" } },
      basis: { ...stored.basis, g4: { away: "B", home: "C", date: "5/8" } },
      modifiedAt: later(stored.modifiedAt, 1),
    });
    await user.click(within(machine).getByRole("button", { name: "Rename" }));
    const renamed = within(machine).getByRole("textbox", { name: "New name" });
    await user.clear(renamed);
    await user.type(renamed, "Aces win out");
    await user.click(within(machine).getByRole("button", { name: "Save name" }));
    const [afterRename] = readScenarios(stored.seasonId);
    expect(afterRename?.name).toBe("Aces win out");
    expect(afterRename?.picks).toEqual({ g3: { winnerId: "D" }, g4: { winnerId: "B" } });

    // Renamed there again; a change saved here keeps that name, with the picks shown here.
    if (!afterRename) throw new Error("Not kept");
    keepScenario({
      ...afterRename,
      name: "Renamed there",
      modifiedAt: later(stored.modifiedAt, 2),
    });
    await pick(user, machine, "Ducks at Aces", "Aces");
    await user.click(within(machine).getByRole("button", { name: "Save changes" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Saved the changes to “Renamed there”."
    );
    const [afterSave] = readScenarios(stored.seasonId);
    expect(afterSave?.name).toBe("Renamed there");
    expect(afterSave?.picks).toEqual({ g3: { winnerId: "A" } });
  });

  it("brings the open scenario up to date as stored, keeping another tab's rename (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await pick(user, machine, "Bears at Comets", "Bears");
    const stored = await saveScenario(user, machine);
    keepScenario({ ...stored, name: "Renamed there", modifiedAt: later(stored.modifiedAt, 1) });

    // Ducks at Aces played meanwhile, from another device.
    act(() => {
      const store = live.store;
      if (!store) throw new Error("No season store");
      const season = store.get().season;
      store.apply({ ...season, logs: { ...season.logs, g3: final("9", "1") } });
    });
    await user.click(within(machine).getByRole("button", { name: "Bring it up to date" }));
    const [after] = readScenarios(stored.seasonId);
    expect(after?.name).toBe("Renamed there");
    expect(after?.picks).toEqual({ g4: { winnerId: "B" } });
  });

  it("asks before picks not yet saved go for another scenario, and keeps them unless told (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Aces");
    await saveScenario(user, machine);
    // Nothing unsaved: no scenario open again at once, with no picks.
    await user.selectOptions(picker, "Unsaved picks");
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);

    // Picks made with no scenario open, and a scenario chosen: asked first, and kept if so.
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await pick(user, machine, "Bears at Comets", "Bears");
    await user.selectOptions(picker, "Scenario 1");
    let ask = within(machine).getByRole("group", { name: "Picks not saved" });
    expect(ask).toHaveTextContent(
      "The picks on screen are not saved. Open “Scenario 1” in their place?"
    );
    await user.click(within(ask).getByRole("button", { name: "Keep them" }));
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
    expect(picker).toHaveDisplayValue("Unsaved picks");
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);

    // Let go of when the person says so.
    await user.selectOptions(picker, "Scenario 1");
    await user.click(within(machine).getByRole("button", { name: "Let them go" }));
    expect(picker).toHaveDisplayValue("Scenario 1");
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Aces"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Sim"]);

    // Changes to the open scenario not yet saved are asked about too, for no scenario as well.
    await pick(user, machine, "Bears at Comets", "Comets");
    await user.selectOptions(picker, "Unsaved picks");
    ask = within(machine).getByRole("group", { name: "Picks not saved" });
    expect(ask).toHaveTextContent(
      "The changes to “Scenario 1” are not saved. Start again with no picks?"
    );
    await user.click(within(ask).getByRole("button", { name: "Keep them" }));
    expect(picker).toHaveDisplayValue("Scenario 1");
    expect(pressed(machine, "Bears at Comets")).toEqual(["Comets"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("keeps a typed score within what a saved scenario keeps, so it is saved as shown (2.7 review)", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const ducksRuns = within(machine).getByRole("spinbutton", { name: "Ducks runs" });
    await user.type(ducksRuns, "120");
    expect(ducksRuns).toHaveValue(99);
    await user.type(within(machine).getByRole("spinbutton", { name: "Aces runs" }), "3");
    const stored = await saveScenario(user, machine);
    expect(stored.picks.g3).toEqual({ winnerId: "D", awayRuns: 99, homeRuns: 3 });
    first.unmount();

    // Opened again on another visit, the score is the one that was shown.
    render(<App />);
    machine = await openMachine(user);
    await user.selectOptions(
      within(machine).getByRole("combobox", { name: "Scenario" }),
      "Scenario 1"
    );
    expect(within(machine).getByRole("spinbutton", { name: "Ducks runs" })).toHaveValue(99);
  });

  it("brings back no scenario another tab let go of, and keeps its picks here (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const stored = await saveScenario(user, machine);
    dropScenario(stored.seasonId, stored.id);

    await pick(user, machine, "Bears at Comets", "Bears");
    await user.click(within(machine).getByRole("button", { name: "Save changes" }));
    expect(readScenarios(stored.seasonId)).toEqual([]);
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "“Scenario 1” is no longer kept on this device: another tab let it go. Its picks are still here, unsaved."
    );
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);
    expect(within(machine).getByRole("button", { name: "Save as a scenario" })).toBeEnabled();
  });

  it("shares a link that shows its picks and asks before keeping them, and never touches the season", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.click(within(machine).getByRole("button", { name: "Share" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(/^Link copied\./);
    const link = new URL(await navigator.clipboard.readText());
    expect(link.search).toBe("?view=league");
    expect(link.hash).toMatch(/^#scenario=/);
    first.unmount();

    // Another device: nothing kept, and a link opened.
    window.localStorage.removeItem(STORED);
    window.history.replaceState(null, "", `${link.pathname}${link.search}${link.hash}`);
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Keep this scenario?" });
    expect(dialog).toHaveTextContent("“Shared picks”: 1 pick.");
    expect(dialog).toHaveTextContent("• Ducks over Aces, 5/8");
    expect(window.location.hash).toBe("");
    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));

    expect(
      await screen.findByRole("tab", { name: "Forecast", selected: true })
    ).toBeInTheDocument();
    const opened = await screen.findByRole("region", { name: "Playoff machine" });
    await waitFor(() =>
      expect(within(opened).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
        "Shared picks"
      )
    );
    expect(pressed(opened, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(storedNames()).toEqual(["Shared picks"]);
    // Opened once: back on the tab later, the machine starts as it always does.
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    const again = await openMachine(user);
    expect(within(again).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
      "Unsaved picks"
    );
    expect(Object.keys(loadLogs()).sort()).toEqual(["g1", "g2"]);
    expect(loadMatchups()).toHaveLength(4);
  });

  it("keeps nothing from a link the person turns down", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.click(within(machine).getByRole("button", { name: "Share" }));
    const link = new URL(await navigator.clipboard.readText());
    first.unmount();

    window.history.replaceState(null, "", `${link.pathname}${link.search}${link.hash}`);
    render(<App />);
    const dialog = await screen.findByRole("dialog", { name: "Keep this scenario?" });
    await user.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.localStorage.getItem(STORED)).toBeNull();
    expect(window.location.hash).toBe("");
  });
});
