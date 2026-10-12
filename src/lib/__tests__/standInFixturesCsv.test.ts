import { describe, expect, it } from "vitest";
import { STAND_IN_FIXTURES_CSV_HEADERS, standInFixturesCsvParts } from "../standInFixturesCsv";
import { parseCSVLine } from "../csv";
import type { AgeGroup, ScoutGame, ScoutTeam } from "../teamRankings";

const group = (id: string, ageLevel: number, year: number): AgeGroup => ({
  id,
  name: `${ageLevel}U ${year}`,
  ageLevel,
  year,
  seasonIds: [],
});

/** A pulled club: it has a GameChanger link of its own, which is what makes it one. */
const club = (id: string, name: string, state: string): ScoutTeam => ({
  id,
  name,
  state,
  gcTeams: [{ teamId: `gc-${id}`, ageGroupId: "g10", name }],
});
const standIn = (id: string, name: string): ScoutTeam => ({ id, name, nameOnly: true });
const slot = (id: string, name: string): ScoutTeam => ({ id, name, placeholder: true });

const SIX_PM = "2026-09-19T22:00:00.000Z";
const SEVEN_PM = "2026-09-19T23:00:00.000Z";
const NEXT_WEEK = { date: "2026-09-26", startTs: "2026-09-26T22:00:00.000Z" };

const game = (
  id: string,
  teamAId: string,
  teamBId: string,
  extra: Partial<ScoutGame> = {}
): ScoutGame => ({
  id,
  teamAId,
  teamBId,
  ageGroupId: "g10",
  date: "2026-09-19",
  startTs: SIX_PM,
  teamAScore: 5,
  teamBScore: 3,
  source: { kind: "gamechanger", teamId: `gc-${teamAId}`, gameId: `src-${id}` },
  ...extra,
});

type Header = (typeof STAND_IN_FIXTURES_CSV_HEADERS)[number];
const cell = (row: string[] | undefined, name: Header) =>
  row?.[STAND_IN_FIXTURES_CSV_HEADERS.indexOf(name)];

const rowsOf = async (
  teams: ScoutTeam[],
  games: ScoutGame[],
  ageGroups = [group("g10", 10, 2027)]
): Promise<string[][]> =>
  (await standInFixturesCsvParts(teams, ageGroups, games))
    .join("")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map(parseCSVLine);

/** The rows written for one stand-in game, header skipped. */
const rowsFor = (rows: string[][], gameId: string) =>
  rows.slice(1).filter((row) => cell(row, "Game ID") === gameId);

/*
 * The case the export exists for. The Raiders (NJ) and the Woodchucks (PA) played at six. Each
 * was pulled; each refused the other's stand-in across the state line; so each schedule's row went
 * onto a stand-in — and the Raiders' schedule spelled the Woodchucks wrong while it was at it.
 */
const raiders = club("P", "Raiders", "NJ");
const woodchucks = club("Q", "Woodchucks", "PA");
const woodchuks = standIn("X", "Woodchuks");
const raidersStandIn = standIn("Y", "Raiders");

