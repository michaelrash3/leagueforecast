import { parseDateValue, seasonStartMonth } from "./date";
import { MATCHUP_ODDS_SPREAD, MATCHUP_ODDS_SPREAD_MACHINE_PITCH } from "./oddsSpread";
import { normalCdf, normalQuantile, wilsonScoreInterval } from "./probability";
import { clamp, isFinal, parseNumber } from "./util";
import {
  DEFAULT_GOLD_CUTOFF,
  DEFAULT_TIEBREAKER_ORDER,
  MODEL_AGGRESSION,
  RUN_SCORE_CAP,
  type GameLog,
  type Matchup,
  type PitchMode,
  type Prediction,
  type Settings,
  type Team,
  type TiebreakerFactor,
  type TeamBase,
} from "./types";

export const emptyTeam = (base: TeamBase): Team => ({
  ...base,
  w: 0,
  l: 0,
  t: 0,
  rs: 0,
  ra: 0,
  games: 0,
  pct: 0,
  runDiff: 0,
  rsg: 0,
  rag: 0,
  hpg: 0,
  kpg: 0,
  oppKpg: 0,
  errorsPerGame: 0,
  walksAllowedPerGame: 0,
  walksReceivedPerGame: 0,
  hitDiff: 0,
  errorDiff: 0,
  walkDiff: 0,
  tpi: 0,
  baseTpi: 0,
  sos: 0,
  momentum: 0,
  awayK6: null,
  homeK6: null,
  totalK6: null,
  contactBonus: 0,
  machineDifficulty: 0,
  headToHead: {},
});

export const createTeamId = (name: string, existing: Set<string>) => {
  const compact = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = compact.slice(0, 4) || "TEAM";
  let id = base;
  let counter = 1;

  while (existing.has(id)) {
    id = `${base.slice(0, 3)}${counter}`;
    counter += 1;
  }

  existing.add(id);
  return id;
};

export const standingsPoints = (
  team: Pick<Team, "w" | "t">,
  settings: Pick<Settings, "winPoints" | "tiePoints">
) => team.w * settings.winPoints + team.t * settings.tiePoints;

/**
 * How many teams a season's postseason takes, which drives the simulation and the seeding.
 *
 * The model is written around "how many teams qualify", so rather than special-casing it
 * everywhere, each format is expressed as a number: a cut league uses its setting, an all-in
 * league qualifies everyone, and a league with no postseason qualifies nobody. Displays that only
 * make sense with a real cut line are gated on the format being "cut" instead. Kept here rather
 * than in App so a season that is not open (`seasonGlance.ts`) is seeded by the same rule.
 */
export const effectiveGoldCutoff = (
  settings: Pick<Settings, "postseasonFormat" | "goldCutoff">,
  teamCount: number
): number =>
  settings.postseasonFormat === "cut"
    ? clamp(
        Math.round(settings.goldCutoff || DEFAULT_GOLD_CUTOFF),
        1,
        Math.max(1, teamCount || DEFAULT_GOLD_CUTOFF)
      )
    : settings.postseasonFormat === "all"
      ? Math.max(1, teamCount)
      : 0;

export const getRemainingCounts = (
  teams: readonly Pick<Team, "id" | "games">[],
  remainingGames: readonly Matchup[],
  regularSeasonGamesPerTeam = 0
) => {
  const counts: Record<string, number> = {};
  teams.forEach((team) => {
    counts[team.id] = 0;
  });

  remainingGames.forEach((game) => {
    counts[game.away] = (counts[game.away] ?? 0) + 1;
    counts[game.home] = (counts[game.home] ?? 0) + 1;
  });

  if (regularSeasonGamesPerTeam > 0) {
    teams.forEach((team) => {
      const minimumRemainingFromSeasonLength = Math.max(0, regularSeasonGamesPerTeam - team.games);
      counts[team.id] = Math.max(counts[team.id] ?? 0, minimumRemainingFromSeasonLength);
    });
  }

  return counts;
};

/**
 * The opponent in a game a team owes beyond the schedule (`owedGames`). No team can be it: a team's
 * id is trimmed as it is read in (`coerceTeams`), and this one starts with a space.
 */
export const OWED_OPPONENT = " owed";

/**
 * The games each team still owes under the games-per-team setting beyond those the schedule shows,
 * the ones `getRemainingCounts` adds for the Standings' status, as games against a stand-in that is
 * never ranked (`OWED_OPPONENT`). The exact search plays them after the scheduled games, where a
 * game against nobody can go either way, as the status already reads it. A round at a time, each
 * team owing one more playing it, at home and away by turns, since nothing says which. None where
 * the setting is off or the schedule has them all, so such a league is searched exactly as it
 * always was; and none for games already in `remaining`, so adding them to a list that has them
 * adds nothing.
 */
export const owedGames = (
  teams: readonly Pick<Team, "id" | "games">[],
  remaining: readonly Matchup[],
  settings: Pick<Settings, "regularSeasonGamesPerTeam">
): Matchup[] => {
  const perTeam = Math.max(0, Math.round(settings.regularSeasonGamesPerTeam || 0));
  if (perTeam <= 0) return [];
  const scheduled = getRemainingCounts(teams, remaining);
  const owed = teams.map((team) => Math.max(0, perTeam - team.games - (scheduled[team.id] ?? 0)));
  const games: Matchup[] = [];
  for (let round = 0; round < Math.max(0, ...owed); round += 1) {
    teams.forEach((team, at) => {
      if ((owed[at] ?? 0) <= round) return;
      const home = round % 2 === 1;
      games.push({
        id: `${OWED_OPPONENT} ${team.id} ${round + 1}`,
        date: "",
        away: home ? OWED_OPPONENT : team.id,
        home: home ? team.id : OWED_OPPONENT,
      });
    });
  }
  return games;
};

/**
 * The side a game owed beyond the schedule is played against in a simulated season (`playOwed`):
 * the league's average team. Every number the forecast reads off a team is the league's average of
 * it, each team counted by the games behind it, so a team yet to play adds nothing, and a league
 * whose games are all its own gives a .500 side with no run differential; the forecast then favours
 * a strong team against it and a weak one not. Its games are the league's average count, so the
 * forecast trusts it as far as a typical team, and its rating, where the teams carry one, is theirs
 * averaged by the games behind each. It is nobody's opponent in particular: no head-to-head, nothing
 * booked onto it, and no place in any table. Exported for its tests.
 */
export const leagueAverageSide = (teams: readonly Team[]): Team => {
  type Read = (team: Team) => number | null | undefined;
  const byGames = (team: Team) => team.games;
  const each = () => 1;
  // A mean over the teams of what each gives, counted by `weight`; one giving nothing is left out.
  const mean = (read: Read, weight = byGames): number | null => {
    let sum = 0;
    let count = 0;
    teams.forEach((team) => {
      const value = read(team);
      if (value === null || value === undefined) return;
      sum += value * weight(team);
      count += weight(team);
    });
    return count ? sum / count : null;
  };
  const perGame = (read: Read) => mean((team) => read(team) ?? 0) ?? 0;
  // A season's total, and the count of games itself, as the average team's.
  const perTeam = (read: Read) => mean((team) => read(team) ?? 0, each) ?? 0;
  const rating = mean(
    (team) => team.adjustedRating,
    (team) => team.ratedGames ?? 0
  );
  return {
    ...emptyTeam({ id: OWED_OPPONENT, name: "Not yet scheduled" }),
    games: perTeam((team) => team.games),
    pct: perGame((team) => team.pct),
    rsg: perGame((team) => team.rsg),
    rag: perGame((team) => team.rag),
    hpg: perGame((team) => team.hpg),
    kpg: perGame((team) => team.kpg),
    oppKpg: perGame((team) => team.oppKpg),
    errorsPerGame: perGame((team) => team.errorsPerGame),
    walksAllowedPerGame: perGame((team) => team.walksAllowedPerGame),
    walksReceivedPerGame: perGame((team) => team.walksReceivedPerGame),
    runDiff: perTeam((team) => team.runDiff),
    hitDiff: perTeam((team) => team.hitDiff),
    errorDiff: perTeam((team) => team.errorDiff),
    walkDiff: perTeam((team) => team.walkDiff),
    tpi: perGame((team) => team.tpi),
    baseTpi: perGame((team) => team.baseTpi),
    sos: perGame((team) => team.sos),
    momentum: perGame((team) => team.momentum),
    contactBonus: perGame((team) => team.contactBonus),
    machineDifficulty: perGame((team) => team.machineDifficulty),
    awayK6: mean((team) => team.awayK6),
    homeK6: mean((team) => team.homeK6),
    totalK6: mean((team) => team.totalK6),
    ...(rating === null
      ? {}
      : {
          adjustedRating: rating,
          // The count the average rated team's rating rests on.
          ratedGames:
            mean((team) => (team.adjustedRating === undefined ? null : team.ratedGames), each) ?? 0,
        }),
  };
};

export type MathGoldStatus = {
  goldStatus: "Clinched" | "Eliminated" | "In" | "Alive";
  maxPoints: number;
  blockersAhead: number;
  /** The best and worst PCT this team can still finish on, which is what the cut is decided by. */
  maxPct: number;
  minPct: number;
};

/**
 * The best and worst PCT a team can still finish on.
 *
 * PCT counts a tie as half a win over games *played*, so both ends move as the season runs: the
 * best case wins everything left, the worst loses everything left, and either way the denominator
 * grows. That growth is the whole reason points and PCT disagree — points only ever go up, so a
 * team that has played twice as many games looks twice as strong on points and no stronger at all
 * on PCT.
 */
const pctBounds = (team: Team, remaining: number): { min: number; max: number } => {
  const played = team.w + team.l + team.t;
  const total = played + remaining;
  if (total <= 0) return { min: 0, max: 0 };
  const credited = team.w + team.t * 0.5;
  return { min: credited / total, max: (credited + remaining) / total };
};

/**
 * Whether the maths alone settles a team's Gold Bracket place. The table and simulations rank on
 * league points, so the clinch calculation must use that same currency. PCT bounds remain in the
 * result because callers display them as useful best/worst-record context.
 */
export const getMathGoldStatus = (
  team: Team,
  teams: Team[],
  remainingCounts: Record<string, number>,
  cutoff: number,
  settings: Pick<Settings, "winPoints" | "tiePoints">
): MathGoldStatus => {
  const maxPoints =
    standingsPoints(team, settings) + (remainingCounts[team.id] ?? 0) * settings.winPoints;
  const currentPoints = standingsPoints(team, settings);
  const mine = pctBounds(team, remainingCounts[team.id] ?? 0);

  // Teams that finish above this one however the season goes: their floor clears its ceiling.
  const blockersAhead = teams.filter((other) => {
    if (other.id === team.id) return false;
    return standingsPoints(other, settings) > maxPoints;
  }).length;

  // Teams that can still reach it: their ceiling reaches its floor.
  const possibleCatchers = teams.filter((other) => {
    if (other.id === team.id) return false;
    const otherMax =
      standingsPoints(other, settings) + (remainingCounts[other.id] ?? 0) * settings.winPoints;
    return otherMax >= currentPoints;
  }).length;

  const eliminated = blockersAhead >= cutoff;
  const clinched = possibleCatchers < cutoff;

  return {
    goldStatus: eliminated
      ? "Eliminated"
      : clinched
        ? "Clinched"
        : (team.rank ?? 99) <= cutoff
          ? "In"
          : "Alive",
    maxPoints,
    blockersAhead,
    maxPct: mine.max,
    minPct: mine.min,
  };
};

export type RankOptions = {
  runDiffTiebreaker?: boolean;
  tiebreakerOrder?: TiebreakerFactor[];
  winPoints?: number;
  tiePoints?: number;
};

