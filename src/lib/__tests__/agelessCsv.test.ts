import { describe, expect, it } from "vitest";
import {
  AGELESS_CSV_HEADERS,
  agelessCsv,
  agelessCsvFilename,
  agelessCsvParts,
  parseAgelessCsv,
} from "../agelessCsv";
import { parseGcTeamList } from "../gameChangerApi";
import { normalizeHeader, parseCSVLine } from "../csv";
import type { AgeUnknownList, AgeUnknownTeam } from "../ageUnknown";

const row = (extra: Partial<AgeUnknownTeam> = {}): AgeUnknownTeam => ({
  teamId: "gcABCDEFGHIJKL",
  name: "D33 Minors Allied Gardens 2",
  firstSeen: "2026-08-01T00:00:00.000Z",
  lastTried: "2026-09-15T00:00:00.000Z",
  tries: 3,
  evidence: {
    ageLabel: "Minors",
    city: "San Diego",
    state: "CA",
    ngb: ["little league"],
    games: 12,
    scored: 10,
    aheadOfToday: 0,
    shutoutBlowouts: 1,
    opponents: 6,
    namedAnAge: 0,
    tally: [],
    sampleOpponents: ["D33 Majors Allied Gardens 1", "Mission Valley Minors"],
    record: { win: 8, loss: 4, tie: 0 },
    playerCount: 11,
  },
  ...extra,
});

/** The file as a spreadsheet would read it: a header row and one array of cells per row. */
const asCells = (text: string): string[][] =>
  text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseCSVLine);

describe("the file the waiting list comes out as", () => {
  it("writes one row per team under the headers, in order", () => {
    const [header, first] = asCells(agelessCsv([row()]));
    expect(header).toEqual([...AGELESS_CSV_HEADERS]);
    expect(first?.[0]).toBe("gcABCDEFGHIJKL");
    expect(first?.[1]).toBe("D33 Minors Allied Gardens 2");
    expect(first?.[2]).toBe("https://web.gc.com/teams/gcABCDEFGHIJKL");
  });

  it("leaves the answer column empty, because that is the column somebody fills in", () => {
    const answerAt = AGELESS_CSV_HEADERS.indexOf("Answer");
    const [, first] = asCells(agelessCsv([row()]));
    expect(first?.[answerAt]).toBe("");
  });

  it("carries the evidence behind the row, so a decision needs no second window", () => {
    const [header, first] = asCells(agelessCsv([row()]));
    const at = (name: string) => first?.[(header ?? []).indexOf(name)];
    expect(at("Age Field")).toBe("Minors");
    expect(at("Sanctioning Body")).toBe("little league");
    expect(at("City")).toBe("San Diego");
    expect(at("Played")).toBe("D33 Majors Allied Gardens 1; Mission Valley Minors");
    expect(at("Record")).toBe("8-4-0");
    expect(at("Players")).toBe("11");
  });

  it("says why the team is on the list at all", () => {
    const [header, first] = asCells(agelessCsv([row()]));
    expect(first?.[(header ?? []).indexOf("Why")]).toMatch(/opponent|age/i);
  });

  /*
   * The names on this list are the ones nobody could parse, so they are exactly the names carrying
   * commas, quotes and a leading dash. A leading dash also means a formula to Excel, which is what
   * `csvEscape`'s guard is for, and a row that breaks the file is a row nobody ever answers.
   */
  it("survives a name with a comma, a quote and a leading dash", () => {
    const awkward = row({ name: '-Los "Diablos", Norte' });
    const [, first] = asCells(agelessCsv([awkward]));
    expect(first?.[1]).toBe('-Los "Diablos", Norte');
    expect(agelessCsv([awkward])).toContain('"\'-Los ""Diablos"", Norte"');
  });

  it("builds the file in pieces, one per row plus the header", () => {
    const parts = agelessCsvParts([row(), row({ teamId: "gcMNOPQRSTUVWX" })]);
    expect(parts).toHaveLength(3);
    expect(parts.join("")).toBe(agelessCsv([row(), row({ teamId: "gcMNOPQRSTUVWX" })]));
  });

  it("names the file after the day it was taken", () => {
    expect(agelessCsvFilename("2026-09-22")).toBe("gamechanger-waiting-on-an-age-2026-09-22.csv");
  });
});

