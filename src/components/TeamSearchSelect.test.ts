import { describe, expect, it } from "vitest";
import {
  noMatchText,
  coachesToList,
  gcIdsInSearch,
  matchTeamOptions,
  type TeamSearchOption,
} from "./TeamSearchSelect";

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

describe("a club's coaches", () => {
  // Invented names.
  const clubs: TeamSearchOption[] = [
    { id: "ky", label: "Rangers", detail: "KY", coaches: ["Pat Placeholder", "Sam Sample"] },
    { id: "tx", label: "Rangers", detail: "TX" },
  ];

  it("are searched as well as the name, in any case and any part", () => {
    expect(matchTeamOptions(clubs, "SAMPLE").shown.map((option) => option.id)).toEqual(["ky"]);
    expect(matchTeamOptions(clubs, "placeh").shown.map((option) => option.id)).toEqual(["ky"]);
    // A club with none is still found by its name, and a coach nobody has finds nothing.
    expect(matchTeamOptions(clubs, "rangers").total).toBe(2);
    expect(matchTeamOptions(clubs, "nobody").total).toBe(0);
  });

  it("are listed with the ones the search found first and marked, three named at most", () => {
    const coaches = ["Dana Dummy", "Robin Roster", "Casey Clipboard", "Jordan Jersey"];
    expect(coachesToList(coaches, "")).toEqual({
      names: [
        { name: "Dana Dummy", found: false },
        { name: "Robin Roster", found: false },
        { name: "Casey Clipboard", found: false },
      ],
      more: 1,
    });
    expect(coachesToList(coaches, "JERSEY")).toEqual({
      names: [
        { name: "Jordan Jersey", found: true },
        { name: "Dana Dummy", found: false },
        { name: "Robin Roster", found: false },
      ],
      more: 1,
    });
    expect(coachesToList([], "x")).toBeNull();
    expect(coachesToList(undefined, "x")).toBeNull();
  });
});

describe("searching by several words, in any order", () => {
  const clubs: TeamSearchOption[] = [
    { id: "tn", label: "Trash Pandas", detail: "9U 2027 · Nashville, TN" },
    { id: "ky", label: "Trash Pandas", detail: "9U 2027 · Hebron, KY" },
    { id: "ny", label: "Brooklyn Bombers", detail: "10U 2027 · Brooklyn, NY" },
    { id: "wv", label: "Mountaineers", detail: "WV" },
    { id: "va", label: "Cavaliers", detail: "VA" },
    { id: "rap", label: "River City Raptors", detail: "OH", coaches: ["Sam Sample"] },
  ];
  const ids = (query: string) => matchTeamOptions(clubs, query).shown.map((option) => option.id);

  it("finds a name whatever order its words are typed in", () => {
    expect(ids("pandas trash")).toEqual(["ky", "tn"]);
  });

  it("needs every word to match something about the club", () => {
    expect(ids("trash ky")).toEqual(["ky"]);
    expect(ids("trash zzz")).toEqual([]);
  });

  it("reads a state's name as its code", () => {
    expect(ids("pandas kentucky")).toEqual(["ky"]);
    expect(ids("tennessee")).toEqual(["tn"]);
    expect(ids("new york")).toEqual(["ny"]);
    expect(ids("ohio raptors")).toEqual(["rap"]);
  });

  it("takes the longest state name it can, so West Virginia is not Virginia", () => {
    expect(ids("west virginia")).toEqual(["wv"]);
    expect(ids("virginia")).toEqual(["va"]);
  });

  it("finds a state's code only as a whole capitalised word", () => {
    const more: TeamSearchOption[] = [
      ...clubs,
      { id: "coho", label: "COHO Elite", detail: "WA" },
      { id: "pride", label: "Pride in Pinstripes", detail: "TX" },
      { id: "hoos", label: "Hoosiers", detail: "IN" },
    ];
    const found = (query: string) => matchTeamOptions(more, query).shown.map((option) => option.id);
    expect(found("ohio")).toEqual(["rap"]);
    expect(found("indiana")).toEqual(["hoos"]);
  });

  it("still finds a coach whose name is a state's", () => {
    const more: TeamSearchOption[] = [
      ...clubs,
      { id: "tx", label: "Lone Stars", detail: "TX", coaches: ["Georgia Smith"] },
    ];
    expect(matchTeamOptions(more, "georgia smith").shown.map((option) => option.id)).toEqual([
      "tx",
    ]);
    expect(coachesToList(["Pat Placeholder", "Georgia Smith"], "georgia")?.names).toEqual([
      { name: "Georgia Smith", found: true },
      { name: "Pat Placeholder", found: false },
    ]);
  });

  it("lets one word find the club and another its coach", () => {
    expect(ids("raptors sample")).toEqual(["rap"]);
  });

  it("marks a coach any word of the search found", () => {
    expect(coachesToList(["Pat Placeholder", "Sam Sample"], "raptors sample")?.names).toEqual([
      { name: "Sam Sample", found: true },
      { name: "Pat Placeholder", found: false },
    ]);
  });
});