export const rankOptionsFromSettings = (
  settings: Pick<Settings, "runDiffTiebreaker" | "tiebreakerOrder" | "winPoints" | "tiePoints">
): RankOptions => ({
  runDiffTiebreaker: settings.runDiffTiebreaker,
  tiebreakerOrder: settings.tiebreakerOrder,
  winPoints: settings.winPoints,
  tiePoints: settings.tiePoints,
});

export const resolvedTiebreakerOrder = (options: RankOptions) => {
  if (options.tiebreakerOrder) return options.tiebreakerOrder;
  return options.runDiffTiebreaker ? DEFAULT_TIEBREAKER_ORDER : [];
};

const headToHeadPct = (team: Team, opponentId: string) => {
  const record = team.headToHead?.[opponentId];
  if (!record) return null;
  const games = record.wins + record.losses + record.ties;
  if (games <= 0) return null;
  return (record.wins + record.ties * 0.5) / games;
};

export const compareByTiebreaker = (
  a: Team,
  b: Team,
  factor: TiebreakerFactor,
  tiedGroupSize: number
) => {
  switch (factor) {
    case "headToHead": {
      if (tiedGroupSize !== 2) return 0;
      const aPct = headToHeadPct(a, b.id);
      const bPct = headToHeadPct(b, a.id);
      if (aPct === null || bPct === null || Math.abs(aPct - bPct) <= 0.0001) return 0;
      return bPct - aPct;
    }
    case "runDifferential": {
      // USSSA seeds on AVG run differential (with the run diff already capped upstream).
      const aAvg = a.games ? a.runDiff / a.games : 0;
      const bAvg = b.games ? b.runDiff / b.games : 0;
      if (Math.abs(aAvg - bAvg) > 1e-9) return bAvg - aAvg;
      return 0;
    }
    case "runsAgainst": {
      // USSSA seeds on AVG runs allowed, ascending (fewer is better).
      const aAvg = a.games ? a.ra / a.games : 0;
      const bAvg = b.games ? b.ra / b.games : 0;
      if (Math.abs(aAvg - bAvg) > 1e-9) return aAvg - bAvg;
      return 0;
    }
    case "runsFor": {
      const aAvg = a.games ? a.rs / a.games : 0;
      const bAvg = b.games ? b.rs / b.games : 0;
      if (Math.abs(aAvg - bAvg) > 1e-9) return bAvg - aAvg;
      return 0;
    }
    default:
      return 0;
  }
};

const compareTiedTeams = (tiebreakerOrder: TiebreakerFactor[], tiedGroupSize: number) => {
  return (a: Team, b: Team) => {
    for (const factor of tiebreakerOrder) {
      const diff = compareByTiebreaker(a, b, factor, tiedGroupSize);
      if (diff !== 0) return diff;
    }

    if (Math.abs(b.tpi - a.tpi) > 0.0001) return b.tpi - a.tpi;
    return a.id.localeCompare(b.id);
  };
};

export const rankTeams = (teams: Team[], options: RankOptions) => {
  const tiebreakerOrder = resolvedTiebreakerOrder(options);
  const pointsFor = (team: Team) =>
    team.w * (options.winPoints ?? 1) + team.t * (options.tiePoints ?? 0.5);
  const sortedByRecord = [...teams].sort((a, b) => {
    // These are league standings, not a power ranking. Credit wins already earned first, then
    // penalize losses already spent: with the same points, 0-1 must stay ahead of 0-2 because the
    // latter has one fewer remaining opportunity in an equal-length season.
    const pointsDiff = pointsFor(b) - pointsFor(a);
    if (Math.abs(pointsDiff) > 0.0001) return pointsDiff;
    if (a.l !== b.l) return a.l - b.l;
    return a.id.localeCompare(b.id);
  });

  const sorted: Team[] = [];
  for (let index = 0; index < sortedByRecord.length;) {
    const first = sortedByRecord[index];
    if (!first) break;

    const tiedGroup = [first];
    let nextIndex = index + 1;
    while (nextIndex < sortedByRecord.length) {
      const candidate = sortedByRecord[nextIndex];
      if (
        !candidate ||
        Math.abs(pointsFor(candidate) - pointsFor(first)) > 0.0001 ||
        candidate.l !== first.l
      ) {
        break;
      }
      tiedGroup.push(candidate);
      nextIndex += 1;
    }

    sorted.push(...tiedGroup.sort(compareTiedTeams(tiebreakerOrder, tiedGroup.length)));
    index = nextIndex;
  }

  return sorted.map((team, index) => ({ ...team, rank: index + 1 }));
};

const cloneHeadToHead = (headToHead: Team["headToHead"] = {}) =>
  Object.fromEntries(
    Object.entries(headToHead).map(([id, record]) => [id, { ...record }])
  ) as Record<string, NonNullable<Team["headToHead"]>[string]>;

const ensureHeadToHeadRecord = (team: Team, opponentId: string) => {
  team.headToHead ??= {};
  team.headToHead[opponentId] ??= { wins: 0, losses: 0, ties: 0 };
  return team.headToHead[opponentId];
};

const addHeadToHeadResult = (team: Team, opponentId: string, diff: number) => {
  const record = ensureHeadToHeadRecord(team, opponentId);
  if (diff > 0) record.wins += 1;
  else if (diff < 0) record.losses += 1;
  else record.ties += 1;
};

type InternalTeam = Team & {
  awayKs: number;
  awayInns: number;
  homeKs: number;
  homeInns: number;
  battingHits: number;
  battingKs: number;
  opponentKs: number;
  errors: number;
  opponentErrors: number;
  walksAllowed: number;
  walksReceived: number;
  hitsAllowed: number;
  oppTpiSum: number;
  machineDiffSum: number;
  machineDiffCount: number;
  results: { diff: number; oppId: string }[];
};

const cappedRunDiff = (
  runsFor: number,
  runsAgainst: number,
  maxRunDifferential = RUN_SCORE_CAP
) => {
  const cap = Math.max(0, Math.min(RUN_SCORE_CAP, Math.round(maxRunDifferential)));
  const rawDiff = runsFor - runsAgainst;
  if (cap <= 0) return rawDiff;
  return clamp(rawDiff, -cap, cap);
};

/**
 * Resolve the effective per-game run-differential cap. When autoRunDiffCap is on, the cap follows
 * the pitch format — 8 for machine/coach pitch (which carry a per-inning run limit and earlier
 * mercy) and 12 for player pitch (9U+ has no run limit) — otherwise the manual maxRunDifferential.
 */
/**
 * Puts an opponent-adjusted rating onto each team, which is what lets a forecast know who a team
 * played rather than only what it scored.
 *
 * Attached here and nowhere else, so there is one answer to "does this team have a rating".
 * A team the fit never saw a game for gets no field at all, and every forecast for it stays
 * exactly the number it was before any of this existed.
 *
 * The count is the games the *rating* rests on, not the team's league games, and the difference
 * is the whole point where Team Rankings is switched on: a team with two league games and five
 * tournament results already has a firm rating and should be trusted like one. It is also why the
 * count is read here rather than inside the forecast — a simulated season adds to a team's games
 * as it runs, and leaning ever harder on a rating that is frozen at reality would be wrong.
 */
export const attachAdjustedRatings = (
  teams: Team[],
  ratings: { byTeam: Map<string, number>; games: Map<string, number> }
): Team[] =>
  teams.map((team) => {
    const rating = ratings.byTeam.get(team.id);
    const rated = ratings.games.get(team.id) ?? 0;
    if (rating === undefined || !Number.isFinite(rating) || rated <= 0) return team;
    return { ...team, adjustedRating: rating, ratedGames: rated };
  });

export const resolveMaxRunDifferential = (settings: {
  maxRunDifferential: number;
  pitchMode?: PitchMode;
  autoRunDiffCap?: boolean;
}): number => {
  if (settings.autoRunDiffCap) return settings.pitchMode === "player" ? 12 : 8;
  return settings.maxRunDifferential;
};

