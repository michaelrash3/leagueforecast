import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteField, readSavedFields, saveField } from "../tournamentFields";

const backing = new Map<string, string>();
beforeEach(() => {
  backing.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => void backing.set(k, v),
    removeItem: (k: string) => void backing.delete(k),
  });
});

describe("saved tournament fields", () => {
  const field = { name: "Fall Classic", teamIds: ["S-A", "S-B"], pools: 2, advance: 4 };

  it("keeps a field per age group, by name, replacing one of the same name", () => {
    saveField("ag10", field);
    saveField("ag10", { ...field, teamIds: ["S-C"] });
    saveField("ag11", { ...field, name: "Spring Open" });
    expect(readSavedFields("ag10")).toEqual([{ ...field, teamIds: ["S-C"] }]);
    expect(readSavedFields("ag11").map((one) => one.name)).toEqual(["Spring Open"]);
  });

  it("deletes one without touching the others", () => {
    saveField("ag10", field);
    saveField("ag10", { ...field, name: "Other" });
    expect(deleteField("ag10", "Fall Classic").map((one) => one.name)).toEqual(["Other"]);
  });

  it("reads nothing it cannot read", () => {
    backing.set("lf_tournament_fields_v1", "{oops");
    expect(readSavedFields("ag10")).toEqual([]);
    backing.set("lf_tournament_fields_v1", JSON.stringify({ ag10: [{ name: 3 }, "x"] }));
    expect(readSavedFields("ag10")).toEqual([]);
  });
});
