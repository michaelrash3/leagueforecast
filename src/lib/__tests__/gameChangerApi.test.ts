import { describe, expect, it } from "vitest";
import teamListCsv from "./fixtures/gc-team-list.csv?raw";
import orgListCsv from "./fixtures/gc-org-list.csv?raw";
import teamListOrgsCsv from "./fixtures/gc-team-list-orgs.csv?raw";
import profileFixture from "./fixtures/gc-team-profile.json";
import gamesFixture from "./fixtures/gc-team-games.json";
import {
  GC_GAMES_ACCEPT,
  GC_PROFILE_ACCEPT,
  GC_PUBLIC_API_BASE,
  GC_TEAM_ENDPOINT,
  GC_TEAM_ID_PATTERN,
  ageFromGradYear,
  ageFromGradYearInName,
  ageFromGradYearLabel,
  ageLevelFromName,
  ageFromLeagueNames,
  ageLevelOf,
  ageSpanFromName,
  avatarKeyFromUrl,
  gradYearFromName,
  formatGcSeason,
  gcGamesApiUrl,
  gcProfileApiUrl,
  gcTeamPageUrl,
  isGcFetchErrorReason,
  localDateInZone,
  normalizeGcGameStatus,
  gcGameIdsFrom,
  normalizeGcGames,
  normalizeGcTeamProfile,
  parseGcAgeLevel,
  parseGcAssociations,
  parseGcNgb,
  parseGcOrgId,
  parseGcOrgKind,
  parseGcOrgList,
  parseGcSeasonLabel,
  gcSeasonIsCurrent,
  ageWrittenInName,
  parseGcTeamId,
  parseGcTeamList,
  squadYearForGcSeason,
  type GcGame,
} from "../gameChangerApi";

const TEAM_ID = "gsUthn4XoIxS";

describe("constants and URLs", () => {
  it("names the proxy endpoint and GameChanger's public API base", () => {
    expect(GC_TEAM_ENDPOINT).toBe("/api/gc-team");
    expect(GC_PUBLIC_API_BASE).toBe("https://api.team-manager.gc.com");
    expect(GC_PROFILE_ACCEPT).toContain("public_team_profile+json");
    expect(GC_GAMES_ACCEPT).toContain("public_team_schedule_event:list+json");
  });

  it("builds the page and API URLs for a team id", () => {
    expect(gcTeamPageUrl(TEAM_ID)).toBe("https://web.gc.com/teams/gsUthn4XoIxS");
    expect(gcProfileApiUrl(TEAM_ID)).toBe(
      "https://api.team-manager.gc.com/public/teams/gsUthn4XoIxS"
    );
    expect(gcGamesApiUrl(TEAM_ID)).toBe(
      "https://api.team-manager.gc.com/public/teams/gsUthn4XoIxS/games"
    );
    expect(gcGamesApiUrl(TEAM_ID, "http://localhost:9999/")).toBe(
      "http://localhost:9999/public/teams/gsUthn4XoIxS/games"
    );
  });

  it("accepts observed 12-character ids and rejects the obviously wrong", () => {
    expect(GC_TEAM_ID_PATTERN.test("zjvVkYnqLrf0")).toBe(true);
    expect(GC_TEAM_ID_PATTERN.test(TEAM_ID)).toBe(true);
    expect(GC_TEAM_ID_PATTERN.test("abc")).toBe(false);
    expect(GC_TEAM_ID_PATTERN.test("has space in")).toBe(false);
    expect(GC_TEAM_ID_PATTERN.test("a".repeat(25))).toBe(false);
    expect(GC_TEAM_ID_PATTERN.test("../../etc/passwd")).toBe(false);
    // Not a global regex: `test` must be stateless.
    expect(GC_TEAM_ID_PATTERN.test(TEAM_ID)).toBe(true);
    expect(GC_TEAM_ID_PATTERN.test(TEAM_ID)).toBe(true);
  });

  it("recognises the error reasons the proxy can send", () => {
    expect(isGcFetchErrorReason("blocked")).toBe(true);
    expect(isGcFetchErrorReason("unconfigured")).toBe(true);
    expect(isGcFetchErrorReason("nope")).toBe(false);
    expect(isGcFetchErrorReason(42)).toBe(false);
  });
});

describe("parseGcTeamId", () => {
  it("returns a bare id trimmed", () => {
    expect(parseGcTeamId("  zjvVkYnqLrf0 \n")).toBe("zjvVkYnqLrf0");
  });

  it("pulls the id out of any web.gc.com team URL", () => {
    expect(parseGcTeamId("https://web.gc.com/teams/zjvVkYnqLrf0")).toBe("zjvVkYnqLrf0");
    expect(
      parseGcTeamId("https://web.gc.com/teams/gsUthn4XoIxS/2026-fall-nv-stars-9u-scout/schedule")
    ).toBe(TEAM_ID);
    expect(parseGcTeamId("web.gc.com/teams/gsUthn4XoIxS?tab=roster")).toBe(TEAM_ID);
    expect(parseGcTeamId("<https://web.gc.com/teams/gsUthn4XoIxS/>")).toBe(TEAM_ID);
  });

  it("returns null for anything else", () => {
    expect(parseGcTeamId("")).toBeNull();
    expect(parseGcTeamId("   ")).toBeNull();
    expect(parseGcTeamId("abc")).toBeNull();
    expect(parseGcTeamId("https://example.com/teams/gsUthn4XoIxS")).toBeNull();
    expect(parseGcTeamId("https://web.gc.com/leagues/gsUthn4XoIxS")).toBeNull();
    expect(parseGcTeamId("NV Stars 9u Scout")).toBeNull();
  });
});

