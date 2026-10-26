/**
 * The comparison `communityLevelSweep.ts` prints: where a league's rating starts as the boards
 * start it (`startingLevel`, the counted level) against a start that also reads how the league's
 * outside games went (`resultsAwareLevels`), on one squad year's pool as the boards fit it.
 *
 * Kept apart from the script, and free of Node, so a test can run it on a made-up pool and hold its
 * report to what it says (`communitySweep.test.ts`); the script only reads a pool and prints.
 *
 * It repeats the measurement the counted level was shipped on (`scheduleCommunities.ts`): the year
 * fitted as the board would have been on each cut day (1, 8 and 15 September 2026 by default),
 * every later game between two clubs that fit rated (from 23 September) scored on the ratings the
 * board showed, each variant against the counted level game by game, the squared error of the
 * margin and the Brier score of the win chance, with standard errors that read a club's games
 * together (`pairedImprovement`); then on the board of the day, the national top-25 places and the
 * well-connected state #1s each variant moves, how long its fit takes, and where one named club
 * stands.
 */
import {
  clearlyBetterBar,
  isClearlyBetter,
  MIN_PAIRED_GAMES,
  pairedImprovement,
  type PairedReading,
} from "../src/lib/scoutBacktest.ts";
import { dayInstant } from "../src/lib/ratingRecency.ts";
import { resultsAwareRestart, type ResultsAwareLevel } from "../src/lib/resultsAwareLevel.ts";
import {
  ageGroupLevel,
  ageGroupYear,
  fitScoutYear,
  predictMatchup,
  RATING_CAP,
  ratedMargin,
  rowsOfYearFit,
  scoutFitRanks,
  scoutRatingGames,
  type AgeGroup,
  type ScoutGame,
  type ScoutRankingRow,
  type ScoutTeam,
  type ScoutYearFit,
} from "../src/lib/teamRankings.ts";

/** A way of starting a league's ratings, and why it is in the comparison. */
export type LevelVariant = { key: string; why: string; rule?: ResultsAwareLevel };

/**
 * The control, the four amounts of belief the counted level keeps that the owner asked for, and one
 * more. `k5-weak` moves only leagues with ten or fewer outside games, where the counted level still
 * does most of the work and where the Longhorns' league is: a well-connected league's own games
 * already fix its level, so moving it as well can only reorder well-connected boards, which the
 * owner held to 15 state #1s changed when the resolution was chosen. If it does as well on the later
 * games as `k5` while changing fewer well-connected #1s, the rule can be narrowed to where it is
 * needed.
 */
export const LEVEL_VARIANTS: readonly LevelVariant[] = [
  { key: "control", why: "the counted level, as the boards start a league today" },
  {
    key: "k2",
    why: "two outside games' worth of belief kept with the counted level",
    rule: { kappa: 2 },
  },
  { key: "k5", why: "five", rule: { kappa: 5 } },
  { key: "k10", why: "ten", rule: { kappa: 10 } },
  { key: "k20", why: "twenty", rule: { kappa: 20 } },
  {
    key: "k5-weak",
    why: "five, moving only leagues with ten or fewer outside games",
    rule: { kappa: 5, maxOutside: 10 },
  },
];

/** The cut days of the measurement the counted level was shipped on, and its first scored day. */
export const DEFAULT_CUTS = ["2026-09-01", "2026-09-08", "2026-09-15"];
export const DEFAULT_SCORE_FROM = "2026-09-23";
/** Outside games at which a league is well connected: the 276 state #1s of 11 October 2026. */
export const WELL_CONNECTED = 31;
/** Outside games up to which a league is weakly connected, as the counted level was measured. */
export const WEAKLY_CONNECTED = 10;
/** Distinct days below which a segment's band calibrates nothing (`recencySweep.ts`). */
export const MIN_SCORED_DAYS = 8;
/** Well-connected state #1s the owner allowed a change of the start to move (resolution, 20). */
export const OWNER_STATE_ONES = 15;

/** A club asked about by name: the part of its name, its town and state, and the page it is on. */
export type ClubQuery = { name: string; city?: string; state?: string; page?: string };

