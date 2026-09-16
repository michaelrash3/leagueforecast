import { describe, expect, it } from "vitest";
import { matchTeamOptions, type TeamSearchOption } from "./TeamSearchSelect";

const options: TeamSearchOption[] = [
  { id: "3", label: "Trash Pandas", detail: "TN" },
  { id: "1", label: "aces", detail: "KY" },
  { id: "4", label: "Trash Pandas", detail: "KY" },
  { id: "2", label: "Bears" },
];

describe("matchTeamOptions", () => {
  it("lists alphabetically rather than in the order it was handed", () => {
    // The caller's order is ranking order, which is no help when looking for a name you know.
    expect(matchTeamOptions(options, "").shown.map((option) => option.id)).toEqual([
      "1",
      "2",
      "4",
      "3",
    ]);
  });

  it("orders two clubs of the same name by what tells them apart", () => {
    const pandas = matchTeamOptions(options, "trash").shown;
    expect(pandas.map((option) => option.detail)).toEqual(["KY", "TN"]);
  });

  it("ignores case, and matches anywhere in the name", () => {
    expect(matchTeamOptions(options, "PAND").shown).toHaveLength(2);
    expect(matchTeamOptions(options, "ear").shown.map((option) => option.id)).toEqual(["2"]);
  });

  it("searches the detail too, so a state narrows the list", () => {
    expect(matchTeamOptions(options, "ky").shown.map((option) => option.id)).toEqual(["1", "4"]);
  });

  it("finds nothing rather than everything when nothing matches", () => {
    expect(matchTeamOptions(options, "zzz")).toEqual({ shown: [], total: 0 });
  });

  it("caps what it draws but still counts the rest", () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      id: String(index),
      label: `Team ${String(index).padStart(3, "0")}`,
    }));
    const result = matchTeamOptions(many, "", 50);
    expect(result.shown).toHaveLength(50);
    expect(result.total).toBe(120);
    // Capped off the top of the alphabet, not off whatever came first.
    expect(result.shown[0]!.label).toBe("Team 000");
  });

  it("does not disturb the list it was given", () => {
    const given = options.slice();
    matchTeamOptions(given, "");
    expect(given).toEqual(options);
  });
});

describe("an option something knows about", () => {
  const plain = (label: string) => ({ id: label, label });

  it("goes above the alphabet", () => {
    const { shown } = matchTeamOptions(
      [plain("Aces"), plain("Badgers"), { id: "z", label: "Zebras", priority: 0 }],
      ""
    );
    // The alphabet is the right default because nothing usually knows better, and the wrong one
    // when something does — here, two shared coaches, which means one club 98% of the time.
    expect(shown.map((option) => option.label)).toEqual(["Zebras", "Aces", "Badgers"]);
  });

  it("keeps the caller's order among the ones it knows about", () => {
    const { shown } = matchTeamOptions(
      [
        { id: "b", label: "Second guess", priority: 1 },
        { id: "a", label: "Best guess", priority: 0 },
        plain("Aardvarks"),
      ],
      ""
    );
    expect(shown.map((option) => option.label)).toEqual([
      "Best guess",
      "Second guess",
      "Aardvarks",
    ]);
  });

  it("survives the truncation that would otherwise drop it", () => {
    const many = Array.from({ length: 500 }, (_, index) =>
      plain(`Team ${String(index).padStart(4, "0")}`)
    );
    const { shown } = matchTeamOptions([...many, { id: "z", label: "Zebras", priority: 0 }], "");
    // Alphabetically "Zebras" is last of 501 and the list draws fifty.
    expect(shown[0]?.label).toBe("Zebras");
  });

  it("is still filtered by the query like everything else", () => {
    const { shown } = matchTeamOptions(
      [{ id: "z", label: "Zebras", priority: 0 }, plain("Aces")],
      "ace"
    );
    expect(shown.map((option) => option.label)).toEqual(["Aces"]);
  });

  it("leaves a list with no priorities exactly as it was", () => {
    const { shown } = matchTeamOptions([plain("Badgers"), plain("Aces")], "");
    expect(shown.map((option) => option.label)).toEqual(["Aces", "Badgers"]);
  });
});