describe("parseGcTeamList", () => {
  it("keeps the club's name out of a list cell that carries the whole card", () => {
    // GameChanger's own team-list export writes the card into one cell. Everything after the
    // bullet describes the team; none of it names it.
    const { entries } = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group,Season",
        '"101 Baseball Bros 9U Fall 2026 • Staff: Eric Deskins • 10 players",gK5JSTKGwRYz,9U,Fall 2026',
      ].join("\n")
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("101 Baseball Bros 9U Fall 2026");
    // The age level is still read, because it sits before the bullet.
    expect(entries[0]!.ageLevel).toBe(9);
    expect(entries[0]!.season).toEqual({ season: "fall", year: 2026 });
  });

  it("leaves a name with no bullet exactly as it is", () => {
    const { entries } = parseGcTeamList(
      ["Team Name,Team ID", "NV Stars 9u Scout,gsUthn4XoIxS"].join("\n")
    );
    expect(entries[0]!.name).toBe("NV Stars 9u Scout");
  });
  const csv = [
    "\uFEFFTeam Name,Team ID,Age Group,Season,City,State,Player Count,GameChanger URL",
    '"Trash Pandas, Baseball Club",zjvVkYnqLrf0,11U,Fall 2026,Georgetown,KY,12,https://web.gc.com/teams/zjvVkYnqLrf0',
    "NV Stars 9u Scout,gsUthn4XoIxS,9U,Fall 2026,Georgetown,KY,10,https://web.gc.com/teams/gsUthn4XoIxS",
    "Blank Age,Ab12Cd34Ef56,,Spring 2027,,,,https://web.gc.com/teams/Ab12Cd34Ef56",
    "Nineteen,Zy98Xw76Vu54,19U,Winter 2026,Louisville,KY,9,https://web.gc.com/teams/Zy98Xw76Vu54",
    "No Id Here,,10U,Fall 2026,Lexington,KY,11,",
    "Dupe,zjvVkYnqLrf0,11U,Fall 2026,Georgetown,KY,12,https://web.gc.com/teams/zjvVkYnqLrf0",
    "",
  ].join("\r\n");

  it("reads the user's CSV export, BOM and quoted names included", () => {
    const { entries, skipped } = parseGcTeamList(csv);
    expect(entries).toEqual([
      {
        teamId: "zjvVkYnqLrf0",
        name: "Trash Pandas, Baseball Club",
        ageLevel: 11,
        season: { season: "fall", year: 2026 },
        city: "Georgetown",
        state: "KY",
        playerCount: 12,
      },
      {
        teamId: TEAM_ID,
        name: "NV Stars 9u Scout",
        ageLevel: 9,
        season: { season: "fall", year: 2026 },
        city: "Georgetown",
        state: "KY",
        playerCount: 10,
      },
      // A blank Player Count cell leaves the field off rather than reading as a roster of nobody.
      { teamId: "Ab12Cd34Ef56", name: "Blank Age", season: { season: "spring", year: 2027 } },
      {
        teamId: "Zy98Xw76Vu54",
        name: "Nineteen",
        ageLevel: 19,
        season: { season: "winter", year: 2026 },
        city: "Louisville",
        state: "KY",
        playerCount: 9,
      },
    ]);
    // The row with no id and the duplicate produce nothing; the header and blank line are not "skipped".
    expect(skipped).toHaveLength(2);
    expect(skipped[0]).toContain("No Id Here");
    expect(skipped[1]).toContain("Dupe");
  });

  it("accepts the columns in any order and falls back to the URL column for the id", () => {
    const text = [
      "State,GameChanger URL,Season,Team Name,Age Group",
      "KY,https://web.gc.com/teams/gsUthn4XoIxS/2026-fall-nv-stars-9u-scout/schedule,fall 2026,NV Stars,9u",
    ].join("\n");
    expect(parseGcTeamList(text)).toEqual({
      entries: [
        {
          teamId: TEAM_ID,
          name: "NV Stars",
          ageLevel: 9,
          season: { season: "fall", year: 2026 },
          state: "KY",
        },
      ],
      skipped: [],
    });
  });

  it("reads a tab-separated paste from a spreadsheet", () => {
    const text = ["Team Name\tTeam ID\tAge Group", "NV Stars\tgsUthn4XoIxS\t9U"].join("\n");
    expect(parseGcTeamList(text).entries).toEqual([
      { teamId: TEAM_ID, name: "NV Stars", ageLevel: 9 },
    ]);
  });

  it("reads a headerless list of ids and URLs, however they are separated", () => {
    const text = [
      "zjvVkYnqLrf0",
      "https://web.gc.com/teams/gsUthn4XoIxS/2026-fall-nv-stars-9u-scout/schedule, Ab12Cd34Ef56 Zy98Xw76Vu54",
      "not an id",
      "  ",
      "zjvVkYnqLrf0",
    ].join("\n");
    const { entries, skipped } = parseGcTeamList(text);
    expect(entries.map((entry) => entry.teamId)).toEqual([
      "zjvVkYnqLrf0",
      TEAM_ID,
      "Ab12Cd34Ef56",
      "Zy98Xw76Vu54",
    ]);
    expect(skipped).toEqual(["not an id", "zjvVkYnqLrf0"]);
  });

  it("drops plain words on a line that also carries a real-looking id", () => {
    // Spreadsheet rows pasted without their header: the city is 10 letters, the id wins.
    const text = "Trash Pandas,zjvVkYnqLrf0,11U,Fall 2026,Georgetown,KY";
    expect(parseGcTeamList(text).entries).toEqual([{ teamId: "zjvVkYnqLrf0" }]);
  });

  it("still takes a lone alphabetic token as an id (the API is the judge)", () => {
    expect(parseGcTeamList("abcdefghijkl").entries).toEqual([{ teamId: "abcdefghijkl" }]);
  });

  it("returns nothing for empty input", () => {
    expect(parseGcTeamList("")).toEqual({ entries: [], skipped: [] });
    expect(parseGcTeamList("\n\n")).toEqual({ entries: [], skipped: [] });
  });
});

describe("the season being played", () => {
  const is = (season: "fall" | "winter" | "spring" | "summer", year: number, today: string) =>
    gcSeasonIsCurrent({ season, year }, today);

  it("is the one the calendar is in", () => {
    expect(is("fall", 2026, "2026-09-23")).toBe(true);
    expect(is("summer", 2026, "2026-09-23")).toBe(false);
    expect(is("spring", 2027, "2026-09-23")).toBe(false);
    expect(is("fall", 2025, "2026-09-23")).toBe(false);
  });

  // A spring league still finishing in June, or a fall one starting in August, is either.
  it("counts both seasons where they overlap", () => {
    expect(is("summer", 2026, "2026-08-15")).toBe(true);
    expect(is("fall", 2026, "2026-08-15")).toBe(true);
    expect(is("spring", 2026, "2026-06-10")).toBe(true);
    expect(is("summer", 2026, "2026-06-10")).toBe(true);
  });

  it("runs winter over the new year, under either year's label", () => {
    expect(is("winter", 2026, "2026-12-10")).toBe(true);
    expect(is("winter", 2027, "2026-12-10")).toBe(true);
    expect(is("winter", 2026, "2027-01-15")).toBe(true);
    expect(is("winter", 2027, "2027-01-15")).toBe(true);
    expect(is("winter", 2025, "2027-01-15")).toBe(false);
    expect(is("winter", 2026, "2026-09-23")).toBe(false);
  });

  // Not knowing the day is not a reason to stop asking about a team.
  it("counts any season as current on a day it cannot read", () => {
    expect(is("spring", 2020, "someday")).toBe(true);
  });
});

describe("an age a name writes, rankable or not", () => {
  it("reads the number in front of or behind the U", () => {
    expect(ageWrittenInName("5U Pirates")).toBe(5);
    expect(ageWrittenInName("Cubs 4U")).toBe(4);
    expect(ageWrittenInName("U9 Bandits")).toBe(9);
    expect(ageWrittenInName("Aces")).toBeUndefined();
  });
});

describe("seasons", () => {
  it("parses season labels with a four-digit year", () => {
    expect(parseGcSeasonLabel("Fall 2026")).toEqual({ season: "fall", year: 2026 });
    expect(parseGcSeasonLabel("fall 2026")).toEqual({ season: "fall", year: 2026 });
    expect(parseGcSeasonLabel("2027-spring")).toEqual({ season: "spring", year: 2027 });
    expect(parseGcSeasonLabel("Winter 2026-2027")).toEqual({ season: "winter", year: 2026 });
    expect(parseGcSeasonLabel("Summer 2026")).toEqual({ season: "summer", year: 2026 });
    expect(parseGcSeasonLabel("Autumn 2026")).toEqual({ season: "fall", year: 2026 });
  });

  it("rejects two-digit years, missing seasons and blanks", () => {
    expect(parseGcSeasonLabel("Spring 27")).toBeNull();
    expect(parseGcSeasonLabel("2026")).toBeNull();
    expect(parseGcSeasonLabel("Fall")).toBeNull();
    expect(parseGcSeasonLabel("")).toBeNull();
  });

  it("formats and round-trips", () => {
    expect(formatGcSeason({ season: "fall", year: 2026 })).toBe("Fall 2026");
    expect(formatGcSeason({ season: "spring", year: 2027 })).toBe("Spring 2027");
    expect(parseGcSeasonLabel(formatGcSeason({ season: "winter", year: 2026 }))).toEqual({
      season: "winter",
      year: 2026,
    });
  });

  it("maps a GameChanger season onto the squad year", () => {
    expect(squadYearForGcSeason({ season: "fall", year: 2026 })).toBe(2027);
    expect(squadYearForGcSeason({ season: "winter", year: 2026 })).toBe(2027);
    expect(squadYearForGcSeason({ season: "spring", year: 2027 })).toBe(2027);
    expect(squadYearForGcSeason({ season: "summer", year: 2027 })).toBe(2027);
  });
});