export type CommunitySweepInput = {
  ageGroups: AgeGroup[];
  /** The squad year's pool as the boards fit it (`deriveAllKnown`, `asWorkerSees`). */
  teams: ScoutTeam[];
  games: ScoutGame[];
  /** A ranked page of the year, which names the pool (`rankingPoolGroupIds`). */
  pageId: string;
  /** The day of the board the places and the named club are read on, an ISO day. */
  today: string;
  cuts?: readonly string[];
  scoreFrom?: string;
  /** The last day scored, or every day to `today` when left out. */
  scoreTo?: string;
  variants?: readonly LevelVariant[];
  club?: ClubQuery;
  /** The clock fits are timed by, in milliseconds. */
  now?: () => number;
};

/** One way of splitting the later games, by how connected the less connected side's league is. */
export type SegmentKey = "all" | "island" | "weak" | "more" | "weakOutsider" | "weakWell";
export const SEGMENTS: ReadonlyArray<{ key: SegmentKey; label: string }> = [
  { key: "all", label: "every later game" },
  { key: "island", label: "the less connected side's league has no outside games (an island)" },
  { key: "weak", label: "the less connected side's league has 1 to 10 outside games" },
  { key: "more", label: "both sides' leagues with more than 10" },
  { key: "weakOutsider", label: "a weakly connected side (0 to 10) against another league" },
  { key: "weakWell", label: "a weakly connected side against a well-connected one (31+)" },
];

/** A variant against the control on one segment of the later games. */
export type SegmentReading = {
  key: SegmentKey;
  games: number;
  days: number;
  decided: number;
  /** Mean squared error of the margin, runs², and Brier score, the variant's and the control's. */
  squared: number;
  brier: number;
  controlSquared: number;
  controlBrier: number;
  /** How much lower than the control's, game by game (`pairedImprovement`): positive is better. */
  squaredGain: PairedReading | null;
  brierGain: PairedReading | null;
  measurable: boolean;
};

/** Where the named club stands on the board of the day under one variant. */
export type ClubReading = {
  teamId: string;
  name: string;
  city?: string;
  state?: string;
  pageName: string;
  rating: number;
  pointRating: number;
  levelPrior?: number;
  outsideGames?: number;
  record: string;
  rank: number;
  stateRank?: number;
};

export type VariantResult = {
  key: string;
  why: string;
  segments: SegmentReading[];
  /** Each cut's fit, then the board of the day's, in seconds. */
  cutSeconds: number[];
  boardSeconds: number;
  /** The national top 25 of every ranked page of the year, against the control's. */
  topPlaces: { kept: number; of: number; wellKept: number; wellOf: number };
  /** Each page's #1 of each state, against the control's. */
  stateOnes: { changed: number; of: number; wellChanged: number; wellOf: number; islands: number };
  club: ClubReading[];
};

export type CutSummary = {
  cut: string;
  trained: number;
  scored: number;
  communities: number;
  /** The scored games' sides, by how connected each side's league is. */
  sides: { island: number; weak: number; middling: number; well: number };
};

/**
 * The league the fit found for the club asked about, as the control's board reads it: the clubs
 * the schedule's communities put together (`scheduleCommunities.ts`), how many games each played
 * inside and outside it, and every rated game with exactly one side in it, which is what the
 * league's starting level counts. Asked for because a league the fit finds is not the league a
 * person knows: the owner counted two outside games where the fit counted six.
 */
export type LeagueDetail = {
  size: number;
  inside: number;
  outside: number;
  members: { id: string; name: string; place: string; inside: number; outside: number }[];
  outsideGames: {
    date: string;
    member: string;
    opponent: string;
    opponentLeague: { size: number; outside: number };
    score: string;
    filedBy: string;
    gameId: string;
    /** Another outside game of this league on the same day between the same two clubs. */
    twin: boolean;
  }[];
};

export type CommunitySweep = {
  year: number | undefined;
  pageNames: string[];
  cuts: CutSummary[];
  scoreFrom: string;
  scoreTo?: string;
  variants: VariantResult[];
  /** Whether every later game together is enough to rank anything (`MIN_PAIRED_GAMES`, days). */
  measurable: boolean;
  /** The bar a variant's gain must clear against the control, in standard errors. */
  bar: number;
  clubAsked: boolean;
  league?: LeagueDetail;
};

