import { parseDateValue } from "./date";
import { clamp, isFinal, parseNumber } from "./util";
import {
  MODEL_AGGRESSION,
  type GameLog,
  type Matchup,
  type Prediction,
  type Settings,
  type Team,
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
  tpi: 0,
  baseTpi: 0,
  sos: 0,
  momentum: 0,
  awayK6: null,
  homeK6: null,
  totalK6: null,
  machineDifficulty: 0,
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

export const rankTeams = (teams: Team[], options: { runDiffTiebreaker: boolean }) => {
  const sorted = [...teams].sort((a, b) => {
    if (Math.abs(b.pct - a.pct) > 0.0001) return b.pct - a.pct;
    if (options.runDiffTiebreaker && b.runDiff !== a.runDiff) {
      return b.runDiff - a.runDiff;
    }
    return b.tpi - a.tpi;
  });
  return sorted.map((team, index) => ({ ...team, rank: index + 1 }));
};

type InternalTeam = Team & {
  awayKs: number;
  awayInns: number;
  homeKs: number;
  homeInns: number;
  battingHits: number;
  battingKs: number;
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

      leagueKs += awayK + homeK;
      leagueInnings += innings * 2;

      away.results.push({ diff: awayRuns - homeRuns, oppId: home.id });
      home.results.push({ diff: homeRuns - awayRuns, oppId: away.id });

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

  teams.forEach((team) => {
    team.sos = team.games ? team.oppTpiSum / team.games : 0;
    team.tpi = team.baseTpi + team.sos * 0.2;
    team.machineDifficulty = team.machineDiffCount
      ? clamp(team.machineDiffSum / team.machineDiffCount, -3, 3)
      : 0;

    const recent = team.results.slice(-3);
    if (recent.length >= 3) {
      const recentDiff = recent.reduce((sum, game) => sum + game.diff, 0) / recent.length;
      const seasonDiff = team.games ? team.runDiff / team.games : 0;
      team.momentum = clamp(recentDiff - seasonDiff, -4, 4);
    }
  });

  return teams.map(
    ({
      awayKs: _ak,
      awayInns: _ai,
      homeKs: _hk,
      homeInns: _hi,
      battingHits: _bh,
      battingKs: _bk,
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

export const predictGame = (
  game: Matchup,
  teams: Team[],
  settings: Pick<Settings, "modelAggression">,
  byId?: Map<string, Team>
): Prediction => {
  const lookup = byId ?? buildByIdMap(teams);
  const away = lookup.get(game.away);
  const home = lookup.get(game.home);

  if (!away || !home || away.games < 2 || home.games < 2) {
    return {
      awayScore: 7,
      homeScore: 6,
      awayWinPct: 0.52,
      winnerId: game.away,
      confidence: "Low",
    };
  }

  const totalRuns = teams.reduce((sum, team) => sum + team.rs, 0);
  const totalGames = teams.reduce((sum, team) => sum + team.games, 0);
  const leagueRuns = totalGames ? totalRuns / totalGames : 8;

  const aggression = MODEL_AGGRESSION[settings.modelAggression] ?? 1;

  let awayScore = (away.rsg * home.rag) / Math.max(leagueRuns, 1);
  let homeScore = (home.rsg * away.rag) / Math.max(leagueRuns, 1);

  const tpiDiff = clamp(away.tpi - home.tpi, -6, 6);
  awayScore =
    awayScore * (1 + tpiDiff * 0.025 * aggression) +
    clamp(away.momentum, -3, 3) * 0.15 * aggression;
  homeScore =
    homeScore * (1 - tpiDiff * 0.025 * aggression) +
    clamp(home.momentum, -3, 3) * 0.15 * aggression;

  const kDiff = clamp(
    (away.awayK6 ?? 4.5) + home.machineDifficulty - (home.homeK6 ?? 4.5),
    -3,
    3
  );
  if (kDiff > 0) homeScore += kDiff * 0.2;
  if (kDiff < 0) awayScore += Math.abs(kDiff) * 0.2;

  const safeAway = Math.max(1, awayScore);
  const safeHome = Math.max(1, homeScore);
  const rawMargin = safeAway - safeHome;
  const roundedAway = Math.round(safeAway);
  const roundedHome = Math.round(safeHome);
  const awayWinPct = 1 / (1 + Math.exp(-rawMargin / 4));
  const winnerId = rawMargin >= 0 ? game.away : game.home;
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

export const applyResult = (
  teams: Team[],
  game: Matchup,
  winnerId: string,
  modelTeams: Team[],
  settings: Settings
) => {
  const next = teams.map((team) => ({ ...team }));
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
    team.rsg = team.games ? team.rs / team.games : 0;
    team.rag = team.games ? team.ra / team.games : 0;
    // Refresh baseTpi/tpi so projected near-ties don't sort with stale values.
    const diffPerGame = team.games ? clamp(team.runDiff / team.games, -8, 8) : 0;
    team.baseTpi = team.games ? diffPerGame + team.pct * 2 : 0;
    team.tpi = team.baseTpi + team.sos * 0.2;
  });

  return next;
};

export const projectStandings = (
  teams: Team[],
  games: Matchup[],
  settings: Settings
) => {
  let projected = teams.map((team) => ({ ...team }));
  const byId = buildByIdMap(teams);
  games.forEach((game) => {
    const prediction = predictGame(game, teams, settings, byId);
    projected = applyResult(projected, game, prediction.winnerId, teams, settings);
  });
  return rankTeams(projected, { runDiffTiebreaker: settings.runDiffTiebreaker });
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

  const byId = buildByIdMap(teams);
  const random = makeRandom(hashSeed(seedText));

  for (let i = 0; i < iterations; i += 1) {
    let simTeams = teams.map((team) => ({ ...team }));

    remaining.forEach((game) => {
      const prediction = predictGame(game, teams, settings, byId);
      const winner = random() < prediction.awayWinPct ? game.away : game.home;
      simTeams = applyResult(simTeams, game, winner, teams, settings);
    });

    rankTeams(simTeams, { runDiffTiebreaker: settings.runDiffTiebreaker })
      .slice(0, cutoff)
      .forEach((team) => {
        counts[team.id] = (counts[team.id] ?? 0) + 1;
      });
  }

  const odds: Record<string, number> = {};
  teams.forEach((team) => {
    odds[team.id] = ((counts[team.id] ?? 0) / iterations) * 100;
  });
  return odds;
};
