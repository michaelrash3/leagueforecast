import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { prefetchAllViews } from "./components/league/leagueViews";
import { readFullBackup } from "./lib/backup";
import {
  basisFor,
  dropScenario,
  keepScenario,
  readScenarios,
  scenarioLinkHash,
} from "./lib/savedScenarios";
import type { ScenarioPick } from "./lib/scenario";
import type { SeasonStore } from "./lib/seasonStore";
import {
  createSeason,
  getActiveSeasonId,
  listSeasons,
  loadLogs,
  loadMatchups,
  loadSettings,
  loadTeams,
  saveLogs,
  saveMatchups,
  saveSettings,
  saveTeams,
  setActiveSeason,
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
    // Nothing changed here, so the picks shown are the scenario's as now saved, the other tab's
    // among them, rather than this tab's older ones passing for changes to save over them.
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Renamed to “Aces win out”. The picks shown are now those another tab saved to it."
    );
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeDisabled();

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
    expect(afterSave?.picks).toEqual({ g3: { winnerId: "A" }, g4: { winnerId: "B" } });
  });

  it("keeps picks changed here when Rename takes in the ones another tab saved (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const stored = await saveScenario(user, machine);
    keepScenario({
      ...stored,
      picks: { ...stored.picks, g4: { winnerId: "B" } },
      basis: { ...stored.basis, g4: { away: "B", home: "C", date: "5/8" } },
      modifiedAt: later(stored.modifiedAt, 1),
    });

    // A change of this tab's own, not yet saved: it stays, to be saved over the other tab's or not.
    await pick(user, machine, "Bears at Comets", "Comets");
    await user.click(within(machine).getByRole("button", { name: "Rename" }));
    const renamed = within(machine).getByRole("textbox", { name: "New name" });
    await user.clear(renamed);
    await user.type(renamed, "Comets day");
    await user.click(within(machine).getByRole("button", { name: "Save name" }));
    expect(readScenarios(stored.seasonId)[0]?.picks).toEqual({
      g3: { winnerId: "D" },
      g4: { winnerId: "B" },
    });
    expect(within(machine).getByRole("status")).toHaveTextContent(/^Renamed to “Comets day”\.$/);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Comets"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeEnabled();
  });

  it("brings the open scenario up to date as stored, keeping another tab's rename (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await pick(user, machine, "Bears at Comets", "Bears");
    const stored = await saveScenario(user, machine);
    keepScenario({
      ...stored,
      name: "Renamed there",
      picks: { ...stored.picks, g4: { winnerId: "C" } },
      modifiedAt: later(stored.modifiedAt, 1),
    });

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
    expect(after?.picks).toEqual({ g4: { winnerId: "C" } });
    // Nothing changed here: shown as now saved, the other tab's pick and all.
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "The picks shown are now those another tab saved to it."
    );
    expect(pressed(machine, "Bears at Comets")).toEqual(["Comets"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeDisabled();
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

  it("keeps the question about picks not saved in step with the list and the buttons beside it (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Aces");
    await saveScenario(user, machine);
    await user.selectOptions(picker, "Unsaved picks");
    await pick(user, machine, "Ducks at Aces", "Ducks");

    // While asked, the list shows the entry asked about, so a step through it with the arrow keys
    // goes on from there rather than back to the start; and the question is announced.
    await user.selectOptions(picker, "Scenario 1");
    expect(picker).toHaveDisplayValue("Scenario 1");
    const ask = within(machine).getByRole("group", { name: "Picks not saved" });
    expect(within(ask).getByRole("status")).toHaveTextContent("Open “Scenario 1” in their place?");

    // Stepped back to the picks on screen: nothing left to ask.
    await user.selectOptions(picker, "Unsaved picks");
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);

    // Saving them instead puts the question away, as Rename and Delete do.
    await user.selectOptions(picker, "Scenario 1");
    await user.click(within(machine).getByRole("button", { name: "Save as a scenario" }));
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
    expect(picker).toHaveDisplayValue("Unsaved picks");
    await user.click(within(machine).getByRole("button", { name: "Cancel" }));
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
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

  it("names the open scenario as stored when it is copied or deleted (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const stored = await saveScenario(user, machine);

    // Renamed in another tab: the copy is named after it as it is called now.
    keepScenario({ ...stored, name: "Aces win out", modifiedAt: later(stored.modifiedAt, 1) });
    await user.click(within(machine).getByRole("button", { name: "Duplicate" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Made “Aces win out (copy)”, with the picks as they are now."
    );
    expect(picker).toHaveDisplayValue("Aces win out (copy)");
    expect(storedNames()).toEqual(["Aces win out", "Aces win out (copy)"]);

    // And the copy renamed there in turn: what is deleted is said by the name it had there.
    const copy = readScenarios(stored.seasonId).find((one) => one.name === "Aces win out (copy)");
    if (!copy) throw new Error("Not copied");
    keepScenario({ ...copy, name: "Copy renamed there", modifiedAt: later(copy.modifiedAt, 1) });
    await user.click(within(machine).getByRole("button", { name: "Delete" }));
    await user.click(within(machine).getByRole("button", { name: "Delete it" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Deleted “Copy renamed there”. Its picks are still here, unsaved."
    );
    expect(storedNames()).toEqual(["Aces win out"]);

    // One another tab let go of is not copied back into being under its old name: said, as for
    // the other changes, with its picks left here to save.
    await user.selectOptions(picker, "Aces win out");
    await user.click(within(machine).getByRole("button", { name: "Let them go" }));
    dropScenario(stored.seasonId, stored.id);
    await user.click(within(machine).getByRole("button", { name: "Duplicate" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "“Aces win out” is no longer kept on this device: another tab let it go. Its picks are still here, unsaved."
    );
    expect(storedNames()).toEqual([]);
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
  });

  it("keeps the picks made while another tab is looked at, for as long as the page is up (2.7 review)", async () => {
    const user = userEvent.setup();
    const first = render(<App />);
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await pick(user, machine, "Bears at Comets", "Bears");
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    machine = await openMachine(user);
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);

    // A scenario open with a change not yet saved comes back open, the change still to save.
    await saveScenario(user, machine);
    await pick(user, machine, "Bears at Comets", "Comets");
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    machine = await openMachine(user);
    expect(within(machine).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
      "Scenario 1"
    );
    expect(pressed(machine, "Bears at Comets")).toEqual(["Comets"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeEnabled();

    // Saved, then saved to in another tab meanwhile: the picks shown here, unchanged here, are
    // not passed off as changes to write over that tab's.
    await user.click(within(machine).getByRole("button", { name: "Save changes" }));
    const [kept] = readScenarios(getActiveSeasonId());
    if (!kept) throw new Error("Not kept");
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    keepScenario({
      ...kept,
      picks: { ...kept.picks, g3: { winnerId: "A" } },
      modifiedAt: later(kept.modifiedAt, 1),
    });
    machine = await openMachine(user);
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeDisabled();

    // Let go of there meanwhile: still open here, until a change to it finds that out and says so.
    await user.click(screen.getByRole("tab", { name: "Dashboard" }));
    dropScenario(kept.seasonId, kept.id);
    machine = await openMachine(user);
    expect(within(machine).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
      "Scenario 1"
    );
    await pick(user, machine, "Bears at Comets", "Bears");
    await user.click(within(machine).getByRole("button", { name: "Save changes" }));
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "“Scenario 1” is no longer kept on this device: another tab let it go. Its picks are still here, unsaved."
    );
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);
    first.unmount();

    // The page gone, they go with it.
    render(<App />);
    machine = await openMachine(user);
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Sim"]);
  });

  /** A second season with the same teams and games, made before the page opens. */
  const anotherSeason = (name: string) => {
    const first = getActiveSeasonId();
    const teams = loadTeams();
    const games = loadMatchups();
    const made = createSeason(name);
    setActiveSeason(made.id);
    saveTeams(teams);
    saveMatchups(games);
    setActiveSeason(first);
    return made;
  };

  it("lets the picks go at a change of season, whether the Forecast tab is open or not (2.7 review)", async () => {
    const spring = getActiveSeasonId();
    const fall = anotherSeason("Fall");
    const user = userEvent.setup();
    render(<App />);
    const seasonPicker = screen.getByRole("combobox", { name: /active season/i });
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.selectOptions(seasonPicker, fall.id);
    await user.selectOptions(seasonPicker, spring);
    machine = await screen.findByRole("region", { name: "Playoff machine" });
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);

    // Away on another tab meanwhile: they go the same, rather than come back on the way back.
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.click(screen.getByRole("tab", { name: "Standings" }));
    await user.selectOptions(seasonPicker, fall.id);
    await user.selectOptions(seasonPicker, spring);
    machine = await openMachine(user);
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);
  });

  it("gives a season made under a deleted one's id none of the picks left on another tab (2.7 review)", async () => {
    const fall = anotherSeason("Fall");
    setActiveSeason(fall.id);
    const user = userEvent.setup();
    render(<App />);
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await saveScenario(user, machine);
    await pick(user, machine, "Bears at Comets", "Bears");

    // Fall deleted, and the season left duplicated: the copy is given Fall's id.
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    const seasons = await screen.findByRole("region", { name: "Seasons" });
    const row = (name: string) => within(seasons).getByText(name).closest("li") as HTMLElement;
    await user.click(within(row("Fall")).getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete season" })
    );
    await waitFor(() => expect(within(seasons).queryByText("Fall")).toBeNull());
    expect(storedNames()).toEqual([]);
    const [left] = listSeasons();
    if (!left) throw new Error("No season left");
    await user.click(within(row(left.name)).getByRole("button", { name: "Duplicate" }));
    await waitFor(() => expect(within(seasons).getByText(`${left.name} copy`)).toBeInTheDocument());
    expect(listSeasons().find((season) => season.name === `${left.name} copy`)?.id).toBe(fall.id);
    await user.click(within(row(`${left.name} copy`)).getByRole("button", { name: "Switch" }));

    machine = await openMachine(user);
    expect(within(machine).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
      "No saved scenarios yet"
    );
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Sim"]);
  });

  it("gives a season a restore puts under the open id none of the picks left on another tab (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    let machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await saveScenario(user, machine);
    await pick(user, machine, "Bears at Comets", "Bears");

    // A backup of another season under the same id, made at another moment, with the same games.
    const backup = readFullBackup();
    const other = {
      ...backup,
      seasons: backup.seasons.map((season) => ({
        ...season,
        createdAt: "2020-01-01T00:00:00.000Z",
      })),
    };
    await user.click(screen.getByRole("tab", { name: "Settings" }));
    await user.upload(
      screen.getByLabelText("Import backup JSON"),
      new File([JSON.stringify(other)], "backup.json", { type: "application/json" })
    );
    await user.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Restore everything" })
    );
    await waitFor(() => expect(listSeasons()[0]?.createdAt).toBe("2020-01-01T00:00:00.000Z"));
    expect(storedNames()).toEqual([]);

    machine = await openMachine(user);
    expect(within(machine).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
      "No saved scenarios yet"
    );
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Sim"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Sim"]);
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
    // Opened once: put away and back on the tab later, it is as it was left, not opened again.
    await user.selectOptions(
      within(opened).getByRole("combobox", { name: "Scenario" }),
      "Unsaved picks"
    );
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

  /**
   * A scenario link opened in this tab while it runs, as one pasted into its address bar is, and
   * kept: the page hears the address change and asks.
   */
  const keepLinkHere = async (
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    picks: Record<string, ScenarioPick>
  ) => {
    const at = "2026-05-01T12:00:00.000Z";
    const hash = scenarioLinkHash({
      version: 1,
      id: "shared",
      name,
      seasonId: getActiveSeasonId(),
      picks,
      basis: basisFor(picks, loadMatchups()),
      createdAt: at,
      modifiedAt: at,
    });
    if (!hash) throw new Error("No link");
    act(() => {
      window.location.hash = hash;
    });
    const dialog = await screen.findByRole("dialog", { name: "Keep this scenario?" });
    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  };

  it("asks before a link kept in this tab takes the place of picks not saved (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Aces");
    await saveScenario(user, machine);
    await user.selectOptions(picker, "Unsaved picks");
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await pick(user, machine, "Bears at Comets", "Bears");
    // Asked about another scenario, and a link kept before the answer: the question is the link's.
    await user.selectOptions(picker, "Scenario 1");

    await keepLinkHere(user, "Comets win", { g4: { winnerId: "C" } });
    const ask = await within(machine).findByRole("group", { name: "Picks not saved" });
    await waitFor(() =>
      expect(ask).toHaveTextContent(
        "The picks on screen are not saved. Open “Comets win” in their place?"
      )
    );
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);
    expect(storedNames()).toEqual(["Comets win", "Scenario 1"]);
    await user.click(within(ask).getByRole("button", { name: "Keep them" }));
    expect(picker).toHaveDisplayValue("Unsaved picks");
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);

    // Changes to an open scenario are asked about the same way, and let go of when told.
    await user.selectOptions(picker, "Scenario 1");
    await user.click(within(machine).getByRole("button", { name: "Let them go" }));
    await pick(user, machine, "Bears at Comets", "Bears");
    await keepLinkHere(user, "Bears win", { g4: { winnerId: "B" }, g3: { winnerId: "D" } });
    const again = await within(machine).findByRole("group", { name: "Picks not saved" });
    expect(again).toHaveTextContent(
      "The changes to “Scenario 1” are not saved. Open “Bears win” in their place?"
    );
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Aces"]);
    await user.click(within(again).getByRole("button", { name: "Let them go" }));
    expect(picker).toHaveDisplayValue("Bears win");
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
  });

  it("puts away what was open for the last scenario when a link kept in this tab opens (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await saveScenario(user, machine);

    // A new name being typed for "Scenario 1": it goes, rather than rename the link's scenario.
    await user.click(within(machine).getByRole("button", { name: "Rename" }));
    expect(within(machine).getByRole("textbox", { name: "New name" })).toHaveValue("Scenario 1");
    await keepLinkHere(user, "Comets win", { g4: { winnerId: "C" } });
    await waitFor(() => expect(picker).toHaveDisplayValue("Comets win"));
    expect(within(machine).queryByRole("textbox", { name: "New name" })).toBeNull();
    expect(pressed(machine, "Bears at Comets")).toEqual(["Comets"]);
    expect(within(machine).getByRole("status")).toHaveTextContent(
      "Opened “Comets win”, kept from a link."
    );

    // A delete being asked about: it goes too, rather than ask it of the link's scenario.
    await user.click(within(machine).getByRole("button", { name: "Delete" }));
    expect(within(machine).getByRole("group", { name: "Delete the scenario" })).toBeInTheDocument();
    await keepLinkHere(user, "Bears win", { g4: { winnerId: "B" } });
    await waitFor(() => expect(picker).toHaveDisplayValue("Bears win"));
    expect(within(machine).queryByRole("group", { name: "Delete the scenario" })).toBeNull();
    expect(storedNames()).toEqual(["Bears win", "Comets win", "Scenario 1"]);
  });

  it("keeps the open scenario as this tab has it while a link kept here is asked about (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const stored = await saveScenario(user, machine);
    await pick(user, machine, "Bears at Comets", "Bears");
    // Another tab saves a pick of its own to it meanwhile.
    keepScenario({
      ...stored,
      picks: { ...stored.picks, g4: { winnerId: "C" } },
      modifiedAt: later(stored.modifiedAt, 1),
    });

    await keepLinkHere(user, "Aces win", { g3: { winnerId: "A" } });
    const ask = await within(machine).findByRole("group", { name: "Picks not saved" });
    await user.click(within(ask).getByRole("button", { name: "Keep them" }));
    expect(picker).toHaveDisplayValue("Scenario 1");
    // The change here taken back, nothing is left to save: that tab's pick is not one made here.
    await pick(user, machine, "Bears at Comets", "Sim");
    expect(within(machine).getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("leaves out of the list a scenario a link kept here pushed out, its picks still on screen (2.7 review)", async () => {
    const user = userEvent.setup();
    render(<App />);
    const machine = await openMachine(user);
    const picker = within(machine).getByRole("combobox", { name: "Scenario" });
    await pick(user, machine, "Ducks at Aces", "Ducks");
    const stored = await saveScenario(user, machine);
    // Twenty-nine more kept elsewhere since, each changed after it: it is the oldest of thirty.
    for (let n = 1; n <= 29; n += 1)
      keepScenario({
        ...stored,
        id: `other-${n}`,
        name: `Other ${n}`,
        modifiedAt: later(stored.modifiedAt, n),
      });
    await pick(user, machine, "Bears at Comets", "Bears");

    await keepLinkHere(user, "Comets win", { g4: { winnerId: "C" } });
    expect(
      await screen.findByText("To make room for “Comets win”, this device let go of “Scenario 1”.")
    ).toBeInTheDocument();
    const ask = await within(machine).findByRole("group", { name: "Picks not saved" });
    expect(ask).toHaveTextContent(
      "The picks on screen are not saved. Open “Comets win” in their place?"
    );
    await user.click(within(ask).getByRole("button", { name: "Keep them" }));
    expect(picker).toHaveDisplayValue("Unsaved picks");
    expect(within(picker).queryByRole("option", { name: "Scenario 1" })).toBeNull();
    expect(pressed(machine, "Ducks at Aces")).toEqual(["Ducks"]);
    expect(pressed(machine, "Bears at Comets")).toEqual(["Bears"]);
    expect(within(machine).getByRole("button", { name: "Save as a scenario" })).toBeEnabled();
    // They are what is open now: chosen again in the list, nothing is asked.
    await user.selectOptions(picker, "Unsaved picks");
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
  });

  it("opens a link kept for a season only once back on it, judged by that season's picks (2.7 review)", async () => {
    // A second season with the same teams and games, picked in while the link was asked about.
    const spring = getActiveSeasonId();
    const games = loadMatchups();
    const fall = createSeason("Fall");
    setActiveSeason(fall.id);
    saveTeams([
      { id: "A", name: "Aces" },
      { id: "B", name: "Bears" },
      { id: "C", name: "Comets" },
      { id: "D", name: "Ducks" },
    ]);
    saveMatchups(games);
    setActiveSeason(spring);
    const user = userEvent.setup();
    render(<App />);
    let machine = await openMachine(user);
    const at = "2026-05-01T12:00:00.000Z";
    const picks = { g4: { winnerId: "C" } };
    const hash = scenarioLinkHash({
      version: 1,
      id: "shared",
      name: "Comets win",
      seasonId: spring,
      picks,
      basis: basisFor(picks, loadMatchups()),
      createdAt: at,
      modifiedAt: at,
    });
    if (!hash) throw new Error("No link");
    act(() => {
      window.location.hash = hash;
    });
    const dialog = await screen.findByRole("dialog", { name: "Keep this scenario?" });
    const seasonPicker = screen.getByRole("combobox", { name: /active season/i, hidden: true });
    await user.selectOptions(seasonPicker, fall.id);
    machine = await openMachine(user);
    await pick(user, machine, "Ducks at Aces", "Ducks");
    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // Back on the season it was kept for: the other season's picks are not this one's to ask about.
    await user.selectOptions(seasonPicker, spring);
    machine = await screen.findByRole("region", { name: "Playoff machine" });
    await waitFor(() =>
      expect(within(machine).getByRole("combobox", { name: "Scenario" })).toHaveDisplayValue(
        "Comets win"
      )
    );
    expect(within(machine).queryByRole("group", { name: "Picks not saved" })).toBeNull();
    expect(pressed(machine, "Bears at Comets")).toEqual(["Comets"]);
  });
});
