import { describe, expect, it } from "vitest";
import { glanceCache, glanceGroups, glanceLines, seasonGlance } from "../seasonGlance";
import type { SeasonMeta, SeasonSnapshot } from "../storage";
import { DEFAULT_SETTINGS, type GameLog, type Matchup, type Settings } from "../types";

/*
 * Placeholder names. Four teams, each pair once: the Aces beat everyone, the Bears beat the
 * Comets and the Dukes, and the Comets beat the Dukes, so the table is Aces, Bears, Comets, Dukes.
 */
const teams = [
  { id: "A", name: "Aces" },
  { id: "B", name: "Bears" },
  { id: "C", name: "Comets" },
  { id: "D", name: "Dukes" },
];
const games: Matchup[] = [
  { id: "g1", date: "5/1", away: "B", home: "A" },
  { id: "g2", date: "5/1", away: "D", home: "C" },
  { id: "g3", date: "5/8", away: "C", home: "A" },
  { id: "g4", date: "5/8", away: "D", home: "B" },
  { id: "g5", date: "5/15", away: "D", home: "A" },
  { id: "g6", date: "5/15", away: "C", home: "B" },
];
const final = (away: string, home: string): GameLog => ({
  awayRuns: away,
  homeRuns: home,
  awayHits: "",
  homeHits: "",
  awayK: "",
  homeK: "",
  innings: "6",
  isFinal: true,
});
// The home side wins every one of these, which is the table above.
const allPlayed: Record<string, GameLog> = Object.fromEntries(
  games.map((game) => [game.id, final("1", "5")])
);

const season = (
  overrides: Partial<Pick<SeasonSnapshot, "logs" | "bracketLogs" | "matchups">> & {
    settings?: Partial<Settings>;
  } = {}
) => ({
  teams,
  matchups: overrides.matchups ?? games,
  logs: overrides.logs ?? allPlayed,
  bracketLogs: overrides.bracketLogs ?? {},
  settings: { ...DEFAULT_SETTINGS, ...overrides.settings },
});

describe("seasonGlance", () => {
  /*
   * Every team in the bracket: the Aces (1) host the Dukes (4) and the Bears (2) the Comets (3) in
   * the semifinals, and the final is hosted by the better seed left. The Comets win it from third.
   */
  const fourTeamBracket = {
    "bracket-r1-g1": final("1", "5"),
    "bracket-r1-g2": final("4", "2"),
    "bracket-r2-g1": final("6", "3"),
  };

  it("names the champion the bracket's final crowned, and the followed team's finish", () => {
    const glance = seasonGlance(
      season({ settings: { postseasonFormat: "all" }, bracketLogs: fourTeamBracket }),
      "C"
    );
    expect(glance.final).toEqual({
      leader: "Aces",
      champion: "Comets",
      ourTeam: "Comets finished 3 of 4, and won it all.",
    });
    expect(glance.bracketOpen).toBe(false);
    expect(glanceLines(glance)).toEqual([
      "Regular season: Aces finished first.",
      "Champion: Comets.",
      "Comets finished 3 of 4, and won it all.",
    ]);
  });

  it("names no champion from a bracket with a game the model would have to pick", () => {
    // The final has a score, but the Bears-Comets semifinal does not: who played the final is the
    // model's guess, so the final's score cannot say who won it.
    const { "bracket-r1-g2": _unplayed, ...rest } = fourTeamBracket;
    const glance = seasonGlance(
      season({ settings: { postseasonFormat: "all" }, bracketLogs: rest }),
      null
    );
    expect(glance.final).toBeNull();
    expect(glance.bracketOpen).toBe(true);
    expect(glanceLines(glance)).toEqual([
      "Regular season: Aces finished first.",
      "The bracket's final has no score yet.",
    ]);
  });

  it("gives the Gold and Silver champions and whether the followed team made Gold", () => {
    // The top two make Gold, where the Bears win at the Aces; the Comets win Silver at home.
    const glance = seasonGlance(
      season({
        settings: { postseasonFormat: "cut", goldCutoff: 2 },
        bracketLogs: {
          "bracket-r1-g1": final("4", "3"),
          "silver-bracket-r1-g1": final("2", "5"),
        },
      }),
      "D"
    );
    expect(glanceLines(glance)).toEqual([
      "Regular season: Aces finished first.",
      "Champion: Bears.",
      "Silver champion: Comets.",
      "Dukes finished 4 of 4.",
      "Dukes missed the Gold bracket.",
    ]);
    expect(glance.ours).toMatchObject({ place: 4, gold: false });
    // Third, the first place outside the line.
    const comets = seasonGlance(
      season({ settings: { postseasonFormat: "cut", goldCutoff: 2 } }),
      "C"
    ).ours;
    expect(comets).toMatchObject({ place: 3, gold: false });
  });

  it("ends with the regular season where there is no postseason", () => {
    const glance = seasonGlance(season({ settings: { postseasonFormat: "none" } }), "B");
    expect(glance.final).toEqual({ leader: "Aces", ourTeam: "Bears finished 2 of 4." });
    expect(glanceLines(glance)).toEqual([
      "Regular season: Aces finished first.",
      "Bears finished 2 of 4.",
    ]);
  });

  it("says how far an unfinished season has got, and names no champion while games remain", () => {
    // Four of six played: the Aces 2-0, the Bears 2-1, the Dukes 0-1 and the Comets 0-2. A bracket
    // score kept already is not read while the table can still change.
    const logs = {
      g1: final("1", "5"),
      g3: final("1", "5"),
      g4: final("1", "5"),
      g6: final("1", "5"),
    };
    const glance = seasonGlance(
      season({
        logs,
        settings: { postseasonFormat: "cut", goldCutoff: 2 },
        bracketLogs: { "bracket-r1-g1": final("4", "3") },
      }),
      "B"
    );
    expect(glance.final).toBeNull();
    expect(glance.bracketOpen).toBe(false);
    expect(glanceLines(glance)).toEqual([
      "In progress: 4 of 6 played, led by Aces.",
      "Bears: 2 of 4 so far (2-1), inside the Gold line.",
    ]);
  });

  it("names no leader before a game is final, and says when there are no games", () => {
    expect(glanceLines(seasonGlance(season({ logs: {} }), null))).toEqual([
      "In progress: 0 of 6 played.",
    ]);
    expect(glanceLines(seasonGlance(season({ matchups: [], logs: {} }), "A"))).toEqual([
      "No games yet: 4 teams.",
    ]);
  });

  it("leaves out a followed team the season no longer has", () => {
    expect(seasonGlance(season(), "gone").ours).toBeNull();
  });
});

