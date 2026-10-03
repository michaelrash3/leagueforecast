/**
 * A Team Rankings pool of a realistic shape, from a seed: the same pool on every machine, with
 * nobody's real club in it.
 *
 * What the live views are tested and measured against. No test in the repository pinned a board
 * of a real-sized pool, and a real pool cannot be committed (it holds coaches' names), so this
 * draws one, roughly the shape of the 26 September 2026 pool:
 * - about half the clubs pulled from GameChanger, four in ten known only by name, the rest slots;
 * - their GameChanger links a quarter in the fall alone and two thirds in the spring alone, though
 *   a game is dated by the side that filed it, so most clubs end up with games in both halves;
 * - about one game in thirteen across ages and a quarter against a club known only by name;
 * - a third of scores reported a run differently by the other side, a few won by more than 30, a
 *   few scored on a day still to come, a few undated, a few struck out.
 *
 * It also holds every case a board turns on that a random draw would rarely reach:
 * - League Standings seasons whose teams link to pulled clubs by name and by a person's pick, so
 *   `deriveAllKnown` mints teams, and mints them in an order (`S-LEXI`, `S-LEXI2`);
 * - a season with nothing stored, one season claimed by two pages, and a pulled copy of a league
 *   game for `dedupeLeagueFixtures` to fold;
 * - slots marked and unmarked, and a pulled club whose name reads as a slot;
 * - clubs tied on rating and margin, stored against name order, so the name breaks the tie;
 * - a page with no year, which is a pool of its own and lists whoever played on it.
 *
 * Every club's name carries its page's word (`Birch Club 12 10U`) but the slots' and the few
 * renamed below on purpose (last year's twin Bears, this year's 11U "TBC", the tied clubs), each on
 * one page, so no two pages' clubs share a name, slots aside (a "Winner of Game 12" can be on any
 * page), and a League Standings team links to the club it names, the twins' aside. Real pools do repeat names across pages and years; the cases that turn
 * on that are tested on their own, small.
 *
 * Names are invented and plain ASCII, though their order is still the runtime locale's: the boards'
 * ties go by `localeCompare`, and the pins hold under en-US, C, sv-SE, de-DE, da-DK, lt-LT, cs-CZ
 * and haw-US but not Thai, whose collation passes over spaces and puts two schedule-rank ties the
 * other way.
 * Dates are built from integers rather than with `Date`, so the pool does not move with the zone.
 * The draw is mulberry32 (`Math.imul`), exact on every engine.
 *
 *   import { poolFixture } from "./poolFixture.ts";
 *   const pool = poolFixture({ seed: 7, clubsPerPage: 300 });
 */

import {
  NO_SCOUT_TEAM,
  type AgeGroup,
  type ScoutGame,
  type ScoutTeam,
} from "../src/lib/teamRankings.ts";
import type { GameLog, Matchup, TeamBase } from "../src/lib/types.ts";

/** The day the fixture's pool is read on: spring of squad year 2027, a few weeks in. */
export const FIXTURE_TODAY = "2027-04-15";

/** One League Standings season, as it is stored. */
export type FixtureSeason = {
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
};

export type PoolFixture = {
  today: string;
  ageGroups: AgeGroup[];
  teams: ScoutTeam[];
  games: ScoutGame[];
  /** League Standings seasons by id. An id a page claims and this leaves out has nothing stored. */
  seasons: Record<string, FixtureSeason>;
};

/** The repository's 32-bit seeded generator (`powerRating.test.ts`), exact on every engine. */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
const iso = (year: number, month: number, day: number): string =>
  `${year}-${pad(month)}-${pad(day)}`;