/**
 * The reason this file's columns are named the way they are: a worked file goes back into the
 * import box, and `parseGcTeamList` reads it there.
 */
describe("the file read back by the team importer", () => {
  it("is a list of teams, by the first three columns", () => {
    const parsed = parseGcTeamList(agelessCsv([row()]));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0]?.teamId).toBe("gcABCDEFGHIJKL");
    expect(parsed.entries[0]?.name).toBe("D33 Minors Allied Gardens 2");
  });

  /*
   * Why the observed label's column is called "Age Field" and not "Age Group".
   *
   * `AGE_HEADERS` matches `age group`, `age`, `age level` and `division`, so any of those names
   * would make `readColumns` treat GameChanger's own label as the age on a re-import — and never
   * look at `Answer`, which is not an alias it matches. Today that is harmless, because a label on
   * a waiting row is by construction one `ageLevelOf` already refused: "Minors", "Varsity", "AAA"
   * all read as undefined, which is why the team is waiting.
   *
   * It stops being harmless the moment `ageFromDivisionName` joins the ladder, which is the point
   * of the work this file is part of. Then `ageLevelOf("Minors", …)` answers 12, and a file whose
   * reader wrote 10U in `Answer` would import at 12 instead — GameChanger's rejected label beating
   * the human who was asked precisely because it was rejected. The column is named defensively
   * now, before the rung that would make it bite exists.
   *
   * So the test puts a readable age in that column, which no real row carries, and shows the
   * importer does not see it.
   */
  it("does not read the observed age label as the answer", () => {
    expect(AGELESS_CSV_HEADERS).toContain("Age Field");
    const headers = AGELESS_CSV_HEADERS.map(normalizeHeader);
    ["age group", "age", "age level", "division"].forEach((alias) => {
      expect(headers).not.toContain(alias);
    });
    const readable = agelessCsv([row({ evidence: { ...row().evidence!, ageLabel: "9U" } })]);
    expect(readable).toContain("9U");
    expect(parseGcTeamList(readable).entries[0]?.ageLevel).toBeUndefined();
  });
});

describe("the file read back as the waiting list", () => {
  it("round-trips a row whole", () => {
    const list: AgeUnknownList = [row()];
    expect(parseAgelessCsv(agelessCsv(list))).toEqual([
      {
        ...row(),
        evidence: {
          ageLabel: "Minors",
          city: "San Diego",
          state: "CA",
          ngb: ["little league"],
          games: 12,
          scored: 10,
          aheadOfToday: 0,
          shutoutBlowouts: 1,
          opponents: 6,
          namedAnAge: 0,
          tally: [],
          sampleOpponents: ["D33 Majors Allied Gardens 1", "Mission Valley Minors"],
          playerCount: 11,
        },
      },
    ]);
  });

  it("reads the opponent tally back", () => {
    const tallied = row({
      evidence: {
        games: 4,
        scored: 4,
        aheadOfToday: 0,
        shutoutBlowouts: 0,
        opponents: 3,
        namedAnAge: 3,
        tally: [
          [10, 2],
          [9, 1],
        ],
      },
    });
    expect(parseAgelessCsv(agelessCsv([tallied]))[0]?.evidence?.tally).toEqual([
      [10, 2],
      [9, 1],
    ]);
  });

  it("reads a file Excel saved, with a byte order mark and CRLF endings", () => {
    const excel = `\ufeff${agelessCsv([row()]).replace(/\n/g, "\r\n")}`;
    expect(parseAgelessCsv(excel)).toHaveLength(1);
  });

  it("skips a row with no id rather than failing the file", () => {
    const text = `${agelessCsv([row()])},,,\n`;
    expect(parseAgelessCsv(text)).toHaveLength(1);
  });

  it("reads nothing out of a file that is not this one", () => {
    expect(parseAgelessCsv("Team Name,City\nSomebody,Dayton\n")).toEqual([]);
    expect(parseAgelessCsv("")).toEqual([]);
  });
});