describe("age levels", () => {
  it("parses strict age labels", () => {
    expect(parseGcAgeLevel("9U")).toBe(9);
    expect(parseGcAgeLevel("9u")).toBe(9);
    expect(parseGcAgeLevel("U9")).toBe(9);
    expect(parseGcAgeLevel("11U")).toBe(11);
    expect(parseGcAgeLevel(" 12 U ")).toBe(12);
    expect(parseGcAgeLevel("19U")).toBe(19);
    expect(parseGcAgeLevel("9")).toBe(9);
    expect(parseGcAgeLevel(11)).toBe(11);
  });

  it("returns undefined for blanks, prose and out-of-range values", () => {
    expect(parseGcAgeLevel("")).toBeUndefined();
    expect(parseGcAgeLevel(undefined)).toBeUndefined();
    expect(parseGcAgeLevel(null)).toBeUndefined();
    expect(parseGcAgeLevel("Varsity")).toBeUndefined();
    expect(parseGcAgeLevel("9u Astros")).toBeUndefined();
    expect(parseGcAgeLevel("20U")).toBeUndefined();
    expect(parseGcAgeLevel("5U")).toBeUndefined();
    expect(parseGcAgeLevel(4)).toBeUndefined();
    expect(parseGcAgeLevel(9.5)).toBeUndefined();
  });

  it("reads a two-age bracket as the older of the two", () => {
    // A bracket that admits twelve-year-olds is a 12U bracket. Calling such a team 11U would make
    // every game it plays against a 12U side read as playing up. 731 teams in one 48,035-row
    // export carry one of these.
    expect(parseGcAgeLevel("11U/12U")).toBe(12);
    expect(parseGcAgeLevel("9U/10U")).toBe(10);
    expect(parseGcAgeLevel("17U/18U")).toBe(18);
    // Written the other way round, which really happens: "11U/10U" and "12U/11U" are both in the
    // export. The rule is oldest, not last.
    expect(parseGcAgeLevel("11U/10U")).toBe(11);
    expect(parseGcAgeLevel("12U/11U")).toBe(12);
    // Non-adjacent brackets, and more than two.
    expect(parseGcAgeLevel("10U/12U")).toBe(12);
    expect(parseGcAgeLevel("9U/11U/13U")).toBe(13);
    // Other separators and spacing.
    expect(parseGcAgeLevel("13u - 14u")).toBe(14);
    expect(parseGcAgeLevel("10-12")).toBe(12);
  });

  it("reads the tier letters travel ball hangs off a level as part of the label", () => {
    // "12UA" is a 12U team in the A tier, not a different age. No row in a 48,035-team export
    // carries one in the age column; this is here so the column and the name agree on purpose
    // rather than by accident.
    expect(parseGcAgeLevel("12UA")).toBe(12);
    expect(parseGcAgeLevel("11uaa")).toBe(11);
    expect(parseGcAgeLevel("11UA/12UB")).toBe(12);
    expect(ageLevelFromName("Bandits 12UA Fall")).toBe(12);
    // Still not a level: the letters have to be a tier, and they have to follow the U.
    expect(parseGcAgeLevel("12UNDER")).toBeUndefined();
    expect(parseGcAgeLevel("12ZZ")).toBeUndefined();
    expect(ageLevelFromName("Team 9abc/10U")).toBe(10);
  });

  it("will not read a pair of numbers that are not both ages as a bracket", () => {
    // Half a label is not a level: one unreadable part makes the whole value unknown, so a season
    // span or a division pair stays undefined rather than becoming a guess.
    expect(parseGcAgeLevel("2026-2027")).toBeUndefined();
    expect(parseGcAgeLevel("Varsity/JV")).toBeUndefined();
    expect(parseGcAgeLevel("9U/Varsity")).toBeUndefined();
    expect(parseGcAgeLevel("9U/20U")).toBeUndefined();
    expect(parseGcAgeLevel("9U/5U")).toBeUndefined();
  });

  it("reads a bracket written into the name the same way", () => {
    expect(ageLevelFromName("Braves 9u/10u Fall")).toBe(10);
    expect(ageLevelFromName("Astros (9U/10U)")).toBe(10);
    expect(ageLevelFromName("AZ Core 17U/18U")).toBe(18);
    expect(ageLevelFromName("9U/10U Orioles Fall26")).toBe(10);
    // The shorthand where only the second age carries its U.
    expect(ageLevelFromName("OM 9/10U Fall 2026 White - Malone")).toBe(10);
    expect(ageLevelFromName("Alvey 9U/10U | King Coconuts")).toBe(10);
  });

  it("reads both ends of a bracket, not just the one it files the team at", () => {
    // The older end is the level; the pair is what says the level came from a bracket at all,
    // which is what lets it outrank the age field and what takes the whole thing off the name.
    expect(ageSpanFromName("Premier Ohio Lopez 9U/10U")).toEqual({ low: 9, high: 10 });
    expect(ageSpanFromName("13u - 14u Bandits")).toEqual({ low: 13, high: 14 });
    // Written the other way round, which really happens: the ends are sorted, not assumed.
    expect(ageSpanFromName("Heat 12U/11U")).toEqual({ low: 11, high: 12 });
    expect(ageSpanFromName("OM 9/10U Fall 2026 White - Malone")).toEqual({ low: 9, high: 10 });
    expect(ageSpanFromName("11UA/12UB Rebels")).toEqual({ low: 11, high: 12 });
    // One age, no age, and a pair of numbers that is not a bracket.
    expect(ageSpanFromName("Trash Pandas 9u")).toBeUndefined();
    expect(ageSpanFromName("Mears 1 - 2026")).toBeUndefined();
    expect(ageSpanFromName("")).toBeUndefined();
  });

  it("does not mistake a stray pair of numbers in a name for a bracket", () => {
    // The second age has to carry the U, which is what keeps these out.
    expect(ageLevelFromName("Mears 1 - 2026")).toBeUndefined();
    expect(ageLevelFromName("Mirror Lake 2 2026")).toBeUndefined();
    // A single label still wins when there is no bracket, unchanged from before.
    expect(ageLevelFromName("AZ Venom 11U 2027")).toBe(11);
    expect(ageLevelFromName("2026 Fall Trosky Illinois 9U")).toBe(9);
  });

  it("finds an age label inside a team name", () => {
    expect(ageLevelFromName("9u Astros")).toBe(9);
    expect(ageLevelFromName("NV Stars 9u Scout")).toBe(9);
    expect(ageLevelFromName("9U North Oldham Knights - Navy")).toBe(9);
    expect(ageLevelFromName("U11 Bandits")).toBe(11);
    expect(ageLevelFromName("Team 12 U Elite")).toBe(12);
    expect(ageLevelFromName("Trash Pandas")).toBeUndefined();
    expect(ageLevelFromName("2026 Fall Squad")).toBeUndefined();
    expect(ageLevelFromName("")).toBeUndefined();
  });
});

