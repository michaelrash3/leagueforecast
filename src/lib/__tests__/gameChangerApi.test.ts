import { describe, expect, it } from "vitest";
import profileFixture from "./fixtures/gc-team-profile.json";
import gamesFixture from "./fixtures/gc-team-games.json";
import {
  GC_GAMES_ACCEPT,
  GC_PROFILE_ACCEPT,
  GC_PUBLIC_API_BASE,
  GC_TEAM_ENDPOINT,
  GC_TEAM_ID_PATTERN,
  ageLevelFromName,
  avatarKeyFromUrl,
  formatGcSeason,
  gcGamesApiUrl,
  gcProfileApiUrl,
  gcTeamPageUrl,
  isGcFetchErrorReason,
  localDateInZone,
  normalizeGcGameStatus,
  normalizeGcGames,
  normalizeGcTeamProfile,
  parseGcAgeLevel,
  parseGcSeasonLabel,
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
      },
      {
        teamId: TEAM_ID,
        name: "NV Stars 9u Scout",
        ageLevel: 9,
        season: { season: "fall", year: 2026 },
        city: "Georgetown",
        state: "KY",
      },
      { teamId: "Ab12Cd34Ef56", name: "Blank Age", season: { season: "spring", year: 2027 } },
      {
        teamId: "Zy98Xw76Vu54",
        name: "Nineteen",
        ageLevel: 19,
        season: { season: "winter", year: 2026 },
        city: "Louisville",
        state: "KY",
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
      ageLevel: 9,
      season: { season: "fall", year: 2026 },
      record: { win: 11, loss: 1, tie: 0 },
      avatarKey: "5192a689-d888-4ae5-abce-446885dca7c7",
      playerCount: 10,
    });
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