const pad = (text: string, width: number) => text.padEnd(width);
const padLeft = (text: string, width: number) => text.padStart(width);

/** A page's name as the boards print it: "9U 2027", or its own where it has no level or year. */
export const pageNameOf = (group: AgeGroup): string => {
  const level = ageGroupLevel(group);
  const year = ageGroupYear(group);
  return level === undefined || year === undefined ? group.name : `${level}U ${year}`;
};

/** A league's connectedness by its outside games. */
const classOf = (outside: number): "island" | "weak" | "middling" | "well" =>
  outside <= 0
    ? "island"
    : outside <= WEAKLY_CONNECTED
      ? "weak"
      : outside < WELL_CONNECTED
        ? "middling"
        : "well";

/** Which segments a scored game is in, read off the control fit of its cut. */
const segmentsOf = (outsideA: number, outsideB: number, apart: boolean): SegmentKey[] => {
  const weaker = Math.min(outsideA, outsideB);
  const stronger = Math.max(outsideA, outsideB);
  const keys: SegmentKey[] = ["all"];
  if (weaker <= 0) keys.push("island");
  else if (weaker <= WEAKLY_CONNECTED) keys.push("weak");
  else keys.push("more");
  if (weaker <= WEAKLY_CONNECTED && apart) {
    keys.push("weakOutsider");
    if (stronger >= WELL_CONNECTED) keys.push("weakWell");
  }
  return keys;
};

type Scored = {
  game: ScoutGame;
  ageGap: number;
  day: number;
  segments: SegmentKey[];
  sides: [number, number];
};

/** The shown margin and win chance of a game on a fit, as the board's matchup reads them. */
const predicted = (fit: ScoutYearFit, game: ScoutGame, ageGap: number) => {
  const shown = (id: string) =>
    fit.confident(fit.adjusted.ratings.get(id) ?? 0, fit.effective.get(id) ?? 0);
  const a = shown(game.teamAId);
  const b = shown(game.teamBId);
  const gapRuns = ageGap * fit.adjusted.ageGapRuns;
  const level = fit.homeLevels.get(game.teamAId) ?? fit.homeLevels.get(game.teamBId);
  // The age gap in the margin, as the fit reads a game across levels, and in the chance alike.
  return { margin: a - b + gapRuns, win: predictMatchup(a + gapRuns, b, level).winProbA };
};

/** Mean of a typed array, or 0 for none. */
const meanOf = (values: Float32Array): number => {
  let sum = 0;
  for (let at = 0; at < values.length; at += 1) sum += values[at]!;
  return values.length > 0 ? sum / values.length : 0;
};

/** Every state's #1 on a page's rows: its first row of each state. */
const stateOnesOf = (
  rows: readonly ScoutRankingRow[],
  stateOf: (id: string) => string | undefined
) => {
  const ones = new Map<string, string>();
  rows.forEach((row) => {
    const state = stateOf(row.teamId);
    if (state && !ones.has(state)) ones.set(state, row.teamId);
  });
  return ones;
};

/**
 * Runs the comparison: each variant fitted at every cut and on the board of the day, scored against
 * the control. The control's own fit decides which later games are scored and which segment each
 * is in, so every variant faces the same games.
 */