describe("ageLevelOf", () => {
  /** Fall 2026 is squad year 2027, which is the season the team in these cases is playing. */
  const SQUAD_YEAR = 2027;

  it("files a squad whose name spells out a bracket at the older end, over the age field", () => {
    /*
     * Premier Ohio Lopez 9U/10U, Fall 2026, whose GameChanger age field says 9U. The field holds
     * one value picked from a dropdown and the name holds the whole bracket, so the two are not
     * in conflict so much as one is half the other. Filed at 9U, every game the squad played in
     * its own bracket read as playing up, and the rating carried an advantage it had not earned.
     */
    expect(ageLevelOf("9U", "Premier Ohio Lopez 9U/10U", SQUAD_YEAR)).toBe(10);
    // The same answer however the field is filled in, including not at all.
    expect(ageLevelOf("10U", "Premier Ohio Lopez 9U/10U", SQUAD_YEAR)).toBe(10);
    expect(ageLevelOf("", "Premier Ohio Lopez 9U/10U", SQUAD_YEAR)).toBe(10);
    expect(ageLevelOf(undefined, "Premier Ohio Lopez 9U/10U", SQUAD_YEAR)).toBe(10);
    // And a field that disagrees outright is still a field: the bracket is what the team wrote.
    expect(ageLevelOf("12U", "Premier Ohio Lopez 9U/10U", SQUAD_YEAR)).toBe(10);
  });

  it("keeps the age field ahead of a single label in the name", () => {
    // Unchanged, and deliberately: one age in a name is somebody's typing, while the field is the
    // same somebody answering the question outright. Only a bracket says more than the field does.
    expect(ageLevelOf("9U", "Aces 10U", SQUAD_YEAR)).toBe(9);
    // A graduating class in the field outranks a label in the name for the same reason.
    expect(ageLevelOf("2029", "Aces 10U", SQUAD_YEAR)).toBe(16);
    // An unreadable field falls through to the name, as before.
    expect(ageLevelOf("Varsity", "Aces 10U", SQUAD_YEAR)).toBe(10);
    expect(ageLevelOf("", "Aces 10U", SQUAD_YEAR)).toBe(10);
  });

  it("falls to a graduating class in the name, and then to no level at all", () => {
    expect(ageLevelOf("", "Midwest Nationals 2030", SQUAD_YEAR)).toBe(15);
    // A year too near the season is a season, not a class, so this is a team with no age.
    expect(ageLevelOf("", "Warriors Spring 2027", SQUAD_YEAR)).toBeUndefined();
    expect(ageLevelOf("", "Trash Pandas", SQUAD_YEAR)).toBeUndefined();
    // No squad year, so neither class reading is available to try.
    expect(ageLevelOf("", "Midwest Nationals 2030", undefined)).toBeUndefined();
  });

  it("reads a profile and the list row naming it as one age", () => {
    // The two climb the same ladder because they call the same function; a row and the team it
    // names disagreeing about the age is what that is there to stop.
    const profile = normalizeGcTeamProfile({
      ...profileFixture,
      name: "Premier Ohio Lopez 9U/10U",
      age_group: "9U",
    });
    expect(profile?.ageLevel).toBe(10);
    // What GameChanger actually filed it under is still kept, because the level is now a reading.
    expect(profile?.ageLabel).toBe("9U");

    const { entries } = parseGcTeamList(
      [
        "Team Name,Team ID,Age Group,Season",
        "Premier Ohio Lopez 9U/10U,gK5JSTKGwRYz,9U,Fall 2026",
      ].join("\n")
    );
    expect(entries[0]!.ageLevel).toBe(10);
  });
});

describe("avatarKeyFromUrl", () => {
  it("returns the media id segment of a media-service URL, with or without the signed query", () => {
    expect(
      avatarKeyFromUrl(
        "https://media-service.gc.com/e3157726-26f9-464c-9fa7-dab8e0fc0a03?Policy=abc&Signature=def"
      )
    ).toBe("e3157726-26f9-464c-9fa7-dab8e0fc0a03");
    expect(
      avatarKeyFromUrl("https://media-service.gc.com/5192a689-d888-4ae5-abce-446885dca7c7")
    ).toBe("5192a689-d888-4ae5-abce-446885dca7c7");
    expect(avatarKeyFromUrl("//media-service.gc.com/abc123/thumb.png")).toBe("abc123");
  });

  it("returns undefined for other hosts and non-strings", () => {
    expect(avatarKeyFromUrl("https://example.com/e3157726")).toBeUndefined();
    expect(avatarKeyFromUrl("https://media-service.gc.com/")).toBeUndefined();
    expect(avatarKeyFromUrl(undefined)).toBeUndefined();
    expect(avatarKeyFromUrl(null)).toBeUndefined();
    expect(avatarKeyFromUrl(12)).toBeUndefined();
  });
});

describe("localDateInZone", () => {
  it("computes the calendar date in the schedule's zone, not UTC", () => {
    expect(localDateInZone("2026-09-12T23:00:00.000Z", "America/New_York")).toBe("2026-09-12");
    expect(localDateInZone("2026-09-13T03:30:00.000Z", "America/New_York")).toBe("2026-09-12");
    expect(localDateInZone("2026-09-13T03:30:00.000Z", "UTC")).toBe("2026-09-13");
    expect(localDateInZone("2026-01-01T02:00:00.000Z", "America/Los_Angeles")).toBe("2025-12-31");
    expect(localDateInZone("2026-09-12T23:00:00.000Z", "Asia/Tokyo")).toBe("2026-09-13");
  });

  it("falls back to UTC for a missing or unknown zone", () => {
    expect(localDateInZone("2026-09-12T23:00:00.000Z")).toBe("2026-09-12");
    expect(localDateInZone("2026-09-12T23:00:00.000Z", "Mars/Olympus_Mons")).toBe("2026-09-12");
    expect(localDateInZone("2026-09-13T03:30:00.000Z", "")).toBe("2026-09-13");
  });

  it("passes a bare date through and rejects garbage", () => {
    expect(localDateInZone("2026-08-22", "America/New_York")).toBe("2026-08-22");
    expect(localDateInZone("not a date", "America/New_York")).toBeUndefined();
    expect(localDateInZone("", "America/New_York")).toBeUndefined();
  });
});

describe("normalizeGcTeamProfile", () => {
  it("normalizes the captured profile", () => {
    expect(normalizeGcTeamProfile(profileFixture)).toEqual({
      id: TEAM_ID,
      name: "NV Stars 9u Scout",
      sport: "baseball",
      city: "Georgetown",
      state: "KY",
      ageLabel: "9U",
      ageLevel: 9,
      season: { season: "fall", year: 2026 },
      record: { win: 11, loss: 1, tie: 0 },
      avatarKey: "5192a689-d888-4ae5-abce-446885dca7c7",
      playerCount: 10,
      // Both of these were in the capture from the start and neither was read: the sanctioning
      // body, which is the only thing that says whether "Majors" is an age or a skill class, and
      // the coaches, which are the strongest club-matching signal the app has.
      ngb: ["usssa"],
      staff: ["Noochie Varner", "Jordan Fox", "Tyler Coons"],
    });
  });

  /*
   * Both of these were in the captured profile from the beginning and neither was read, because
   * a comment on `GcTeamSchedule.listed` said the public endpoints return neither and the code
   * believed it.
   */
  it("keeps the coaches the profile names, tidied the way a pasted cell is", () => {
    const doubled = normalizeGcTeamProfile({
      ...profileFixture,
      staff: ["Noochie  Varner", "NOOCHIE VARNER", "", 7, "Jordan Fox"],
    });
    expect(doubled?.staff).toEqual(["Noochie Varner", "Jordan Fox"]);
    const none = normalizeGcTeamProfile({ ...profileFixture, staff: [] });
    expect(none?.staff).toBeUndefined();
  });

  it("keeps what GameChanger filed the team under, readable or not", () => {
    /*
     * The parse is lossy on purpose — a bracket, a graduation year and an empty field all come out
     * as "no level" — and the label is the only evidence of which. Thousands of teams reach the
     * pool with no level, and what to do about them depends entirely on this string.
     */
    const bracket = normalizeGcTeamProfile({ ...profileFixture, age_group: "11U/12U" });
    expect(bracket?.ageLabel).toBe("11U/12U");
    // The fixture's season is Fall 2026, so squad year 2027 — and the class of 2027 are seniors.
    const gradYear = normalizeGcTeamProfile({ ...profileFixture, age_group: "2027", name: "Rays" });
    expect(gradYear?.ageLabel).toBe("2027");
    expect(gradYear?.ageLevel).toBe(18);
    const blank = normalizeGcTeamProfile({ ...profileFixture, age_group: "", name: "Rays" });
    expect(blank?.ageLabel).toBeUndefined();
  });

  it("falls back to the age label in the name when age_group is blank", () => {
    const profile = normalizeGcTeamProfile({ ...profileFixture, age_group: "", name: "9u Astros" });
    expect(profile?.ageLevel).toBe(9);
    expect(profile?.name).toBe("9u Astros");
  });

  it("prefers age_group over the name when both are present", () => {
    const profile = normalizeGcTeamProfile({
      ...profileFixture,
      age_group: "10U",
      name: "9u Astros",
    });
    expect(profile?.ageLevel).toBe(10);
  });

  it("leaves optional fields out when GameChanger does not send them", () => {
    expect(normalizeGcTeamProfile({ id: "Ab12Cd34Ef56", name: "Mystery Team" })).toEqual({
      id: "Ab12Cd34Ef56",
      name: "Mystery Team",
    });
  });

  it("uses the fallback id when the body has none, and unwraps an envelope", () => {
    expect(normalizeGcTeamProfile({ name: "Wrapped" }, "Ab12Cd34Ef56")).toEqual({
      id: "Ab12Cd34Ef56",
      name: "Wrapped",
    });
    expect(normalizeGcTeamProfile({ data: { id: "Ab12Cd34Ef56", name: "Inner" } })).toEqual({
      id: "Ab12Cd34Ef56",
      name: "Inner",
    });
  });

  it("returns null for bodies that are not a profile", () => {
    expect(normalizeGcTeamProfile(null)).toBeNull();
    expect(normalizeGcTeamProfile("nope")).toBeNull();
    expect(normalizeGcTeamProfile([])).toBeNull();
    expect(normalizeGcTeamProfile({ foo: 1 })).toBeNull();
    expect(normalizeGcTeamProfile({ id: "Ab12Cd34Ef56" })).toBeNull();
    expect(normalizeGcTeamProfile({ name: "No id anywhere" })).toBeNull();
  });

  it("ignores a season it cannot read rather than inventing one", () => {
    const profile = normalizeGcTeamProfile({
      id: "Ab12Cd34Ef56",
      name: "Odd",
      team_season: { season: "monsoon", year: 2026, record: { win: "3", loss: "2" } },
    });
    expect(profile?.season).toBeUndefined();
    expect(profile?.record).toEqual({ win: 3, loss: 2, tie: 0 });
  });
});