export const calculateTeams = (
  teamBases: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  settings: Pick<Settings, "maxRunDifferential"> &
    Partial<Pick<Settings, "pitchMode" | "autoRunDiffCap">> = {
    maxRunDifferential: RUN_SCORE_CAP,
  }
): Team[] => {
  const runDiffCap = resolveMaxRunDifferential(settings);
  const teams: InternalTeam[] = teamBases.map((base) => ({
    ...emptyTeam(base),
    awayKs: 0,
    awayInns: 0,
    homeKs: 0,
    homeInns: 0,
    battingHits: 0,
    battingKs: 0,
    opponentKs: 0,
    errors: 0,
    opponentErrors: 0,
    walksAllowed: 0,
    walksReceived: 0,
    hitsAllowed: 0,
    oppTpiSum: 0,
    machineDiffSum: 0,
    machineDiffCount: 0,
    results: [],
  }));

  const byId = new Map(teams.map((team) => [team.id, team]));
  let leagueKs = 0;
  let leagueInnings = 0;

  // The season's own order, which turns over New Year when its schedule does.
  const start = seasonStartMonth(matchups.map((game) => game.date));
  [...matchups]
    .sort((a, b) => parseDateValue(a.date, start) - parseDateValue(b.date, start))
    .forEach((game) => {
      const log = logs[game.id];
      if (!log || !isFinal(log)) return;

      const away = byId.get(game.away);
      const home = byId.get(game.home);
      if (!away || !home) return;

      const awayRuns = parseNumber(log.awayRuns);
      const homeRuns = parseNumber(log.homeRuns);
      const innings = parseNumber(log.innings, 6) || 6;
      const awayK = parseNumber(log.awayK);
      const homeK = parseNumber(log.homeK);
      const awayHits = parseNumber(log.awayHits);
      const homeHits = parseNumber(log.homeHits);
      const awayErrors = parseNumber(log.awayErrors ?? "");
      const homeErrors = parseNumber(log.homeErrors ?? "");
      const awayWalksAllowed = parseNumber(log.awayWalksAllowed ?? "");
      const homeWalksAllowed = parseNumber(log.homeWalksAllowed ?? "");

      away.games += 1;
      home.games += 1;
      away.rs += awayRuns;
      away.ra += homeRuns;
      home.rs += homeRuns;
      home.ra += awayRuns;
      away.runDiff += cappedRunDiff(awayRuns, homeRuns, runDiffCap);
      home.runDiff += cappedRunDiff(homeRuns, awayRuns, runDiffCap);

      away.awayKs += awayK;
      away.awayInns += innings;
      home.homeKs += homeK;
      home.homeInns += innings;
      away.battingHits += awayHits;
      home.battingHits += homeHits;
      away.battingKs += awayK;
      home.battingKs += homeK;
      away.opponentKs += homeK;
      home.opponentKs += awayK;
      away.errors += awayErrors;
      home.errors += homeErrors;
      away.opponentErrors += homeErrors;
      home.opponentErrors += awayErrors;
      away.walksAllowed += awayWalksAllowed;
      home.walksAllowed += homeWalksAllowed;
      away.walksReceived += homeWalksAllowed;
      home.walksReceived += awayWalksAllowed;
      away.hitsAllowed += homeHits;
      home.hitsAllowed += awayHits;

      leagueKs += awayK + homeK;
      leagueInnings += innings * 2;

      away.results.push({ diff: awayRuns - homeRuns, oppId: home.id });
      home.results.push({ diff: homeRuns - awayRuns, oppId: away.id });
      addHeadToHeadResult(away, home.id, awayRuns - homeRuns);
      addHeadToHeadResult(home, away.id, homeRuns - awayRuns);

      if (awayRuns > homeRuns) {
        away.w += 1;
        home.l += 1;
      } else if (homeRuns > awayRuns) {
        home.w += 1;
        away.l += 1;
      } else {
        away.t += 1;
        home.t += 1;
      }
    });

  const leagueK6 = leagueInnings > 30 ? (leagueKs / leagueInnings) * 6 : 4.5;

  teams.forEach((team) => {
    team.pct = team.games ? (team.w + team.t * 0.5) / team.games : 0;
    team.rsg = team.games ? team.rs / team.games : 0;
    team.rag = team.games ? team.ra / team.games : 0;
    team.hpg = team.games ? team.battingHits / team.games : 0;
    team.kpg = team.games ? team.battingKs / team.games : 0;
    team.oppKpg = team.games ? team.opponentKs / team.games : 0;
    team.errorsPerGame = team.games ? team.errors / team.games : 0;
    team.walksAllowedPerGame = team.games ? team.walksAllowed / team.games : 0;
    team.walksReceivedPerGame = team.games ? team.walksReceived / team.games : 0;
    team.hitDiff = team.battingHits - team.hitsAllowed;
    team.errorDiff = team.opponentErrors - team.errors;
    team.walkDiff = team.walksReceived - team.walksAllowed;

    const innings = team.awayInns + team.homeInns;
    const k6 = innings ? ((team.awayKs + team.homeKs) / innings) * 6 : null;
    const contactBonus = k6 !== null ? clamp((leagueK6 - k6) * 0.35, -1.25, 1.25) : 0;
    const diffPerGame = team.games ? clamp(team.runDiff / team.games, -8, 8) : 0;

    team.baseTpi = team.games ? diffPerGame + team.pct * 2 + contactBonus : 0;
    // Kept on the team so `settleGame` can rebuild `baseTpi` around it: see `Team.contactBonus`.
    team.contactBonus = team.games ? contactBonus : 0;
    team.awayK6 = team.awayInns ? (team.awayKs / team.awayInns) * 6 : null;
    team.homeK6 = team.homeInns ? (team.homeKs / team.homeInns) * 6 : null;
    team.totalK6 = k6;
  });

  matchups.forEach((game) => {
    const log = logs[game.id];
    if (!log || !isFinal(log)) return;
    const away = byId.get(game.away);
    const home = byId.get(game.home);
    if (!away || !home) return;

    away.oppTpiSum += home.baseTpi;
    home.oppTpiSum += away.baseTpi;

    const innings = parseNumber(log.innings, 6) || 6;
    const awayK = parseNumber(log.awayK);
    const awayInnings = away.awayInns + away.homeInns;
    const awayBaseline = awayInnings
      ? ((away.awayKs + away.homeKs + leagueK6 * 2) / (awayInnings + 12)) * 6
      : leagueK6;

    home.machineDiffSum += (awayK / innings) * 6 - awayBaseline;
    home.machineDiffCount += 1;
  });

  const computeRecencyMomentum = (team: InternalTeam, byId: Map<string, InternalTeam>) => {
    const recent = team.results.slice(-6);
    if (recent.length < 3 || team.games === 0) return 0;

    let weightedDiff = 0;
    let weightedOppStrength = 0;
    let weightSum = 0;
    recent.forEach((game, index) => {
      const age = recent.length - 1 - index;
      const weight = 0.72 ** age;
      const opp = byId.get(game.oppId);
      weightedDiff += game.diff * weight;
      weightedOppStrength += (opp?.baseTpi ?? 0) * weight;
      weightSum += weight;
    });

    if (weightSum <= 0) return 0;

    const recencyDiff = weightedDiff / weightSum;
    const recencyOppStrength = weightedOppStrength / weightSum;
    const seasonDiff = team.runDiff / team.games;

    return clamp(recencyDiff - seasonDiff + recencyOppStrength * 0.18, -4.5, 4.5);
  };

  teams.forEach((team) => {
    team.sos = team.games ? team.oppTpiSum / team.games : 0;
    team.tpi = team.baseTpi + team.sos * 0.2;
    team.machineDifficulty = team.machineDiffCount
      ? clamp(team.machineDiffSum / team.machineDiffCount, -3, 3)
      : 0;

    team.momentum = computeRecencyMomentum(team, byId);
  });

  return teams.map(
    ({
      awayKs: _ak,
      awayInns: _ai,
      homeKs: _hk,
      homeInns: _hi,
      battingHits: _bh,
      battingKs: _bk,
      opponentKs: _ok,
      errors: _e,
      opponentErrors: _oe,
      walksAllowed: _wa,
      walksReceived: _wr,
      hitsAllowed: _ha,
      oppTpiSum: _ot,
      machineDiffSum: _md,
      machineDiffCount: _mc,
      results: _r,
      ...team
    }) => team
  );
};

const buildByIdMap = (teams: Team[]) => {
  const map = new Map<string, Team>();
  teams.forEach((team) => map.set(team.id, team));
  return map;
};

const logit = (p: number) => Math.log(p / (1 - p));
const logistic = (value: number) => 1 / (1 + Math.exp(-value));

const headToHeadEdge = (team: Team, opponentId: string) => {
  const record = team.headToHead?.[opponentId];
  if (!record) return 0;

  const games = record.wins + record.losses + record.ties;
  if (games <= 0) return 0;

  const pct = (record.wins + record.ties * 0.5) / games;
  const sampleWeight = clamp(games / 4, 0.25, 1);
  return clamp((pct - 0.5) * 2 * sampleWeight, -1, 1);
};

type MatchupEdgeInput = {
  away: Team;
  home: Team;
  leagueK6: number;
  rawMargin: number;
  aggression: number;
};

const matchupWinEdge = ({ away, home, leagueK6, rawMargin, aggression }: MatchupEdgeInput) => {
  const awayDiffPerGame = away.games ? away.runDiff / away.games : 0;
  const homeDiffPerGame = home.games ? home.runDiff / home.games : 0;
  const awayContact = (leagueK6 - (away.totalK6 ?? leagueK6)) * 0.18 + away.hpg * 0.08;
  const homeContact = (leagueK6 - (home.totalK6 ?? leagueK6)) * 0.18 + home.hpg * 0.08;
  const sampleReliability = clamp((away.games + home.games) / 14, 0.35, 1);

  const marginEdge = clamp(rawMargin / 8, -1.35, 1.35);
  const tpiEdge = clamp((away.tpi - home.tpi) / 7, -1.25, 1.25);
  const scoringEdge = clamp((away.rsg - home.rsg + (home.rag - away.rag) * 0.7) / 9, -1.1, 1.1);
  const pctEdge = clamp((away.pct - home.pct) * 1.35, -1, 1);
  const runDiffEdge = clamp((awayDiffPerGame - homeDiffPerGame) / 7, -1, 1);
  const momentumEdge = clamp((away.momentum - home.momentum) / 7, -0.85, 0.85);
  const contactEdge = clamp((awayContact - homeContact) / 2.5, -0.75, 0.75);
  const sosEdge = clamp((away.sos - home.sos) / 8, -0.55, 0.55);
  const h2hEdge = headToHeadEdge(away, home.id);
  const homeFieldEdge = -0.06;

  const weightedEdge =
    marginEdge * 0.34 +
    tpiEdge * 0.28 +
    scoringEdge * 0.2 +
    pctEdge * 0.15 +
    runDiffEdge * 0.13 +
    momentumEdge * 0.1 +
    h2hEdge * 0.08 +
    contactEdge * 0.07 +
    sosEdge * 0.05 +
    homeFieldEdge;

  const aggressionInfluence = clamp(0.95 + aggression * 0.18, 0.95, 1.25);
  return weightedEdge * sampleReliability * aggressionInfluence;
};

/**
 * The nearest the per-game model's chance comes to certain, either way: no game at this level is a
 * lock. Named for the Dashboard's "Why" panel, which says when a chance it shows is held there.
 */
export const GAME_CHANCE_FLOOR = 0.04;
export const GAME_CHANCE_CEILING = 0.96;

export const calibrateAwayWinPct = (
  rawPct: number,
  awayGames: number,
  homeGames: number,
  aggression: number
) => {
  const clipped = clamp(rawPct, 0.02, 0.98);
  const totalGames = awayGames + homeGames;
  const reliability = clamp(totalGames / 20, 0, 1);
  const shrink = 0.58 + reliability * 0.28;
  const aggressionInfluence = clamp(1 + (aggression - 1) * 0.12, 0.9, 1.1);
  const calibrated = 1 / (1 + Math.exp(-logit(clipped) * shrink * aggressionInfluence));
  return clamp(calibrated, GAME_CHANCE_FLOOR, GAME_CHANCE_CEILING);
};

const playerPitchEdge = (away: Team, home: Team) => {
  const awayDiffPerGame = away.games ? away.runDiff / away.games : 0;
  const homeDiffPerGame = home.games ? home.runDiff / home.games : 0;
  const runDiffEdge = clamp((awayDiffPerGame - homeDiffPerGame) / 8, -1, 1);
  const scoringEdge = clamp((away.rsg - home.rsg + (home.rag - away.rag)) / 10, -1, 1);
  const walkEdge = clamp(
    ((away.walkDiff ?? 0) / Math.max(away.games, 1) -
      (home.walkDiff ?? 0) / Math.max(home.games, 1)) /
      5,
    -1,
    1
  );
  const hitEdge = clamp(
    ((away.hitDiff ?? 0) / Math.max(away.games, 1) -
      (home.hitDiff ?? 0) / Math.max(home.games, 1)) /
      7,
    -1,
    1
  );
  const errorEdge = clamp(
    ((away.errorDiff ?? 0) / Math.max(away.games, 1) -
      (home.errorDiff ?? 0) / Math.max(home.games, 1)) /
      4,
    -1,
    1
  );
  const sosEdge = clamp((away.sos - home.sos) / 8, -1, 1);
  const momentumEdge = clamp((away.momentum - home.momentum) / 7, -1, 1);
  const h2hEdge = headToHeadEdge(away, home.id) * 0.05;

  return (
    runDiffEdge * 0.3 +
    scoringEdge * 0.25 +
    walkEdge * 0.15 +
    hitEdge * 0.1 +
    errorEdge * 0.1 +
    sosEdge * 0.05 +
    momentumEdge * 0.05 +
    h2hEdge -
    0.04
  );
};

/**
 * How far a forecast leans on the opponent-adjusted rating rather than this league's own per-game
 * stats, by how many rated games the thinner-rated of the two sides has.
 *
 * The floor is not zero. A rating of 0 means "league average", which is a better guess than a
 * record-based edge built out of one game, and on simulated seasons the blend was already worth
 * 0.003 to 0.008 of Brier score with nothing but a game or two behind it. 0.40 with nothing rated,
 * 0.52 at one game, 0.70 at four, 0.80 at eight, 0.88 at sixteen.
 *
 * The weights come from a sweep over 400 simulated leagues per case with known true team strengths:
 * every measure — Brier, log loss, winner accuracy, margin error — improved the further the
 * forecast leaned on the rating, in all six scenario-by-pitch-mode cells. The reason is scale
 * rather than direction. The stats model's expected margin has about twice the spread of real
 * margins, while the rating's spread is about right, so a model that is half signal and twice as
 * wide as it should be loses to one that is narrower and better aimed.
 */
export const RATING_PRIOR_FLOOR = 0.4;
export const RATING_PRIOR_GROWTH = 0.6;
export const RATING_PRIOR_MIDPOINT = 4;
/**
 * Runs of rating margin per unit of pre-calibration win edge: how hard the rating pulls a game's
 * forecast.
 *
 * It was 0.25, held below the 0.43 that fitted best on Poisson-scored simulated seasons, because
 * on overdispersed ones anything at 0.43 or above was worse than not blending at all. Real games
 * said otherwise once the rating was fitted to real margins. On the pseudo-leagues
 * `FORECAST_RUN_CAP` describes, 54,265 games scored after three cuts, with the rating capped at 20
 * the per-game log loss was lowest at 0.43 both with Team Rankings results (0.6230, against 0.6327
 * at 0.25) and without them (0.6303 against 0.6394), and the forecast stopped being too shy: the
 * favourite called at about 65% won 66% of the time, at 75% won 76% and at 84% won 84%, where at
 * 0.25 and the old cap of 8 it had won 78%, 90% and 97%. At 0.5 and above it was too sure again.
 * The 8U pages, machine and coach pitch, did best a little higher (0.50, 0.5689 against 0.5716 at
 * 0.43) and were still far better at 0.43 than at the old 0.25 (0.6162).
 *
 * `scheduleDifficulty.ts` reads it too, to state a record as runs, which is the same conversion
 * with no bet riding on it.
 */