export const runCommunitySweep = (input: CommunitySweepInput): CommunitySweep => {
  const { ageGroups, teams, games, pageId, today } = input;
  const cuts = input.cuts ?? DEFAULT_CUTS;
  const scoreFrom = input.scoreFrom ?? DEFAULT_SCORE_FROM;
  const variants = input.variants ?? LEVEL_VARIANTS;
  const now = input.now ?? Date.now;
  const group = ageGroups.find((entry) => entry.id === pageId);
  const year = ageGroupYear(group);
  const yearPages = ageGroups.filter(
    (entry) => ageGroupYear(entry) === year && scoutFitRanks(entry.id, ageGroups)
  );
  const fromAt = dayInstant(scoreFrom);
  const toAt = input.scoreTo === undefined ? Number.POSITIVE_INFINITY : dayInstant(input.scoreTo);
  const everyRated = scoutRatingGames(pageId, teams, games, ageGroups, undefined, today);
  const later = everyRated
    .map((entry) => ({ ...entry, day: dayInstant(entry.game.date) }))
    .filter(({ day }) => day >= fromAt && day <= toAt);

  const sideIndex = new Map<string, number>();
  const sideOf = (id: string) => {
    const known = sideIndex.get(id);
    if (known !== undefined) return known;
    sideIndex.set(id, sideIndex.size);
    return sideIndex.size - 1;
  };
  const timed = <T>(work: () => T): [T, number] => {
    const started = now();
    const value = work();
    return [value, (now() - started) / 1000];
  };
  const fitOf = (rated: ReturnType<typeof scoutRatingGames>, variant: LevelVariant) =>
    timed(() =>
      fitScoutYear(
        year,
        teams,
        games,
        rated,
        ageGroups,
        variant.rule ? { restart: resultsAwareRestart(variant.rule) } : {}
      )
    );

  // Per variant, per segment: every scored game's squared error, Brier (decided games), sides.
  type Pile = {
    squared: number[];
    brier: number[];
    sides: number[];
    decidedSides: number[];
    days: Set<number>;
  };
  const piles = variants.map(
    () =>
      new Map<SegmentKey, Pile>(
        SEGMENTS.map(({ key }) => [
          key,
          { squared: [], brier: [], sides: [], decidedSides: [], days: new Set<number>() },
        ])
      )
  );
  const cutSeconds = variants.map(() => [] as number[]);
  const cutSummaries: CutSummary[] = [];

  for (const cut of cuts) {
    const trained = scoutRatingGames(pageId, teams, games, ageGroups, undefined, cut);
    const fits = variants.map((variant, at) => {
      const [fit, seconds] = fitOf(trained, variant);
      cutSeconds[at]!.push(seconds);
      return fit;
    });
    const control = fits[0]!;
    const outsideOf = (id: string) => {
      const community = control.communities.of.get(id);
      return community === undefined ? 0 : (control.communities.outside[community] ?? 0);
    };
    const sides = { island: 0, weak: 0, middling: 0, well: 0 };
    const scored: Scored[] = later
      .filter(
        ({ game }) =>
          (control.adjusted.games.get(game.teamAId) ?? 0) > 0 &&
          (control.adjusted.games.get(game.teamBId) ?? 0) > 0
      )
      .map(({ game, ageGap, day }) => {
        const outsideA = outsideOf(game.teamAId);
        const outsideB = outsideOf(game.teamBId);
        sides[classOf(outsideA)] += 1;
        sides[classOf(outsideB)] += 1;
        const apart =
          control.communities.of.get(game.teamAId) !== control.communities.of.get(game.teamBId);
        return {
          game,
          ageGap,
          day,
          segments: segmentsOf(outsideA, outsideB, apart),
          sides: [sideOf(game.teamAId), sideOf(game.teamBId)],
        };
      });
    cutSummaries.push({
      cut,
      trained: trained.length,
      scored: scored.length,
      communities: control.communities.outside.length,
      sides,
    });
    fits.forEach((fit, at) => {
      for (const { game, ageGap, day, segments, sides: pair } of scored) {
        const margin = Math.max(-RATING_CAP, Math.min(RATING_CAP, ratedMargin(game) ?? 0));
        const guess = predicted(fit, game, ageGap);
        const decided = margin !== 0;
        for (const key of segments) {
          const pile = piles[at]!.get(key)!;
          pile.squared.push((guess.margin - margin) ** 2);
          pile.sides.push(pair[0], pair[1]);
          pile.days.add(day);
          if (decided) {
            pile.brier.push((guess.win - (margin > 0 ? 1 : 0)) ** 2);
            pile.decidedSides.push(pair[0], pair[1]);
          }
        }
      }
    });
  }

  // The board of the day, every variant, for the places, the #1s and the named club.
  const board = everyRated;
  const stateById = new Map(teams.map((team) => [team.id, team.state]));
  const stateOf = (id: string) => stateById.get(id) || undefined;
  const boards = variants.map((variant) => {
    const [fit, seconds] = fitOf(board, variant);
    const rows = new Map(
      yearPages.map((page) => [page.id, rowsOfYearFit(fit, page.id, undefined, ageGroups)])
    );
    return { fit, seconds, rows };
  });
  const controlBoard = boards[0]!;
  const controlOutside = (id: string) => {
    const { communities } = controlBoard.fit;
    const community = communities.of.get(id);
    return community === undefined ? 0 : (communities.outside[community] ?? 0);
  };
  const isWell = (id: string) => controlOutside(id) >= WELL_CONNECTED;
  const leagueDetailOf = (targetId: string): LeagueDetail | undefined => {
    const { communities } = controlBoard.fit;
    const league = communities.of.get(targetId);
    if (league === undefined) return undefined;
    const byId = new Map(teams.map((team) => [team.id, team]));
    const nameOf = (id: string) => byId.get(id)?.name ?? id;
    const clubOfGc = new Map(
      teams.flatMap((team) => (team.gcTeams ?? []).map((link) => [link.teamId, team.id] as const))
    );
    const sizes = new Map<number, number>();
    communities.of.forEach((c) => sizes.set(c, (sizes.get(c) ?? 0) + 1));
    const counts = new Map<string, { inside: number; outside: number }>();
    const tally = (id: string) => {
      const known = counts.get(id);
      if (known) return known;
      const fresh = { inside: 0, outside: 0 };
      counts.set(id, fresh);
      return fresh;
    };
    communities.of.forEach((c, id) => {
      if (c === league) tally(id);
    });
    let inside = 0;
    const outsideGames: LeagueDetail["outsideGames"] = [];
    board.forEach(({ game }) => {
      const a = communities.of.get(game.teamAId);
      const b = communities.of.get(game.teamBId);
      if (a === league && b === league) {
        inside += 1;
        tally(game.teamAId).inside += 1;
        tally(game.teamBId).inside += 1;
        return;
      }
      if (a !== league && b !== league) return;
      const member = a === league ? game.teamAId : game.teamBId;
      const other = a === league ? game.teamBId : game.teamAId;
      const otherLeague = a === league ? b : a;
      tally(member).outside += 1;
      const filer = game.source?.teamId;
      outsideGames.push({
        date: game.date ?? "?",
        member: nameOf(member),
        opponent: nameOf(other),
        opponentLeague: {
          size: otherLeague === undefined ? 1 : (sizes.get(otherLeague) ?? 1),
          outside: otherLeague === undefined ? 0 : (communities.outside[otherLeague] ?? 0),
        },
        score: `${nameOf(game.teamAId)} ${game.teamAScore ?? "?"}-${game.teamBScore ?? "?"} ${nameOf(game.teamBId)}`,
        filedBy: filer === undefined ? "?" : nameOf(clubOfGc.get(filer) ?? filer),
        gameId: game.id,
        twin: false,
      });
    });
    const keyOf = (g: (typeof outsideGames)[number]) =>
      `${g.date}|${[g.member, g.opponent].sort().join("|")}`;
    const seen = new Map<string, number>();
    outsideGames.forEach((g) => seen.set(keyOf(g), (seen.get(keyOf(g)) ?? 0) + 1));
    outsideGames.forEach((g) => {
      g.twin = (seen.get(keyOf(g)) ?? 0) > 1;
    });
    outsideGames.sort((x, y) => x.date.localeCompare(y.date));
    return {
      size: counts.size,
      inside,
      outside: communities.outside[league] ?? 0,
      members: [...counts.entries()]
        .map(([id, count]) => {
          const team = byId.get(id);
          return {
            id,
            name: nameOf(id),
            place: [team?.city, team?.state].filter(Boolean).join(", "),
            ...count,
          };
        })
        .sort((x, y) => y.inside - x.inside || x.name.localeCompare(y.name)),
      outsideGames,
    };
  };

  // The named club, looked up on the roster the boards fit by its name, town and state.
  const query = input.club;
  const wanted = query
    ? teams.filter(
        (team) =>
          team.name.toLowerCase().includes(query.name.toLowerCase()) &&
          (query.city === undefined ||
            (team.city ?? "").toLowerCase() === query.city.toLowerCase()) &&
          (query.state === undefined ||
            (team.state ?? "").toUpperCase() === query.state.toUpperCase())
      )
    : [];
  const clubOn = (rows: Map<string, ScoutRankingRow[]>): ClubReading[] =>
    wanted.flatMap((team) => {
      for (const page of yearPages) {
        if (query?.page !== undefined && pageNameOf(page) !== query.page) continue;
        const pageRows = rows.get(page.id) ?? [];
        const row = pageRows.find((entry) => entry.teamId === team.id);
        if (!row) continue;
        const state = team.state;
        const inState = state ? pageRows.filter((entry) => stateOf(entry.teamId) === state) : [];
        const stateRank = state ? inState.findIndex((entry) => entry.teamId === team.id) + 1 : 0;
        return [
          {
            teamId: team.id,
            name: team.name,
            ...(team.city ? { city: team.city } : {}),
            ...(state ? { state } : {}),
            pageName: pageNameOf(page),
            rating: row.rating,
            pointRating: row.pointRating,
            ...(row.levelPrior === undefined ? {} : { levelPrior: row.levelPrior }),
            ...(row.outsideGames === undefined ? {} : { outsideGames: row.outsideGames }),
            record: row.record,
            rank: row.rank,
            ...(stateRank > 0 ? { stateRank } : {}),
          },
        ];
      }
      return [];
    });

  const results: VariantResult[] = variants.map((variant, at) => {
    const segments = SEGMENTS.map(({ key }): SegmentReading => {
      const mine = piles[at]!.get(key)!;
      const theirs = piles[0]!.get(key)!;
      const squaredMine = Float32Array.from(mine.squared);
      const squaredTheirs = Float32Array.from(theirs.squared);
      const brierMine = Float32Array.from(mine.brier);
      const brierTheirs = Float32Array.from(theirs.brier);
      const games = squaredMine.length;
      const measurable = games >= MIN_PAIRED_GAMES && mine.days.size >= MIN_SCORED_DAYS;
      const gain = (ours: Float32Array, reference: Float32Array, sides: number[]) =>
        at === 0 || ours.length < 2
          ? null
          : pairedImprovement(
              { errors: ours },
              { errors: reference, sides: Uint32Array.from(sides) },
              false
            );
      return {
        key,
        games,
        days: mine.days.size,
        decided: brierMine.length,
        squared: meanOf(squaredMine),
        brier: meanOf(brierMine),
        controlSquared: meanOf(squaredTheirs),
        controlBrier: meanOf(brierTheirs),
        squaredGain: gain(squaredMine, squaredTheirs, mine.sides),
        brierGain: gain(brierMine, brierTheirs, mine.decidedSides),
        measurable,
      };
    });

    const mineBoard = boards[at]!;
    let kept = 0;
    let of = 0;
    let wellKept = 0;
    let wellOf = 0;
    let changed = 0;
    let ones = 0;
    let wellChanged = 0;
    let wellOnes = 0;
    let islands = 0;
    yearPages.forEach((page) => {
      const theirs = controlBoard.rows.get(page.id) ?? [];
      const ours = mineBoard.rows.get(page.id) ?? [];
      const ourTop = new Set(ours.slice(0, 25).map((row) => row.teamId));
      theirs.slice(0, 25).forEach((row) => {
        of += 1;
        if (ourTop.has(row.teamId)) kept += 1;
        if (!isWell(row.teamId)) return;
        wellOf += 1;
        if (ourTop.has(row.teamId)) wellKept += 1;
      });
      const ourOnes = stateOnesOf(ours, stateOf);
      stateOnesOf(theirs, stateOf).forEach((teamId, state) => {
        ones += 1;
        const moved = ourOnes.get(state) !== teamId;
        if (moved) changed += 1;
        if (isWell(teamId)) {
          wellOnes += 1;
          if (moved) wellChanged += 1;
        }
      });
      ourOnes.forEach((teamId) => {
        if (controlOutside(teamId) <= 0) islands += 1;
      });
    });

    return {
      key: variant.key,
      why: variant.why,
      segments,
      cutSeconds: cutSeconds[at]!,
      boardSeconds: mineBoard.seconds,
      topPlaces: { kept, of, wellKept, wellOf },
      stateOnes: { changed, of: ones, wellChanged, wellOf: wellOnes, islands },
      club: clubOn(mineBoard.rows),
    };
  });

  const overall = results[0]?.segments.find((segment) => segment.key === "all");
  return {
    year,
    pageNames: yearPages.map(pageNameOf),
    cuts: cutSummaries,
    scoreFrom,
    ...(input.scoreTo === undefined ? {} : { scoreTo: input.scoreTo }),
    variants: results,
    measurable: overall?.measurable ?? false,
    bar: clearlyBetterBar(Math.max(1, variants.length - 1)),
    clubAsked: query !== undefined,
    ...(() => {
      const first = results[0]?.club[0];
      const detail = first ? leagueDetailOf(first.teamId) : undefined;
      return detail ? { league: detail } : {};
    })(),
  };
};