/**
 * The sanctioning body, which is the only field in the payload that says whose word a division
 * word is. It arrives in a shape nothing should produce — a JSON array inside a string — so it is
 * read leniently and refuses rather than guesses when it is anything else.
 */
describe("parseGcNgb", () => {
  it("reads the shape GameChanger actually sends", () => {
    expect(parseGcNgb('["usssa"]')).toEqual(["usssa"]);
    expect(parseGcNgb('["little league","usssa"]')).toEqual(["little league", "usssa"]);
  });

  it("reads a bare string and a real array too", () => {
    expect(parseGcNgb("usssa")).toEqual(["usssa"]);
    expect(parseGcNgb(["USSSA", "Pony"])).toEqual(["usssa", "pony"]);
  });

  // Compared against, never shown, so the answer must not turn on case or spacing.
  it("lowercases, collapses spacing and counts a repeat once", () => {
    expect(parseGcNgb('["Little  League","LITTLE LEAGUE"]')).toEqual(["little league"]);
    expect(parseGcNgb(["  usssa  "])).toEqual(["usssa"]);
  });

  it("is empty for anything it cannot read", () => {
    expect(parseGcNgb(undefined)).toEqual([]);
    expect(parseGcNgb("")).toEqual([]);
    expect(parseGcNgb("[not json")).toEqual([]);
    expect(parseGcNgb('["", "  "]')).toEqual([]);
    expect(parseGcNgb(7)).toEqual([]);
    expect(parseGcNgb({ ngb: "usssa" })).toEqual([]);
  });
});

describe("normalizeGcGameStatus", () => {
  it("maps the words GameChanger uses", () => {
    expect(normalizeGcGameStatus("completed", true)).toBe("completed");
    expect(normalizeGcGameStatus("Final", true)).toBe("completed");
    expect(normalizeGcGameStatus("completed", false)).toBe("completed");
    expect(normalizeGcGameStatus("canceled", false)).toBe("canceled");
    expect(normalizeGcGameStatus("cancelled", false)).toBe("canceled");
    expect(normalizeGcGameStatus("postponed", false)).toBe("canceled");
    expect(normalizeGcGameStatus("forfeit", true)).toBe("canceled");
    expect(normalizeGcGameStatus("in_progress", false)).toBe("in_progress");
    expect(normalizeGcGameStatus("In Progress", false)).toBe("in_progress");
    expect(normalizeGcGameStatus("scheduled", false)).toBe("scheduled");
  });

  it("reads a missing status from the scores and leaves strangers unknown", () => {
    expect(normalizeGcGameStatus(undefined, true)).toBe("completed");
    expect(normalizeGcGameStatus(null, false)).toBe("scheduled");
    expect(normalizeGcGameStatus("", false)).toBe("scheduled");
    expect(normalizeGcGameStatus("weather_hold", false)).toBe("unknown");
    expect(normalizeGcGameStatus("weather_hold", true)).toBe("unknown");
    expect(normalizeGcGameStatus(7, false)).toBe("scheduled");
  });
});