export const RATING_EDGE_PER_RUN = 0.43;

/**
 * How many games the model has on a team, counting the ones Team Rankings brought in.
 *
 * Every place that asks "how much do we know here" used the league count alone, which is the one
 * number that is deliberately blind to a tournament. A team with one league game and eight
 * tournament results is not an unknown, and shrinking its forecast toward a coin flip as though it
 * were throws away the evidence the rating was fitted from. Falls back to the league count, so a
 * league with no Team Rankings data behind it is unchanged.
 */
const knownGames = (team: Team) => Math.max(team.games, team.ratedGames ?? 0);

type RatingPrior = { weight: number; margin: number };

/** The rating's view of a matchup, or null when either side has no rating attached. */
const ratingPrior = (away: Team, home: Team): RatingPrior | null => {
  const awayRating = away.adjustedRating;
  const homeRating = home.adjustedRating;
  if (
    awayRating === undefined ||
    homeRating === undefined ||
    !Number.isFinite(awayRating) ||
    !Number.isFinite(homeRating)
  ) {
    return null;
  }
  const rated = Math.max(0, Math.min(away.ratedGames ?? 0, home.ratedGames ?? 0));
  return {
    weight: RATING_PRIOR_FLOOR + RATING_PRIOR_GROWTH * (rated / (rated + RATING_PRIOR_MIDPOINT)),
    margin: awayRating - homeRating,
  };
};

/**
 * Pull a model's expected margin and its pre-calibration win edge toward what the rating says.
 *
 * The edge is blended rather than nudged by the difference between the two margins. Nudging was
 * tried first and made every probability measure worse at every weight, because these models'
 * win edge is not a function of their own margin — it is a separate, better-behaved aggregate of
 * run differential, scoring, walks, hits, errors and form — so pushing it by a margin correction
 * takes out information the probability never had in it.
 *
 * With no rating attached both come back untouched, which is what keeps a league that has never
 * built one on exactly the numbers it has today.
 */
const blendWithRating = (prior: RatingPrior | null, modelMargin: number, modelEdge: number) => {
  if (!prior) return { margin: modelMargin, edge: modelEdge };
  return {
    margin: modelMargin + prior.weight * (prior.margin - modelMargin),
    edge: modelEdge + prior.weight * (prior.margin * RATING_EDGE_PER_RUN - modelEdge),
  };
};

/**
 * What the model needs to know about the league as a whole, carried rather than recounted.
 *
 * Both models place a game against the league's scoring rate, which meant two or three full passes
 * over every team on every prediction — and the simulators predict once per remaining game per
 * iteration, so those passes dominated. A settled game moves the totals by exactly what it added,
 * so the loop builds this once and hands it down. The cap on one game's run differential is a pure
 * function of settings, so it is resolved here too instead of per settled game.
 *
 * Runs and games are counts, so carrying them is exact: integers this small add without rounding,
 * and the pinned answers in sim.test.ts hold to the digit. Strikeouts are not — `kpg` is a rate, so
 * a carried sum of kpg times games and a recounted one can differ in the last bit, and that is a
 * published number moving for no reason anybody chose. So the machine-pitch model still counts
 * that one, and loses the other two.
 */
export type LeagueTally = {
  runs: number;
  games: number;
  runDiffCap: number;
};

const leagueTallyOf = (teams: Team[], settings: Settings): LeagueTally => ({
  runs: teams.reduce((sum, team) => sum + team.rs, 0),
  games: teams.reduce((sum, team) => sum + team.games, 0),
  runDiffCap: resolveMaxRunDifferential(settings),
});

/**
 * What the per-game model's projected margin is made of, from the away side, for a game card's
 * Model Read (`modelRead`): the margin the league's own games give on their own (runs scored and
 * allowed, form, and in machine pitch the strikeouts and power index), the ratings' margin, and how
 * far the projection leans on the ratings (`blendWithRating`), which together are the margin the
 * projected score is split from.
 *
 * Filled in where a caller hands one over, rather than returned: the simulators call the model once
 * per game per season played out and never ask, and an object made for every one of those calls
 * would be made for nothing.
 */
export type GameRead = {
  /** The league's own games read alone; null where a side has fewer than two, as none is read. */
  runs: number | null;
  /** The ratings' margin, the away side's less the home side's; null where either has none. */
  rating: number | null;
  /** The share of the way from the league's games to the ratings the projection goes, 0 to 1. */
  weight: number;
  /** The projected margin each side's runs are split from, before they are rounded. */
  margin: number;
};

/** Writes the model's reading of a game where one was asked for (`GameRead`). */
const writeRead = (
  read: GameRead | undefined,
  runs: number | null,
  prior: RatingPrior | null,
  margin: number
): void => {
  if (!read) return;
  read.runs = runs;
  read.rating = prior ? prior.margin : null;
  read.weight = prior ? prior.weight : 0;
  read.margin = margin;
};

export const predictPlayerPitchGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression">,
  byId?: Map<string, Team>,
  tally?: LeagueTally,
  read?: GameRead
): Prediction => {
  const lookup = byId ?? buildByIdMap(teams);
  const away = lookup.get(game.away);
  const home = lookup.get(game.home);
  const totalRuns = tally ? tally.runs : teams.reduce((sum, team) => sum + team.rs, 0);
  const totalGames = tally ? tally.games : teams.reduce((sum, team) => sum + team.games, 0);
  const leagueRuns = totalGames ? totalRuns / totalGames : 7;
  const aggression = MODEL_AGGRESSION[settings.modelAggression] ?? 1;

  if (!away || !home) {
    writeRead(read, null, null, 0);
    return {
      awayScore: Math.round(leagueRuns),
      homeScore: Math.round(leagueRuns),
      awayWinPct: 0.5,
      winnerId: game.away,
      confidence: "Low",
    };
  }

  if (away.games < 2 || home.games < 2) {
    const awayPrior = away.games ? away.pct : 0.5;
    const homePrior = home.games ? home.pct : 0.5;
    const rawPct = clamp(0.5 + clamp((awayPrior - homePrior) * 0.16, -0.08, 0.08), 0.02, 0.98);
    // Blended in logit space, the same as the full model below, so a rating fitted from games this
    // league never saw is the thing that answers here. Win percentage over one or two games is
    // barely evidence; a rating over nine is, and this is the case it was brought in for.
    const prior = ratingPrior(away, home);
    const blended = blendWithRating(prior, 0, logit(rawPct));
    const awayWinPct = calibrateAwayWinPct(
      logistic(blended.edge),
      knownGames(away),
      knownGames(home),
      aggression
    );
    // With no rating this is the spread this branch has always produced, from the pct alone.
    const spread = prior ? clamp(blended.margin / 2, -4, 4) : clamp((awayWinPct - 0.5) * 6, -1, 1);
    writeRead(read, null, prior, spread * 2);
    return {
      awayScore: Math.max(1, Math.round(leagueRuns + spread)),
      homeScore: Math.max(1, Math.round(leagueRuns - spread)),
      awayWinPct,
      winnerId: awayWinPct >= 0.5 ? game.away : game.home,
      confidence: "Low",
    };
  }

  const awayCommandPressure =
    (home.walksAllowedPerGame ?? 0) * 0.28 - (away.errorsPerGame ?? 0) * 0.18;
  const homeCommandPressure =
    (away.walksAllowedPerGame ?? 0) * 0.28 - (home.errorsPerGame ?? 0) * 0.18;
  const awayScore = Math.max(
    1,
    (away.rsg * home.rag) / Math.max(leagueRuns, 1) + awayCommandPressure + away.momentum * 0.08
  );
  const homeScore = Math.max(
    1,
    (home.rsg * away.rag) / Math.max(leagueRuns, 1) + homeCommandPressure + home.momentum * 0.08
  );
  const edge = playerPitchEdge(away, home) * clamp(0.95 + aggression * 0.16, 0.95, 1.25);
  const prior = ratingPrior(away, home);
  const blended = blendWithRating(prior, awayScore - homeScore, edge);
  writeRead(read, awayScore - homeScore, prior, blended.margin);
  const awayWinPct = calibrateAwayWinPct(
    logistic(blended.edge),
    knownGames(away),
    knownGames(home),
    aggression
  );
  const winnerId = awayWinPct >= 0.5 ? game.away : game.home;
  const winnerPct = winnerId === game.away ? awayWinPct : 1 - awayWinPct;
  const margin = Math.abs(blended.margin);
  const confidence: Prediction["confidence"] =
    away.games >= 6 && home.games >= 6 && margin >= 5 && winnerPct >= 0.76
      ? "High"
      : away.games >= 4 && home.games >= 4 && margin >= 2.5 && winnerPct >= 0.63
        ? "Medium"
        : "Low";
  // The expected total is kept and only the gap between the two sides moves, so a blend cannot
  // quietly turn a 9-7 into a 2-0.
  const midpoint = (awayScore + homeScore) / 2;
  return {
    awayScore: Math.max(1, Math.round(midpoint + blended.margin / 2)),
    homeScore: Math.max(1, Math.round(midpoint - blended.margin / 2)),
    awayWinPct,
    winnerId,
    confidence,
  };
};

