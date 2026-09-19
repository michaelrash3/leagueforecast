import { describe, expect, it } from "vitest";
import { buildScheduleCsv, scheduleCsvFilename } from "../scheduleCsvExport";
import { CSV_SECTIONS, csvSectionMarker } from "../csv";
import { blankLog } from "../util";
import type { GameLog, Matchup, TeamBase } from "../types";

/**
 * This was ninety lines inside App wrapped around a Blob and an anchor click, so the only way to
 * find out what a downloaded file would contain was to download one.
 */
const teamsById = new Map<string, TeamBase>([
  ["a", { id: "a", name: "Rays" } as TeamBase],
  ["b", { id: "b", name: "Blue, Jays" } as TeamBase],
]);

const matchups: Matchup[] = [{ id: "g1", date: "2026-05-01", away: "a", home: "b" }];

const logs: Record<string, GameLog> = {
  g1: {
    ...blankLog(),
    innings: "6",
    awayRuns: "7",
    awayHits: "9",
    awayK: "4",
    awayErrors: "1",
    awayWalksAllowed: "2",
    homeRuns: "3",
    homeHits: "5",
    homeK: "8",
    homeErrors: "0",
    homeWalksAllowed: "3",
  },
};

const lines = (csv: string) => csv.split("\n");

describe("the schedule CSV", () => {
  it("records errors and walks in player pitch", () => {
    const csv = buildScheduleCsv({ matchups, logs, teamsById, pitchMode: "player" });
    const [header, row] = lines(csv);

    expect(header).toBe(
      "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away E,Away BB,Home Team,Home Runs,Home Hits,Home E,Home BB"
    );
    // Two things pinned here that a download alone would not show. The date is written the way
    // the app shows it rather than the way it is stored, and the away side's walks column carries
    // what the home side allowed, with the home column carrying the away side's.
    expect(row).toBe('g1,5/1,Rays,6,7,9,1,3,"Blue, Jays",3,5,0,2');
  });

  it("records strikeouts and balls in play in machine pitch", () => {
    const csv = buildScheduleCsv({ matchups, logs, teamsById, pitchMode: "machine" });
    const [header, row] = lines(csv);

    expect(header).toBe(
      "Game ID,Date,Away Team,Innings,Away Runs,Away Hits,Away K,Away BIP,Home Team,Home Runs,Home Hits,Home K,Home BIP"
    );
    expect(header).not.toContain("Away E");
    expect(row).toContain("Rays");
  });

  it("quotes a team name containing a comma rather than splitting the row", () => {
    const csv = buildScheduleCsv({ matchups, logs, teamsById, pitchMode: "player" });
    expect(csv).toContain('"Blue, Jays"');
  });

  it("keeps the id when a game names a team the season does not have", () => {
    const orphan: Matchup[] = [{ id: "g2", date: "", away: "ghost", home: "b" }];
    const csv = buildScheduleCsv({ matchups: orphan, logs: {}, teamsById, pitchMode: "player" });
    expect(lines(csv)[1]).toContain("ghost");
  });

  it("stays a flat CSV when there is no Team Rankings pool to append", () => {
    const csv = buildScheduleCsv({ matchups, logs, teamsById, pitchMode: "player" });
    expect(csv).not.toContain(csvSectionMarker(CSV_SECTIONS.schedule));
    expect(lines(csv)).toHaveLength(2);
  });

  it("marks the schedule as a section once a pool rides along after it", () => {
    const csv = buildScheduleCsv({
      matchups,
      logs,
      teamsById,
      pitchMode: "player",
      rankingsSections: "# Section: Scout Teams\nid,name",
    });
    expect(lines(csv)[0]).toBe(csvSectionMarker(CSV_SECTIONS.schedule));
    expect(csv).toContain("# Section: Scout Teams");
  });

  it("names the file after the season", () => {
    expect(scheduleCsvFilename("2026 Spring Minors")).toBe("2026_Spring_Minors_Schedule_Data.csv");
  });
});