describe("normalizeGcGames", () => {
  const games = normalizeGcGames(gamesFixture);

  it("reads every captured game", () => {
    expect(games).toHaveLength(12);
    expect(games.every((game) => game.status === "completed")).toBe(true);
    expect(games.every((game) => game.timezone === "America/New_York")).toBe(true);
  });

  it("normalizes the first game with its opponent avatar", () => {
    const first: GcGame = {
      id: "59cdce43-a346-4c2f-b06f-1a0b21ba3fdc",
      date: "2026-08-22",
      startTs: "2026-08-22T20:30:00.000Z",
      timezone: "America/New_York",
      opponentName: "NKY Sluggers 9U",
      opponentAvatarKey: "e3157726-26f9-464c-9fa7-dab8e0fc0a03",
      homeAway: "away",
      teamScore: 12,
      opponentScore: 2,
      status: "completed",
      rawStatus: "completed",
    };
    expect(games[0]).toEqual(first);
  });

  it("leaves the avatar key out for an opponent without one", () => {
    const ambush = games.find((game) => game.id.startsWith("84901410"));
    expect(ambush).toEqual({
      id: "84901410-8dee-4ab1-8650-0d6a85f6639e",
      date: "2026-08-22",
      startTs: "2026-08-22T22:00:00.000Z",
      timezone: "America/New_York",
      opponentName: "Ambush 9U",
      homeAway: "home",
      teamScore: 12,
      opponentScore: 2,
      status: "completed",
      rawStatus: "completed",
    });
    expect(ambush).not.toHaveProperty("opponentAvatarKey");
  });

  it("dates an evening game on its Kentucky day, not the UTC one", () => {
    const evening = games.find((game) => game.id.startsWith("f19046f2"));
    expect(evening?.startTs).toBe("2026-09-12T23:00:00.000Z");
    expect(evening?.date).toBe("2026-09-12");
    const late = games.find((game) => game.id.startsWith("91fa47c0"));
    expect(late?.startTs).toBe("2026-09-13T22:30:00.000Z");
    expect(late?.date).toBe("2026-09-13");
    expect(late?.teamScore).toBe(7);
    expect(late?.opponentScore).toBe(16);
  });

  it("shares an avatar key between two games against the same opponent", () => {
    const knights = games.filter((game) => game.opponentName === "9U North Oldham Knights - Navy");
    expect(knights).toHaveLength(2);
    expect(new Set(knights.map((game) => game.opponentAvatarKey))).toEqual(
      new Set(["e24833fb-64dd-4f84-a4de-9ac709e0cf63"])
    );
  });

  /*
   * An all-day entry has a date and no time. GameChanger writes a start for one anyway: in the
   * user's audit of 24 September 2026, midnight UTC and no timezone. Read as a time, that is the
   * same instant for every all-day game on the day.
   */
  it("keeps an all-day entry's date and drops its placeholder time", () => {
    const allDay = (id: string, timezone: string | null) => ({
      id,
      opponent_team: { name: "Blue Ridge Elite 2028" },
      is_full_day: true,
      start_ts: "2026-09-12T00:00:00.000Z",
      timezone,
      score: { team: 7, opponent_team: 0 },
      game_status: "completed",
    });
    const [noZone, withZone, timed] = normalizeGcGames([
      allDay("d1", null),
      // Midnight UTC is the evening before in New York; the placeholder names the day in UTC.
      allDay("d2", "America/New_York"),
      {
        id: "t1",
        opponent_team: { name: "Blue Ridge Elite 2028" },
        is_full_day: false,
        start_ts: "2026-09-12T14:15:00.000Z",
        timezone: "America/New_York",
        score: { team: 7, opponent_team: 0 },
        game_status: "completed",
      },
    ]);
    expect(noZone?.startTs).toBeUndefined();
    expect(noZone?.date).toBe("2026-09-12");
    expect(withZone?.startTs).toBeUndefined();
    expect(withZone?.date).toBe("2026-09-12");
    expect(timed?.startTs).toBe("2026-09-12T14:15:00.000Z");
    expect(timed?.date).toBe("2026-09-12");
  });

  /*
   * Every entry's id, the ones read as games or not: a pull tells a row its schedule dropped from
   * one it listed in a shape this app cannot read, and only the first may take a game away.
   */
  it("lists the id of every entry, read as a game or not", () => {
    const raw = [
      { id: "g1", opponent_team: { name: "Read 9U" }, start_ts: "2026-10-03T18:00:00.000Z" },
      { id: "g2", opponent_team: null, start_ts: "2026-10-04T18:00:00.000Z" },
      { opponent_team: { name: "No Id 9U" } },
      "not an entry",
    ];
    expect(normalizeGcGames(raw).map((game) => game.id)).toEqual(["g1"]);
    expect(gcGameIdsFrom(raw)).toEqual(["g1", "g2"]);
    expect(gcGameIdsFrom({ games: raw })).toEqual(["g1", "g2"]);
    expect(gcGameIdsFrom(null)).toEqual([]);
  });

  it("reads scheduled games without scores and canceled ones", () => {
    const list = normalizeGcGames([
      {
        id: "s1",
        opponent_team: { name: "Future Foes 9U" },
        start_ts: "2026-10-03T18:00:00.000Z",
        timezone: "America/New_York",
        home_away: "home",
        score: null,
        game_status: "scheduled",
      },
      {
        id: "c1",
        opponent_team: { name: "Rained Out 9U" },
        start_ts: "2026-10-04T18:00:00.000Z",
        timezone: "America/New_York",
        game_status: "canceled",
      },
      {
        id: "u1",
        opponent_team: { name: "No Status 9U" },
        start_ts: "2026-10-05T18:00:00.000Z",
        timezone: "America/New_York",
        score: { team: 4, opponent_team: 4 },
      },
    ]);
    expect(list).toEqual([
      {
        id: "s1",
        date: "2026-10-03",
        startTs: "2026-10-03T18:00:00.000Z",
        timezone: "America/New_York",
        opponentName: "Future Foes 9U",
        homeAway: "home",
        status: "scheduled",
        rawStatus: "scheduled",
      },
      {
        id: "c1",
        date: "2026-10-04",
        startTs: "2026-10-04T18:00:00.000Z",
        timezone: "America/New_York",
        opponentName: "Rained Out 9U",
        status: "canceled",
        rawStatus: "canceled",
      },
      {
        id: "u1",
        date: "2026-10-05",
        startTs: "2026-10-05T18:00:00.000Z",
        timezone: "America/New_York",
        opponentName: "No Status 9U",
        teamScore: 4,
        opponentScore: 4,
        status: "completed",
      },
    ]);
  });

  it("accepts the list wrapped in an object and skips unreadable entries", () => {
    const wrapped = normalizeGcGames({ games: [gamesFixture[0], null, { id: "x" }, "junk", 7] });
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.id).toBe("59cdce43-a346-4c2f-b06f-1a0b21ba3fdc");
    expect(normalizeGcGames({ events: [gamesFixture[1]] })).toHaveLength(1);
    expect(normalizeGcGames({ data: [gamesFixture[2]] })).toHaveLength(1);
    expect(normalizeGcGames({ items: [gamesFixture[3]] })).toHaveLength(1);
  });

  it("returns an empty list for bodies that hold no list", () => {
    expect(normalizeGcGames(null)).toEqual([]);
    expect(normalizeGcGames("nope")).toEqual([]);
    expect(normalizeGcGames({ foo: 1 })).toEqual([]);
    expect(normalizeGcGames([])).toEqual([]);
  });

  it("skips a practice slot with no opponent", () => {
    expect(
      normalizeGcGames([
        { id: "p1", start_ts: "2026-10-03T18:00:00.000Z", timezone: "America/New_York" },
      ])
    ).toEqual([]);
  });
});

describe("age labels travel ball actually uses", () => {
  // Every one of these came out of a real GameChanger export with a blank Age Group column: the
  // level is in the name, and the tier letter sits right against it.
  it("reads a level through its tier suffix", () => {
    expect(ageLevelFromName("9UA Tortugas")).toBe(9);
    expect(ageLevelFromName("9UB Sus Goats")).toBe(9);
    expect(ageLevelFromName("WPPA 9UA Cougars")).toBe(9);
    expect(ageLevelFromName("Base Invaders Welles Park 9UB")).toBe(9);
    expect(ageLevelFromName("Frisco Dodgers - Gomez 11UAA")).toBe(11);
    expect(ageLevelFromName("Thunder 10ud")).toBe(10);
  });

  it("still reads the plain labels", () => {
    expect(ageLevelFromName("9u Astros 9U")).toBe(9);
    expect(ageLevelFromName("Trash Pandas 9u")).toBe(9);
    expect(ageLevelFromName("U11 Bandits")).toBe(11);
    expect(ageLevelFromName("Kilbourne 19U Fall Ball")).toBe(19);
  });

  // The suffix is letters the tier uses, not any word starting with one, so a longer word still
  // ends the label rather than being swallowed into it.
  it("does not invent a level out of a longer word", () => {
    expect(ageLevelFromName("12UNDER Bandits")).toBeUndefined();
    expect(ageLevelFromName("Team Umpire 9")).toBeUndefined();
    expect(ageLevelFromName("Wildcats")).toBeUndefined();
  });
});

describe("parseGcTeamList against a real export", () => {
  const csv = teamListCsv;

  it("reads every row of the file people actually have", () => {
    const { entries, skipped } = parseGcTeamList(csv);
    expect(skipped).toEqual([]);
    expect(entries).toHaveLength(6);
    // The BOM a spreadsheet writes must not end up glued to the first header.
    expect(entries[0]?.teamId).toBe("aGLfkW4E22sm");
  });

  it("falls back to the name when the age column is blank", () => {
    const { entries } = parseGcTeamList(csv);
    const tortugas = entries.find((entry) => entry.teamId === "aGLfkW4E22sm");
    expect(tortugas?.ageLevel).toBe(9);
    const dodgers = entries.find((entry) => entry.teamId === "ghoY0z3UvrY9");
    expect(dodgers?.ageLevel).toBe(11);
  });

  it("keeps the rest of the row", () => {
    const { entries } = parseGcTeamList(csv);
    const astros = entries.find((entry) => entry.teamId === "hH8l9MBjxg7U");
    expect(astros).toMatchObject({
      name: "9u Astros 9U",
      ageLevel: 9,
      city: "Baileyton",
      state: "AL",
      season: { season: "fall", year: 2026 },
    });
  });

  // A winter season spanning two years is labelled by the first of them.
  it("reads a two-year winter label as its first year", () => {
    const { entries } = parseGcTeamList(csv);
    const enFuego = entries.find((entry) => entry.teamId === "zjvVkYnqLrf0");
    expect(enFuego?.season).toEqual({ season: "winter", year: 2026 });
  });
});

describe("a 0-0 score", () => {
  it("is no result: GameChanger writes 0-0 where nobody entered a score", () => {
    const [game] = normalizeGcGames([
      {
        id: "z1",
        opponent_team: { name: "Smashers 9U" },
        start_ts: "2026-08-27T18:00:00.000Z",
        timezone: "America/New_York",
        score: { team: 0, opponent_team: 0 },
        game_status: "completed",
      },
    ]);
    expect(game?.teamScore).toBeUndefined();
    expect(game?.opponentScore).toBeUndefined();
  });

  it("leaves a real shutout alone", () => {
    const [game] = normalizeGcGames([
      {
        id: "z2",
        opponent_team: { name: "Smashers 9U" },
        start_ts: "2026-08-27T18:00:00.000Z",
        timezone: "America/New_York",
        score: { team: 0, opponent_team: 6 },
        game_status: "completed",
      },
    ]);
    expect(game?.teamScore).toBe(0);
    expect(game?.opponentScore).toBe(6);
  });
});