/** The pages: last year's three, this year's seven, and one with no year at all. */
const PAGES: Array<{ level: number; year: number }> = [
  { level: 9, year: 2026 },
  { level: 10, year: 2026 },
  { level: 11, year: 2026 },
  ...[8, 9, 10, 11, 12, 13, 14].map((level) => ({ level, year: 2027 })),
];
const pageId = (level: number, year: number): string => `ag_${level}u_${year}`;
const NO_YEAR_PAGE = "ag_showcase";
/** A word for each page, in its clubs' names, so no two pages' clubs share a name, slots aside. */
const PAGE_WORDS = [
  "Ash",
  "Birch",
  "Cedar",
  "Dogwood",
  "Elm",
  "Fir",
  "Gum",
  "Hazel",
  "Ivy",
  "Juniper",
  "Kauri",
];
const wordOf = (page: string): string => {
  const at = PAGES.findIndex(({ level, year }) => pageId(level, year) === page);
  return PAGE_WORDS[at] ?? "Larch";
};
const STATES = ["KY", "OH", "IN", "TN"] as const;

type Kind = "pulled" | "typed" | "nameOnly" | "slot";
type Club = {
  team: ScoutTeam;
  kind: Kind;
  page: string;
  level: number | undefined;
  year: number | undefined;
  strength: number;
  /** 0 fall only, 1 spring only, 2 both. */
  halves: 0 | 1 | 2;
  league: number;
};

/**
 * A pool from `seed`, with `clubsPerPage` clubs on each of the ten pages with a year and a tenth of
 * that on the one without. At 300 a page the pool holds about 3,000 teams and 8,500 games (3,034
 * and 8,520 at seed 7), and this year's fit has well over the 150 clubs at which the solver turns
 * from elimination to conjugate gradients.
 */
