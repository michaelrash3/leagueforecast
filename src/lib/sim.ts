import { parseDateValue } from "./date";
import { clamp, isFinal, parseNumber } from "./util";
import {
  DEFAULT_TIEBREAKER_ORDER,
  MODEL_AGGRESSION,
  type GameLog,
  type Matchup,
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

export const getRemainingCounts = (
  teams: Team[],
  remainingGames: Matchup[],
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

export type MathGoldStatus = {
  goldStatus: "Clinched" | "Eliminated" | "In" | "Alive";
  maxPoints: number;
  blockersAhead: number;
};

export const getMathGoldStatus = (
  team: Team,
  teams: Team[],
  remainingCounts: Record<string, number>,
  cutoff: number,
  settings: Pick<Settings, "winPoints" | "tiePoints">
): MathGoldStatus => {
  const currentPoints = standingsPoints(team, settings);
  const winPoints = settings.winPoints;
  const maxPoints = currentPoints + (remainingCounts[team.id] ?? 0) * winPoints;

  const blockersAhead = teams.filter((other) => {
    if (other.id === team.id) return false;
    return standingsPoints(other, settings) > maxPoints;
  }).length;

  const possibleCatchers = teams.filter((other) => {
    if (other.id === team.id) return false;
    const otherMaxPoints =
      standingsPoints(other, settings) + (remainingCounts[other.id] ?? 0) * winPoints;
    return otherMaxPoints >= currentPoints;
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

const resolvedTiebreakerOrder = (options: RankOptions) => {
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

const compareByTiebreaker = (a: Team, b: Team, factor: TiebreakerFactor, tiedGroupSize: number) => {
  switch (factor) {
    case "headToHead": {
      if (tiedGroupSize !== 2) return 0;
      const aPct = headToHeadPct(a, b.id);
      const bPct = headToHeadPct(b, a.id);
      if (aPct === null || bPct === null || Math.abs(aPct - bPct) <= 0.0001) return 0;
      return bPct - aPct;
    }
    case "runDifferential":
      if (a.runDiff !== b.runDiff) return b.runDiff - a.runDiff;
      return 0;
    case "runsAgainst":
      if (a.ra !== b.ra) return a.ra - b.ra;
      return 0;
    case "runsFor":
      if (a.rs !== b.rs) return b.rs - a.rs;
      return 0;
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
  const sortedByPct = [...teams].sort((a, b) => {
    // GameChanger's PCT column treats ties as half a win and sorts standings
    // by that percentage before applying secondary tiebreakers.
    if (Math.abs(b.pct - a.pct) > 0.0001) return b.pct - a.pct;
    return a.id.localeCompare(b.id);
  });

  const sorted: Team[] = [];
  for (let index = 0; index < sortedByPct.length; ) {
    const first = sortedByPct[index];
    if (!first) break;

    const tiedGroup = [first];
    let nextIndex = index + 1;
    while (nextIndex < sortedByPct.length) {
      const candidate = sortedByPct[nextIndex];
      if (!candidate || Math.abs(candidate.pct - first.pct) > 0.0001) break;
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

export const calculateTeams = (
  teamBases: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>
): Team[] => {
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

  [...matchups]
    .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
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
    team.runDiff = team.rs - team.ra;
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
  return clamp(calibrated, 0.04, 0.96);
};

const playerPitchEdge = (away: Team, home: Team) => {
  const awayDiffPerGame = away.games ? away.runDiff / away.games : 0;
  const homeDiffPerGame = home.games ? home.runDiff / home.games : 0;
  const runDiffEdge = clamp((awayDiffPerGame - homeDiffPerGame) / 8, -1, 1);
  const scoringEdge = clamp((away.rsg - home.rsg + (home.rag - away.rag)) / 10, -1, 1);
  const walkEdge = clamp(((away.walkDiff ?? 0) / Math.max(away.games, 1) - (home.walkDiff ?? 0) / Math.max(home.games, 1)) / 5, -1, 1);
  const hitEdge = clamp(((away.hitDiff ?? 0) / Math.max(away.games, 1) - (home.hitDiff ?? 0) / Math.max(home.games, 1)) / 7, -1, 1);
  const errorEdge = clamp(((away.errorDiff ?? 0) / Math.max(away.games, 1) - (home.errorDiff ?? 0) / Math.max(home.games, 1)) / 4, -1, 1);
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

export const predictPlayerPitchGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression">,
  byId?: Map<string, Team>
): Prediction => {
  const lookup = byId ?? buildByIdMap(teams);
  const away = lookup.get(game.away);
  const home = lookup.get(game.home);
  const totalRuns = teams.reduce((sum, team) => sum + team.rs, 0);
  const totalGames = teams.reduce((sum, team) => sum + team.games, 0);
  const leagueRuns = totalGames ? totalRuns / totalGames : 7;
  const aggression = MODEL_AGGRESSION[settings.modelAggression] ?? 1;

  if (!away || !home) {
    return { awayScore: Math.round(leagueRuns), homeScore: Math.round(leagueRuns), awayWinPct: 0.5, winnerId: game.away, confidence: "Low" };
  }

  if (away.games < 2 || home.games < 2) {
    const awayPrior = away.games ? away.pct : 0.5;
    const homePrior = home.games ? home.pct : 0.5;
    const awayWinPct = calibrateAwayWinPct(0.5 + clamp((awayPrior - homePrior) * 0.16, -0.08, 0.08), away.games, home.games, aggression);
    const spread = clamp((awayWinPct - 0.5) * 6, -1, 1);
    return { awayScore: Math.max(1, Math.round(leagueRuns + spread)), homeScore: Math.max(1, Math.round(leagueRuns - spread)), awayWinPct, winnerId: awayWinPct >= 0.5 ? game.away : game.home, confidence: "Low" };
  }

  const awayCommandPressure = (home.walksAllowedPerGame ?? 0) * 0.28 - (away.errorsPerGame ?? 0) * 0.18;
  const homeCommandPressure = (away.walksAllowedPerGame ?? 0) * 0.28 - (home.errorsPerGame ?? 0) * 0.18;
  const awayScore = Math.max(1, (away.rsg * home.rag) / Math.max(leagueRuns, 1) + awayCommandPressure + away.momentum * 0.08);
  const homeScore = Math.max(1, (home.rsg * away.rag) / Math.max(leagueRuns, 1) + homeCommandPressure + home.momentum * 0.08);
  const edge = playerPitchEdge(away, home) * clamp(0.95 + aggression * 0.16, 0.95, 1.25);
  const awayWinPct = calibrateAwayWinPct(logistic(edge), away.games, home.games, aggression);
  const winnerId = awayWinPct >= 0.5 ? game.away : game.home;
  const winnerPct = winnerId === game.away ? awayWinPct : 1 - awayWinPct;
  const margin = Math.abs(awayScore - homeScore);
  const confidence: Prediction["confidence"] = away.games >= 6 && home.games >= 6 && margin >= 5 && winnerPct >= 0.76 ? "High" : away.games >= 4 && home.games >= 4 && margin >= 2.5 && winnerPct >= 0.63 ? "Medium" : "Low";
  return { awayScore: Math.round(awayScore), homeScore: Math.round(homeScore), awayWinPct, winnerId, confidence };
};

export const predictMachinePitchGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression">,
  byId?: Map<string, Team>
): Prediction => {
  const lookup = byId ?? buildByIdMap(teams);
  const away = lookup.get(game.away);
  const home = lookup.get(game.home);
  const totalRuns = teams.reduce((sum, team) => sum + team.rs, 0);
  const totalGames = teams.reduce((sum, team) => sum + team.games, 0);
  const totalStrikeouts = teams.reduce((sum, team) => sum + team.kpg * team.games, 0);
  const leagueRuns = totalGames ? totalRuns / totalGames : 7;
  const leagueK6 = totalGames ? totalStrikeouts / totalGames : 4.5;
  const aggression = MODEL_AGGRESSION[settings.modelAggression] ?? 1;

  if (!away || !home) {
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
    const awayWinPct = calibrateAwayWinPct(0.5 + priorDiff, away.games, home.games, aggression);
    const scoreSpread = clamp((awayWinPct - 0.5) * 6, -1, 1);
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
  const roundedAway = Math.round(safeAway);
  const roundedHome = Math.round(safeHome);
  const edge = matchupWinEdge({ away, home, leagueK6, rawMargin, aggression });
  const rawAwayWinPct = logistic(edge);
  const awayWinPct = calibrateAwayWinPct(rawAwayWinPct, away.games, home.games, aggression);
  const winnerId = awayWinPct >= 0.5 ? game.away : game.home;
  const winnerPct = winnerId === game.away ? awayWinPct : 1 - awayWinPct;
  const margin = Math.abs(rawMargin);

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
  byId?: Map<string, Team>
): Prediction => {
  if (settings.pitchMode === "player") return predictPlayerPitchGame(game, teams, settings, byId);
  return predictMachinePitchGame(game, teams, settings, byId);
};

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

  const prediction = predictGame(game, modelTeams, settings);
  let awayRuns = prediction.awayScore;
  let homeRuns = prediction.homeScore;

  if (winnerId === game.away && awayRuns <= homeRuns) awayRuns = homeRuns + 1;
  if (winnerId === game.home && homeRuns <= awayRuns) homeRuns = awayRuns + 1;

  away.games += 1;
  home.games += 1;
  away.rs += awayRuns;
  away.ra += homeRuns;
  home.rs += homeRuns;
  home.ra += awayRuns;

  addHeadToHeadResult(away, home.id, awayRuns - homeRuns);
  addHeadToHeadResult(home, away.id, homeRuns - awayRuns);

  if (winnerId === game.away) {
    away.w += 1;
    home.l += 1;
  } else {
    home.w += 1;
    away.l += 1;
  }

  [away, home].forEach((team) => {
    team.pct = team.games ? (team.w + team.t * 0.5) / team.games : 0;
    team.runDiff = team.rs - team.ra;
    // Keep per-game production rates anchored to finalized games only. Projected
    // results can update standings and run-differential tiebreakers, but they
    // should not dilute displayed R/G, H/G, K/G, or opponent K/G with model-generated games.
    const diffPerGame = team.games ? clamp(team.runDiff / team.games, -8, 8) : 0;
    team.baseTpi = team.games ? diffPerGame + team.pct * 2 : 0;
    team.tpi = team.baseTpi + team.sos * 0.2;
  });

  return next;
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

export const projectStandings = (teams: Team[], games: Matchup[], settings: Settings) => {
  let projected = teams.map((team) => ({ ...team }));
  games.forEach((game) => {
    const projectionById = buildByIdMap(projected);
    const prediction = predictGame(game, projected, settings, projectionById);
    projected = applyResult(projected, game, prediction.winnerId, projected, settings);
  });
  return rankTeams(projected, rankOptionsFromSettings(settings));
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

export const simulationSeed = (
  matchups: Matchup[],
  logs: Record<string, GameLog>,
  extras: string
) => {
  const finals = [...matchups]
    .map((game) => `${game.id}|${isFinal(logs[game.id]) ? "F" : "O"}`)
    .sort()
    .join(",");
  return `${extras}::${finals}`;
};

const hasConvergedOdds = (
  teams: Team[],
  counts: Record<string, number>,
  previous: Record<string, number> | null,
  completedIterations: number,
  thresholdPct: number
) => {
  if (!previous || completedIterations <= 0) return false;

  let maxDelta = 0;
  teams.forEach((team) => {
    const currentPct = ((counts[team.id] ?? 0) / completedIterations) * 100;
    const delta = Math.abs(currentPct - (previous[team.id] ?? 0));
    if (delta > maxDelta) maxDelta = delta;
  });

  return maxDelta <= thresholdPct;
};

export const simulateGoldOdds = (
  teams: Team[],
  remaining: Matchup[],
  iterations: number,
  seedText: string,
  cutoff: number,
  settings: Settings
) => {
  const counts: Record<string, number> = {};
  teams.forEach((team) => {
    counts[team.id] = 0;
  });

  const random = makeRandom(hashSeed(seedText));
  const minIterations = Math.min(iterations, 100);
  const convergenceCheckInterval = 25;
  const convergenceThresholdPct = 0.35;
  let lastSnapshot: Record<string, number> | null = null;
  let completedIterations = 0;

  for (let i = 0; i < iterations; i += 1) {
    let simTeams = teams.map((team) => ({ ...team }));

    remaining.forEach((game) => {
      const simById = buildByIdMap(simTeams);
      const prediction = predictGame(game, simTeams, settings, simById);
      const winner = random() < prediction.awayWinPct ? game.away : game.home;
      simTeams = applyResult(simTeams, game, winner, simTeams, settings);
    });

    rankTeams(simTeams, rankOptionsFromSettings(settings))
      .slice(0, cutoff)
      .forEach((team) => {
        counts[team.id] = (counts[team.id] ?? 0) + 1;
      });

    completedIterations += 1;
    const reachedMinimum = completedIterations >= minIterations;
    const onCheckInterval = completedIterations % convergenceCheckInterval === 0;
    if (!reachedMinimum || !onCheckInterval) continue;

    if (
      hasConvergedOdds(teams, counts, lastSnapshot, completedIterations, convergenceThresholdPct)
    ) {
      break;
    }

    lastSnapshot = {};
    teams.forEach((team) => {
      lastSnapshot![team.id] = ((counts[team.id] ?? 0) / completedIterations) * 100;
    });
  }

  const denominator = Math.max(1, completedIterations);
  const odds: Record<string, number> = {};
  teams.forEach((team) => {
    odds[team.id] = ((counts[team.id] ?? 0) / denominator) * 100;
  });
  return odds;
};