describe("reading a graduation year as an age", () => {
  /*
   * The class of 2027 are seniors in the 2026-27 season, which this app files as squad year 2027.
   * Every year further out is a year younger.
   */
  it("puts the graduating class at 18U and counts down from there", () => {
    expect(ageFromGradYear(2027, 2027)).toBe(18);
    expect(ageFromGradYear(2029, 2027)).toBe(16);
    expect(ageFromGradYear(2035, 2027)).toBe(10);
  });

  it("refuses a year that lands on an age nobody plays", () => {
    // 2024 in the 2027 season would be 21U; 2040 would be 5U.
    expect(ageFromGradYear(2024, 2027)).toBeUndefined();
    expect(ageFromGradYear(2040, 2027)).toBeUndefined();
  });

  it("reads a class two years out or further from a name", () => {
    expect(gradYearFromName("Midwest Elite 2029", 2027)).toBe(2029);
    expect(ageFromGradYearInName("Midwest Elite 2029", 2027)).toBe(16);
    expect(ageFromGradYearInName("Nationals 2030 Black", 2027)).toBe(15);
  });

  /*
   * The whole reason for the margin. Measured over a 48,035-team export, a year equal to the
   * season year is a graduation year 0.2% of the time and one year out 44.8%, so anything nearer
   * than two years out is a coin toss between the class of 2028 and next spring's squad — and
   * reading it wrong puts a nine-year-old team at 18U.
   */
  it("refuses a year too near the season to tell from one", () => {
    expect(gradYearFromName("Warriors Spring 2027", 2027)).toBeUndefined();
    expect(gradYearFromName("Warriors 2027", 2027)).toBeUndefined();
    expect(gradYearFromName("Warriors 2028", 2027)).toBeUndefined();
    expect(ageFromGradYearInName("Warriors Spring 2027", 2027)).toBeUndefined();
  });

  it("refuses a season written beside the year, however far out it is", () => {
    expect(gradYearFromName("Warriors Spring 2030", 2027)).toBeUndefined();
    expect(gradYearFromName("Warriors 2030 Fall", 2027)).toBeUndefined();
  });

  it("is not fooled by a town that shares a season's name", () => {
    // "Fall River" is a place, and the season word is nowhere near the year.
    expect(gradYearFromName("Fall River Bandits 2030", 2027)).toBe(2030);
  });

  it("refuses a span of two years, which is a season and never a class", () => {
    expect(gradYearFromName("Bandits 2029-2030", 2027)).toBeUndefined();
    expect(gradYearFromName("Bandits 2029/30", 2027)).toBeUndefined();
  });

  it("refuses two different years, because there is no telling which is the class", () => {
    expect(gradYearFromName("Bandits 2029 Showcase 2031", 2027)).toBeUndefined();
    // The same year twice is still one year.
    expect(gradYearFromName("2030 Bandits 2030", 2027)).toBe(2030);
  });

  it("reads a bare year in the age field without the margin", () => {
    /*
     * A different question from a name. The age field's whole job is to say what age group a team
     * is in, and nobody writes a season into it — so a year there is a graduating class, and the
     * only thing left to check is that it lands on an age that exists.
     */
    expect(ageFromGradYearLabel("2027", 2027)).toBe(18);
    expect(ageFromGradYearLabel("2029", 2027)).toBe(16);
    expect(ageFromGradYearLabel("9U", 2027)).toBeUndefined();
    expect(ageFromGradYearLabel("11U/12U", 2027)).toBeUndefined();
    expect(ageFromGradYearLabel(undefined, 2027)).toBeUndefined();
  });

  it("prefers a stated age to a graduating class, in either place", () => {
    // An age label in the age field beats everything; a label in the name beats a class in it.
    const stated = normalizeGcTeamProfile({
      ...profileFixture,
      age_group: "14U",
      name: "Elite 2031",
    });
    expect(stated?.ageLevel).toBe(14);
    const named = normalizeGcTeamProfile({
      ...profileFixture,
      age_group: "",
      name: "Elite 14U 2031",
    });
    expect(named?.ageLevel).toBe(14);
  });

  it("leaves a team with no season alone, because a class means nothing without one", () => {
    const noSeason = normalizeGcTeamProfile({
      ...profileFixture,
      age_group: "",
      team_season: null,
      season: null,
      name: "Elite 2031",
    });
    expect(noSeason?.ageLevel).toBeUndefined();
  });
});

/**
 * The organization list: the leagues, tournaments and travel clubs the user found.
 *
 * A second file rather than rows mixed into the team list, because an organization id and a team
 * id are the same shape and nothing inside one file could tell them apart.
 */
describe("parseGcOrgList with the teams under each organization", () => {
  // The header and two rows exactly as the Organizations export of 22 September 2026 wrote them.
  const withTeams = [
    "Entity Type,Entity Name,Organization ID,City,State,Season Name,Season Year,Sport,Home URL,Teams URL,Schedule URL,Team Count,Team IDs,Found Via Searches,First Seen,Last Seen",
    '"travel","Strike Out Cancer","001HxWz6qGlu","Oxford","PA","fall","2026","baseball","https://web.gc.com/organizations/001HxWz6qGlu/home","https://web.gc.com/organizations/001HxWz6qGlu/teams","https://web.gc.com/organizations/001HxWz6qGlu/schedule","4","KJz7is1kgzOm; 1AF7a2UggAi7; dGdko0mnt5cg; QjBhPB3gwcb4","zut","2026-09-22T22:39:29.257Z",""',
    '"travel","8U Back To School Ballout 26","00xMigfEP8B5","","","fall","2026","baseball","https://web.gc.com/organizations/00xMigfEP8B5/home","https://web.gc.com/organizations/00xMigfEP8B5/teams","https://web.gc.com/organizations/00xMigfEP8B5/schedule","2","w70w04ngxoIR; D0PvbUNHZLHB; w70w04ngxoIR; not an id","Jack",""',
  ].join("\n");

  it("reads the ids of the teams under each one", () => {
    const { orgs, skipped } = parseGcOrgList(withTeams);
    expect(skipped).toEqual([]);
    expect(orgs[0]?.teamIds).toEqual([
      "KJz7is1kgzOm",
      "1AF7a2UggAi7",
      "dGdko0mnt5cg",
      "QjBhPB3gwcb4",
    ]);
    expect(orgs[0]?.teamCount).toBe(4);
  });

  it("keeps each id once and only what reads as an id", () => {
    expect(parseGcOrgList(withTeams).orgs[1]?.teamIds).toEqual(["w70w04ngxoIR", "D0PvbUNHZLHB"]);
  });

  it("leaves the field off a file with no such column", () => {
    expect(parseGcOrgList(orgListCsv).orgs.every((org) => org.teamIds === undefined)).toBe(true);
  });
});