export const predictMachinePitchGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression">,
  byId?: Map<string, Team>,
  tally?: LeagueTally,
  read?: GameRead
): Prediction => {
  const lookup = byId ?? buildByIdMap(teams);
  const away = lookup.get(game.away);
  const home = lookup.get(game.home);
  const totalRuns = tally ? tally.runs : teams.reduce((sum, team) => sum + team.rs, 0);
  const totalGames = tally ? tally.games : teams.reduce((sum, team) => sum + team.games, 0);
  // Counted, not carried: see LeagueTally on why this one cannot be added up as it goes.
  const totalStrikeouts = teams.reduce((sum, team) => sum + team.kpg * team.games, 0);
  const leagueRuns = totalGames ? totalRuns / totalGames : 7;
  const leagueK6 = totalGames ? totalStrikeouts / totalGames : 4.5;
  const aggression = MODEL_AGGRESSION[settings.modelAggression] ?? 1;

  if (!away || !home) {
    writeRead(read, null, null, 0);
    return {
      awayScore: Math.round(leagueRuns),
      homeScore: Math.round(leagueRuns),
      awayWinPct: 0.5,
      winnerId: game.away,
      confidence: "Low",
    };
  }

  if (away.games < 2 || home.games < 2) {
    const awayPrior = away.games ? away.pct : 0.5;
    const homePrior = home.games ? home.pct : 0.5;
    const priorDiff = clamp((awayPrior - homePrior) * 0.18, -0.08, 0.08);
    // See the same branch in the player-pitch model: the rating answers here when there is one.
    const prior = ratingPrior(away, home);
    const blended = blendWithRating(prior, 0, logit(clamp(0.5 + priorDiff, 0.02, 0.98)));
    const awayWinPct = calibrateAwayWinPct(
      logistic(blended.edge),
      knownGames(away),
      knownGames(home),
      aggression
    );
    const scoreSpread = prior
      ? clamp(blended.margin / 2, -4, 4)
      : clamp((awayWinPct - 0.5) * 6, -1, 1);
    writeRead(read, null, prior, scoreSpread * 2);
    return {
      awayScore: Math.max(1, Math.round(leagueRuns + scoreSpread)),
      homeScore: Math.max(1, Math.round(leagueRuns - scoreSpread)),
      awayWinPct,
      winnerId: awayWinPct >= 0.5 ? game.away : game.home,
      confidence: "Low",
    };
  }

  let awayScore = (away.rsg * home.rag) / Math.max(leagueRuns, 1);
  let homeScore = (home.rsg * away.rag) / Math.max(leagueRuns, 1);

  const tpiDiff = clamp(away.tpi - home.tpi, -6, 6);
  awayScore =
    awayScore * (1 + tpiDiff * 0.025 * aggression) +
    clamp(away.momentum, -3, 3) * 0.15 * aggression;
  homeScore =
    homeScore * (1 - tpiDiff * 0.025 * aggression) +
    clamp(home.momentum, -3, 3) * 0.15 * aggression;

  const kDiff = clamp((away.awayK6 ?? 4.5) + home.machineDifficulty - (home.homeK6 ?? 4.5), -3, 3);
  if (kDiff > 0) homeScore += kDiff * 0.2;
  if (kDiff < 0) awayScore += Math.abs(kDiff) * 0.2;

  const safeAway = Math.max(1, awayScore);
  const safeHome = Math.max(1, homeScore);
  const rawMargin = safeAway - safeHome;
  const edge = matchupWinEdge({ away, home, leagueK6, rawMargin, aggression });
  const prior = ratingPrior(away, home);
  const blended = blendWithRating(prior, rawMargin, edge);
  writeRead(read, rawMargin, prior, blended.margin);
  const midpoint = (safeAway + safeHome) / 2;
  const roundedAway = Math.max(1, Math.round(midpoint + blended.margin / 2));
  const roundedHome = Math.max(1, Math.round(midpoint - blended.margin / 2));
  const rawAwayWinPct = logistic(blended.edge);
  const awayWinPct = calibrateAwayWinPct(
    rawAwayWinPct,
    knownGames(away),
    knownGames(home),
    aggression
  );
  const winnerId = awayWinPct >= 0.5 ? game.away : game.home;
  const winnerPct = winnerId === game.away ? awayWinPct : 1 - awayWinPct;
  const margin = Math.abs(blended.margin);

  let confidence: Prediction["confidence"] = "Low";
  if (away.games >= 6 && home.games >= 6 && margin >= 6 && winnerPct >= 0.78) {
    confidence = "High";
  } else if (away.games >= 4 && home.games >= 4 && margin >= 3 && winnerPct >= 0.65) {
    confidence = "Medium";
  }

  return {
    awayScore: roundedAway,
    homeScore: roundedHome,
    awayWinPct,
    winnerId,
    confidence,
  };
};

export const predictGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression" | "pitchMode">,
  byId?: Map<string, Team>,
  tally?: LeagueTally,
  /** Where given, filled in with what the projected margin is made of (`GameRead`). */
  read?: GameRead
): Prediction => {
  if (settings.pitchMode === "player")
    return predictPlayerPitchGame(game, teams, settings, byId, tally, read);
  return predictMachinePitchGame(game, teams, settings, byId, tally, read);
};

/**
 * Books one projected result onto its two sides, in place: the model's predicted score, nudged so
 * the given winner actually wins. The records, runs, run differential, head-to-head and the rating
 * fields the tiebreakers read all move with it.
 *
 * What `applyResult` books, for the projections that pick a winner rather than draw a season. The
 * simulators draw the margin too, and book it with `settleDrawn`.
 */
const settleGame = (
  away: Team,
  home: Team,
  game: Matchup,
  winnerId: string,
  prediction: Prediction,
  settings: Settings
): void => {
  const { awayRuns, homeRuns } = projectedRuns(game, winnerId, prediction);
  bookScore(away, home, awayRuns, homeRuns, resolveMaxRunDifferential(settings));
};

/** The model's predicted score, nudged so the given winner wins: what a projection books. */
const projectedRuns = (
  game: Matchup,
  winnerId: string,
  prediction: Prediction
): { awayRuns: number; homeRuns: number } => {
  let awayRuns = prediction.awayScore;
  let homeRuns = prediction.homeScore;
  if (winnerId === game.away && awayRuns <= homeRuns) awayRuns = homeRuns + 1;
  if (winnerId === game.home && homeRuns <= awayRuns) homeRuns = awayRuns + 1;
  return { awayRuns, homeRuns };
};

/** In a game owed beyond the schedule (`owedGames`), the team that owes it. */
const owerOf = (game: Matchup): string => (game.away === OWED_OPPONENT ? game.home : game.away);

/**
 * Books one projected result of a game owed beyond the schedule onto the team that owes it, in
 * place: the model's score against the league's average side (`leagueAverageSide`), nudged so the
 * given winner wins, as `settleGame` books a scheduled one, on the team's side alone, since the
 * side it is played against is in no table.
 */
const settleOwed = (
  team: Team,
  game: Matchup,
  winnerId: string,
  prediction: Prediction,
  settings: Settings
): void => {
  const { awayRuns, homeRuns } = projectedRuns(game, winnerId, prediction);
  const cap = resolveMaxRunDifferential(settings);
  if (game.away === team.id) bookSide(team, awayRuns, homeRuns, cap);
  else bookSide(team, homeRuns, awayRuns, cap);
};

/**
 * One side of a score booked onto a team the caller owns: the game, the runs, the run differential
 * as capped, the record (a level score is a tie) and the rating the tiebreakers fall back on. A
 * side's numbers move with its own runs alone, so booking the two sides of a game one after the
 * other is booking the game; a game owed beyond the schedule (`owedGames`) books its team's side
 * and no other.
 */
const bookSide = (team: Team, runsFor: number, runsAgainst: number, runDiffCap: number): void => {
  team.games += 1;
  team.rs += runsFor;
  team.ra += runsAgainst;
  team.runDiff += cappedRunDiff(runsFor, runsAgainst, runDiffCap);
  if (runsFor > runsAgainst) team.w += 1;
  else if (runsFor < runsAgainst) team.l += 1;
  else team.t += 1;
  team.pct = team.games ? (team.w + team.t * 0.5) / team.games : 0;
  // Keep per-game production rates anchored to finalized games only. Projected
  // results can update standings and run-differential tiebreakers, but they
  // should not dilute displayed R/G, H/G, K/G, or opponent K/G with model-generated games.
  const diffPerGame = team.games ? clamp(team.runDiff / team.games, -8, 8) : 0;
  // The contact term is carried, not recomputed. It is the one piece of `baseTpi` that comes
  // from strikeout rates, and a model game has none — so recomputing it here does not leave it
  // undiluted, it deletes it. Before this, booking the first simulated game moved `baseTpi` by
  // up to 1.25 in either direction on a four-team pin, and `tpi` feeds `predictGame` and the
  // tiebreakers for every game after it in the same iteration.
  team.baseTpi = team.games ? diffPerGame + team.pct * 2 + (team.contactBonus ?? 0) : 0;
  team.tpi = team.baseTpi + team.sos * 0.2;
};

/**
 * One score booked onto two teams the caller owns: each side (`bookSide`) and the head-to-head
 * between them. Every simulated game is booked here (`settleDrawn`), and the standings solver books
 * the last game of a season here too, so a table it ranks is the one a forecast would.
 */
const bookScore = (
  away: Team,
  home: Team,
  awayRuns: number,
  homeRuns: number,
  runDiffCap: number
): void => {
  bookSide(away, awayRuns, homeRuns, runDiffCap);
  bookSide(home, homeRuns, awayRuns, runDiffCap);
  addHeadToHeadResult(away, home.id, awayRuns - homeRuns);
  addHeadToHeadResult(home, away.id, homeRuns - awayRuns);
};

/**
 * The teams with the one game left booked at a given score, as new objects where they change; the
 * inputs are untouched. What the standings solver ranks to see where a team finishes on the last
 * day of a season (`neededResults`). A game owed beyond the schedule (`owedGames`) has one side in
 * the league, and that side alone is booked.
 */
export const withScore = (
  teams: Team[],
  game: Matchup,
  awayRuns: number,
  homeRuns: number,
  settings: Settings
): Team[] => {
  const next = teams.map((team) =>
    team.id === game.away || team.id === game.home
      ? { ...team, headToHead: cloneHeadToHead(team.headToHead) }
      : team
  );
  const away = next.find((team) => team.id === game.away);
  const home = next.find((team) => team.id === game.home);
  const cap = resolveMaxRunDifferential(settings);
  if (away && home) bookScore(away, home, awayRuns, homeRuns, cap);
  else if (away) bookSide(away, awayRuns, homeRuns, cap);
  else if (home) bookSide(home, homeRuns, awayRuns, cap);
  return next;
};

/**
 * The teams with one result applied, as new objects; the inputs are untouched. What
 * `projectStandings` and the tests use, and what the simulators used to, one clone per game.
 */
export const applyResult = (
  teams: Team[],
  game: Matchup,
  winnerId: string,
  modelTeams: Team[],
  settings: Settings
) => {
  const next = teams.map((team) => ({ ...team, headToHead: cloneHeadToHead(team.headToHead) }));
  const byId = buildByIdMap(next);
  const away = byId.get(game.away);
  const home = byId.get(game.home);
  if (!away || !home) return next;
  settleGame(away, home, game, winnerId, predictGame(game, modelTeams, settings), settings);
  return next;
};

/**
 * One iteration's copy of the league to play a season out on: every team and every head-to-head
 * record copied once, so the loop can write results straight onto them, with the lookup built once
 * beside them rather than once per game.
 */
const scratchSeason = (teams: Team[]): { season: Team[]; byId: Map<string, Team> } => {
  const season = teams.map((team) => ({ ...team, headToHead: cloneHeadToHead(team.headToHead) }));
  return { season, byId: buildByIdMap(season) };
};

/**
 * A share of games tied, read as though this many games without a tie came before the league's
 * own. A judgement, not a measurement: most leagues play every game to a result, and one tie in a
 * league's first six games should not make one in six of the rest a tie.
 */
const TIE_PRIOR_GAMES = 10;

/**
 * The normal curve that gives the same odds as the logistic one with spread `s` has a standard
 * deviation of about 1.702 s (the usual match of the two curves, within 0.01 of a probability
 * everywhere).
 */
const LOGISTIC_TO_NORMAL = 1.702;

/** What a simulated season draws beyond who wins each game (`seasonDraws`). */
export type SeasonDraws = {
  random: () => number;
  /** How often a game is drawn level (`TIE_PRIOR_GAMES`). */
  tieShare: number;
  /** How far one game's margin falls from the predicted one: a normal curve's width, in runs. */
  spread: number;
  /**
   * A paired run's (`simulateGoldOddsRun`): every game that may end level makes the tie draw,
   * whatever the share. Its two points draw each game from one stream, and where the result
   * between them was the league's first tie, the point before, with no share to draw at, made a
   * draw fewer a game than the point after: every game drew apart, and the step was two runs'
   * chance again. On four synthetic eight-team leagues, 30 seeds each, the step spread 2.27 points
   * from seed to seed, where on a win it spread 0.85; drawn every game, 1.05 (0.87 on a win).
   */
  tieAlwaysDrawn?: true;
};

