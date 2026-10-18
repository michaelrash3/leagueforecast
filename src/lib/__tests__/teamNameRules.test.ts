import { describe, expect, it } from "vitest";
import {
  NAME_RULES,
  firstRuleHit,
  isNotBaseball,
  madeUpHit,
  notATeamWord,
  splitName,
  type NameRule,
} from "../teamNameRules";

/*
 * The words that say a page is not a team, or that the team plays another game. Each rule is read
 * against the name as written and the name with its joins split apart, and refused unless its
 * exemption reads either. Every name here is invented; the shapes are the export's.
 */

const ruleFor = (word: string): NameRule => {
  const rule = NAME_RULES.find((entry) => entry.word === word);
  if (!rule) throw new Error(`no rule ${word}`);
  return rule;
};

/**
 * For each rule: a name it reads, a name its pattern reads that its exemption keeps (where it has
 * one), one only the split form reads, and one only the raw form reads.
 */
const CASES: {
  word: string;
  match: string;
  exempt?: string;
  splitOnly: string;
  rawOnly: string;
}[] = [
  {
    word: "practice",
    match: "Thornbury Practice 12U",
    exempt: "Bramblecote Family Practice 10U",
    splitOnly: "Nettlefield Practice2",
    rawOnly: "Nettlefield PracTice 12U",
  },
  {
    word: "scrimmage",
    match: "Nettlefield Scrimage",
    splitOnly: "Nettlefield Scrimmage11U",
    rawOnly: "Wexcombe SCRIMmage",
  },
  {
    word: "test",
    match: "Thornbury Test 12U",
    exempt: "Test Red Kestrelmoor 12U",
    splitOnly: "zTestNettlefield",
    rawOnly: "Hollowmere TeSt",
  },
  {
    word: "demo",
    match: "Duskwood Demo 12U",
    exempt: "Gildersleeve Demo Dawgs 12U",
    splitOnly: "Duskwood Demo12U",
    rawOnly: "DeMo Squad",
  },
  {
    word: "sample",
    match: "Nettlefield Sample 12U",
    splitOnly: "Nettlefield SampleTeam",
    rawOnly: "DuMmy Nines",
  },
  {
    word: "fake",
    match: "Wexcombe Fake 12U",
    exempt: "Bramblecote Fake And Bake 14U",
    splitOnly: "Nettlefield FakeTeam",
    rawOnly: "FaKe Nines",
  },
  {
    word: "delete",
    match: "Delete Me Nettlefield",
    splitOnly: "Nettlefield DeleteMe",
    rawOnly: "Nettlefield DeLete",
  },
  {
    word: "placeholder",
    match: "Nettlefield Placeholder 12U",
    splitOnly: "Kestrelmoor Placeholder1",
    rawOnly: "Kestrelmoor PLACEholder",
  },
  {
    word: "duplicate",
    match: "Copy of Duskwood Drakes",
    splitOnly: "Nettlefield DuplicateTeam",
    rawOnly: "Nettlefield DuPlicate",
  },
  {
    word: "void",
    match: "Hollowmere Hornets DNU",
    splitOnly: "Nettlefield Dont Use12U",
    rawOnly: "Hollowmere DO NOt USE",
  },
  {
    word: "tryout",
    match: "Kestrelmoor Tryouts 2026",
    splitOnly: "Kestrelmoor Tryouts2026",
    rawOnly: "Wexcombe TRYouts",
  },
  {
    word: "stats",
    match: "Elmstead Stats",
    exempt: "Bramblecote All Stats 10U",
    splitOnly: "Elmstead Stats2026",
    rawOnly: "Nettlefield StAts",
  },
  {
    word: "stream",
    match: "Rowanberry Live Stream",
    exempt: "Pimbleton Pikes w/ Streaming",
    splitOnly: "Rowanberry LiveStream12U",
    rawOnly: "Nettlefield CAMera",
  },
  {
    word: "intrasquad",
    match: "Wexcombe Intrasquad",
    splitOnly: "Kes12UIntrasquad",
    rawOnly: "Wexcombe INTRAsquad",
  },
  {
    word: "team",
    match: "Team 7",
    splitOnly: "TEAM_9",
    rawOnly: "TEam 7",
  },
  {
    word: "softball",
    match: "Gildersleeve Softball 12U",
    exempt: "Kestrelmoor Baseball and Softball 12U",
    splitOnly: "Gildersleeve Softball12U",
    rawOnly: "Gildersleeve SOFTball",
  },
];