describe("parseGcOrgList against the real export", () => {
  it("reads every row of the file the user actually has", () => {
    const { orgs, skipped } = parseGcOrgList(orgListCsv);
    expect(skipped).toEqual([]);
    expect(orgs).toHaveLength(3);

    expect(orgs[0]).toEqual({
      orgId: "3sazmL1VgPnC",
      name: "Cincy Legends Baseball",
      kind: "travel",
      city: "Cincinnati",
      state: "OH",
      sport: "baseball",
      season: { season: "spring", year: 2027 },
      teamCount: 12,
    });
  });

  /*
   * The season columns do not always hold what they say. This row reads `Season Name="2027"` with
   * `Season Year` empty — the year landed in the name's cell — so both halves are read from
   * either, and a year with no season word is reported as the half it is rather than dropped.
   */
  it("reads a year that arrived in the season-name column", () => {
    const { orgs } = parseGcOrgList(orgListCsv);
    const league = orgs.find((org) => org.orgId === "Pqy5Av4tHncy");
    expect(league?.season).toBeUndefined();
    expect(league?.seasonYear).toBe(2027);
    expect(league?.kind).toBe("league");
  });

  /*
   * And the names carry ages. A single-age league or tournament says what every team under it
   * plays at, which is the fastest thing in this whole backlog: one row answers a membership.
   */
  it("keeps names an age can be read out of", () => {
    const { orgs } = parseGcOrgList(orgListCsv);
    expect(ageLevelFromName(orgs.find((o) => o.orgId === "Pqy5Av4tHncy")!.name!)).toBe(11);
    expect(ageLevelFromName(orgs.find((o) => o.orgId === "e7BuP4Z9MPM4")!.name!)).toBe(12);
    // A club that runs every age says nothing, and must not be made to.
    expect(ageLevelFromName(orgs.find((o) => o.orgId === "3sazmL1VgPnC")!.name!)).toBeUndefined();
  });

  it("takes a bare id or a pasted URL with no header at all", () => {
    const { orgs, skipped } = parseGcOrgList(
      ["Pqy5Av4tHncy", "https://web.gc.com/organizations/e7BuP4Z9MPM4/teams", "not an id"].join(
        "\n"
      )
    );
    expect(orgs.map((org) => org.orgId)).toEqual(["Pqy5Av4tHncy", "e7BuP4Z9MPM4"]);
    expect(skipped).toEqual(["not an id"]);
  });

  it("counts a repeated organization once", () => {
    const twice = [orgListCsv.trim(), orgListCsv.split("\n")[1]].join("\n");
    const { orgs, skipped } = parseGcOrgList(twice);
    expect(orgs).toHaveLength(3);
    expect(skipped).toHaveLength(1);
  });
});

describe("the organization columns on a team row", () => {
  it("reads the club, the leagues and the tournaments off the real export", () => {
    const { entries, skipped } = parseGcTeamList(teamListOrgsCsv);
    expect(skipped).toEqual([]);
    expect(entries).toHaveLength(4);

    const legends = entries[1]!;
    expect(legends.org).toEqual({
      orgId: "3sazmL1VgPnC",
      name: "Cincy Legends Baseball",
      kind: "travel",
      city: "Cincinnati",
      state: "OH",
      season: { season: "spring", year: 2027 },
    });
    expect(legends.leagues).toEqual([{ name: "NKB 10 Majors", orgId: "TYhyg71UbyM9" }]);
    expect(legends.tournaments).toBeUndefined();
    // The columns that already worked still do.
    expect(legends.staff).toEqual(["Coach Smith"]);
    expect(legends.ageLevel).toBe(10);
  });

  /*
   * A team that plays a tournament and belongs to no club: every organization cell is blank, so
   * there must be no `org` at all rather than an object saying nothing.
   */
  it("leaves the club off a row that names none", () => {
    const { entries } = parseGcTeamList(teamListOrgsCsv);
    const independent = entries[2]!;
    expect(independent.org).toBeUndefined();
    expect(independent.tournaments).toEqual([
      { name: "NB Summer Slam 12U", orgId: "e7BuP4Z9MPM4" },
    ]);
  });

  /*
   * The row that settles the rule: an 11U team whose league is "NKB 11u" and whose tournaments
   * include "NB Summer Slam 12U". You play your own age in your league and you enter tournaments
   * up, so the league may age a team and the tournament may not.
   */
  it("keeps several tournaments apart from the league", () => {
    const { entries } = parseGcTeamList(teamListOrgsCsv);
    const multi = entries[3]!;
    expect(multi.leagues).toEqual([{ name: "NKB 11u", orgId: "Pqy5Av4tHncy" }]);
    expect(multi.tournaments).toEqual([
      { name: "NB Summer Slam 12U", orgId: "e7BuP4Z9MPM4" },
      { name: "NSB Father's Day B-Bash", orgId: "prETpcCzpfL5" },
    ]);
    expect(ageLevelFromName(multi.leagues![0]!.name)).toBe(11);
    expect(ageLevelFromName(multi.tournaments![0]!.name)).toBe(12);
    /*
     * And the two season columns are not crossed. This row's team season is "Summer 2027" while
     * its organization season is a bare "2027", which is not a season at all — so the team has
     * one and the club has none, and a reader that matched "season" loosely would give the club
     * the team's.
     */
    expect(multi.season).toEqual({ season: "summer", year: 2027 });
    expect(multi.org?.season).toBeUndefined();
    expect(multi.org?.orgId).toBe("ORGID000004");
  });

  // The crawl's own bookkeeping columns cost nothing: unknown headers are ignored.
  it("ignores the columns it does not know", () => {
    const { entries } = parseGcTeamList(teamListOrgsCsv);
    expect(entries[0]!.name).toBe("Example 9U Team");
    expect(entries[0]!.org?.orgId).toBe("QXsVtQbOUWQB");
  });
});

describe("organization ids, kinds and associations", () => {
  it("reads an id from a page URL or a bare token", () => {
    expect(parseGcOrgId("https://web.gc.com/organizations/3sazmL1VgPnC/teams")).toBe(
      "3sazmL1VgPnC"
    );
    expect(parseGcOrgId("  Pqy5Av4tHncy ")).toBe("Pqy5Av4tHncy");
    expect(parseGcOrgId("https://web.gc.com/teams/gsUthn4XoIxS")).toBeNull();
    expect(parseGcOrgId("")).toBeNull();
  });

  it("reads the three kinds and nothing else", () => {
    expect(parseGcOrgKind("travel")).toBe("travel");
    expect(parseGcOrgKind("League")).toBe("league");
    expect(parseGcOrgKind(" TOURNAMENT ")).toBe("tournament");
    expect(parseGcOrgKind("club")).toBe("travel");
    expect(parseGcOrgKind("something else")).toBeUndefined();
    expect(parseGcOrgKind(undefined)).toBeUndefined();
  });

  it("reads a name, an id, both, or several", () => {
    expect(parseGcAssociations("NKB 11u|Pqy5Av4tHncy")).toEqual([
      { name: "NKB 11u", orgId: "Pqy5Av4tHncy" },
    ]);
    // A name with no id is still worth keeping: the name is what carries an age.
    expect(parseGcAssociations("Some League")).toEqual([{ name: "Some League" }]);
    expect(parseGcAssociations("A|Pqy5Av4tHncy;A|Pqy5Av4tHncy")).toHaveLength(1);
    expect(parseGcAssociations("")).toEqual([]);
    expect(parseGcAssociations("  ;  ")).toEqual([]);
  });
});

/**
 * A league ages a team; a tournament does not.
 *
 * You play your own age in your league and you enter tournaments up, so an age in a tournament's
 * name is a ceiling a team reached rather than the age it is.
 */
describe("ageFromLeagueNames", () => {
  it("reads the age a league names", () => {
    expect(ageFromLeagueNames([{ name: "NKB 11u", orgId: "Pqy5Av4tHncy" }])).toBe(11);
    expect(ageFromLeagueNames([{ name: "Rec League 9U/10U" }])).toBe(10);
  });

  it("says nothing when no league names one", () => {
    expect(ageFromLeagueNames([{ name: "NKB 10 Majors" }])).toBeUndefined();
    expect(ageFromLeagueNames([])).toBeUndefined();
    expect(ageFromLeagueNames(undefined)).toBeUndefined();
  });

  /*
   * Two leagues naming different ages is not an answer — one of them is about a different squad
   * of the same club — so it refuses rather than picking, which is the rule a tie is already held
   * to in `ageFromOpponentNames`.
   */
  it("refuses two leagues that disagree, and takes two that agree", () => {
    expect(ageFromLeagueNames([{ name: "NKB 11u" }, { name: "Fall Ball 12U" }])).toBeUndefined();
    expect(ageFromLeagueNames([{ name: "NKB 11u" }, { name: "Winter 11U" }])).toBe(11);
  });
});
