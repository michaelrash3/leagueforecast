import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  handoffLoaded,
  heldHandoff,
  holdHandoff,
  onHandoffLoaded,
  resetHandoffForTests,
  subscribeHandoff,
  takeHandoff,
} from "../crawlHandoffStore";

/* The crawl's files held until an Import takes them. Placeholder names throughout. */

const teams = {
  name: "GC_Teams_New.csv",
  text: "Team Name,Team ID\nPlaceholder Owls,Ab3dE5gH7jK9",
};
const orgs = { name: "GC_Organizations_New.csv", text: "Organization Name,Organization ID" };

beforeEach(() => resetHandoffForTests());

describe("the crawl's files, held for Import", () => {
  it("are taken once each, and cleared as they are", async () => {
    const changed = vi.fn();
    subscribeHandoff(changed);
    expect(holdHandoff({ id: "run_1", teams, orgs })).toEqual({ status: "held", loaded: [] });
    expect(changed).toHaveBeenCalledTimes(1);

    const taken = takeHandoff("teams");
    expect(taken?.id).toBe("run_1");
    expect(await taken?.file.text()).toBe(teams.text);
    expect(taken?.file.name).toBe("GC_Teams_New.csv");
    expect(takeHandoff("teams")).toBeNull();
    // The other kind waits for its own Import.
    expect(heldHandoff().orgs?.id).toBe("run_1");
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("keep the same snapshot until something changes", () => {
    const before = heldHandoff();
    expect(heldHandoff()).toBe(before);
    holdHandoff({ id: "run_1", teams, orgs: null });
    const after = heldHandoff();
    expect(after).not.toBe(before);
    expect(heldHandoff()).toBe(after);
    expect(takeHandoff("orgs")).toBeNull();
    expect(heldHandoff()).toBe(after);
  });

  it("take a newer file's place of a kind not yet taken, leaving the other kind be", () => {
    holdHandoff({ id: "run_1", teams, orgs });
    holdHandoff({ id: "run_2", teams, orgs: null });
    expect(heldHandoff().teams?.id).toBe("run_2");
    expect(heldHandoff().orgs?.id).toBe("run_1");
  });

  it("are never held twice under one id, even once taken, and say which kinds went in", () => {
    holdHandoff({ id: "run_1", teams, orgs });
    takeHandoff("orgs");
    handoffLoaded("run_1", "orgs");
    takeHandoff("teams");
    expect(holdHandoff({ id: "run_1", teams, orgs })).toEqual({
      status: "duplicate",
      loaded: ["orgs"],
    });
    expect(heldHandoff()).toEqual({ teams: null, orgs: null });
  });

  it("tell the page once per kind applied, which tells the miner", () => {
    const told = vi.fn();
    onHandoffLoaded(told);
    holdHandoff({ id: "run_1", teams, orgs });
    takeHandoff("teams");
    // Taken is not yet in: a file that fails to go in tells nobody.
    expect(told).not.toHaveBeenCalled();
    handoffLoaded("run_1", "teams");
    handoffLoaded("run_1", "teams");
    expect(told.mock.calls).toEqual([["run_1", "teams"]]);
  });
});