const signed = (value: number, digits: number) =>
  `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(digits)}`;

/** A gain and its standard error, "+0.095 ± 0.022 (z 4.3)", or a dash. */
const gainWords = (gain: PairedReading | null, digits: number): string =>
  gain === null
    ? "—"
    : `${signed(gain.by, digits)} ± ${gain.standardError.toFixed(digits)}` +
      (gain.standardError > 0 ? ` (z ${signed(gain.by / gain.standardError, 1)})` : "");

/**
 * The report, as lines: `lines` numbers only, fit for a public log (no club, league or name), and
 * `named` the lines that name the club asked about, for a reader allowed to see them.
 */
export const describeCommunitySweep = (
  sweep: CommunitySweep
): { lines: string[]; named: string[] } => {
  const lines: string[] = [];
  const named: string[] = [];
  const say = (line = "") => lines.push(line);
  say(
    `Squad year ${sweep.year ?? "?"}, pages ${sweep.pageNames.join(", ")}: the counted level` +
      " against a level that reads the league's outside games."
  );
  say(
    `Scored from ${sweep.scoreFrom}${sweep.scoreTo ? ` to ${sweep.scoreTo}` : ""}, every game` +
      " between two clubs the cut's fit rated, on the ratings its board showed."
  );
  sweep.cuts.forEach((cut) =>
    say(
      `  cut ${cut.cut}: fitted on ${cut.trained} games, ${cut.communities} leagues; scored` +
        ` ${cut.scored} later games, whose sides' leagues were ${cut.sides.island} island,` +
        ` ${cut.sides.weak} with 1-10 outside games, ${cut.sides.middling} with 11-30 and` +
        ` ${cut.sides.well} with 31 or more`
    )
  );
  say();
  sweep.variants.forEach((variant) => say(`  ${pad(variant.key, 8)} ${variant.why}`));

  say();
  if (!sweep.measurable) {
    const all = sweep.variants[0]?.segments.find((segment) => segment.key === "all");
    say(
      `Not measurable: ${all?.games ?? 0} scored game(s) on ${all?.days ?? 0} day(s) over the cuts,` +
        ` short of ${MIN_PAIRED_GAMES} games on ${MIN_SCORED_DAYS} days. No variant is ranked.`
    );
  } else {
    say(
      "Squared error of the margin (runs²) and Brier score of the win chance: the control's, then" +
        " each variant's gain on the same games, positive = lower than the control's, ± a standard" +
        ` error that reads a club's games together. Named better only past ${sweep.bar.toFixed(2)}` +
        ` standard errors (${sweep.variants.length - 1} variants against one control).`
    );
    SEGMENTS.forEach(({ key, label }) => {
      const control = sweep.variants[0]!.segments.find((segment) => segment.key === key)!;
      say();
      say(`  ${label}: ${control.games} games on ${control.days} days, ${control.decided} decided`);
      if (!control.measurable) {
        say(`    not measurable: too few games or days to rank anything here.`);
        return;
      }
      say(
        `    ${pad("control", 9)} squared ${control.controlSquared.toFixed(3)}` +
          `  Brier ${control.controlBrier.toFixed(5)}`
      );
      sweep.variants.slice(1).forEach((variant) => {
        const reading = variant.segments.find((segment) => segment.key === key)!;
        const better = isClearlyBetter(reading.squaredGain, sweep.variants.length - 1);
        const worse =
          reading.squaredGain !== null &&
          -reading.squaredGain.by > sweep.bar * reading.squaredGain.standardError;
        say(
          `    ${pad(variant.key, 9)} squared ${padLeft(gainWords(reading.squaredGain, 3), 26)}` +
            `  Brier ${padLeft(gainWords(reading.brierGain, 5), 30)}` +
            (better ? "  clearly better" : worse ? "  clearly worse" : "")
        );
      });
    });
  }

  say();
  say("On the board of the day, against the control's:");
  say(
    `  ${pad("variant", 9)}${padLeft("top-25 kept", 14)}${padLeft("well-conn.", 13)}` +
      `${padLeft("state #1s moved", 17)}${padLeft("well-conn. #1s", 16)}${padLeft("island #1s", 12)}` +
      `${padLeft("fit, s", 9)}${padLeft("cut fits, s", 13)}`
  );
  sweep.variants.forEach((variant) => {
    const { topPlaces: top, stateOnes: ones } = variant;
    const cutMean =
      variant.cutSeconds.length > 0
        ? variant.cutSeconds.reduce((sum, value) => sum + value, 0) / variant.cutSeconds.length
        : 0;
    say(
      `  ${pad(variant.key, 9)}${padLeft(`${top.kept}/${top.of}`, 14)}` +
        `${padLeft(`${top.wellKept}/${top.wellOf}`, 13)}` +
        `${padLeft(`${ones.changed}/${ones.of}`, 17)}` +
        `${padLeft(`${ones.wellChanged}/${ones.wellOf}`, 16)}${padLeft(String(ones.islands), 12)}` +
        `${padLeft(variant.boardSeconds.toFixed(2), 9)}${padLeft(cutMean.toFixed(2), 13)}`
    );
  });
  say(
    `  The owner allowed ${OWNER_STATE_ONES} well-connected state #1s (leagues with` +
      ` ${WELL_CONNECTED} or more outside games) to move when the resolution was chosen.` +
      " A variant's fit is two solves, the control's one."
  );

  if (sweep.clubAsked) {
    say();
    const found = sweep.variants[0]?.club ?? [];
    if (found.length === 0) {
      say("The club asked about is not on the board of the day in this pool.");
    } else {
      say(`The club asked about (${found.length} match(es) of its name and town on its page):`);
      found.forEach((_, index) => {
        sweep.variants.forEach((variant) => {
          const club = variant.club[index];
          if (!club) return;
          const words =
            `rating ${signed(club.rating, 2)} (fit ${signed(club.pointRating, 2)}),` +
            ` ${club.stateRank ? `#${club.stateRank} in its state, ` : ""}#${club.rank} on its page,` +
            ` started at ${club.levelPrior === undefined ? "—" : signed(club.levelPrior, 2)},` +
            ` its league ${club.outsideGames ?? "—"} outside games, ${club.record}`;
          say(`  match ${index + 1}, ${pad(variant.key, 8)} ${words}`);
          named.push(
            `  ${club.name} (${club.city ?? "?"}, ${club.state ?? "?"}; ${club.pageName}),` +
              ` ${pad(variant.key, 8)} ${words}`
          );
        });
      });
    }
  }
  const league = sweep.league;
  if (league) {
    say();
    say(
      `Its league as the fit found it: ${league.size} clubs, ${league.inside} games inside it,` +
        ` ${league.outside} rated games with one side outside it` +
        ` (${league.outsideGames.filter((g) => g.twin).length} of them on a day and pairing another shares).`
    );
    named.push("", "Its league as the fit found it, club by club (games inside, games outside):");
    league.members.forEach((member) =>
      named.push(
        `  ${member.name} (${member.place || "?"}): ${member.inside} inside, ${member.outside} outside`
      )
    );
    named.push("Each game with one side outside it:");
    league.outsideGames.forEach((g) =>
      named.push(
        `  ${g.date}  ${g.score}  [member ${g.member}; opponent's league ${g.opponentLeague.size} clubs,` +
          ` ${g.opponentLeague.outside} outside games; filed by ${g.filedBy}]${g.twin ? "  ← same day and pairing as another" : ""}`
      )
    );
  }
  return { lines, named };
};