/*
 * A GameChanger id is what somebody holding a team's page has, and a pasted one found nothing:
 * names were all a search read. Invented ids throughout.
 */
describe("finding a club by its GameChanger id", () => {
  const withIds: TeamSearchOption[] = [
    {
      id: "hive",
      label: "Example Hive *Fall Ball*",
      detail: "8U 2027 · OH",
      gcIds: ["Ab3dEf6hIj9k"],
    },
    { id: "owls", label: "Owls", detail: "9U 2027 · OH", gcIds: ["Zy8xWv7uTs6r", "Qp5oNm4lKj3i"] },
    { id: "bolts", label: "Thunderbolts", detail: "9U 2027 · KY" },
  ];
  const found = (query: string) => matchTeamOptions(withIds, query).shown.map((one) => one.id);

  it("finds the club an id is linked to, bare or inside a link to its page", () => {
    expect(found("Ab3dEf6hIj9k")).toEqual(["hive"]);
    expect(found("https://web.gc.com/teams/Qp5oNm4lKj3i")).toEqual(["owls"]);
    expect(found("web.gc.com/teams/Zy8xWv7uTs6r/schedule")).toEqual(["owls"]);
  });

  it("reads a twelve-letter word as a name unless a club carries it as an id", () => {
    expect(gcIdsInSearch("Thunderbolts")).toEqual(["Thunderbolts"]);
    expect(found("Thunderbolts")).toEqual(["bolts"]);
    // Ids are matched exactly: GameChanger's are case-sensitive.
    expect(found("ab3def6hij9k")).toEqual([]);
  });

  it("finds nobody for an id no club here carries", () => {
    expect(found("https://web.gc.com/teams/Nn1nN2nN3nN4")).toEqual([]);
  });
});

describe("what an empty list says of a pasted id", () => {
  const explain = (id: string) => (id === "gcWAIT000001" ? "Waiting on an age." : undefined);

  it("says where the app has an id no club carries", () => {
    expect(noMatchText("gcWAIT000001", explain)).toBe("Waiting on an age.");
    expect(noMatchText("https://web.gc.com/teams/gcWAIT000001", explain)).toBe(
      "Waiting on an age."
    );
  });

  it("says it has no record of an unknown id, without claiming it was never pulled", () => {
    const said = noMatchText("bKpjvY5AVqOV", explain);
    expect(said).toMatch(/^The app has no record of that GameChanger id\./);
    // A pull that refused it for its season keeps no record, so both are possible.
    expect(said).toContain("a season that was not ticked");
    // The two seasons the pull's picker always offers, so the advice can be followed.
    expect(said).toContain("with this season and last ticked");
    // Twelve letters, but a name: no digit, and no capital past the first letter.
    expect(noMatchText("Thunderbolts", explain)).toBe("No team matches that.");
  });

  it("claims only its own list in a picker that cannot look an id up", () => {
    // Same team as and the league's club picker search fewer clubs and pass no lookup.
    expect(noMatchText("bKpjvY5AVqOV")).toBe(
      "No team in this list is linked to that GameChanger id."
    );
    expect(noMatchText("https://web.gc.com/teams/gcWAIT000001")).toBe(
      "No team in this list is linked to that GameChanger id."
    );
  });
});