/**
 * What a simulated game draws beyond who wins it: by how much, and whether it is tied.
 *
 * Each game used to be booked at the model's predicted score, the drawn winner nudged to win by
 * one where the score had it losing. So no simulated game was tied, every upset was won by a run,
 * every favourite by its predicted margin, and the run differential the tiebreakers read moved
 * only with who won: two teams level on points were split the same way in every season drawn.
 *
 * Now the winner is drawn at the model's chance, as before, and the margin from a normal curve
 * around the predicted margin, held to the winner's side of level (`drawMargin`). Its width is the
 * odds curve's spread (`MATCHUP_ODDS_SPREAD`), the margin that moves a matchup from even to about
 * 73%, read as a normal curve (`LOGISTIC_TO_NORMAL`): 8.0 runs for kid pitch and 6.7 for machine
 * and coach pitch. A league that has had ties draws them at its own share so far
 * (`TIE_PRIOR_GAMES`); one that has had none draws none.
 *
 * Measured on made-up leagues, played out from known strengths with a game's noise on top and
 * forecast part way through by the simulation that shipped and by this one, then scored against how
 * each season really finished (1,500 leagues a setting, nine settings; the commit has every
 * number): the Gold odds' log loss was lower in six settings, by 0.001 to 0.0035, level in two, and
 * higher in one, by 0.003, a league of six far apart in strength whose games varied by 6 runs, well
 * under the curve's 8. The curve's width is the one the pool's own games measured, so a league whose
 * games are much closer than the pool's is the case it serves least. Drawing each team's strength
 * once a season as well, which the plan first had, made the odds worse at every point: the model's
 * chance for a game already allows for how little its ratings are known, and a team's season drawn
 * on top counted that twice, so a team given 14% made the cut 5% of the time.
 *
 * Exported, with `drawMargin`, for their tests.
 */
export const seasonDraws = (
  teams: readonly Team[],
  settings: Pick<Settings, "pitchMode">,
  random: () => number
): SeasonDraws => ({ random, ...drawWidths(teams, settings) });

/**
 * How widely a simulated game is drawn (`seasonDraws`) apart from the stream it is drawn from: the
 * share of games tied and the curve's width. What a game card's range is read off
 * (`drawnMarginSpan`), so it is the width the Gold odds draw at.
 */
export const drawWidths = (
  teams: readonly Team[],
  settings: Pick<Settings, "pitchMode">
): Pick<SeasonDraws, "tieShare" | "spread"> => {
  const ties = teams.reduce((sum, team) => sum + team.t, 0);
  const games = teams.reduce((sum, team) => sum + team.games, 0);
  const spread =
    settings.pitchMode === "machine" || settings.pitchMode === "coach"
      ? MATCHUP_ODDS_SPREAD_MACHINE_PITCH
      : MATCHUP_ODDS_SPREAD;
  return {
    // Each game is counted on both sides, so the ties and games are both twice over.
    tieShare: ties / (games + 2 * TIE_PRIOR_GAMES),
    spread: spread * LOGISTIC_TO_NORMAL,
  };
};

/**
 * One game's margin, in whole runs: positive for an away win, negative for a home one, and 0 for a
 * tie, which only a game that may end level is drawn. The away side wins exactly as often as
 * `awayWinPct` says; the margin is then the normal curve around `predicted`, the predicted margin,
 * on that side of level: the second draw placed within the part of the curve that side's margins
 * fill. Two draws a game, three where the league has had ties or the run is paired
 * (`SeasonDraws.tieAlwaysDrawn`), whatever the game comes to.
 */
export const drawMargin = (
  draws: SeasonDraws,
  awayWinPct: number,
  predicted: number,
  mayTie: boolean
): number => {
  if (mayTie && (draws.tieShare > 0 || draws.tieAlwaysDrawn) && draws.random() < draws.tieShare) {
    return 0;
  }
  const awayWins = draws.random() < awayWinPct;
  const level = normalCdf(-predicted / draws.spread);
  const placed = draws.random();
  const at = awayWins ? level + placed * (1 - level) : placed * level;
  const runs = predicted + draws.spread * normalQuantile(clamp(at, 1e-12, 1 - 1e-12));
  return awayWins ? Math.max(1, Math.round(runs)) : Math.min(-1, Math.round(runs));
};

/** The share of a game's drawn margins a game card's range holds: eight games in ten. */
export const DRAWN_RANGE_SHARE = 0.8;

/**
 * The margins one game is drawn at eight times in ten, as `drawMargin` draws them: its tenth and
 * ninetieth percentiles, in whole runs, from the away side. Worked out rather than sampled, from the
 * same three parts: a tie at the league's share, the away side winning at its chance, and the margin
 * on the curve around the predicted one on the winner's side of level, rounded as drawn. So the
 * range a card shows is the one the Gold odds play the game within, and it follows the chance as
 * well as the margin: an underdog given more than the curve gives it wins more of its share by
 * little, and the range reaches further its way.
 */
export const drawnMarginSpan = (
  draws: Pick<SeasonDraws, "tieShare" | "spread">,
  awayWinPct: number,
  predicted: number,
  share = DRAWN_RANGE_SHARE
): { low: number; high: number } => {
  const tie = draws.tieShare;
  const homeWins = (1 - tie) * (1 - awayWinPct);
  const awayWins = (1 - tie) * awayWinPct;
  const level = normalCdf(-predicted / draws.spread);
  const curve = (at: number) =>
    predicted + draws.spread * normalQuantile(clamp(at, 1e-12, 1 - 1e-12));
  /**
   * The margin a share `q` of the game's draws fall at or below. Where `q` is exactly the share of
   * one side's wins, a margin of 1 either way would do; the low end takes the nearer the home side
   * and the high end the nearer the away side, so the game read from the other side is the same
   * range turned round: an away side given exactly one chance in ten reaches no further than a home
   * side given the same.
   */
  const at = (q: number, high: boolean): number => {
    const within = (share: number) => (high ? q < share : q <= share);
    if (within(homeWins)) return Math.min(-1, Math.round(curve((q / homeWins) * level)));
    if (within(homeWins + tie)) return 0;
    return Math.max(1, Math.round(curve(level + ((q - homeWins - tie) / awayWins) * (1 - level))));
  };
  const tail = (1 - share) / 2;
  return { low: at(tail, false), high: at(1 - tail, true) };
};

/**
 * One side's runs in a game drawn at `margin` from that side (`drawMargin`), the Gold odds' way: the
 * projected total kept, split so that the margin is the drawn one, the loser never below nothing,
 * and a tie each side half. The other side's runs are the same split at the margin turned round.
 * What every simulated game is booked at (`settleDrawn`), and so what a card's score range is read
 * off at the two ends of its margin range: a side's runs only ever rise with its margin.
 */
export const drawnRuns = (total: number, margin: number): number =>
  margin === 0
    ? Math.round(total / 2)
    : Math.max(0, Math.round((total - Math.abs(margin)) / 2)) + Math.max(0, margin);

/**
 * Books a drawn margin onto the two sides, in place: the predicted total kept, split so that the
 * margin is the drawn one, the loser never below nothing. The league's carried totals move by
 * exactly what is booked, so they stay the counted ones. A side left out is the stand-in of a game
 * owed beyond the schedule (`playOwed`), so only the team's own side is booked and counted.
 */
const settleDrawn = (
  away: Team | undefined,
  home: Team | undefined,
  margin: number,
  prediction: Prediction,
  tally: LeagueTally
): void => {
  const total = prediction.awayScore + prediction.homeScore;
  const awayRuns = drawnRuns(total, margin);
  const homeRuns = drawnRuns(total, -margin);
  if (away && home) {
    tally.runs += awayRuns + homeRuns;
    tally.games += 2;
    bookScore(away, home, awayRuns, homeRuns, tally.runDiffCap);
  } else if (away) {
    tally.runs += awayRuns;
    tally.games += 1;
    bookSide(away, awayRuns, homeRuns, tally.runDiffCap);
  } else if (home) {
    tally.runs += homeRuns;
    tally.games += 1;
    bookSide(home, homeRuns, awayRuns, tally.runDiffCap);
  }
};

/** How a game went, as `playOut` writes it down for the team followed (`GoldSwing`). */
const HOME_WON = 0;
const AWAY_WON = 1;
const TIED = 2;

/**
 * Plays the remaining games once, in order, writing each result onto the scratch season so the
 * next prediction sees the standings as they then are. Each game makes the same number of draws
 * whatever it comes to, so a season's draws, and every answer, follow from the seed alone.
 */
const playOut = (
  season: Team[],
  byId: Map<string, Team>,
  remaining: Matchup[],
  settings: Settings,
  draws: SeasonDraws,
  /** Where given, how each game went, at its place (`HOME_WON`, `AWAY_WON` or `TIED`). */
  results?: Uint8Array,
  /**
   * In a paired run, its draws (`SeasonDraws.tieAlwaysDrawn`), its seed, this season's number and
   * each game's key at its place: each game draws a stream of its own (`gameStream`).
   */
  paired?: { draws: SeasonDraws; seed: number; season: number; games: readonly number[] }
): void => {
  const tally = leagueTallyOf(season, settings);
  for (const [at, game] of remaining.entries()) {
    const prediction = predictGame(game, season, settings, byId, tally);
    const margin = drawMargin(
      paired
        ? {
            ...paired.draws,
            random: gameStream(paired.seed, paired.season, paired.games[at] ?? 0),
          }
        : draws,
      prediction.awayWinPct,
      prediction.awayScore - prediction.homeScore,
      true
    );
    if (results) results[at] = margin > 0 ? AWAY_WON : margin < 0 ? HOME_WON : TIED;
    const away = byId.get(game.away);
    const home = byId.get(game.home);
    if (away && home) settleDrawn(away, home, margin, prediction, tally);
  }
};

/** The games owed beyond the schedule (`owedGames`), and the side they are played against. */
export type OwedPlay = { games: Matchup[]; side: Team };

/** What a simulation or a projection plays beyond the schedule: undefined where nothing is owed. */
export const owedPlay = (
  teams: Team[],
  remaining: Matchup[],
  settings: Settings
): OwedPlay | undefined => {
  const games = owedGames(teams, remaining, settings);
  return games.length ? { games, side: leagueAverageSide(teams) } : undefined;
};

/**
 * Plays the games each team owes beyond the schedule, after the scheduled ones, each against the
 * league's average side (`leagueAverageSide`) and drawn as a scheduled game is. The side is in the
 * lookup for these games alone, and booking leaves it as it was (`settleDrawn`), so every owed game
 * is against the same average, which no table ranks and no other game sees. They come after every
 * scheduled game and draw nothing where none is owed, so a league owing none draws what it always
 * did.
 */
const playOwed = (
  season: Team[],
  byId: Map<string, Team>,
  owed: OwedPlay,
  settings: Settings,
  draws: SeasonDraws,
  /**
   * In a paired run, as `playOut` takes it, with each owed game's key at its place: each owed game
   * draws a stream of its own too. Drawn from the run's one stream, a tie drawn in one point and
   * not the other (a tie takes one number, a margin three) moved every owed draw after it, in that
   * season and the ones after, so the step on a league's first tie was two runs' worth of chance.
   */
  paired?: { draws: SeasonDraws; seed: number; season: number; games: readonly number[] }
): void => {
  // The league's totals as the scheduled games left them, which booking keeps the counted ones.
  const tally = leagueTallyOf(season, settings);
  byId.set(OWED_OPPONENT, owed.side);
  for (const [at, game] of owed.games.entries()) {
    const prediction = predictGame(game, season, settings, byId, tally);
    const margin = drawMargin(
      paired
        ? {
            ...paired.draws,
            random: gameStream(paired.seed, paired.season, paired.games[at] ?? 0),
          }
        : draws,
      prediction.awayWinPct,
      prediction.awayScore - prediction.homeScore,
      true
    );
    const away = game.away === OWED_OPPONENT ? undefined : byId.get(game.away);
    const home = game.home === OWED_OPPONENT ? undefined : byId.get(game.home);
    settleDrawn(away, home, margin, prediction, tally);
  }
  byId.delete(OWED_OPPONENT);
};

export const DEFAULT_SEED_LOCK_REMAINING_GAME_LIMIT = 12;