describe("the name rules", () => {
  it("are sixteen, in the order they were measured", () => {
    expect(NAME_RULES.map((rule) => rule.word)).toEqual(CASES.map((entry) => entry.word));
  });

  describe.each(CASES)("$word", ({ word, match, exempt, splitOnly, rawOnly }) => {
    const rule = ruleFor(word);
    const hit = (name: string) => firstRuleHit(name, [rule])?.word ?? null;

    it(`reads "${match}"`, () => {
      expect(hit(match)).toBe(word);
    });

    if (exempt !== undefined) {
      it(`leaves "${exempt}", which its pattern alone would read`, () => {
        expect(rule.pattern.test(exempt) || rule.pattern.test(splitName(exempt))).toBe(true);
        expect(hit(exempt)).toBeNull();
      });
    }

    it(`reads "${splitOnly}" only once its joins are split`, () => {
      expect(rule.pattern.test(splitOnly)).toBe(false);
      expect(hit(splitOnly)).toBe(word);
    });

    it(`reads "${rawOnly}" only as it is written`, () => {
      expect(rule.pattern.test(splitName(rawOnly))).toBe(false);
      expect(hit(rawOnly)).toBe(word);
    });
  });

  it("keeps a name its exemption reads only once its joins are split", () => {
    // Every exemption above is written with spaces, so the name as written already escapes; these
    // escape only split, and a check of the raw form alone would refuse them.
    ["Bramblecote FamilyPractice 10U", "TestRed Kestrelmoor 12U"].forEach((name) => {
      expect(NAME_RULES.some((rule) => rule.exempt?.test(name))).toBe(false);
      expect(firstRuleHit(name, NAME_RULES)).toBeNull();
    });
  });

  it("splits a name at its joins and nowhere else", () => {
    expect(splitName("NettlefieldGC")).toBe("Nettlefield GC");
    expect(splitName("ABCDont")).toBe("ABC Dont");
    expect(splitName("Hollowmere2")).toBe("Hollowmere 2");
    expect(splitName("2026Hollowmere")).toBe("2026 Hollowmere");
    expect(splitName("Kestrel_Moor")).toBe("Kestrel Moor");
    expect(splitName("Thornbury Thrushes 12U")).toBe("Thornbury Thrushes 12 U");
  });

  it("leaves the near misses the measurement found alone", () => {
    // Sponsors and real squads in the export whose names carry the letters but not the word.
    [
      "Nettlefield Chiropractic 10U",
      "Contest Nettlefield",
      "Nettlefield Demons",
      "Nettlefield Testers 11U",
      "Samples Nettlefield 9U",
      "Copycat Nettlefield 10U",
      "Kestrelmoor All-Stat Nines 12U",
      "Stat Nettlefield 10U",
      "Bramblecote Stream 11U",
      "TBD Nettlefield 12U",
      "Go Pro Nettlefield 13U",
    ].forEach((name) => expect(firstRuleHit(name, NAME_RULES)).toBeNull());
  });

  it("reads practice in every form a name writes it, the British spellings too", () => {
    [
      "Thornbury Practices",
      "Thornbury Practicing 12U",
      "Thornbury Practise",
      "Thornbury Practises 11U",
      "Thornbury Practised",
      "Thornbury Practising 12U",
    ].forEach((name) => expect(notATeamWord(name)?.word, name).toBe("practice"));
  });

  it("names the first rule a name meets, with the words as the name writes them", () => {
    expect(notATeamWord("Hollowmere Scrimmage DNU")).toEqual({
      word: "scrimmage",
      text: "Scrimmage",
      opponent: "drop",
    });
    expect(notATeamWord("Hollowmere Hornets Do Not Use")).toEqual({
      word: "void",
      text: "Do Not Use",
      opponent: "slot",
    });
    expect(notATeamWord("Nettlefield Practice2")?.text).toBe("Practice");
  });

  it("files the old-page words as slots and drops the rest", () => {
    const gate = Object.fromEntries(NAME_RULES.map((rule) => [rule.word, rule.opponent]));
    expect(Object.keys(gate).filter((word) => gate[word] === "slot")).toEqual([
      "delete",
      "placeholder",
      "duplicate",
      "void",
      "team",
    ]);
  });

  it("reads a name that is only Team and a number or a letter, however it is written", () => {
    [
      "Team 7",
      "Team 04",
      "Team 250",
      "team 5",
      "TEAM 12",
      "Team #4",
      "Team # 4",
      "Team#4",
      "Team7",
      "Team B",
      "TeamB",
      "Team",
      "  Team 6  ",
      "My Team",
      "MyTeam",
      "New Team 3",
      "The Team",
      "Our Team A",
      "TEAM_9",
    ].forEach((name) => expect(notATeamWord(name)?.word, name).toBe("team"));
  });

  it("leaves a name that opens with Team and goes on to say who the team is", () => {
    /*
     * The whole name has to be the word and its number: a place, a club's name, an age, a year or
     * a second word after the number is a team somebody named. A number run into a name splits to
     * "Team 7 Larkspire" and is still a name.
     */
    [
      "Team Wrenfield 12U",
      "Team Elite Larkspire 12U",
      "Team 1 Alderbrook Academy",
      "Team QXR",
      "Team QXR 12U",
      "Team7Larkspire",
      "Team 7 Larkspire",
      "Larkspire Team 7",
      "Team 12U",
      "Team12U",
      "Team 2026",
      "Team 1234",
      "Team 1A",
      "Team - 5",
      "Teamwork Larkspire",
      "My Team Larkspire",
    ].forEach((name) => expect(firstRuleHit(name, NAME_RULES), name).toBeNull());
  });

  it("says the whole name is what a Team-number name hit, and files a game against one on a slot", () => {
    expect(notATeamWord("Team #4")).toEqual({ word: "team", text: "Team #4", opponent: "slot" });
    expect(notATeamWord("TEAM_9")?.text).toBe("TEAM 9");
  });

  it("reads nothing into a name that is not a string", () => {
    expect(notATeamWord(undefined)).toBeNull();
    expect(notATeamWord("")).toBeNull();
    expect(notATeamWord(12)).toBeNull();
  });
});