export const poolFixture = ({
  seed = 7,
  clubsPerPage = 300,
}: { seed?: number; clubsPerPage?: number } = {}): PoolFixture => {
  const random = mulberry32(seed);
  const int = (below: number): number => Math.floor(random() * below);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  const today = FIXTURE_TODAY;

  const ageGroups: AgeGroup[] = [
    ...PAGES.map(({ level, year }) => ({
      id: pageId(level, year),
      name: `${level}U ${year}`,
      ageLevel: level,
      year,
      seasonIds: [] as string[],
    })),
    // A page from before the picker: no level and no year, read from a name that has neither.
    { id: NO_YEAR_PAGE, name: "Showcase", seasonIds: [] },
  ];

  const clubs: Club[] = [];
  const leagues: number[][] = [];
  let gcSerial = 0;
  const gcId = (): string => `FX${pad((gcSerial += 1), 10)}`;

  const addClub = (
    page: string,
    level: number | undefined,
    year: number | undefined,
    at: number
  ) => {
    const draw = random();
    const kind: Kind =
      draw < 0.52 ? "pulled" : draw < 0.54 ? "typed" : draw < 0.92 ? "nameOnly" : "slot";
    const state = pick(STATES);
    const label = level === undefined ? "" : ` ${level}U`;
    const word = wordOf(page);
    const id = `S-${page.slice(3)}-${pad(at, 4)}`;
    const half = random();
    const halves: 0 | 1 | 2 = half < 0.24 ? 0 : half < 0.89 ? 1 : 2;
    let team: ScoutTeam;
    if (kind === "pulled") {
      const link = (season: "fall" | "spring") => ({
        teamId: gcId(),
        name: `${word} Club ${at}${label}`,
        ageGroupId: page,
        season,
        ...(year === undefined ? {} : { seasonYear: season === "fall" ? year - 1 : year }),
        ...(level === undefined ? {} : { ageLevel: level }),
      });
      const links =
        halves === 2 ? [link("fall"), link("spring")] : [link(halves === 0 ? "fall" : "spring")];
      team = {
        id,
        name: `${word} Club ${at}${label}`,
        state,
        city: `Town ${int(40)}`,
        gcTeams: links,
      };
    } else if (kind === "typed") {
      team = { id, name: `${word} Squad ${at}${label}`, state };
    } else if (kind === "nameOnly") {
      team = { id, name: `${word} Rival ${at}${label}`, nameOnly: true };
    } else {
      // Half the slots are marked; the rest only read as one, which the codec marks on the way in.
      team =
        random() < 0.5
          ? { id, name: `Winner of Game ${at}`, placeholder: true }
          : { id, name: `TBD- ${pad(1 + int(7))}/${pad(1 + int(28))}/27, ${1 + int(9)}:00 PM` };
    }
    const club: Club = {
      team,
      kind,
      page,
      level,
      year,
      strength: (random() - 0.5) * 8,
      halves,
      league: -1,
    };
    clubs.push(club);
    return club;
  };

  // Clubs, page by page, and leagues of six to fourteen clubs of one page and state.
  [
    ...PAGES.map(({ level, year }) => ({ level, year, page: pageId(level, year) })),
    {
      level: undefined,
      year: undefined,
      page: NO_YEAR_PAGE,
    },
  ].forEach(({ level, year, page }) => {
    const count =
      page === NO_YEAR_PAGE ? Math.max(20, Math.floor(clubsPerPage / 10)) : clubsPerPage;
    const open = new Map<string, number[]>();
    for (let at = 0; at < count; at += 1) {
      const club = addClub(page, level, year, at);
      if (club.kind !== "pulled" && club.kind !== "typed") continue;
      const state = club.team.state ?? "";
      let league = open.get(state);
      if (!league || league.length >= 6 + int(9)) {
        league = [];
        leagues.push(league);
        open.set(state, league);
      }
      club.league = leagues.length - 1;
      league.push(clubs.length - 1);
    }
  });

  // A pulled club whose name reads as a slot: its own GameChanger id says it is a club, and the
  // codec clears the mark it was stored with.
  const tbc = clubs.find((club) => club.kind === "pulled" && club.page === pageId(11, 2027));
  if (tbc) tbc.team = { ...tbc.team, name: "TBC", placeholder: true };

  const onPage = (page: string, kinds: readonly Kind[]) =>
    clubs.filter((club) => club.page === page && kinds.includes(club.kind));
  const scheduled = (page: string) => onPage(page, ["pulled", "typed"]);
  const byPage = new Map(
    [...PAGES.map(({ level, year }) => pageId(level, year)), NO_YEAR_PAGE].map((page) => [
      page,
      { teams: scheduled(page), rivals: onPage(page, ["nameOnly"]), slots: onPage(page, ["slot"]) },
    ])
  );

  const games: ScoutGame[] = [];
  let serial = 0;
  const dateIn = (club: Club, half: 0 | 1): string | undefined => {
    if (club.year === undefined || random() < 0.01) return undefined;
    return half === 0
      ? iso(club.year - 1, 8 + int(5), 1 + int(28))
      : iso(club.year, 1 + int(7), 1 + int(28));
  };
  const scoreOf = (a: Club, b: Club, gap: number) => {
    const margin = Math.round(a.strength - b.strength + 2 * gap + (random() - 0.5) * 8);
    const base = 2 + int(6);
    return margin >= 0
      ? { teamAScore: base + margin, teamBScore: base }
      : { teamAScore: base, teamBScore: base - margin };
  };

  clubs.forEach((a) => {
    if (a.kind !== "pulled" && a.kind !== "typed") return;
    const here = byPage.get(a.page)!;
    const count = 2 + Math.floor(16 * random() * random());
    for (let k = 0; k < count; k += 1) {
      const r = random();
      let b: Club | undefined;
      if (r < 0.55) {
        const league = leagues[a.league] ?? [];
        b = clubs[league[int(league.length)] ?? -1];
      } else if (r < 0.65) {
        b = pick(here.teams);
      } else if (r < 0.74 && a.level !== undefined && a.year !== undefined) {
        // Across ages: a club a level up or down in the same year, when there is a page for it.
        const other = byPage.get(pageId(a.level + (random() < 0.5 ? 1 : -1), a.year));
        b = other && other.teams.length > 0 ? pick(other.teams) : undefined;
      } else if (r < 0.97) {
        b = here.rivals.length > 0 ? pick(here.rivals) : undefined;
      } else {
        b = here.slots.length > 0 ? pick(here.slots) : undefined;
      }
      if (!b || b === a) continue;
      const half: 0 | 1 = a.halves === 2 ? (int(2) as 0 | 1) : a.halves;
      const date = dateIn(a, half);
      const ahead = date !== undefined && date > today;
      // Scheduled games still to come carry no score, but a few were typed in early.
      const scored = !ahead || random() < 0.03;
      const levelB = b.kind === "pulled" || b.kind === "typed" ? b.level : a.level;
      const gap = a.level !== undefined && levelB !== undefined ? a.level - levelB : 0;
      const game: ScoutGame = {
        id: `g${(serial += 1)}`,
        teamAId: a.team.id,
        teamBId: b.team.id,
        ageGroupId: a.page,
        ...(date ? { date } : {}),
      };
      if (a.level !== undefined && levelB !== undefined && random() < 0.9) {
        game.ageLevelA = a.level;
        game.ageLevelB = levelB;
      }
      if (scored) {
        Object.assign(game, scoreOf(a, b, gap));
        const odd = random();
        if (odd < 0.003) {
          // A rout: rated only once somebody has confirmed the margin.
          game.teamAScore = 35;
          game.teamBScore = 1;
          if (random() < 0.5) game.scoreConfirmed = 34;
        } else if (odd < 0.008) {
          game.excluded = true;
        } else if (odd < 0.31 && game.teamAScore !== undefined && game.teamBScore !== undefined) {
          // The other side reported it a run differently, one way or the other.
          const moreForA = random() < 0.5;
          game.reportedByB = {
            teamAScore: game.teamAScore + (moreForA ? 1 : 0),
            teamBScore: game.teamBScore + (moreForA ? 0 : 1),
          };
        }
      }
      games.push(game);
    }
  });

  // Ties: two islands of two clubs with the same one result, so rating and margin both tie and the
  // name decides the order. Stored South first, so the board's North-first order is the name's
  // doing and not the roster's.
  const tiePage = pageId(12, 2027);
  ["Tied South", "Tied North"].forEach((name, at) => {
    const winner = addClub(tiePage, 12, 2027, 9000 + at * 2);
    const loser = addClub(tiePage, 12, 2027, 9001 + at * 2);
    winner.team = { id: `S-TIE-${at}W`, name: `${name} Aces`, state: "KY" };
    loser.team = { id: `S-TIE-${at}L`, name: `${name} Bees`, state: "KY" };
    games.push({
      id: `tie${at}`,
      teamAId: winner.team.id,
      teamBId: loser.team.id,
      ageGroupId: tiePage,
      teamAScore: 6,
      teamBScore: 2,
      date: "2027-03-14",
    });
  });

  // One club starred the old way, on the roster, and one page that names its own.
  const starred = clubs.find((club) => club.kind === "pulled" && club.page === pageId(10, 2027));
  if (starred) starred.team = { ...starred.team, isMine: true };
  const mine = clubs.find((club) => club.kind === "pulled" && club.page === pageId(9, 2027));
  if (mine) ageGroups.find((group) => group.id === pageId(9, 2027))!.myTeamId = mine.team.id;

  // ---------- League Standings ----------
  const seasons: Record<string, FixtureSeason> = {};
  const claim = (page: string, seasonId: string) =>
    ageGroups.find((group) => group.id === page)!.seasonIds.push(seasonId);
  const finalLog = (away: number, home: number): GameLog => ({
    awayRuns: String(away),
    awayHits: "",
    awayK: "",
    homeRuns: String(home),
    homeHits: "",
    homeK: "",
    innings: "6",
    isFinal: true,
  });
  /** A round robin among `teams`, weekly from `first` ("M/D"), finals for the days already played. */
  const season = (
    seasonId: string,
    teams: TeamBase[],
    year: number,
    first: { month: number; day: number }
  ): FixtureSeason => {
    const matchups: Matchup[] = [];
    const logs: Record<string, GameLog> = {};
    let week = 0;
    teams.forEach((away, i) =>
      teams.slice(i + 1).forEach((home) => {
        const day = first.day + 7 * week;
        const month = first.month + Math.floor((day - 1) / 28);
        const date = `${month}/${1 + ((day - 1) % 28)}`;
        week = (week + 1) % 8;
        const id = `${seasonId}-m${matchups.length + 1}`;
        matchups.push({ id, date, away: away.id, home: home.id });
        // Fall dates fall in the year before the squad year; spring's in it.
        const played = iso(month >= 8 ? year - 1 : year, month, 1 + ((day - 1) % 28)) < today;
        if (played) logs[id] = finalLog(2 + int(8), 2 + int(8));
      })
    );
    const stored = { teams, matchups, logs };
    seasons[seasonId] = stored;
    return stored;
  };

  // This year's 10U league: five clubs by their own names, one by a person's pick under another
  // name, one nobody has pulled, which is minted, and one a person said is not in Team Rankings.
  // That answer turns the link panel's name match off, but deriving the league's games still goes
  // by the name for any team no pick or guess reaches, so today its games land on the club of its
  // name all the same.
  const tenU = scheduled(pageId(10, 2027)).filter((club) => club.kind === "pulled");
  const named = tenU.slice(0, 5).map((club, i) => ({ id: `t10-${i}`, name: club.team.name }));
  const pickedClub = tenU[5];
  const tenUTeams: TeamBase[] = [
    ...named,
    ...(pickedClub
      ? [{ id: "t10-pick", name: "Picked Under Another Name", scoutTeamId: pickedClub.team.id }]
      : []),
    { id: "t10-none", name: tenU[6]?.team.name ?? "Not Here", scoutTeamId: NO_SCOUT_TEAM },
    { id: "t10-new", name: "Lexington Legends" },
  ];
  const tenUSeason = season("fx-10u-fall", tenUTeams, 2027, { month: 9, day: 6 });
  claim(pageId(10, 2027), "fx-10u-fall");

  // A pulled copy of the first league game, filed by the away club against the home club on the
  // same day, for the fold to collapse into the league's row.
  const firstMatchup = tenUSeason.matchups[0];
  const awayClub = tenU[0];
  const homeClub = tenU[1];
  if (firstMatchup && awayClub && homeClub) {
    const [month, day] = firstMatchup.date.split("/").map(Number);
    games.push({
      id: "pulled-league-copy",
      teamAId: awayClub.team.id,
      teamBId: homeClub.team.id,
      ageGroupId: pageId(10, 2027),
      teamAScore: 5,
      teamBScore: 4,
      date: iso(2026, month ?? 9, day ?? 6),
    });
  }

  // Last year's 9U league, walked first because its page is stored first: its new team takes
  // `S-LEXI`, so this year's Legends become `S-LEXI2`. One of its teams has the name two of last
  // year's clubs share, so the name alone cannot say which is meant. (Which club a league team goes
  // to depending on the year being read is `allKnown.test.ts`'s, on a smaller case.)
  const nineU = scheduled(pageId(9, 2026)).filter((club) => club.kind === "pulled");
  const twinName = "Bears Baseball";
  nineU.slice(0, 2).forEach((club) => (club.team = { ...club.team, name: twinName }));
  season(
    "fx-9u-2026",
    [
      { id: "t9-lions", name: "Lexington Lions" },
      { id: "t9-bears", name: twinName },
      ...nineU.slice(2, 6).map((club, i) => ({ id: `t9-${i}`, name: club.team.name })),
    ],
    2026,
    { month: 3, day: 1 }
  );
  claim(pageId(9, 2026), "fx-9u-2026");

  // A season a page claims with nothing stored, and one season claimed by two pages.
  claim(pageId(11, 2027), "fx-nothing-stored");
  const twelveU = scheduled(pageId(12, 2027)).filter((club) => club.kind === "pulled");
  season(
    "fx-shared",
    twelveU.slice(0, 4).map((club, i) => ({ id: `t12-${i}`, name: club.team.name })),
    2027,
    { month: 3, day: 7 }
  );
  claim(pageId(12, 2027), "fx-shared");
  claim(pageId(13, 2027), "fx-shared");

  return { today, ageGroups, teams: clubs.map((club) => club.team), games, seasons };
};

/**
 * A short fingerprint of any value: FNV-1a over its JSON, as `powerRating.test.ts` pins a fit. A
 * board's every digit is in its JSON, so one changed bit anywhere changes this.
 */
export const fingerprint = (value: unknown): string => {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};