export const isSeedingLocked = (
  teams: Team[],
  remaining: Matchup[],
  settings: Settings,
  maxRemainingGames = DEFAULT_SEED_LOCK_REMAINING_GAME_LIMIT
) => {
  const baseline = rankTeams(teams, rankOptionsFromSettings(settings));
  const baselineRanks = new Map(baseline.map((team) => [team.id, team.rank ?? 99]));

  if (remaining.length === 0) return baseline.length > 0;
  if (remaining.length > maxRemainingGames) return false;

  const ranksMatchBaseline = (candidate: Team[]) => {
    const rankedCandidate = rankTeams(candidate, rankOptionsFromSettings(settings));
    return rankedCandidate.every((team) => (team.rank ?? 99) === baselineRanks.get(team.id));
  };

  const testOutcomeTree = (index: number, currentTeams: Team[]): boolean => {
    if (index >= remaining.length) return ranksMatchBaseline(currentTeams);

    const game = remaining[index];
    if (!game) return testOutcomeTree(index + 1, currentTeams);

    const awayWins = applyResult(currentTeams, game, game.away, currentTeams, settings);
    if (!testOutcomeTree(index + 1, awayWins)) return false;

    const homeWins = applyResult(currentTeams, game, game.home, currentTeams, settings);
    return testOutcomeTree(index + 1, homeWins);
  };

  return testOutcomeTree(0, baseline);
};

/**
 * The table with every game left to the favourite, each booked at the model's score
 * (`applyResult`): the schedule's games, then the ones each team owes beyond it under games per team
 * (`owedGames`), each against the league's average side and after every scheduled game, as the Gold
 * odds play them (`playOwed`), the owing team's side alone booked. The Forecast's Projected Record,
 * Run Diff and Range read this, and read the schedule alone until 1 November 2026: a team 3-0 with
 * nine games owed was projected to finish 3-0 beside Gold odds that played all nine.
 *
 * `owed` is those games and that side, worked out from the teams given unless a caller hands over
 * its own: the seed walk hands every scenario the season's (`useSeedRanges`), so each is projected
 * against one side and plays the season's owed games, less the one it settles. Null plays none, and
 * a league owing none plays none, so it is projected as it always was.
 */
export const projectStandings = (
  teams: Team[],
  games: Matchup[],
  settings: Settings,
  owed: OwedPlay | null = owedPlay(teams, games, settings) ?? null
) => {
  let projected = teams.map((team) => ({ ...team }));
  games.forEach((game) => {
    const projectionById = buildByIdMap(projected);
    const prediction = predictGame(game, projected, settings, projectionById);
    projected = applyResult(projected, game, prediction.winnerId, projected, settings);
  });
  if (owed) {
    // The teams are this projection's own copies, and booking an owed game touches only the
    // owing team's own numbers (`bookSide`), so they are booked in place.
    const byId = buildByIdMap(projected);
    byId.set(OWED_OPPONENT, owed.side);
    for (const game of owed.games) {
      const team = byId.get(owerOf(game));
      if (!team) continue;
      const prediction = predictGame(game, projected, settings, byId);
      settleOwed(team, game, prediction.winnerId, prediction, settings);
    }
  }
  return rankTeams(projected, rankOptionsFromSettings(settings));
};

/**
 * The teams with one game owed beyond the schedule settled, as new objects where they change; the
 * inputs are untouched. What `applyResult` is for a scheduled game, for the seed walk's scenarios
 * (`useSeedRanges`): the owing team's side booked at the model's score against `side`, the league's
 * average side, nudged so the given winner wins.
 */
export const applyOwedResult = (
  teams: Team[],
  game: Matchup,
  winnerId: string,
  side: Team,
  settings: Settings
): Team[] => {
  const owing = owerOf(game);
  const next = teams.map((team) => (team.id === owing ? { ...team } : team));
  const team = next.find((one) => one.id === owing);
  if (!team) return next;
  const model = buildByIdMap(teams);
  model.set(OWED_OPPONENT, side);
  settleOwed(team, game, winnerId, predictGame(game, teams, settings, model), settings);
  return next;
};

export const hashSeed = (text: string) => {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
};

export const makeRandom = (seed: number) => {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return (state >>> 0) / 4294967296;
  };
};

/** murmur3's finalizer: every bit of a 32-bit key moved by every other. */
const mix32 = (key: number): number => {
  let mixed = Math.imul(key ^ (key >>> 16), 0x85ebca6b);
  mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2ae35);
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

/**
 * One game's draws in one season of a paired run (`simulateGoldOddsRun`): a stream of its own,
 * keyed to the run's seed, the season and the game (`game`, its id's `hashSeed`, worked out once a
 * run), so two runs of one seed draw a game they both play alike, whatever else either plays.
 *
 * The key is mixed (murmur3's finalizer, `mix32`) before it seeds the stream: keys a letter apart,
 * as one season's games are, seeded first draws a fixed distance apart, and two games of a season
 * drew together. Measured on 40 synthetic leagues, 30 seeds each, against plain runs: unmixed, the
 * paired step's mean sat more than three standard errors from the plain one's for 46 of 280 teams;
 * mixed, for none, and with the key as it is now for none of 320. It is put together from numbers,
 * the season stepped by the golden ratio (`0x9e3779b9`) and mixed in with the seed, then the game:
 * a text built and hashed for every game of every season made a paired run a quarter slower than a
 * plain one, 102 ms against 81 for 600 seasons of 120 games, where it is 83 now.
 */
export const gameStream = (seed: number, season: number, game: number): (() => number) =>
  makeRandom(mix32(mix32(seed ^ Math.imul(season + 1, 0x9e3779b9)) ^ game));

/**
 * A text that changes exactly when the forecast's inputs do: which games are final, and what they
 * finished. It seeds the random draws, and it is the key the hooks use to say whether the odds on
 * screen describe the current season.
 *
 * The score is in it because a corrected result — a 5–3 that was really 12–0 — changes every
 * standing the simulation starts from and used to change nothing here: the game was final before
 * and final after, so the key read "current" while the odds on screen were the ones from before
 * the correction, for as long as the refit took.
 */
export const simulationSeed = (
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  extras: string
) => {
  const finals = [...matchups]
    .map((game) => {
      const log = logs[game.id];
      /*
       * A game still to play carries the two sides, because the model gives the home one an
       * advantage and simulating it is the whole of what this seed is a key for. Without them,
       * swapping a fixture's home and away left the key byte for byte identical while the odds
       * moved — measured on a two-team league with one game left, 48.85% against 51.15% — so the
       * page went on showing the old forecast, and `resultKey === key` reported it as current.
       * A finished game needs no such thing: its score is here, and the sides are which way round
       * that score is written.
       */
      return isFinal(log)
        ? `${game.id}|F${log?.awayRuns ?? ""}-${log?.homeRuns ?? ""}`
        : `${game.id}|O${game.away}>${game.home}`;
    })
    .sort()
    .join(",");
  return `${extras}::${finals}`;
};

/**
 * How close the odds have to be known before the loop may stop: a 95% half-width, as a
 * probability. Two points. A settled league — every team plainly in or plainly out — gets there in
 * a couple of hundred seasons; a contested cut line runs to the ceiling instead, which is the
 * right way round.
 */
export const ODDS_PRECISION = 0.02;
/** Below this many seasons nothing is asked of the interval: too few draws to trust its width. */
const ODDS_MIN_ITERATIONS = 200;
const ODDS_CHECK_INTERVAL = 50;

/**
 * Whether every team's odds are known to within `tolerance`.
 *
 * The rule this replaces compared the running average with itself twenty-five seasons earlier and
 * called the odds converged when the largest move was under a third of a point. A cumulative mean
 * is guaranteed to move less as it grows, whatever it is converging to — at a hundred seasons and
 * even odds the true 95% half-width is about ten points, and a drift under a third of a point
 * satisfied the rule by construction. This asks the question that rule only looked like it was
 * asking, how wide the interval is, with the same Wilson interval the app prints beside the odds,
 * so the stop and the ± on screen mean the same thing.
 */
const oddsArePrecise = (
  teams: Team[],
  counts: Record<string, number>,
  completed: number,
  tolerance: number
): boolean =>
  teams.every(
    (team) => wilsonScoreInterval((counts[team.id] ?? 0) / completed, completed).margin <= tolerance
  );

export type GoldOddsRun = {
  /** Per team, the probability (0–100) of finishing inside the cut. */
  odds: Record<string, number>;
  /**
   * Per team, its average finishing place (1 = first) over the same seasons. The projected place
   * is read off this: the place each team takes if every favourite wins put a team needing three
   * wins at #3 on 64% Gold odds above one at #4 on 89%.
   */
  places: Record<string, number>;
  /** For the team followed, how its odds turned on each game left (`GoldSwing`), where asked. */
  swing?: GoldSwing;
  /**
   * How many seasons were actually played out. The ± beside the odds has to be computed from
   * this: the loop stops early when the odds are settled, and an interval computed from the
   * ceiling would claim a precision the draws never reached.
   */
  iterations: number;
};

/**
 * For one team, the seasons played out counted by how each game left went: of the seasons in
 * which a game's away side won (`awayWins`), how many put the team inside the cut (`inIfAway`),
 * and of those in which its home side won (`homeWins`), how many did (`inIfHome`). A season with
 * the game tied is in neither. In the order of the games left (`gameIds`).
 */
export type GoldSwing = {
  teamId: string;
  seasons: number;
  gameIds: string[];
  awayWins: number[];
  homeWins: number[];
  inIfAway: number[];
  inIfHome: number[];
};

/**
 * Plays the rest of the season out `iterations` times, or until every team's odds are known to
 * `ODDS_PRECISION`, and counts who finished inside the cut.
 *
 * With `follow`, it also counts, for that team, how each game left went in the seasons that put it
 * inside the cut (`GoldSwing`): the same seasons, read once more, with no draw added, so the odds
 * are the same to the digit with it or without.
 *
 * `paired` is for two runs whose difference is what is wanted, the Gold trend's last two points
 * (`buildTrendStates`), of one seed: each game draws its own stream (`gameStream`) and every season
 * asked for is played, so the two runs pair game for game and season for season. On one stream,
 * the point before the last result, with that game still to play, drew every game after it apart
 * from the last point, and every season after the first.
 */