describe("the stand-in fixtures file", async () => {
  it("heads the file with its columns", async () => {
    const [header] = await rowsOf([raiders, woodchuks], [game("g1", "P", "X")]);
    expect(header).toEqual([...STAND_IN_FIXTURES_CSV_HEADERS]);
  });

  it("pairs a mirrored fixture from both sides, misspelling and all", async () => {
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, raidersStandIn],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    const [fromRaiders] = rowsFor(rows, "g1");
    expect(cell(fromRaiders, "Kind")).toBe("fixture");
    expect(cell(fromRaiders, "Match ID")).toBe("Q");
    expect(cell(fromRaiders, "Opposite ID")).toBe("Y");
    expect(cell(fromRaiders, "Scores")).toBe("agree");
    // "Woodchuks" and "Woodchucks" share no word, only their first letters; "Raiders" is exact.
    expect(cell(fromRaiders, "Name Links")).toBe("2");
    expect(cell(fromRaiders, "Exact Names")).toBe("1");
    expect(cell(fromRaiders, "Filed By")).toBe("match");
    expect(cell(fromRaiders, "Puller Filed")).toBe("yes");
    // Found at the instant, so not found again as a same-day candidate.
    expect(cell(fromRaiders, "Same Day")).toBe("0");

    const [fromWoodchucks] = rowsFor(rows, "g2");
    expect(cell(fromWoodchucks, "Match ID")).toBe("P");
    expect(cell(fromWoodchucks, "Opposite ID")).toBe("X");
  });

  it.each([
    ["dropped", "Woodchuks"],
    ["added", "Woodchuckss"],
    ["changed", "Woodchicks"],
    ["swapped", "Woodhcucks"],
    ["spaced", "Wood Chucks"],
  ])("pairs a name with a letter %s", async (_, spelling) => {
    const rows = await rowsOf(
      [raiders, woodchucks, standIn("X", spelling), standIn("Y", "Diamond Kings")],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("fixture");
    expect(cell(row, "Name Links")).toBe("1");
  });

  it("asks again of a spelling the index only thinks is close", async () => {
    // "Braves" less its B and "Ravesh" less its H are both "Raves", so the index hands the pair
    // back — but that is a letter off one end and a letter onto the other, two slips, not one.
    const rows = await rowsOf(
      [raiders, club("Q", "Ravesh", "PA"), standIn("X", "Braves"), standIn("Y", "Diamond Kings")],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    expect(rowsFor(rows, "g1").map((row) => cell(row, "Kind"))).toEqual(["none"]);
  });

  it("finds the puller's own second row at the same instant", async () => {
    // The Woodchucks' schedule named the Raiders correctly, so the game is on the Raiders twice.
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks],
      [game("g1", "P", "X"), game("g2", "Q", "P", { teamAScore: 3, teamBScore: 5 })]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("same-club");
    expect(cell(row, "Match ID")).toBe("Q");
    expect(cell(row, "Opposite ID")).toBe("P");
    expect(cell(row, "Scores")).toBe("agree");
    expect(cell(row, "Candidates")).toBe("1");
    expect(cell(row, "Same Day")).toBe("0");
  });

  it("runs both searches again a week on, as decoys", async () => {
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, raidersStandIn],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { ...NEXT_WEEK, teamAScore: 3, teamBScore: 5 })]
    );
    const written = rowsFor(rows, "g1");
    expect(written.map((row) => cell(row, "Kind"))).toEqual(["decoy", "day-decoy"]);
    expect(cell(written[0], "Candidates")).toBe("0");
    expect(cell(written[0], "Same Day")).toBe("0");
    expect(cell(written[0], "Decoys")).toBe("1");
    expect(cell(written[0], "Day Decoys")).toBe("1");
    expect(cell(written[0], "Other Date")).toBe(NEXT_WEEK.date);
  });

  it("runs them a week back too", async () => {
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, raidersStandIn],
      [game("g1", "P", "X", NEXT_WEEK), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    expect(rowsFor(rows, "g1").map((row) => cell(row, "Kind"))).toEqual(["decoy", "day-decoy"]);
  });

  it("pairs the other half an hour off, on the same day", async () => {
    // Two coaches typing one start time an hour apart: the day and both names carry it.
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, raidersStandIn],
      [
        game("g1", "P", "X"),
        game("g2", "Q", "Y", { startTs: SEVEN_PM, teamAScore: 3, teamBScore: 5 }),
      ]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("same-day");
    expect(cell(row, "Candidates")).toBe("0");
    expect(cell(row, "Same Day")).toBe("1");
    expect(cell(row, "Other Start")).toBe(SEVEN_PM);
  });

  it("holds a same-day pairing to both names, and a result that does not contradict", async () => {
    const onTheDay = async (opposite: ScoutTeam, extra: Partial<ScoutGame>) =>
      rowsFor(
        await rowsOf(
          [raiders, woodchucks, woodchuks, opposite],
          [game("g1", "P", "X"), game("g2", "Q", opposite.id, { startTs: SEVEN_PM, ...extra })]
        ),
        "g1"
      ).map((row) => cell(row, "Kind"));
    const mirrored = { teamAScore: 3, teamBScore: 5 };
    const unscored = { teamAScore: undefined, teamBScore: undefined };
    // One name, even with the result mirrored: on a busy day some other game has that score.
    expect(await onTheDay(standIn("Y", "Diamond Kings"), mirrored)).toEqual(["none"]);
    expect(await onTheDay(standIn("Y", "Diamond Kings"), unscored)).toEqual(["none"]);
    // Both names, and nothing contradicting: kept.
    expect(await onTheDay(raidersStandIn, unscored)).toEqual(["same-day"]);
    // Both names but a different result at a different time is as likely the second game.
    expect(await onTheDay(raidersStandIn, { teamAScore: 9, teamBScore: 1 })).toEqual(["none"]);
  });

  it("asks the same of the puller's own other rows that day", async () => {
    // The Woodchucks' schedule named the Raiders at seven; the Raiders' own row is at six.
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks],
      [
        game("g1", "P", "X"),
        game("g2", "Q", "P", { startTs: SEVEN_PM, teamAScore: 3, teamBScore: 5 }),
      ]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("same-day");
    expect(cell(row, "Match ID")).toBe("Q");
    expect(cell(row, "Opposite ID")).toBe("P");

    // An unrelated opponent later that day with no result is just the Raiders' next game.
    const later = await rowsOf(
      [raiders, club("Z", "Diamond Kings", "NJ"), woodchuks],
      [
        game("g1", "P", "X"),
        game("g2", "Z", "P", { startTs: SEVEN_PM, teamAScore: undefined, teamBScore: undefined }),
      ]
    );
    expect(rowsFor(later, "g1").map((row) => cell(row, "Kind"))).toEqual(["none"]);
  });

  it("writes the strongest three on the day and of each decoy, and counts them all", async () => {
    const namesakes = Array.from({ length: 5 }, (_, i) => club(`Q${i}`, `Woodchucks ${i}`, "PA"));
    const stands = Array.from({ length: 5 }, (_, i) => standIn(`Y${i}`, "Raiders"));
    const rows = await rowsOf(
      [raiders, woodchuks, ...namesakes, ...stands],
      [
        game("g1", "P", "X"),
        ...namesakes.flatMap((q, i) => [
          game(`d${i}`, q.id, `Y${i}`, { startTs: SEVEN_PM, teamAScore: 3, teamBScore: 5 }),
          game(`w${i}`, q.id, `Y${i}`, { ...NEXT_WEEK, teamAScore: 3, teamBScore: 5 }),
        ]),
      ]
    );
    const kinds = rowsFor(rows, "g1").map((row) => cell(row, "Kind"));
    expect(kinds.filter((k) => k === "same-day")).toHaveLength(3);
    expect(kinds.filter((k) => k === "decoy")).toHaveLength(3);
    expect(kinds.filter((k) => k === "day-decoy")).toHaveLength(3);
    const [first] = rowsFor(rows, "g1");
    expect(cell(first, "Same Day")).toBe("5");
    expect(cell(first, "Decoys")).toBe("5");
    expect(cell(first, "Day Decoys")).toBe("5");
  });

  it("does not pair across season years", async () => {
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, raidersStandIn],
      [
        game("g1", "P", "X"),
        game("g2", "Q", "Y", { ageGroupId: "g10-next", teamAScore: 3, teamBScore: 5 }),
      ],
      [group("g10", 10, 2027), group("g10-next", 10, 2028)]
    );
    expect(rowsFor(rows, "g1").map((row) => cell(row, "Kind"))).toEqual(["none"]);
  });

  it("does not pair two games whose names say nothing about each other", async () => {
    const strangers = [club("Q", "Blue Wave", "PA"), standIn("Y", "Diamond Kings")];
    const rows = await rowsOf(
      [raiders, woodchuks, ...strangers],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    expect(rowsFor(rows, "g1").map((row) => cell(row, "Kind"))).toEqual(["none"]);
  });

  it("holds a pairing at the instant to both names, or one name and the result", async () => {
    const atSix = async (extra: Partial<ScoutGame>) =>
      rowsFor(
        await rowsOf(
          [raiders, woodchucks, woodchuks, standIn("Y", "Diamond Kings")],
          [game("g1", "P", "X"), game("g2", "Q", "Y", extra)]
        ),
        "g1"
      ).map((row) => cell(row, "Kind"));
    // One name and the result mirrored: kept.
    expect(await atSix({ teamAScore: 3, teamBScore: 5 })).toEqual(["fixture"]);
    // One name and nothing to check it against: one shared word is what chance looks like.
    expect(await atSix({ teamAScore: undefined, teamBScore: undefined })).toEqual(["none"]);
  });

  it("leaves a game between two clubs already connected to each other alone", async () => {
    // The Woodchucks played the Blue Wave at six, and both are pulled: that is their game, however
    // well "Woodchucks" matches the stand-in and however neatly the scores line up.
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, club("Z", "Blue Wave", "PA")],
      [game("g1", "P", "X"), game("g2", "Q", "Z", { teamAScore: 3, teamBScore: 5 })]
    );
    expect(rowsFor(rows, "g1").map((row) => cell(row, "Kind"))).toEqual(["none"]);
  });

  it("writes a row filed against a pulled namesake of the puller", async () => {
    // Another club called the Raiders, in another state, holds the Woodchucks' half of the game.
    const namesake = club("R", "Raiders", "TX");
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, namesake],
      [game("g1", "P", "X"), game("g2", "Q", "R", { teamAScore: 3, teamBScore: 5 })]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("fixture");
    expect(cell(row, "Opposite ID")).toBe("R");
    expect(cell(row, "Opposite Kind")).toBe("club");
    expect(cell(row, "Name Links")).toBe("2");
  });

  it("keeps a disagreeing result only when both names support the pairing", async () => {
    const disagreeing = async (opposite: ScoutTeam) =>
      rowsFor(
        await rowsOf(
          [raiders, woodchucks, woodchuks, opposite],
          [game("g1", "P", "X"), game("g2", "Q", opposite.id, { teamAScore: 9, teamBScore: 1 })]
        ),
        "g1"
      );
    // Only the Woodchucks' name links: one claim, and the result contradicts it.
    expect(
      (await disagreeing(standIn("Y", "Diamond Kings"))).map((row) => cell(row, "Kind"))
    ).toEqual(["none"]);
    // Both names link, so it is written — marked as a disagreement for the rule to weigh.
    const [both] = await disagreeing(raidersStandIn);
    expect(cell(both, "Kind")).toBe("fixture");
    expect(cell(both, "Scores")).toBe("differ");
  });

  it("pairs a bracket slot through the puller's name alone", async () => {
    const rows = await rowsOf(
      [raiders, woodchucks, slot("X", "TBD"), raidersStandIn],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Stand-in Kind")).toBe("slot");
    expect(cell(row, "Kind")).toBe("fixture");
    expect(cell(row, "Name Links")).toBe("1");
  });

  it("pairs a row whose other half still has a bracket slot where the puller should be", async () => {
    // The Woodchucks' schedule never learned who it played at six: "TBD", from their side.
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, slot("Y", "TBD")],
      [game("g1", "P", "X"), game("g2", "Q", "Y", { teamAScore: 3, teamBScore: 5 })]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("fixture");
    expect(cell(row, "Opposite Kind")).toBe("slot");
    expect(cell(row, "Name Links")).toBe("1");
  });

  it("searches an untimed row by its day alone", async () => {
    const rows = await rowsOf(
      [raiders, woodchucks, woodchuks, raidersStandIn],
      [
        game("g1", "P", "X", { startTs: undefined }),
        game("g2", "Q", "Y", { startTs: undefined, teamAScore: 3, teamBScore: 5 }),
      ]
    );
    const [row] = rowsFor(rows, "g1");
    expect(cell(row, "Kind")).toBe("same-day");
    expect(cell(row, "Start")).toBe("");
  });

  it("writes a row with nothing beside it as the denominator", async () => {
    const rows = await rowsOf([raiders, woodchuks], [game("g1", "P", "X")]);
    expect(rowsFor(rows, "g1").map((row) => cell(row, "Kind"))).toEqual(["none"]);
  });

  it("writes no row for a game between two pulled clubs", async () => {
    const rows = await rowsOf([raiders, woodchucks], [game("g1", "P", "Q")]);
    expect(rows).toHaveLength(1);
  });

  it("pauses every thousand rows searched, so the page can paint", async () => {
    const stands = Array.from({ length: 2001 }, (_, i) => standIn(`X${i}`, `Stand ${i}`));
    const pauses: string[] = [];
    await standInFixturesCsvParts(
      [raiders, ...stands],
      [group("g10", 10, 2027)],
      // Neither a time nor a day, so the rows cost nothing to search and the count is all there is.
      stands.map((stand, i) =>
        game(`g${i}`, "P", stand.id, { date: undefined, startTs: undefined })
      ),
      (searched, of) => {
        pauses.push(`${searched} of ${of}`);
        return Promise.resolve();
      }
    );
    // And says how far along it is, for the button to show.
    expect(pauses).toEqual(["1000 of 2001", "2000 of 2001"]);
  });

  it("writes the strongest five candidates and counts them all", async () => {
    const namesakes = Array.from({ length: 7 }, (_, i) => club(`Q${i}`, `Woodchucks ${i}`, "PA"));
    const stands = Array.from({ length: 7 }, (_, i) => standIn(`Y${i}`, "Diamond Kings"));
    const rows = await rowsOf(
      [raiders, woodchuks, ...namesakes, ...stands],
      [
        game("g1", "P", "X"),
        ...namesakes.map((q, i) => game(`n${i}`, q.id, `Y${i}`, { teamAScore: 3, teamBScore: 5 })),
      ]
    );
    const written = rowsFor(rows, "g1");
    expect(written).toHaveLength(5);
    expect(cell(written[0], "Candidates")).toBe("7");
  });
});