describe("glanceCache", () => {
  const meta = (updatedAt?: string): SeasonMeta => ({
    id: "s1",
    name: "Fall 2026",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...(updatedAt ? { updatedAt } : {}),
  });

  it("reads a season once until it is saved again or another team is followed", () => {
    const reads: string[] = [];
    const read = (id: string): SeasonSnapshot => {
      reads.push(id);
      return { ...meta(), ...season() };
    };
    const glanceOf = glanceCache();
    const first = glanceOf(meta("2026-09-01T00:00:00.000Z"), "B", read);
    expect(glanceOf(meta("2026-09-01T00:00:00.000Z"), "B", read)).toBe(first);
    expect(reads).toHaveLength(1);
    glanceOf(meta("2026-09-02T00:00:00.000Z"), "B", read);
    glanceOf(meta("2026-09-02T00:00:00.000Z"), "C", read);
    expect(reads).toHaveLength(3);
  });

  it("reads a season again under an id given out again", () => {
    let reads = 0;
    const read = (): SeasonSnapshot => {
      reads += 1;
      return { ...meta(), ...season() };
    };
    const glanceOf = glanceCache();
    const at = "2026-09-01T00:00:00.000Z";
    glanceOf(meta(at), null, read);
    glanceOf({ ...meta(at), createdAt: "2026-08-02T00:00:00.000Z" }, null, read);
    expect(reads).toBe(2);
  });

  it("gives nothing for a season no longer stored", () => {
    expect(glanceCache()(meta(), null, () => null)).toBeNull();
  });
});

describe("glanceGroups", () => {
  const row = (name: string, createdAt = "2026-01-01T00:00:00.000Z") => ({
    meta: { name, createdAt },
  });

  it("sets one league's seasons side by side, newest first, and the groups by their newest", () => {
    const groups = glanceGroups([
      row("NKB 9U Fall 2025"),
      row("Spring 2027"),
      row("nkb 9u fall 2026"),
      row("Season 1", "2026-02-01T00:00:00.000Z"),
      row("Season 2", "2026-03-01T00:00:00.000Z"),
      row("Spring 2026"),
    ]);
    expect(groups.map((group) => [group.stem, group.seasons.map((one) => one.meta.name)])).toEqual([
      ["Spring", ["Spring 2027", "Spring 2026"]],
      ["nkb 9u fall", ["nkb 9u fall 2026", "NKB 9U Fall 2025"]],
      // A name with no year is its own league, ordered by when it was made here.
      ["Season 2", ["Season 2"]],
      ["Season 1", ["Season 1"]],
    ]);
  });
});