export const simulateGoldOddsRun = (
  teams: Team[],
  remaining: Matchup[],
  iterations: number,
  seedText: string,
  cutoff: number,
  settings: Settings,
  follow?: string,
  paired = false
): GoldOddsRun => {
  const counts: Record<string, number> = {};
  const placeSums: Record<string, number> = {};
  teams.forEach((team) => {
    counts[team.id] = 0;
    placeSums[team.id] = 0;
  });

  const random = makeRandom(hashSeed(seedText));
  const minIterations = Math.min(iterations, ODDS_MIN_ITERATIONS);
  let completedIterations = 0;
  const rankOptions = rankOptionsFromSettings(settings);
  // The games owed beyond the schedule, played after it; the swing below is the schedule's alone.
  const owed = owedPlay(teams, remaining, settings);
  const following = follow !== undefined && teams.some((team) => team.id === follow);
  const results = following ? new Uint8Array(remaining.length) : undefined;
  const awayWins = new Array<number>(following ? remaining.length : 0).fill(0);
  const homeWins = new Array<number>(following ? remaining.length : 0).fill(0);
  const inIfAway = new Array<number>(following ? remaining.length : 0).fill(0);
  const inIfHome = new Array<number>(following ? remaining.length : 0).fill(0);
  const draws = seasonDraws(teams, settings, random);
  // A paired run's draws: the tie drawn in every game, and each game's key hashed once a run.
  const pairing = paired
    ? {
        draws: { ...draws, tieAlwaysDrawn: true as const },
        seed: hashSeed(seedText),
        games: remaining.map((game) => hashSeed(game.id)),
        owed: owed ? owed.games.map((game) => hashSeed(game.id)) : [],
      }
    : undefined;

  for (let i = 0; i < iterations; i += 1) {
    const { season, byId } = scratchSeason(teams);
    playOut(
      season,
      byId,
      remaining,
      settings,
      draws,
      results,
      pairing && { ...pairing, season: i }
    );
    if (owed)
      playOwed(
        season,
        byId,
        owed,
        settings,
        draws,
        pairing && { draws: pairing.draws, seed: pairing.seed, season: i, games: pairing.owed }
      );

    let followedIn = false;
    // The same order the cut is read from, so the places are counted with no draw added and the
    // odds stay the same to the digit.
    rankTeams(season, rankOptions).forEach((team, place) => {
      placeSums[team.id] = (placeSums[team.id] ?? 0) + place + 1;
      if (place >= cutoff) return;
      counts[team.id] = (counts[team.id] ?? 0) + 1;
      if (team.id === follow) followedIn = true;
    });
    if (results) {
      for (let at = 0; at < results.length; at += 1) {
        const result = results[at];
        if (result === AWAY_WON) {
          awayWins[at] = (awayWins[at] ?? 0) + 1;
          if (followedIn) inIfAway[at] = (inIfAway[at] ?? 0) + 1;
        } else if (result === HOME_WON) {
          homeWins[at] = (homeWins[at] ?? 0) + 1;
          if (followedIn) inIfHome[at] = (inIfHome[at] ?? 0) + 1;
        }
      }
    }

    completedIterations += 1;
    if (
      !paired &&
      completedIterations >= minIterations &&
      completedIterations % ODDS_CHECK_INTERVAL === 0 &&
      oddsArePrecise(teams, counts, completedIterations, ODDS_PRECISION)
    ) {
      break;
    }
  }

  const denominator = Math.max(1, completedIterations);
  const odds: Record<string, number> = {};
  const places: Record<string, number> = {};
  teams.forEach((team) => {
    odds[team.id] = ((counts[team.id] ?? 0) / denominator) * 100;
    places[team.id] = completedIterations > 0 ? (placeSums[team.id] ?? 0) / denominator : 0;
  });
  return {
    odds,
    places,
    iterations: completedIterations,
    ...(following && follow !== undefined
      ? {
          swing: {
            teamId: follow,
            seasons: completedIterations,
            gameIds: remaining.map((game) => game.id),
            awayWins,
            homeWins,
            inIfAway,
            inIfHome,
          },
        }
      : {}),
  };
};

/**
 * Each team's projected place: the teams ordered by their average finishing place over the
 * simulated seasons, a tie kept in the current order. Null when the simulation has no place for
 * some team (it has not run on this season's teams yet), so the caller keeps its own projection.
 */
export const projectedPlaces = (
  ranked: readonly { id: string; rank?: number }[],
  places: Readonly<Record<string, number>>
): Map<string, number> | null => {
  if (ranked.length === 0 || ranked.some((team) => !((places[team.id] ?? 0) > 0))) return null;
  const order = [...ranked].sort(
    (a, b) => (places[a.id] ?? 0) - (places[b.id] ?? 0) || (a.rank ?? 99) - (b.rank ?? 99)
  );
  return new Map(order.map((team, index) => [team.id, index + 1]));
};

/** The odds alone, for callers that have no use for the count. */
export const simulateGoldOdds = (
  teams: Team[],
  remaining: Matchup[],
  iterations: number,
  seedText: string,
  cutoff: number,
  settings: Settings
): Record<string, number> =>
  simulateGoldOddsRun(teams, remaining, iterations, seedText, cutoff, settings).odds;

/**
 * One point of the Gold-odds trend (`TrendState`), the one way the worker and the page where no
 * worker runs both draw it, so a point marked paired is drawn paired in either.
 */
export const simulateTrendPoint = (
  state: { teams: Team[]; remaining: Matchup[]; seedText: string; paired?: boolean },
  iterations: number,
  cutoff: number,
  settings: Settings
): Record<string, number> =>
  simulateGoldOddsRun(
    state.teams,
    state.remaining,
    iterations,
    state.seedText,
    cutoff,
    settings,
    undefined,
    state.paired
  ).odds;

// Standard single-elimination bracket helpers, here rather than in bracket.ts because bracket.ts
// already imports predictGame/hashSeed from this module, and takes these with them.
export const bracketNextPowerOfTwo = (value: number) => {
  let size = 1;
  while (size < value) size *= 2;
  return size;
};

export const bracketSeedOrder = (size: number): number[] => {
  if (size <= 1) return [1];
  const previous = bracketSeedOrder(size / 2);
  return previous.flatMap((seed) => [seed, size + 1 - seed]);
};

export type BracketOddsResult = {
  /** Per team, the probability (0–100) of finishing at each final seed (index 0 = seed 1). */
  seedDistribution: Record<string, number[]>;
  /** Per team, the probability (0–100) of winning the Gold Bracket. */
  championOdds: Record<string, number>;
  /** Per team, the probability (0–100) of reaching the Gold Bracket final. */
  finalsOdds: Record<string, number>;
  iterations: number;
};

// Play out a single seeded bracket among `entrants` (already in seed order), drawing each game
// from the model's win probability with the shared PRNG. Returns the champion and both finalists.
/**
 * Of the two sides of a bracket game, the one that hosts: the better seed, which is the lower
 * number. Named and exported because it is the rule, and because reading it off the slot a team
 * happens to be standing in is wrong from the second round onward — see `simulateBracketRun`.
 */
export const bracketHost = <T extends { seed: number }>(top: T, bottom: T): T =>
  top.seed <= bottom.seed ? top : bottom;

/**
 * The slot that won a bracket game already played, by its final score, or null for one not played
 * or not decided. The bracket keeps a game's score under its slot (`bracket-r1-g2`), the top slot's
 * runs as the home side's, as `buildBracketProjection` reads them.
 */
const playedWinner = <T>(log: GameLog | undefined, top: T, bottom: T): T | null => {
  if (!log?.isFinal || log.homeRuns === "" || log.awayRuns === "") return null;
  const topRuns = Number(log.homeRuns);
  const bottomRuns = Number(log.awayRuns);
  if (!Number.isFinite(topRuns) || !Number.isFinite(bottomRuns) || topRuns === bottomRuns)
    return null;
  return topRuns > bottomRuns ? top : bottom;
};

const simulateBracketRun = (
  entrants: Team[],
  byId: Map<string, Team>,
  settings: Settings,
  random: () => number,
  played: Record<string, GameLog> = {}
): { championId: string | null; finalistIds: string[] } => {
  if (entrants.length < 2) {
    const only = entrants[0]?.id ?? null;
    return { championId: only, finalistIds: only ? [only] : [] };
  }

  const size = bracketNextPowerOfTwo(entrants.length);
  const totalRounds = Math.log2(size);
  // The league as it stands at season's end, for the model to read both sides from.
  const allTeams = [...byId.values()];
  // A bracket game is drawn, not booked, so the league behind it is the same for every round.
  const tally = leagueTallyOf(allTeams, settings);
  /**
   * Each slot carries the seed that is standing in it, not just the team.
   *
   * The higher seed hosts, which is what a bracket is seeded for — and `bracketSeedOrder` only
   * puts it in the top slot in the *first* round. After that a slot holds whoever won that branch,
   * so reading the host off the slot gives it to the upset winner: a four-team bracket starts
   * [1, 4, 2, 3], and if 4 beats 1 while 2 beats 3 the final is top = 4 against bottom = 2, with
   * the seat handed to the worse of the two. Carrying the seed makes the rule mean in every round
   * what it means in the first.
   */
  type Slot = { id: string; seed: number };
  let slots: (Slot | null)[] = bracketSeedOrder(size).map((seed) => {
    const entrant = entrants[seed - 1];
    return entrant ? { id: entrant.id, seed } : null;
  });
  let finalistIds: string[] = [];

  for (let round = 0; round < totalRounds; round += 1) {
    if (round === totalRounds - 1) {
      finalistIds = slots.flatMap((slot) => (slot ? [slot.id] : []));
    }
    const next: (Slot | null)[] = [];
    for (let game = 0; game < slots.length; game += 2) {
      const top = slots[game] ?? null;
      const bottom = slots[game + 1] ?? null;
      const decided =
        top && bottom
          ? playedWinner(played[`bracket-r${round + 1}-g${game / 2 + 1}`], top, bottom)
          : null;
      if (decided) {
        next.push(decided);
      } else if (top && bottom) {
        const host = bracketHost(top, bottom);
        const visitor = host === top ? bottom : top;
        const matchup: Matchup = {
          id: `sim-r${round}-g${game}`,
          date: "",
          away: visitor.id,
          home: host.id,
        };
        const prediction = predictGame(matchup, allTeams, settings, byId, tally);
        next.push(random() < prediction.awayWinPct ? visitor : host);
      } else {
        next.push(top ?? bottom);
      }
    }
    slots = next;
  }

  return { championId: slots[0]?.id ?? null, finalistIds };
};

export const simulateBracketOdds = (
  teams: Team[],
  remaining: Matchup[],
  iterations: number,
  seedText: string,
  cutoff: number,
  settings: Settings,
  /**
   * The Gold bracket's scores as kept (`bracketLogs`). A game already played is taken as it ended
   * rather than drawn again, so a team knocked out has no title odds left and the champion has
   * them all. Read only once the regular season has no games left, on the schedule or owed beyond
   * it: the bracket is played on the final table, so only then is each slot sure to hold the team
   * its score was kept for.
   */
  bracketLogs: Record<string, GameLog> = {}
): BracketOddsResult => {
  const teamCount = teams.length;
  const seedCounts: Record<string, number[]> = {};
  const championCounts: Record<string, number> = {};
  const finalsCounts: Record<string, number> = {};
  teams.forEach((team) => {
    seedCounts[team.id] = new Array(teamCount).fill(0);
    championCounts[team.id] = 0;
    finalsCounts[team.id] = 0;
  });

  const random = makeRandom(hashSeed(`${seedText}::bracket`));
  const rankOptions = rankOptionsFromSettings(settings);
  const bracketCutoff = Math.max(0, Math.min(cutoff, teamCount));
  const owed = owedPlay(teams, remaining, settings);
  const played = remaining.length === 0 && !owed ? bracketLogs : {};
  const draws = seasonDraws(teams, settings, random);

  for (let i = 0; i < iterations; i += 1) {
    const { season, byId } = scratchSeason(teams);
    playOut(season, byId, remaining, settings, draws);
    if (owed) playOwed(season, byId, owed, settings, draws);

    const finalRanking = rankTeams(season, rankOptions);
    finalRanking.forEach((team, index) => {
      const distribution = seedCounts[team.id];
      if (distribution && index >= 0 && index < distribution.length) {
        distribution[index] = (distribution[index] ?? 0) + 1;
      }
    });

    const entrants = finalRanking.slice(0, bracketCutoff);
    const { championId, finalistIds } = simulateBracketRun(
      entrants,
      byId,
      settings,
      random,
      played
    );
    if (championId) championCounts[championId] = (championCounts[championId] ?? 0) + 1;
    finalistIds.forEach((id) => {
      finalsCounts[id] = (finalsCounts[id] ?? 0) + 1;
    });
  }

  const denominator = Math.max(1, iterations);
  const seedDistribution: Record<string, number[]> = {};
  const championOdds: Record<string, number> = {};
  const finalsOdds: Record<string, number> = {};
  teams.forEach((team) => {
    seedDistribution[team.id] = (seedCounts[team.id] ?? []).map(
      (count) => (count / denominator) * 100
    );
    championOdds[team.id] = ((championCounts[team.id] ?? 0) / denominator) * 100;
    finalsOdds[team.id] = ((finalsCounts[team.id] ?? 0) / denominator) * 100;
  });

  return { seedDistribution, championOdds, finalsOdds, iterations: denominator };
};
