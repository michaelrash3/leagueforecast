import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteField, readSavedFields, saveField } from "../tournamentFields";
import { clubLookupOf } from "../teamRankings/leagueBridge";
import { GONE_CLUB } from "../teamRankings/rememberedClub";

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

/*
 * A saved field keeps, beside each club, GameChanger ids it carried (`SavedField.gc`), and is
 * read by them (`readClub`): a club folded into another is that club, and one whose id is another
 * club's now is shown gone, under an id no club has, so the field never plays the club now under
 * the id in its place. Placeholder names and ids throughout.
 */
describe("a saved field's clubs, by their GameChanger ids", () => {
  const link = (teamId: string) => ({ teamId, name: teamId, ageGroupId: "ag10" });
  const field = {
    name: "Fall Classic",
    teamIds: ["S-ACES", "S-ACES2", "S-BEAR"],
    pools: 1,
    advance: 4,
    gc: [["gcAces001"], ["gcAcesGld"], []],
  };

  it("keeps each club's GameChanger ids, and none where it had none", () => {
    saveField("ag10", field);
    expect(readSavedFields("ag10")).toEqual([field]);
  });

  it("is each club as it is now: folded into another, that club; under an id now another's, gone", () => {
    saveField("ag10", field);
    const now = clubLookupOf([
      // Aces Gold folded into the Aces, its GameChanger team with it.
      { id: "S-ACES", gcTeams: [link("gcAces001"), link("gcAcesGld")] },
      { id: "S-BEAR", gcTeams: [link("gcBears01")] },
    ]);
    expect(readSavedFields("ag10", now)).toEqual([
      { ...field, teamIds: ["S-ACES", "S-BEAR"], gc: [["gcAces001"], []] },
    ]);
    const again = clubLookupOf([
      // Started again: the Aces now under another id, S-ACES and S-ACES2 other clubs', and Aces
      // Gold not pulled back.
      { id: "S-ACES", gcTeams: [link("gcAcesAca")] },
      { id: "S-ACES2", gcTeams: [link("gcAcesMid")] },
      { id: "S-ACES5", gcTeams: [link("gcAces001")] },
      { id: "S-BEAR", gcTeams: [link("gcBears01")] },
    ]);
    expect(readSavedFields("ag10", again)).toEqual([
      { ...field, teamIds: ["S-ACES5", `${GONE_CLUB}S-ACES2`, "S-BEAR"] },
    ]);
  });

  it("hands back a page's fields after a save or a delete as the clubs read them", () => {
    const folded = clubLookupOf([
      { id: "S-ACES", gcTeams: [link("gcAces001"), link("gcAcesGld")] },
    ]);
    expect(saveField("ag10", field, folded)[0]?.teamIds).toEqual(["S-ACES", "S-BEAR"]);
    saveField("ag10", { ...field, name: "Other" });
    expect(deleteField("ag10", "Other", folded)[0]?.teamIds).toEqual(["S-ACES", "S-BEAR"]);
  });

  it("reads a field kept with no GameChanger ids as it always did", () => {
    const old = { name: "Old", teamIds: ["S-ACES", "S-ACES2"], pools: 1, advance: 4 };
    saveField("ag10", old);
    const again = clubLookupOf([{ id: "S-ACES", gcTeams: [link("gcAcesAca")] }]);
    expect(readSavedFields("ag10", again)).toEqual([old]);
  });

  it("reads ids that are not a list of text as none, beside the club they were kept with", () => {
    backing.set(
      "lf_tournament_fields_v1",
      JSON.stringify({
        ag10: [
          {
            name: "Odd",
            teamIds: ["S-ACES", 4, "S-BEAR", "S-COME"],
            gc: [[7], ["gcSkipped"], ["gcBears01"], "gcComets1"],
          },
        ],
      })
    );
    expect(readSavedFields("ag10")).toEqual([
      {
        name: "Odd",
        teamIds: ["S-ACES", "S-BEAR", "S-COME"],
        pools: 1,
        advance: 4,
        gc: [[], ["gcBears01"], []],
      },
    ]);
  });

  it("is still each club where one of the GameChanger teams it was kept with is unlinked", () => {
    saveField("ag10", { ...field, gc: [["gcAces002", "gcAces001"], ["gcAcesGld"], []] });
    // The Aces' newer team unlinked since: the club is the Aces still, ranked and played.
    const unlinked = clubLookupOf([
      { id: "S-ACES", gcTeams: [link("gcAces001")] },
      { id: "S-ACES2", gcTeams: [link("gcAcesGld")] },
      { id: "S-BEAR", gcTeams: [link("gcBears01")] },
    ]);
    expect(readSavedFields("ag10", unlinked)[0]?.teamIds).toEqual(["S-ACES", "S-ACES2", "S-BEAR"]);
  });
});