describe("a page that is no team, and a team that plays another game", () => {
  it("reads softball as not baseball, and never as no team", () => {
    expect(isNotBaseball("Gildersleeve Softball 12U")).toBe(true);
    expect(isNotBaseball("Kestrelmoor Fastpitch 14U")).toBe(true);
    expect(isNotBaseball("Wexcombe 12u Slow Pitch")).toBe(true);
    expect(isNotBaseball("Elmstead Kickball")).toBe(true);
    expect(notATeamWord("Gildersleeve Softball 12U")).toBeNull();
  });

  it("keeps the baseball exemption to the softball words: wiffle baseball is still wiffle", () => {
    expect(isNotBaseball("Kestrelmoor Baseball and Softball 12U")).toBe(false);
    expect(isNotBaseball("Nettlefield 6U Baseball/Softball")).toBe(false);
    expect(isNotBaseball("Nettlefield Wiffle Baseball 12U")).toBe(true);
  });
});

describe("the nightly sweep's words", () => {
  it("are void, test and demo, with their exemptions, read both ways", () => {
    expect(madeUpHit("Thornbury Test 12U")?.word).toBe("test");
    expect(madeUpHit("Duskwood Demo 12U")?.word).toBe("demo");
    expect(madeUpHit("Hollowmere Hornets DNU")?.word).toBe("void");
    expect(madeUpHit("zTestNettlefield")?.word).toBe("test");
  });

  it("leave the Austin organisation called TEST, Skiles Test and a test-prep sponsor", () => {
    expect(madeUpHit("Test Black Kestrelmoor 12U")).toBeNull();
    expect(madeUpHit("Test Red Kestrelmoor 12U")).toBeNull();
    expect(madeUpHit("Test Blaze Nettlefield")).toBeNull();
    expect(madeUpHit("Skiles Test Nettlefield 12U")).toBeNull();
    expect(madeUpHit("Bramblecote Test Prep 12U")).toBeNull();
  });

  it("are not the practice or scrimmage words, which only the import and the tidy read", () => {
    expect(madeUpHit("Thornbury Practice 12U")).toBeNull();
    expect(madeUpHit("Nettlefield Scrimmage")).toBeNull();
  });

  it("are not the Team-number names either, which the sweep's sign has never read", () => {
    expect(madeUpHit("Team 7")).toBeNull();
    expect(madeUpHit("My Team")).toBeNull();
  });
});
