import React, { useEffect, useMemo, useState } from "react";

type TeamBase = {
  id: string;
  name: string;
};

type Team = TeamBase & {
  w: number;
  l: number;
  t: number;
  rs: number;
  ra: number;
  games: number;
  pct: number;
  runDiff: number;
  rsg: number;
  rag: number;
  hpg: number;
  kpg: number;
  tpi: number;
  baseTpi: number;
  sos: number;
  momentum: number;
  awayK6: number | null;
  homeK6: number | null;
  totalK6: number | null;
  machineDifficulty: number;
  rank?: number;
};

type GameLog = {
  awayRuns: string;
  awayHits: string;
  awayK: string;
  homeRuns: string;
  homeHits: string;
  homeK: string;
  innings: string;
  isFinal?: boolean;
};

type Matchup = {
  id: string;
  date: string;
  away: string;
  home: string;
};

type Prediction = {
  awayScore: number;
  homeScore: number;
  awayWinPct: number;
  winnerId: string;
  confidence: "Low" | "Medium" | "High";
};

type TeamWithProjection = Team & {
  projectedRank: number;
  projectedRecord: string;
  projectedRunDiff: number;
  goldPct: number;
  goldTrend: number[];
  goldStatus: "Clinched" | "In" | "Alive" | "Eliminated";
  maxPoints: number;
  blockersAhead: number;
};

type SwingGame = {
  game: Matchup;
  opponentName: string;
  teamIsAway: boolean;
  winSeed: number;
  lossSeed: number;
  modelPick: string;
  winPct: number;
};

const DEFAULT_GOLD_CUTOFF = 7;
const DEFAULT_SEASON_LABEL = "Spring 26";
const DEFAULT_SEASON_YEAR = 2026;
const SIM_ITERATIONS = 220;
const TREND_STATES = 10;

const blankLog = (): GameLog => ({
  awayRuns: "",
  awayHits: "",
  awayK: "",
  homeRuns: "",
  homeHits: "",
  homeK: "",
  innings: "6",
  isFinal: false,
});

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const isFinal = (log?: GameLog | null) => Boolean(log?.isFinal);

const parseNumber = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toMMDD = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}`;

const normalizeDateInput = (value: string) => {
  const trimmed = value?.trim();
  if (!trimmed) return "";

  // Preferred app format: M/D.
  const mmdd = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?$/);
  if (mmdd) {
    const month = clamp(Number(mmdd[1]), 1, 12);
    const day = clamp(Number(mmdd[2]), 1, 31);
    return `${month}/${day}`;
  }

  // ISO from older builds or browser date inputs.
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T12:00:00`);
    return Number.isFinite(date.getTime()) ? toMMDD(date) : trimmed;
  }

  // Old CSV format: "May 1", "May 01", etc.
  const withSeasonYear = Date.parse(`${trimmed} ${DEFAULT_SEASON_YEAR}`);
  if (Number.isFinite(withSeasonYear)) return toMMDD(new Date(withSeasonYear));

  const parsed = Date.parse(trimmed);
  if (Number.isFinite(parsed)) return toMMDD(new Date(parsed));

  return trimmed;
};

const parseDateValue = (date: string) => {
  const normalized = normalizeDateInput(date);
  if (!normalized) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(`${normalized}/${DEFAULT_SEASON_YEAR}`);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const formatGameDate = (date: string) => normalizeDateInput(date) || "No Date";
const formatGameDateLong = (date: string) => normalizeDateInput(date) || "Needs Date";

const displayName = (name: string) => {
  let cleaned = name
    .replace(/\b8u\b/gi, "")
    .replace(/\b8U\b/g, "")
    .replace(/\bNKB\b/gi, "")
    .replace(/\bNKY\b/gi, "")
    .replace(/\bNKYA\b/gi, "")
    .replace(/\bUnion\b/gi, "")
    .replace(/\bSOAS\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (/dobbers/i.test(cleaned)) return "Dirt Dobbers";
  return cleaned || name;
};

const teamAbbr = (name: string) => {
  const short = displayName(name).replace(/[^a-z0-9 ]/gi, "").trim();
  const words = short.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
  return short.slice(0, 3).toUpperCase() || "TM";
};

const recordText = (team: Pick<Team, "w" | "l" | "t">) =>
  `${team.w}-${team.l}${team.t ? `-${team.t}` : ""}`;

const standingsPoints = (team: Pick<Team, "w" | "t">) => team.w + team.t * 0.5;

const getRemainingCounts = (teams: Team[], remainingGames: Matchup[]) => {
  const counts: Record<string, number> = {};
  teams.forEach((team) => {
    counts[team.id] = 0;
  });

  remainingGames.forEach((game) => {
    counts[game.away] = (counts[game.away] || 0) + 1;
    counts[game.home] = (counts[game.home] || 0) + 1;
  });

  return counts;
};

const getMathGoldStatus = (
  team: Team,
  teams: Team[],
  remainingCounts: Record<string, number>,
  cutoff: number
) => {
  const currentPoints = standingsPoints(team);
  const maxPoints = currentPoints + (remainingCounts[team.id] || 0);

  // Eliminated: even if this team wins out, at least cutoff teams are already beyond that max.
  const blockersAhead = teams.filter((other) => {
    if (other.id === team.id) return false;
    return standingsPoints(other) > maxPoints;
  }).length;

  // Clinched: even if this team loses out, fewer than cutoff other teams can reach or pass them.
  // Uses >= instead of > so tied standings-point scenarios are treated conservatively.
  const possibleCatchers = teams.filter((other) => {
    if (other.id === team.id) return false;
    const otherMaxPoints = standingsPoints(other) + (remainingCounts[other.id] || 0);
    return otherMaxPoints >= currentPoints;
  }).length;

  const eliminated = blockersAhead >= cutoff;
  const clinched = possibleCatchers < cutoff;

  return {
    goldStatus: eliminated
      ? ("Eliminated" as const)
      : clinched
        ? ("Clinched" as const)
        : (team.rank || 99) <= cutoff
          ? ("In" as const)
          : ("Alive" as const),
    maxPoints,
    blockersAhead,
  };
};

const emptyTeam = (base: TeamBase): Team => ({
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

const createTeamId = (name: string, existing: Set<string>) => {
  const compact = displayName(name).toUpperCase().replace(/[^A-Z0-9]/g, "");
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

const rankTeams = (teams: Team[]) =>
  [...teams]
    .sort((a, b) => {
      if (Math.abs(b.pct - a.pct) > 0.0001) return b.pct - a.pct;
      if (b.runDiff !== a.runDiff) return b.runDiff - a.runDiff;
      return b.tpi - a.tpi;
    })
    .map((team, index) => ({ ...team, rank: index + 1 }));

const parseCSVLine = (line: string) => {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current.trim());
  return values;
};

const normalizeHeader = (header: string) =>
  header.trim().toLowerCase().replace(/\s+/g, " ");

const csvEscape = (value: string | number) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const calculateTeams = (
  teamBases: TeamBase[],
  matchups: Matchup[],
  logs: Record<string, GameLog>
): Team[] => {
  type InternalTeam = Team & {
    awayKs: number;
    awayInns: number;
    homeKs: number;
    homeInns: number;
    oppTpiSum: number;
    machineDiffSum: number;
    machineDiffCount: number;
    battingHits: number;
    battingKs: number;
    results: { diff: number; oppId: string }[];
  };

  const teams: InternalTeam[] = teamBases.map((base) => ({
    ...emptyTeam(base),
    awayKs: 0,
    awayInns: 0,
    homeKs: 0,
    homeInns: 0,
    oppTpiSum: 0,
    machineDiffSum: 0,
    machineDiffCount: 0,
    battingHits: 0,
    battingKs: 0,
    results: [],
  }));

  const byId = (id: string) => teams.find((team) => team.id === id);
  let leagueKs = 0;
  let leagueInnings = 0;

  [...matchups]
    .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
    .forEach((game) => {
      const log = logs[game.id];
      if (!isFinal(log)) return;

      const away = byId(game.away);
      const home = byId(game.home);
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
      away.battingHits += awayHits;
      home.battingHits += homeHits;
      away.battingKs += awayK;
      home.battingKs += homeK;

      away.awayKs += awayK;
      away.awayInns += innings;
      home.homeKs += homeK;
      home.homeInns += innings;
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
    if (!isFinal(log)) return;
    const away = byId(game.away);
    const home = byId(game.home);
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

  return teams.map(({ awayKs, awayInns, homeKs, homeInns, oppTpiSum, machineDiffSum, machineDiffCount, results, ...team }) => team);
};

const predictGame = (game: Matchup, teams: Team[]): Prediction => {
  const away = teams.find((team) => team.id === game.away);
  const home = teams.find((team) => team.id === game.home);

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

  let awayScore = (away.rsg * home.rag) / Math.max(leagueRuns, 1);
  let homeScore = (home.rsg * away.rag) / Math.max(leagueRuns, 1);

  const tpiDiff = clamp(away.tpi - home.tpi, -6, 6);
  awayScore = awayScore * (1 + tpiDiff * 0.025) + clamp(away.momentum, -3, 3) * 0.15;
  homeScore = homeScore * (1 - tpiDiff * 0.025) + clamp(home.momentum, -3, 3) * 0.15;

  const kDiff = clamp((away.awayK6 ?? 4.5) + home.machineDifficulty - (home.homeK6 ?? 4.5), -3, 3);
  if (kDiff > 0) homeScore += kDiff * 0.2;
  if (kDiff < 0) awayScore += Math.abs(kDiff) * 0.2;

  const safeAway = clamp(awayScore, 1, 18);
  const safeHome = clamp(homeScore, 1, 18);
  const roundedAway = Math.round(safeAway);
  const roundedHome = Math.round(safeHome);
  const margin = roundedAway - roundedHome;
  const awayWinPct = 1 / (1 + Math.exp(-margin / 4));
  const winnerId = roundedAway >= roundedHome ? game.away : game.home;
  const winnerPct = winnerId === game.away ? awayWinPct : 1 - awayWinPct;

  let confidence: Prediction["confidence"] = "Low";
  if (away.games >= 6 && home.games >= 6 && Math.abs(margin) >= 6 && winnerPct >= 0.78) {
    confidence = "High";
  } else if (away.games >= 4 && home.games >= 4 && Math.abs(margin) >= 3 && winnerPct >= 0.65) {
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



const describePrediction = (game: Matchup, prediction: Prediction, teams: Team[]) => {
  const away = teams.find((team) => team.id === game.away);
  const home = teams.find((team) => team.id === game.home);
  const winner = teams.find((team) => team.id === prediction.winnerId);
  const loserId = prediction.winnerId === game.away ? game.home : game.away;
  const loser = teams.find((team) => team.id === loserId);

  const awayName = displayName(away?.name || game.away);
  const homeName = displayName(home?.name || game.home);
  const winnerName = displayName(winner?.name || prediction.winnerId);
  const loserName = displayName(loser?.name || loserId);

  if (!away || !home) {
    return `Model leans ${winnerName}, but one or both teams are missing from the imported team list.`;
  }

  const winnerPct = prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
  const margin = Math.abs(prediction.awayScore - prediction.homeScore);
  const tpiEdge = away.tpi - home.tpi;
  const scoringEdge = away.rsg - home.rsg;
  const preventionEdge = home.rag - away.rag;
  const kEdge = (home.homeK6 ?? 4.5) - ((away.awayK6 ?? 4.5) + home.machineDifficulty);

  const reasons: string[] = [];

  if (Math.abs(scoringEdge) >= 1.2) {
    reasons.push(`${scoringEdge > 0 ? awayName : homeName} has the stronger scoring profile`);
  }

  if (Math.abs(preventionEdge) >= 1.2) {
    reasons.push(`${preventionEdge > 0 ? awayName : homeName} has allowed fewer runs`);
  }

  if (Math.abs(tpiEdge) >= 1.5) {
    reasons.push(`${tpiEdge > 0 ? awayName : homeName} owns the better adjusted profile`);
  }

  if (Math.abs(kEdge) >= 1.0) {
    reasons.push(`${kEdge > 0 ? awayName : homeName} gets a contact/machine edge`);
  }

  if (!reasons.length) {
    reasons.push(`the teams grade close, so the lean is mostly from projected run balance`);
  }

  const confidenceText =
    prediction.confidence === "High"
      ? "a strong lean"
      : prediction.confidence === "Medium"
        ? "a clear lean"
        : "a light lean";

  const lineText = projectedRunLine(prediction, teams);
  return `${lineText} is ${confidenceText}: ${reasons.slice(0, 2).join(" and ")}. That gives ${winnerName} a ${Math.round(winnerPct * 100)}% win chance without treating the forecast like a literal final score.`;
};

const projectedRunLine = (prediction: Prediction, teams: Team[]) => {
  const favoriteId = prediction.winnerId;
  const favorite = teams.find((team) => team.id === favoriteId);
  const favoriteName = displayName(favorite?.name || favoriteId);
  const rawMargin = Math.abs(prediction.awayScore - prediction.homeScore);
  const halfRunLine = Math.max(0.5, rawMargin - 0.5);
  return `${favoriteName} -${halfRunLine.toFixed(1)}`;
};

const upsetRiskLabel = (winnerPct: number, margin: number) => {
  if (winnerPct < 0.58 || margin <= 2) return "High";
  if (winnerPct < 0.70 || margin <= 5) return "Medium";
  return "Low";
};

const applyResult = (
  teams: Team[],
  game: Matchup,
  winnerId: string,
  modelTeams: Team[]
) => {
  const next = teams.map((team) => ({ ...team }));
  const away = next.find((team) => team.id === game.away);
  const home = next.find((team) => team.id === game.home);
  if (!away || !home) return next;

  const prediction = predictGame(game, modelTeams);
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
  });

  return next;
};

const projectStandings = (teams: Team[], games: Matchup[]) => {
  let projected = teams.map((team) => ({ ...team }));
  games.forEach((game) => {
    const prediction = predictGame(game, teams);
    projected = applyResult(projected, game, prediction.winnerId, teams);
  });
  return rankTeams(projected);
};

const hashSeed = (text: string) => {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    seed ^= text.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return seed >>> 0;
};

const makeRandom = (seed: number) => {
  let state = seed || 1;
  return () => {
    state = Math.imul(1664525, state) + 1013904223;
    return ((state >>> 0) / 4294967296);
  };
};

const simulateGoldOdds = (
  teams: Team[],
  remaining: Matchup[],
  iterations: number,
  seedText: string,
  cutoff = DEFAULT_GOLD_CUTOFF
) => {
  const counts: Record<string, number> = {};
  teams.forEach((team) => {
    counts[team.id] = 0;
  });

  const random = makeRandom(hashSeed(seedText));

  for (let i = 0; i < iterations; i += 1) {
    let simTeams = teams.map((team) => ({ ...team }));

    remaining.forEach((game) => {
      const prediction = predictGame(game, teams);
      const winner = random() < prediction.awayWinPct ? game.away : game.home;
      simTeams = applyResult(simTeams, game, winner, teams);
    });

    rankTeams(simTeams).slice(0, cutoff).forEach((team) => {
      counts[team.id] += 1;
    });
  }

  const odds: Record<string, number> = {};
  teams.forEach((team) => {
    odds[team.id] = (counts[team.id] / iterations) * 100;
  });
  return odds;
};

const Sparkline = ({ values }: { values: number[] }) => {
  if (!values.length) return <span className="text-slate-400">—</span>;
  const width = 108;
  const height = 30;
  const data = values.length === 1 ? [values[0], values[0]] : values;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * width;
      const y = height - (clamp(value, 0, 100) / 100) * height;
      return `${x},${y}`;
    })
    .join(" ");

  const last = data[data.length - 1];
  const tone = last >= 75 ? "stroke-emerald-500" : last >= 40 ? "stroke-blue-500" : "stroke-slate-400";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={points} fill="none" className={tone} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={height - (clamp(last, 0, 100) / 100) * height} r="3" className={tone.replace("stroke", "fill")} />
    </svg>
  );
};


const GameDateInput = ({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (value: string) => void;
}) => {
  const [draft, setDraft] = useState(value || "");

  useEffect(() => {
    setDraft(value || "");
  }, [value]);

  const commit = () => {
    const normalized = normalizeDateInput(draft);
    onCommit(normalized);
    setDraft(normalized);
  };

  return (
    <input
      type="text"
      inputMode="text"
      placeholder="5/1"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
      className="w-28 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-black outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-200"
      aria-label="Game date in M/D format"
    />
  );
};

export default function App() {
  const [activeView, setActiveView] = useState<"standings" | "games" | "model" | "settings">("standings");
  const [teams, setTeams] = useState<TeamBase[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("league_teams") || "[]");
    } catch {
      return [];
    }
  });
  const [matchups, setMatchups] = useState<Matchup[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("league_matchups") || "[]");
    } catch {
      return [];
    }
  });
  const [logs, setLogs] = useState<Record<string, GameLog>>(() => {
    try {
      return JSON.parse(localStorage.getItem("league_logs") || "{}");
    } catch {
      return {};
    }
  });
  const [newDate, setNewDate] = useState("");
  const [newAway, setNewAway] = useState("");
  const [newHome, setNewHome] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [recentChanges, setRecentChanges] = useState<string[]>([]);
  const [lastImpact, setLastImpact] = useState<{ title: string; scores: string[]; messages: string[] } | null>(null);
  const [scoreboardTeamFilter, setScoreboardTeamFilter] = useState("ALL");
  const [seasonBuilderText, setSeasonBuilderText] = useState("");

  const [settings, setSettings] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("league_settings") || "{}");
      return {
        goldCutoff: Number(saved.goldCutoff) || DEFAULT_GOLD_CUTOFF,
        seasonLabel: String(saved.seasonLabel || DEFAULT_SEASON_LABEL),
        winPoints: Number(saved.winPoints) || 1,
        tiePoints: Number(saved.tiePoints) || 0.5,
        runDiffTiebreaker: saved.runDiffTiebreaker !== false,
        maxScoreCap: Number(saved.maxScoreCap) || 18,
        modelAggression: String(saved.modelAggression || 'Balanced'),
      };
    } catch {
      return { goldCutoff: DEFAULT_GOLD_CUTOFF, seasonLabel: DEFAULT_SEASON_LABEL, winPoints: 1, tiePoints: 0.5, runDiffTiebreaker: true, maxScoreCap: 18, modelAggression: 'Balanced' };
    }
  });
  const goldCutoff = clamp(Math.round(settings.goldCutoff || DEFAULT_GOLD_CUTOFF), 1, Math.max(1, teams.length || DEFAULT_GOLD_CUTOFF));

  useEffect(() => localStorage.setItem("league_teams", JSON.stringify(teams)), [teams]);
  useEffect(() => localStorage.setItem("league_matchups", JSON.stringify(matchups)), [matchups]);
  useEffect(() => localStorage.setItem("league_logs", JSON.stringify(logs)), [logs]);
  useEffect(() => localStorage.setItem("league_settings", JSON.stringify(settings)), [settings]);

  useEffect(() => {
    if (!newAway && teams[0]) setNewAway(teams[0].id);
    if (!newHome && teams[1]) setNewHome(teams[1].id);
  }, [teams, newAway, newHome]);

  const liveTeams = useMemo(() => calculateTeams(teams, matchups, logs), [teams, matchups, logs]);
  const ranked = useMemo(() => rankTeams(liveTeams), [liveTeams]);
  const remainingGames = useMemo(
    () => matchups.filter((game) => !isFinal(logs[game.id])),
    [matchups, logs]
  );
  const completedGames = useMemo(
    () => matchups.filter((game) => isFinal(logs[game.id])).sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date)),
    [matchups, logs]
  );
  const remainingCounts = useMemo(() => getRemainingCounts(liveTeams, remainingGames), [liveTeams, remainingGames]);
  const projected = useMemo(() => projectStandings(liveTeams, remainingGames), [liveTeams, remainingGames]);

  const odds = useMemo(() => {
    if (!teams.length) return {};
    return simulateGoldOdds(liveTeams, remainingGames, SIM_ITERATIONS, JSON.stringify({ matchups, logs, teams, goldCutoff }), goldCutoff);
  }, [teams, liveTeams, remainingGames, matchups, logs, goldCutoff]);

  const trendMap = useMemo(() => {
    const map: Record<string, number[]> = {};
    teams.forEach((team) => {
      map[team.id] = [];
    });

    if (!teams.length) return map;

    const states = completedGames.slice(-TREND_STATES);
    const buildLogsUntil = (limitIndex: number) => {
      const allowed = new Set(states.slice(0, limitIndex).map((game) => game.id));
      const stateLogs: Record<string, GameLog> = {};
      matchups.forEach((game) => {
        if (allowed.has(game.id) && logs[game.id]) stateLogs[game.id] = logs[game.id];
      });
      return stateLogs;
    };

    for (let index = 0; index <= states.length; index += 1) {
      const stateLogs = buildLogsUntil(index);
      const stateTeams = calculateTeams(teams, matchups, stateLogs);
      const stateRemaining = matchups.filter((game) => !isFinal(stateLogs[game.id]));
      const stateOdds = simulateGoldOdds(
        stateTeams,
        stateRemaining,
        70,
        `trend-${index}-${JSON.stringify(stateLogs).length}-${goldCutoff}`,
        goldCutoff
      );
      teams.forEach((team) => {
        map[team.id].push(stateOdds[team.id] || 0);
      });
    }

    return map;
  }, [teams, matchups, logs, completedGames, goldCutoff]);

  const dashboardRows: TeamWithProjection[] = useMemo(() => {
    return ranked.map((team) => {
      const projectedTeam = projected.find((item) => item.id === team.id);
      const status = getMathGoldStatus(team, ranked, remainingCounts, goldCutoff);
      return {
        ...team,
        projectedRank: projectedTeam?.rank || team.rank || 99,
        projectedRecord: projectedTeam ? recordText(projectedTeam) : recordText(team),
        projectedRunDiff: projectedTeam?.runDiff ?? team.runDiff,
        goldPct: odds[team.id] || 0,
        goldTrend: trendMap[team.id] || [],
        ...status,
      };
    });
  }, [ranked, projected, odds, trendMap, remainingCounts, goldCutoff]);

  const modelRows = useMemo(() => {
    return [...dashboardRows].sort((a, b) => {
      if (a.projectedRank !== b.projectedRank) return a.projectedRank - b.projectedRank;
      if (Math.abs(b.goldPct - a.goldPct) > 0.01) return b.goldPct - a.goldPct;
      return (a.rank || 99) - (b.rank || 99);
    });
  }, [dashboardRows]);
  const currentSosRanks = useMemo(() => {
    return Object.fromEntries(
      [...dashboardRows]
        .sort((a, b) => b.sos - a.sos)
        .map((team, index) => [team.id, index + 1])
    ) as Record<string, number>;
  }, [dashboardRows]);


  const cutLineTeams = useMemo(() => {
    return dashboardRows.filter((team) => {
      const seed = team.rank || 99;
      return seed >= goldCutoff - 2 && seed <= goldCutoff + 3;
    });
  }, [dashboardRows, goldCutoff]);

  const projectedCutLineTeams = useMemo(() => {
    return modelRows.filter((team) => {
      const seed = team.projectedRank || 99;
      return seed >= goldCutoff - 2 && seed <= goldCutoff + 3;
    });
  }, [modelRows, goldCutoff]);


  const seedForScenario = (teamId: string, game: Matchup, winnerId: string) => {
    const scenario = applyResult(liveTeams, game, winnerId, liveTeams);
    const scenarioGames = remainingGames.filter((item) => item.id !== game.id);
    const finalProjected = projectStandings(scenario, scenarioGames);
    return finalProjected.find((team) => team.id === teamId)?.rank || 99;
  };

  const nextTwoSwingGames = (teamId: string): SwingGame[] => {
    return remainingGames
      .filter((game) => game.away === teamId || game.home === teamId)
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .slice(0, 2)
      .map((game) => {
        const teamIsAway = game.away === teamId;
        const opponentId = teamIsAway ? game.home : game.away;
        const opponentName = displayName(teams.find((team) => team.id === opponentId)?.name || opponentId);
        const prediction = predictGame(game, liveTeams);
        const winSeed = seedForScenario(teamId, game, teamId);
        const lossSeed = seedForScenario(teamId, game, opponentId);
        const teamWinPct = teamIsAway ? prediction.awayWinPct : 1 - prediction.awayWinPct;
        const modelPick = displayName(teams.find((team) => team.id === prediction.winnerId)?.name || prediction.winnerId);
        return { game, opponentName, teamIsAway, winSeed, lossSeed, modelPick, winPct: teamWinPct };
      });
  };

  const seedRangeForTeam = (teamId: string) => {
    const baseline = projected.find((team) => team.id === teamId)?.rank || ranked.find((team) => team.id === teamId)?.rank || 99;
    const ranks = [baseline];

    remainingGames.forEach((game) => {
      ranks.push(seedForScenario(teamId, game, game.away));
      ranks.push(seedForScenario(teamId, game, game.home));
    });

    return { best: Math.min(...ranks), worst: Math.max(...ranks), baseline };
  };

  const controlLevelForTeam = (team: TeamWithProjection) => {
    if (team.goldStatus === "Clinched") return "Clinched";
    if (team.goldStatus === "Eliminated") return "Eliminated";

    let winOut = liveTeams.map((item) => ({ ...item }));
    remainingGames.forEach((game) => {
      const winner = game.away === team.id || game.home === team.id
        ? team.id
        : predictGame(game, liveTeams).winnerId;
      winOut = applyResult(winOut, game, winner, liveTeams);
    });

    const winOutSeed = rankTeams(winOut).find((item) => item.id === team.id)?.rank || 99;
    const swings = nextTwoSwingGames(team.id);
    const lossRisk = swings.some((swing) => swing.lossSeed > goldCutoff);

    if (winOutSeed <= goldCutoff && (team.rank || 99) > goldCutoff) return "Controls Path";
    if (winOutSeed > goldCutoff) return "Needs Help";
    if ((team.rank || 99) <= goldCutoff && lossRisk) return "At Risk";
    return "Controls Spot";
  };

  const statusLabel = (team: TeamWithProjection) => {
    if (team.goldStatus === "Clinched") return "Clinched";
    if (team.goldStatus === "Eliminated") return "Eliminated";

    const currentSeed = team.rank || 99;
    const projectedSeed = team.projectedRank || 99;
    const currentCutoffTeam = dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)];
    const cutoffPoints = currentCutoffTeam ? standingsPoints(currentCutoffTeam) : 0;
    const canStillReachCutLine = team.maxPoints >= cutoffPoints;

    // Keep the labels honest: only the mathematical endpoints are Clinched/Eliminated.
    // Firmly In requires current position, projection, odds, and a real cushion over the chase pack.
    if (currentSeed <= goldCutoff) {
      const currentPoints = standingsPoints(team);
      const outsideThreats = dashboardRows.filter((other) =>
        other.id !== team.id &&
        (other.rank || 99) > goldCutoff &&
        other.maxPoints >= currentPoints
      ).length;
      const cushionSlots = Math.max(0, goldCutoff - currentSeed);
      const exposedToChasers = outsideThreats > cushionSlots;

      if (currentSeed <= goldCutoff - 2 && projectedSeed <= goldCutoff && team.goldPct >= 90 && !exposedToChasers) {
        return "Firmly In";
      }
      return "In";
    }

    // Outside the Gold cut line: Alive means a meaningful path, not merely a technical one.
    const seedDistance = currentSeed - goldCutoff;
    const projectedNearCut = projectedSeed <= goldCutoff + 1;

    if (projectedSeed <= goldCutoff && team.goldPct >= 15) return "Alive";
    if (team.goldPct >= 25 && seedDistance <= 3) return "Alive";
    if (projectedNearCut && team.goldPct >= 12) return "Alive";
    if (canStillReachCutLine) return "Work To Do";
    return "Work To Do";
  };

  const statusClass = (team: TeamWithProjection) => {
    const label = statusLabel(team);
    if (label === "Clinched") return "bg-slate-950 text-white";
    if (label === "Firmly In") return "bg-emerald-100 text-emerald-700";
    if (label === "In") return "bg-blue-100 text-blue-700";
    if (label === "Alive") return "bg-amber-100 text-amber-700";
    if (label === "Work To Do") return "bg-orange-100 text-orange-700";
    return "bg-red-100 text-red-700";
  };

  const formatGoldPct = (team: TeamWithProjection) => {
    if (team.goldStatus !== "Eliminated" && team.goldPct > 0 && team.goldPct < 1) return "<1%";
    return `${Math.round(team.goldPct)}%`;
  };

  const titleRaceBadgeForTeam = (team: TeamWithProjection) => {
    const leader = dashboardRows[0];
    if (!leader || leader.id === team.id) return team.rank === 1 ? "Title Leader" : "";
    const teamBack = ((leader.w - team.w) + (team.l - leader.l) + (leader.t - team.t) * 0.5) / 2;
    const teamMax = standingsPoints(team) + (remainingCounts[team.id] || 0);
    const leaderCurrent = standingsPoints(leader);
    if (teamMax < leaderCurrent) return "Title Eliminated";
    if (teamBack <= 2 && (team.rank || 99) <= 5) return "Title Contender";
    return "";
  };

  const teamPathNote = (team: TeamWithProjection) => {
    const range = seedRangeForTeam(team.id);
    const sos = scheduleDifficultyForTeam(team.id);
    const name = displayName(team.name);
    if (team.goldStatus === "Clinched") return `${name} has clinched Gold and is playing for seeding.`;
    if (team.goldStatus === "Eliminated") return `${name} cannot reach Gold and can only affect other teams' paths.`;
    if ((team.rank || 99) <= goldCutoff && range.worst <= goldCutoff) return `${name} controls the spot; even a rough path still projects inside Gold.`;
    if ((team.rank || 99) <= goldCutoff) return `${name} is in now but can fall out if the next results break badly.`;
    if (range.best <= goldCutoff && team.goldPct >= 10) return `${name} can move into Gold with wins and help near the cut line.`;
    return `${name} needs wins plus multiple teams above the line to stumble.`;
  };

  const latestCompletedDate = completedGames.length ? formatGameDate(completedGames[completedGames.length - 1].date) : "No finals yet";

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert("Copied summary.");
    } catch {
      window.prompt("Copy this summary:", text);
    }
  };

  const buildStandingsSummary = () => {
    const rows = dashboardRows.slice(0, Math.min(dashboardRows.length, goldCutoff + 2));
    return [`${settings.seasonLabel} Standings — updated through ${latestCompletedDate}`, ...rows.map((team) => `#${team.rank} ${displayName(team.name)} ${recordText(team)} (${statusLabel(team)}, Gold ${formatGoldPct(team)})`)].join("\n");
  };

  const buildBubbleSummary = () => {
    return [`Bubble Watch — Top ${goldCutoff} make Gold`, ...bubbleMovementRows.map(({ team }) => `#${team.rank} ${displayName(team.name)}: ${teamPathNote(team)} Gold ${formatGoldPct(team)}.`)].join("\n");
  };

  const buildLatestImpactSummary = () => {
    if (!lastImpact) return "No recent impact update.";
    return [lastImpact.title, "Final Scores:", ...lastImpact.scores, "Impact:", ...lastImpact.messages].join("\n");
  };


  const bubbleTierForTeam = (team: TeamWithProjection) => {
    if (team.goldStatus === "Clinched") return "Locked In";
    if (team.goldStatus === "Eliminated") return "Eliminated";
    const currentSeed = team.rank || 99;
    const projectedSeed = team.projectedRank || 99;
    if (currentSeed <= goldCutoff - 2 && projectedSeed <= goldCutoff && team.goldPct >= 80) return "Likely In";
    if (currentSeed <= goldCutoff || projectedSeed <= goldCutoff) return "Bubble In";
    if (team.goldPct >= 20 || projectedSeed <= goldCutoff + 2 || team.maxPoints >= standingsPoints(dashboardRows[Math.min(goldCutoff - 1, dashboardRows.length - 1)] || team)) return "Bubble Out";
    return "Long Shot";
  };

  const scheduleDifficultyForTeam = (teamId: string) => {
    const games = remainingGames.filter((game) => game.away === teamId || game.home === teamId);
    if (!games.length) return { label: "Complete", avgSeed: 0, opponents: "No games left" };
    const oppSeeds = games.map((game) => {
      const opponentId = game.away === teamId ? game.home : game.away;
      const opponent = dashboardRows.find((team) => team.id === opponentId);
      return {
        seed: opponent?.rank || 99,
        name: displayName(opponent?.name || opponentId),
      };
    });
    const avgSeed = oppSeeds.reduce((sum, item) => sum + item.seed, 0) / Math.max(oppSeeds.length, 1);
    const label = avgSeed <= Math.max(2, goldCutoff - 2) ? "Hard" : avgSeed <= goldCutoff + 2 ? "Medium" : "Easy";
    return {
      label,
      avgSeed,
      opponents: oppSeeds.map((item) => `#${item.seed} ${item.name}`).join(", "),
    };
  };

  const gameImportance = (game: Matchup) => {
    const away = dashboardRows.find((team) => team.id === game.away);
    const home = dashboardRows.find((team) => team.id === game.home);
    if (!away || !home) return 0;
    const seedScore = (team: TeamWithProjection) => Math.max(0, 8 - Math.abs((team.rank || 99) - goldCutoff));
    const oddsScore = (team: TeamWithProjection) => Math.max(0, 50 - Math.abs(team.goldPct - 50)) / 10;
    const projectedScore = (team: TeamWithProjection) => Math.max(0, 5 - Math.abs((team.projectedRank || 99) - goldCutoff));
    return seedScore(away) + seedScore(home) + oddsScore(away) + oddsScore(home) + projectedScore(away) + projectedScore(home);
  };

  const biggestBubbleGame = useMemo(() => {
    const game = [...remainingGames].sort((a, b) => gameImportance(b) - gameImportance(a))[0];
    if (!game) return null;
    const away = teams.find((team) => team.id === game.away);
    const home = teams.find((team) => team.id === game.home);
    return `${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`;
  }, [remainingGames, dashboardRows, teams]);

  const todayPicture = useMemo(() => {
    const clinched = dashboardRows.filter((team) => team.goldStatus === "Clinched").map((team) => displayName(team.name));
    const eliminated = dashboardRows.filter((team) => team.goldStatus === "Eliminated").map((team) => displayName(team.name));
    return {
      clinched: clinched.length ? clinched.join(", ") : "None",
      eliminated: eliminated.length ? eliminated.join(", ") : "None",
      biggestGame: biggestBubbleGame || "None",
    };
  }, [dashboardRows, biggestBubbleGame]);

  const bubbleRows = useMemo(() => {
    return dashboardRows.map((team) => ({
      team,
      tier: bubbleTierForTeam(team),
      sos: scheduleDifficultyForTeam(team.id),
      control: controlLevelForTeam(team),
    }));
  }, [dashboardRows, remainingGames, goldCutoff]);

  function getGameScenarioImpact(game: Matchup) {
    const prediction = predictGame(game, liveTeams);
    const away = dashboardRows.find((team) => team.id === game.away);
    const home = dashboardRows.find((team) => team.id === game.home);
    const awaySeedWin = seedForScenario(game.away, game, game.away);
    const awaySeedLoss = seedForScenario(game.away, game, game.home);
    const homeSeedWin = seedForScenario(game.home, game, game.home);
    const homeSeedLoss = seedForScenario(game.home, game, game.away);
    const seedImpact = Math.max(Math.abs(awaySeedWin - awaySeedLoss), Math.abs(homeSeedWin - homeSeedLoss));
    const impactLabel = seedImpact >= 3 ? "High" : seedImpact >= 1 ? "Medium" : "Low";
    const awayGoldSwing = clamp((awaySeedLoss - awaySeedWin) * 8 + (prediction.winnerId === game.away ? 4 : -4), -25, 25);
    const homeGoldSwing = clamp((homeSeedLoss - homeSeedWin) * 8 + (prediction.winnerId === game.home ? 4 : -4), -25, 25);
    return {
      awaySeedWin,
      awaySeedLoss,
      homeSeedWin,
      homeSeedLoss,
      seedImpact,
      impactLabel,
      awayGoldSwing,
      homeGoldSwing,
      awayName: displayName(away?.name || game.away),
      homeName: displayName(home?.name || game.home),
    };
  }


  const nextGameForTeam = (teamId: string) => {
    return remainingGames
      .filter((game) => game.away === teamId || game.home === teamId)
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))[0] || null;
  };

  const isTeamNextGame = (teamId: string, game: Matchup) =>
    nextGameForTeam(teamId)?.id === game.id;

  const goldStatusAfterScenario = (teamId: string, game: Matchup, winnerId: string) => {
    const scenarioTeams = rankTeams(applyResult(liveTeams, game, winnerId, liveTeams));
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);
    const scenarioTeam = scenarioTeams.find((team) => team.id === teamId);
    if (!scenarioTeam) return null;
    return getMathGoldStatus(scenarioTeam, scenarioTeams, scenarioCounts, goldCutoff).goldStatus;
  };

  const teamClinchesGoldWithWin = (teamId: string, game: Matchup) => {
    const team = dashboardRows.find((item) => item.id === teamId);
    if (!team || team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;
    return goldStatusAfterScenario(teamId, game, teamId) === "Clinched";
  };

  const teamCanBeEliminatedWithLoss = (teamId: string, game: Matchup) => {
    const team = dashboardRows.find((item) => item.id === teamId);
    if (!team || team.goldStatus === "Clinched" || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;
    const opponentId = game.away === teamId ? game.home : game.away;
    return goldStatusAfterScenario(teamId, game, opponentId) === "Eliminated";
  };

  const teamClinchesRegularSeasonTitleWithWin = (teamId: string, game: Matchup) => {
    const team = dashboardRows.find((item) => item.id === teamId);
    if (!team || team.goldStatus === "Eliminated") return false;
    if (!isTeamNextGame(teamId, game)) return false;

    const scenarioTeams = rankTeams(applyResult(liveTeams, game, teamId, liveTeams));
    const scenarioRemaining = remainingGames.filter((item) => item.id !== game.id);
    const scenarioCounts = getRemainingCounts(scenarioTeams, scenarioRemaining);
    const scenarioTeam = scenarioTeams.find((item) => item.id === teamId);
    if (!scenarioTeam) return false;

    const titlePoints = standingsPoints(scenarioTeam);
    return scenarioTeams.every((other) => {
      if (other.id === teamId) return true;
      const otherMax = standingsPoints(other) + (scenarioCounts[other.id] || 0);
      // Strictly less means nobody can even tie the team after this result.
      return otherMax < titlePoints;
    });
  };

  const gameStatusForGame = (game: Matchup) => {
    const impact = getGameScenarioImpact(game);
    const away = dashboardRows.find((team) => team.id === game.away);
    const home = dashboardRows.find((team) => team.id === game.home);
    const teamsInGame = [away, home].filter(Boolean) as TeamWithProjection[];

    // Clinch/elimination badges should only appear when this is the affected team's next game.
    // Once that team clinches, the badge disappears for them unless they can clinch the regular season title.
    if (teamsInGame.some((team) => teamClinchesRegularSeasonTitleWithWin(team.id, game))) return "Title Clinch";
    if (teamsInGame.some((team) => teamClinchesGoldWithWin(team.id, game))) return "Gold Bracket Clinch";
    if (teamsInGame.some((team) => teamCanBeEliminatedWithLoss(team.id, game))) return "Elimination Scenario";

    const nearCutLine = teamsInGame.some((team) => Math.abs((team.rank || 99) - goldCutoff) <= 1);
    if (impact.seedImpact >= 2) return "High Impact";
    if (nearCutLine || impact.seedImpact >= 1) return "Bubble Game";
    return "Low Impact";
  };

  const gamesThatMatterMost = useMemo(() => {
    return [...remainingGames]
      .sort((a, b) => gameImportance(b) - gameImportance(a))
      .slice(0, 5)
      .map((game, index) => {
        const away = dashboardRows.find((team) => team.id === game.away);
        const home = dashboardRows.find((team) => team.id === game.home);
        const impact = getGameScenarioImpact(game);
        const status = gameStatusForGame(game);
        const reason = status === "Low Impact"
          ? `${impact.impactLabel} projected seed impact`
          : status;
        return {
          game,
          rank: index + 1,
          label: `${displayName(away?.name || game.away)} vs ${displayName(home?.name || game.home)}`,
          reason,
          date: formatGameDate(game.date),
        };
      });
  }, [remainingGames, dashboardRows, liveTeams, goldCutoff]);

  const gameStatusClasses = (label: string) => {
    if (label === "Title Clinch") return "bg-purple-100 text-purple-700";
    if (label === "Gold Bracket Clinch") return "bg-emerald-100 text-emerald-700";
    if (label === "Elimination Scenario") return "bg-red-100 text-red-700";
    if (label === "High Impact") return "bg-amber-100 text-amber-700";
    if (label === "Bubble Game") return "bg-blue-100 text-blue-700";
    return "bg-slate-200 text-slate-600";
  };

  const clinchScenariosForTeam = (teamId: string) => {
    const team = dashboardRows.find((item) => item.id === teamId);
    if (!team) return [];
    const teamName = displayName(team.name);

    if (team.goldStatus === "Clinched") return [`${teamName} has already clinched a Gold Bracket spot.`];
    if (team.goldStatus === "Eliminated") return [`${teamName} is eliminated from Gold Bracket contention.`];

    const scenarios = nextTwoSwingGames(teamId).slice(0, 2).map((swing) => {
      const opponentLine = `${swing.teamIsAway ? "at" : "vs"} ${swing.opponentName}`;
      if (swing.winSeed <= goldCutoff && swing.lossSeed > goldCutoff) {
        return `${opponentLine}: win projects inside the Gold cut line at #${swing.winSeed}; loss drops outside the Gold cut line at #${swing.lossSeed}.`;
      }
      if (swing.winSeed <= goldCutoff && swing.lossSeed <= goldCutoff) {
        return `${opponentLine}: win improves or protects the Gold Bracket path at #${swing.winSeed}; loss still projects #${swing.lossSeed}.`;
      }
      if (swing.winSeed > goldCutoff && swing.lossSeed > goldCutoff) {
        return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}, so outside help is still needed.`;
      }
      return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}.`;
    });

    if (!scenarios.length) return [`${teamName} has no remaining games; Gold Bracket status depends only on outside results.`];
    return scenarios;
  };

  const bubbleMovementRows = useMemo(() => {
    const byId = new Map(bubbleRows.map((row) => [row.team.id, row]));
    const selected = new Map<string, (typeof bubbleRows)[number]>();
    const add = (row: (typeof bubbleRows)[number] | undefined) => {
      if (row) selected.set(row.team.id, row);
    };

    // Sharper Bubble Watch: last two currently in, first three currently out, plus projected crossers.
    dashboardRows
      .filter((team) => {
        const seed = team.rank || 99;
        return seed >= goldCutoff - 1 && seed <= goldCutoff;
      })
      .forEach((team) => add(byId.get(team.id)));

    dashboardRows
      .filter((team) => {
        const seed = team.rank || 99;
        return seed >= goldCutoff + 1 && seed <= goldCutoff + 3;
      })
      .forEach((team) => add(byId.get(team.id)));

    dashboardRows
      .filter((team) => {
        const currentInside = (team.rank || 99) <= goldCutoff;
        const projectedInside = (team.projectedRank || 99) <= goldCutoff;
        return currentInside !== projectedInside;
      })
      .forEach((team) => add(byId.get(team.id)));

    return [...selected.values()].sort((a, b) => {
      const aCross = ((a.team.rank || 99) <= goldCutoff) !== ((a.team.projectedRank || 99) <= goldCutoff);
      const bCross = ((b.team.rank || 99) <= goldCutoff) !== ((b.team.projectedRank || 99) <= goldCutoff);
      if (aCross !== bCross) return aCross ? -1 : 1;
      return Math.abs((a.team.rank || 99) - goldCutoff) - Math.abs((b.team.rank || 99) - goldCutoff);
    });
  }, [bubbleRows, dashboardRows, goldCutoff]);

  const clinchEliminationRows = useMemo(() => {
    return dashboardRows
      .map((team) => {
        const swings = nextTwoSwingGames(team.id);
        const canClinch = team.goldStatus !== "Clinched" && swings.some((swing) => swing.winSeed <= goldCutoff && team.goldPct >= 55);
        const canBeEliminated = team.goldStatus !== "Eliminated" && swings.some((swing) => swing.lossSeed > goldCutoff && team.goldPct <= 45);
        return { team, swings, canClinch, canBeEliminated };
      })
      .filter((row) => row.canClinch || row.canBeEliminated || row.team.goldStatus === "Clinched" || row.team.goldStatus === "Eliminated")
      .slice(0, 10);
  }, [dashboardRows, remainingGames, goldCutoff]);
  const selectedTeam = selectedTeamId ? dashboardRows.find((team) => team.id === selectedTeamId) || null : null;

  const gameForecasts = useMemo(() => {
    return [...remainingGames]
      .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date))
      .map((game) => {
        const prediction = predictGame(game, liveTeams);
        const away = teams.find((team) => team.id === game.away);
        const home = teams.find((team) => team.id === game.home);
        const winner = teams.find((team) => team.id === prediction.winnerId);
        const winnerPct = prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
        const impact = getGameScenarioImpact(game);
        return {
          game,
          prediction,
          awayName: displayName(away?.name || game.away),
          homeName: displayName(home?.name || game.home),
          winnerName: displayName(winner?.name || prediction.winnerId),
          winnerPct,
          impact,
          explanation: `${describePrediction(game, prediction, liveTeams)} Seed impact is ${impact.impactLabel.toLowerCase()}: ${impact.awayName} ranges from #${impact.awaySeedWin} with a win to #${impact.awaySeedLoss} with a loss, while ${impact.homeName} ranges from #${impact.homeSeedWin} to #${impact.homeSeedLoss}. Estimated Gold swing: ${impact.awayName} ${impact.awayGoldSwing >= 0 ? "+" : ""}${Math.round(impact.awayGoldSwing)}%, ${impact.homeName} ${impact.homeGoldSwing >= 0 ? "+" : ""}${Math.round(impact.homeGoldSwing)}%.`,
        };
      });
  }, [remainingGames, liveTeams, teams]);

  const scoreboardGames = useMemo(() => {
    const dateCompare = (a: Matchup, b: Matchup) => {
      const aFinal = isFinal(logs[a.id]);
      const bFinal = isFinal(logs[b.id]);
      const aNoDate = !a.date.trim();
      const bNoDate = !b.date.trim();

      // Open games stay first; final games stay at the bottom.
      // Reopened final games are allowed to move back to the open section.
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      if (!aFinal && aNoDate !== bNoDate) return aNoDate ? -1 : 1;
      return parseDateValue(a.date) - parseDateValue(b.date) || a.id.localeCompare(b.id);
    };

    const filtered = scoreboardTeamFilter === "ALL"
      ? matchups
      : matchups.filter((game) => game.away === scoreboardTeamFilter || game.home === scoreboardTeamFilter);

    return [...filtered].sort(dateCompare);
  }, [matchups, logs, scoreboardTeamFilter]);

  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = String(event.target?.result || "");
        const lines = text.split(/\r?\n/).filter((line) => line.trim());
        if (lines.length < 2) throw new Error("CSV has no rows");

        const headers = parseCSVLine(lines[0]).map(normalizeHeader);
        const index = (name: string) => headers.indexOf(normalizeHeader(name));

        const gameIdIndex = index("Game ID");
        const dateIndex = index("Date");
        const awayTeamIndex = index("Away Team");
        const inningsIndex = index("Innings");
        const awayRunsIndex = index("Away Runs");
        const awayHitsIndex = index("Away Hits");
        const awayKIndex = index("Away K");
        const homeTeamIndex = index("Home Team");
        const homeRunsIndex = index("Home Runs");
        const homeHitsIndex = index("Home Hits");
        const homeKIndex = index("Home K");

        if (gameIdIndex < 0 || dateIndex < 0 || awayTeamIndex < 0 || homeTeamIndex < 0) {
          throw new Error("Missing required columns");
        }

        const rows = lines.slice(1).map(parseCSVLine);
        const names = new Set<string>();
        rows.forEach((row) => {
          if (row[awayTeamIndex]?.trim()) names.add(row[awayTeamIndex].trim());
          if (row[homeTeamIndex]?.trim()) names.add(row[homeTeamIndex].trim());
        });

        const existingIds = new Set<string>();
        const nameToId = new Map<string, string>();
        const importedTeams = Array.from(names)
          .sort((a, b) => displayName(a).localeCompare(displayName(b)))
          .map((name) => {
            const id = createTeamId(name, existingIds);
            nameToId.set(name, id);
            return { id, name };
          });

        const importedMatchups: Matchup[] = [];
        const importedLogs: Record<string, GameLog> = {};

        rows.forEach((row, rowIndex) => {
          const awayName = row[awayTeamIndex]?.trim();
          const homeName = row[homeTeamIndex]?.trim();
          if (!awayName || !homeName) return;

          const away = nameToId.get(awayName);
          const home = nameToId.get(homeName);
          if (!away || !home) return;

          const id = row[gameIdIndex]?.trim() || `game_${Date.now()}_${rowIndex}`;
          const awayRuns = awayRunsIndex >= 0 ? row[awayRunsIndex]?.trim() || "" : "";
          const homeRuns = homeRunsIndex >= 0 ? row[homeRunsIndex]?.trim() || "" : "";
          const awayK = awayKIndex >= 0 ? row[awayKIndex]?.trim() || "" : "";
          const homeK = homeKIndex >= 0 ? row[homeKIndex]?.trim() || "" : "";

          importedMatchups.push({
            id,
            date: normalizeDateInput(row[dateIndex]?.trim() || ""),
            away,
            home,
          });

          importedLogs[id] = {
            innings: inningsIndex >= 0 ? row[inningsIndex]?.trim() || "6" : "6",
            awayRuns,
            awayHits: awayHitsIndex >= 0 ? row[awayHitsIndex]?.trim() || "" : "",
            awayK,
            homeRuns,
            homeHits: homeHitsIndex >= 0 ? row[homeHitsIndex]?.trim() || "" : "",
            homeK,
            isFinal: awayRuns !== "" && homeRuns !== "" && awayK !== "" && homeK !== "",
          };
        });

        const finalGames = Object.values(importedLogs).filter((log) => isFinal(log)).length;
        const openGames = importedMatchups.length - finalGames;
        const importedFinalGames = importedMatchups
          .filter((game) => isFinal(importedLogs[game.id]))
          .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date));
        const latestImportedFinal = importedFinalGames[importedFinalGames.length - 1];
        const latestImportedFinalDate = latestImportedFinal ? formatGameDate(latestImportedFinal.date) : "None";
        const confirmed = window.confirm(
          `Import this schedule?\n\n${importedTeams.length} teams found\n${importedMatchups.length} games found\n${finalGames} finals imported\n${openGames} open games imported\nLatest final: ${latestImportedFinalDate}\n\nThis will replace the current season data.`
        );

        if (!confirmed) return;

        setTeams(importedTeams);
        setMatchups(importedMatchups);
        setLogs(importedLogs);
        setRecentChanges([]);
        setSelectedTeamId(null);
        setActiveView("standings");
      } catch (error) {
        console.error(error);
        alert("Could not import this CSV. Use the schedule CSV with Game ID, Date, Away Team, and Home Team columns.");
      }
    };
    reader.readAsText(file);
  };

  const exportCSV = () => {
    const headers = [
      "Game ID",
      "Date",
      "Away Team",
      "Innings",
      "Away Runs",
      "Away Hits",
      "Away K",
      "Away BIP",
      "Home Team",
      "Home Runs",
      "Home Hits",
      "Home K",
      "Home BIP",
    ];

    const rows = matchups.map((game) => {
      const log = logs[game.id] || blankLog();
      const away = teams.find((team) => team.id === game.away)?.name || game.away;
      const home = teams.find((team) => team.id === game.home)?.name || game.home;
      const awayBip = calcBip(log.awayHits, log.awayRuns, log.awayK, log.innings);
      const homeBip = calcBip(log.homeHits, log.homeRuns, log.homeK, log.innings);
      return [
        game.id,
        formatGameDate(game.date),
        away,
        log.innings,
        log.awayRuns,
        log.awayHits,
        log.awayK,
        awayBip,
        home,
        log.homeRuns,
        log.homeHits,
        log.homeK,
        homeBip,
      ].map(csvEscape).join(",");
    });

    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Schedule_Data.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ teams, matchups, logs, settings }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Backup.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const resetSeason = () => {
    if (!window.confirm("Reset this season? This clears teams, games, and scores from this browser.")) return;
    setTeams([]);
    setMatchups([]);
    setLogs({});
    setRecentChanges([]);
    setLastImpact(null);
    setSelectedTeamId(null);
    setActiveView("standings");
  };

  const buildRankSnapshot = (nextLogs: Record<string, GameLog>) => {
    const nextLive = calculateTeams(teams, matchups, nextLogs);
    const nextRanked = rankTeams(nextLive);
    const nextRemaining = matchups.filter((game) => !isFinal(nextLogs[game.id]));
    const nextRemainingCounts = getRemainingCounts(nextLive, nextRemaining);
    const nextProjected = projectStandings(nextLive, nextRemaining);
    const nextOdds = simulateGoldOdds(nextLive, nextRemaining, 80, `change-${JSON.stringify(nextLogs).length}-${goldCutoff}`, goldCutoff);

    return nextRanked.map((team) => {
      const projectedTeam = nextProjected.find((item) => item.id === team.id);
      return {
        ...team,
        projectedRank: projectedTeam?.rank || team.rank || 99,
        goldPct: nextOdds[team.id] || 0,
        ...getMathGoldStatus(team, nextRanked, nextRemainingCounts, goldCutoff),
      };
    });
  };

  const readBuilderTeamNames = (): string[] => {
    const cleaned = seasonBuilderText
      .split(/\r?\n|,/)
      .map((name) => name.trim())
      .filter(Boolean);
    return Array.from(new Set<string>(cleaned));
  };

  const buildRoundRobinSeason = () => {
    const names: string[] = readBuilderTeamNames();
    if (names.length < 2) {
      alert("Enter at least two teams to build a schedule.");
      return null;
    }

    const existingIds = new Set<string>();
    const builtTeams = names.map((name) => ({ id: createTeamId(name, existingIds), name }));
    const builtMatchups: Matchup[] = [];
    const builtLogs: Record<string, GameLog> = {};

    for (let awayIndex = 0; awayIndex < builtTeams.length; awayIndex += 1) {
      for (let homeIndex = awayIndex + 1; homeIndex < builtTeams.length; homeIndex += 1) {
        const away = builtTeams[awayIndex];
        const home = builtTeams[homeIndex];
        const gameNumber = builtMatchups.length + 1;
        const id = `game_${String(gameNumber).padStart(3, "0")}_${away.id}_${home.id}`;
        builtMatchups.push({ id, date: "", away: away.id, home: home.id });
        builtLogs[id] = blankLog();
      }
    }

    return { builtTeams, builtMatchups, builtLogs };
  };

  const createSeasonFromTeamList = () => {
    const built = buildRoundRobinSeason();
    if (!built) return;
    const confirmed = window.confirm(
      `Create a new blank schedule?\n\n${built.builtTeams.length} teams\n${built.builtMatchups.length} games\n\nEach team will play every other team once. This will replace the current season data.`
    );
    if (!confirmed) return;

    setTeams(built.builtTeams);
    setMatchups(built.builtMatchups);
    setLogs(built.builtLogs);
    setRecentChanges([]);
    setLastImpact(null);
    setSelectedTeamId(null);
    setScoreboardTeamFilter("ALL");
    setActiveView("games");
  };

  const downloadRoundRobinCSV = () => {
    const built = buildRoundRobinSeason();
    if (!built) return;

    const headers = [
      "Game ID",
      "Date",
      "Away Team",
      "Innings",
      "Away Runs",
      "Away Hits",
      "Away K",
      "Away BIP",
      "Home Team",
      "Home Runs",
      "Home Hits",
      "Home K",
      "Home BIP",
    ];

    const rows = built.builtMatchups.map((game) => {
      const away = built.builtTeams.find((team) => team.id === game.away)?.name || game.away;
      const home = built.builtTeams.find((team) => team.id === game.home)?.name || game.home;
      return [game.id, "", away, "6", "", "", "", "N/A", home, "", "", "", "N/A"].map(csvEscape).join(",");
    });

    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${settings.seasonLabel.replace(/\s+/g, "_")}_Blank_Round_Robin.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const summarizeChanges = (
    before: ReturnType<typeof buildRankSnapshot>,
    after: ReturnType<typeof buildRankSnapshot>,
    impactedTeamIds: string[] = []
  ) => {
    const messages: string[] = [];

    const titleClinched = (team: ReturnType<typeof buildRankSnapshot>[number], field: ReturnType<typeof buildRankSnapshot>) => {
      const currentPoints = standingsPoints(team);
      return field.every((other) => {
        if (other.id === team.id) return true;
        return other.maxPoints < currentPoints;
      });
    };

    const titleEliminated = (team: ReturnType<typeof buildRankSnapshot>[number], field: ReturnType<typeof buildRankSnapshot>) => {
      return field.some((other) => {
        if (other.id === team.id) return false;
        return standingsPoints(other) > team.maxPoints;
      });
    };

    const gamesBackOfFirst = (team: ReturnType<typeof buildRankSnapshot>[number], field: ReturnType<typeof buildRankSnapshot>) => {
      const leader = [...field].sort((a, b) => {
        const aPct = a.games > 0 ? (a.w + a.t * 0.5) / a.games : 0;
        const bPct = b.games > 0 ? (b.w + b.t * 0.5) / b.games : 0;
        if (Math.abs(bPct - aPct) > 0.0001) return bPct - aPct;
        return b.runDiff - a.runDiff;
      })[0];

      if (!leader || leader.id === team.id) return 0;

      // Baseball-style games back. Ties count as half a win and half a loss.
      // This avoids the bad shortcut where an 8-0 team and a 7-4 team looked
      // only one game apart just because their standings points differed by 1.
      const leaderWins = leader.w + leader.t * 0.5;
      const leaderLosses = leader.l + leader.t * 0.5;
      const teamWins = team.w + team.t * 0.5;
      const teamLosses = team.l + team.t * 0.5;
      return Math.max(0, Math.round(((leaderWins - teamWins) + (teamLosses - leaderLosses)) * 5) / 10);
    };

    const titleClinchedInField = (field: ReturnType<typeof buildRankSnapshot>) =>
      field.some((item) => titleClinched(item, field));

    const titleWasAlreadyClinchedBeforeUpdate = titleClinchedInField(before);
    const titleIsClinchedAfterUpdate = titleClinchedInField(after);

    const hasRealisticTitlePath = (
      team: ReturnType<typeof buildRankSnapshot>[number],
      field: ReturnType<typeof buildRankSnapshot>
    ) => {
      if (titleClinched(team, field) || titleEliminated(team, field)) return false;
      const back = gamesBackOfFirst(team, field);
      const projectedRank = team.projectedRank || team.rank || 99;
      const currentRank = team.rank || 99;

      // Only mention the regular season title race when the team is close enough
      // that the note tells the user something meaningful. Otherwise it clutters
      // the impact panel with title-race context for teams that are technically
      // alive but realistically not part of that race.
      const remaining = Math.max(0, team.maxPoints - standingsPoints(team));
      return remaining > 0 && (back <= 1.5 || projectedRank <= 2 || currentRank <= 2);
    };

    after.forEach((team) => {
      const old = before.find((item) => item.id === team.id);
      if (!old) return;
      const oldRank = old.rank || 99;
      const newRank = team.rank || 99;
      const teamName = displayName(team.name);

      if (oldRank !== newRank) {
        const direction = newRank < oldRank ? "moved up" : "dropped";
        messages.push(`${teamName} ${direction} from #${oldRank} to #${newRank}`);
      }

      if (oldRank <= goldCutoff && newRank > goldCutoff) {
        messages.push(`${teamName} dropped below the Gold cut line`);
      }
      if (oldRank > goldCutoff && newRank <= goldCutoff) {
        messages.push(`${teamName} moved above the Gold cut line into Gold position`);
      }

      const oldTitleClinched = titleClinched(old, before);
      const newTitleClinched = titleClinched(team, after);
      const oldTitleEliminated = titleEliminated(old, before);
      const newTitleEliminated = titleEliminated(team, after);

      // Once the regular season title has already been clinched, stop adding title-race
      // context for anyone. The only title message allowed is the moment the title is clinched.
      if (!titleWasAlreadyClinchedBeforeUpdate && !oldTitleClinched && newTitleClinched) {
        messages.push(`${teamName} clinched the regular season title`);
      }

      if (!titleIsClinchedAfterUpdate && !oldTitleEliminated && newTitleEliminated && !newTitleClinched) {
        messages.push(`${teamName} no longer have a path to the regular season title`);
      }

      if (typeof old.goldPct === "number" && typeof team.goldPct === "number") {
        const delta = Math.round(team.goldPct - old.goldPct);
        if (Math.abs(delta) >= 8) {
          messages.push(`${teamName} Gold Bracket odds ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta)}%`);
        }
      }

      if (old.goldStatus !== team.goldStatus) {
        if (team.goldStatus === "Eliminated") messages.push(`${teamName} is now eliminated from Gold Bracket contention`);
        else if (team.goldStatus === "Clinched") messages.push(`${teamName} clinched the Gold Bracket`);
        else messages.push(`${teamName} moved to ${team.goldStatus === "In" ? "Gold position" : "Alive status"}`);
      }
    });

    // Every final has mathematical impact. Keep this focused on meaningful race signals,
    // not record or run-differential lines that are already visible in Standings.
    impactedTeamIds.forEach((teamId) => {
      const old = before.find((item) => item.id === teamId);
      const team = after.find((item) => item.id === teamId);
      if (!old || !team) return;

      const teamName = displayName(team.name);
      const oldPoints = standingsPoints(old);
      const newPoints = standingsPoints(team);
      const goldDelta = Math.round((team.goldPct || 0) - (old.goldPct || 0));
      const oldTitleEliminated = titleEliminated(old, before);
      const newTitleEliminated = titleEliminated(team, after);
      const oldTitleClinched = titleClinched(old, before);
      const newTitleClinched = titleClinched(team, after);

      // Once the regular season title has been clinched, title-race notes should disappear.
      // Keep only the actual clinch moment, then suppress all later title-race context.
      if (!titleWasAlreadyClinchedBeforeUpdate && !oldTitleClinched && newTitleClinched) {
        messages.push(`${teamName} clinched the regular season title`);
      } else if (!titleIsClinchedAfterUpdate && !oldTitleEliminated && newTitleEliminated && !newTitleClinched) {
        messages.push(`${teamName} no longer have a path to the regular season title`);
      } else if (!titleIsClinchedAfterUpdate && team.games > old.games && hasRealisticTitlePath(team, after)) {
        const back = gamesBackOfFirst(team, after);
        if (back > 0) {
          messages.push(`${teamName} sit ${back.toFixed(1).replace(/\.0$/, "")} game${back === 1 ? "" : "s"} back in the regular season title race`);
        }
      }

      if (Math.abs(goldDelta) >= 1) {
        messages.push(`${teamName} Gold Bracket odds ${goldDelta > 0 ? "increased" : "decreased"} by ${Math.abs(goldDelta)}%`);
      }

    });

    return Array.from(new Set(messages)).slice(0, 10);
  };

  const toggleFinal = (gameId: string) => {
    const scrollTopBeforeToggle = typeof window !== "undefined" ? window.scrollY : 0;
    const restoreScoreboardScrollPosition = () => {
      if (typeof window === "undefined") return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.scrollTo({ top: scrollTopBeforeToggle, behavior: "auto" });
        });
      });
    };

    const current = logs[gameId] || blankLog();
    const isMarkingFinal = !current.isFinal;
    const game = matchups.find((item) => item.id === gameId);
    const updateDate = game ? normalizeDateInput(game.date) : "";
    const sameUpdateGames = game
      ? matchups.filter((item) => {
          if (updateDate) return normalizeDateInput(item.date) === updateDate;
          return item.id === gameId;
        })
      : [];

    const nextLogs = {
      ...logs,
      [gameId]: { ...current, isFinal: !current.isFinal },
    };

    setLogs(nextLogs);
    restoreScoreboardScrollPosition();

    if (isMarkingFinal && game) {
      const beforeLogs = { ...nextLogs };
      sameUpdateGames.forEach((item) => {
        if (beforeLogs[item.id]) beforeLogs[item.id] = { ...beforeLogs[item.id], isFinal: false };
      });

      const before = buildRankSnapshot(beforeLogs);
      const after = buildRankSnapshot(nextLogs);
      const impactedTeamIds = Array.from(new Set<string>(sameUpdateGames.flatMap((item) => [item.away, item.home])));
      const messages = summarizeChanges(before, after, impactedTeamIds);
      const finalScores = sameUpdateGames
        .filter((item) => isFinal(nextLogs[item.id]))
        .sort((a, b) => parseDateValue(a.date) - parseDateValue(b.date) || a.id.localeCompare(b.id))
        .map((item) => {
          const log = nextLogs[item.id] || blankLog();
          const away = teams.find((team) => team.id === item.away);
          const home = teams.find((team) => team.id === item.home);
          return `${away ? displayName(away.name) : item.away} ${log.awayRuns || "0"}, ${home ? displayName(home.name) : item.home} ${log.homeRuns || "0"}`;
        });

      setRecentChanges(messages);
      setLastImpact({
        title: updateDate ? `Latest Update — ${updateDate}` : "Latest Update — No Date",
        scores: finalScores,
        messages: messages.length ? messages : ["This update was recorded, but no standings-impact detail could be calculated."],
      });
    } else {
      setRecentChanges([]);
      setLastImpact(null);
    }
  };

  const updateLog = (gameId: string, field: keyof GameLog, value: string | boolean) => {
    setLogs((prev) => ({
      ...prev,
      [gameId]: {
        ...(prev[gameId] || blankLog()),
        [field]: value,
      },
    }));
  };

  const addGame = () => {
    if (!newAway || !newHome || newAway === newHome) return;
    const id = `game_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setMatchups((prev) => [...prev, { id, date: normalizeDateInput(newDate), away: newAway, home: newHome }]);
    setLogs((prev) => ({ ...prev, [id]: blankLog() }));
    setNewDate("");
  };

  const removeGame = (gameId: string) => {
    if (!confirm("Delete this game?")) return;
    setMatchups((prev) => prev.filter((game) => game.id !== gameId));
    setLogs((prev) => {
      const next = { ...prev };
      delete next[gameId];
      return next;
    });
  };

  const swapGame = (gameId: string) => {
    setMatchups((prev) => prev.map((game) => game.id === gameId ? { ...game, away: game.home, home: game.away } : game));
    setLogs((prev) => {
      const log = prev[gameId];
      if (!log) return prev;
      return {
        ...prev,
        [gameId]: {
          ...log,
          awayRuns: log.homeRuns,
          awayHits: log.homeHits,
          awayK: log.homeK,
          homeRuns: log.awayRuns,
          homeHits: log.awayHits,
          homeK: log.awayK,
        },
      };
    });
  };

  const finalCount = completedGames.length;
  const totalGames = matchups.length;
  const currentLeader = dashboardRows[0];

  return (
    <div className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-black tracking-tight text-slate-950">NKB Season Tracker</h1>
              <div className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-slate-600">{settings.seasonLabel}</div>
            </div>

          </div>

          <div className="flex gap-2 rounded-2xl bg-slate-100 p-1 w-fit">
            <button
              onClick={() => setActiveView("standings")}
              className={`rounded-xl px-4 py-2 text-sm font-black ${activeView === "standings" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
            >
              Standings
            </button>
            <button
              onClick={() => setActiveView("games")}
              className={`rounded-xl px-4 py-2 text-sm font-black ${activeView === "games" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
            >
              Games
            </button>
            <button
              onClick={() => setActiveView("model")}
              className={`rounded-xl px-4 py-2 text-sm font-black ${activeView === "model" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
            >
              Projection
            </button>
            <button
              onClick={() => setActiveView("settings")}
              className={`rounded-xl px-4 py-2 text-sm font-black ${activeView === "settings" ? "bg-white text-slate-950 shadow-sm" : "text-slate-500 hover:text-slate-950"}`}
            >
              Settings
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {teams.length === 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 shadow-sm">
              <h2 className="text-2xl font-black tracking-tight">Start a Season</h2>
              <p className="mt-2 text-sm font-semibold text-slate-500">Import an existing schedule CSV, or enter team names and build a blank round-robin schedule.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <label className="inline-flex cursor-pointer rounded-xl bg-red-600 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-red-700">
                  Import CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) importCSV(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <button onClick={createSeasonFromTeamList} className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white shadow-sm hover:bg-slate-800">Create Blank Schedule</button>
                <button onClick={downloadRoundRobinCSV} className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50">Download Blank CSV</button>
              </div>

              <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="text-lg font-black tracking-tight text-slate-950">New Season Builder</h3>
                <p className="mt-1 text-sm font-semibold text-slate-500">Enter teams and create a blank schedule where every team plays every other team once.</p>
                <textarea
                  value={seasonBuilderText}
                  onChange={(event) => setSeasonBuilderText(event.target.value)}
                  placeholder={teams.length ? teams.map((team) => displayName(team.name)).join("\n") : "Stallions\nGriddy\nTrash Pandas"}
                  className="mt-4 h-44 w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold outline-none focus:border-slate-950"
                />
                <div className="mt-4 flex flex-wrap gap-3">
                  <button onClick={createSeasonFromTeamList} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800">Create Schedule</button>
                  <button onClick={downloadRoundRobinCSV} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50">Download Blank CSV</button>
                  <button onClick={() => setSeasonBuilderText(teams.map((team) => displayName(team.name)).join("\n"))} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-slate-50">Use Current Teams</button>
                </div>
              </div>
            </div>
            <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-black tracking-tight text-slate-950">Team List</h3>
              <textarea
                value={seasonBuilderText}
                onChange={(event) => setSeasonBuilderText(event.target.value)}
                placeholder={"Stallions\nGriddy\nTrash Pandas\nChaos"}
                className="mt-4 h-64 w-full resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm font-bold outline-none focus:border-slate-950"
              />
              <p className="mt-3 text-xs font-semibold text-slate-500">One team per line. The generated CSV leaves dates blank so you can add them later.</p>
            </aside>
          </div>
        ) : activeView === "standings" ? (
          <div className="grid grid-cols-1 gap-6">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-slate-950 text-white md:grid-cols-4">
                <Metric label="Leader" value={currentLeader ? displayName(currentLeader.name) : "—"} />
                <Metric label="Finals" value={`${finalCount}/${totalGames}`} />
                <Metric label="Cut Line" value={`Top ${goldCutoff}`} />
                <Metric label="Updated Through" value={latestCompletedDate} />
              </div>

              <div className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <InsightTile label="Gold Clinched" value={todayPicture.clinched} tone="slate" />
                  <InsightTile label="Eliminated" value={todayPicture.eliminated} tone="red" />
                  <InsightTile label="Biggest Bubble Game" value={todayPicture.biggestGame} tone="amber" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                </div>
              </div>

              {lastImpact && (
                <div className="border-b border-slate-200 bg-blue-50 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wide text-blue-700">Impact Since Last Update</div>
                      <div className="text-sm font-black text-slate-950">{lastImpact.title}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setLastImpact(null)}
                      className="rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-wide text-slate-500 shadow-sm ring-1 ring-blue-100 hover:text-slate-950"
                    >
                      Dismiss
                    </button>
                  </div>
                  {lastImpact.scores.length > 0 && (
                    <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-blue-100">
                      <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">Final Scores</div>
                      <div className="flex flex-wrap gap-2 text-xs font-black text-slate-800">
                        {lastImpact.scores.map((score) => (
                          <span key={score} className="rounded-full bg-slate-100 px-3 py-1">{score}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2 text-xs font-black text-blue-700">
                    {lastImpact.messages.map((change) => (
                      <span key={change} className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-blue-100">{change}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-left">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Seed</th>
                      <th className="px-5 py-3">Team</th>
                      <th className="px-4 py-3 text-center">Record</th>
                      <th className="px-4 py-3 text-center">Diff</th>
                      <th className="px-4 py-3 text-center">SOS</th>
                      <th className="px-4 py-3 text-center">Gold %</th>
                      <th className="px-4 py-3 text-center">Playoff Status</th>
                      <th className="px-4 py-3 text-center">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dashboardRows.map((team, index) => (
                      <React.Fragment key={team.id}>
                        {index === goldCutoff && (
                          <tr>
                            <td colSpan={8} className="bg-slate-950 px-5 py-2 text-center text-xs font-black uppercase tracking-[0.22em] text-red-400">
                              Gold Cut Line
                            </td>
                          </tr>
                        )}
                        <tr onClick={() => setSelectedTeamId(team.id)} className="cursor-pointer hover:bg-slate-50/70">
                          <td className="px-5 py-4 font-black text-slate-400">#{team.rank}</td>
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">
                                {teamAbbr(team.name)}
                              </div>
                              <div>
                                <div className="font-black tracking-tight" title={team.name}>{displayName(team.name)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center font-black">{recordText(team)}</td>
                          <td className={`px-4 py-4 text-center font-black ${team.runDiff > 0 ? "text-emerald-600" : team.runDiff < 0 ? "text-red-600" : "text-slate-500"}`}>
                            {team.runDiff > 0 ? "+" : ""}{team.runDiff}
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={`Current SOS: ${team.sos.toFixed(2)}. Rank is based on opponents already played.`}
                              className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-700"
                            >
                              #{currentSosRanks[team.id] || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${team.goldPct >= 75 ? "bg-emerald-100 text-emerald-700" : team.goldPct >= 40 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                              {formatGoldPct(team)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={
                                team.goldStatus === "Eliminated"
                                  ? `${displayName(team.name)} can max out at ${team.maxPoints} standings points, but ${team.blockersAhead} team${team.blockersAhead === 1 ? "" : "s"} already sit above that number.`
                                  : team.goldStatus === "Clinched"
                                    ? `${displayName(team.name)} has mathematically secured a Top ${goldCutoff} spot even if they lose out.`
                                    : `${displayName(team.name)} is still mathematically live for the Top ${goldCutoff}; status is based on current seed, projected seed, Gold odds, and remaining ceiling.`
                              }
                              className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(team)}`}
                            >
                              {statusLabel(team)}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center"><Sparkline values={team.goldTrend} /></td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

          </div>
        ) : activeView === "model" ? (
          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">Projection</h2>
                </div>
                <div className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-black text-white">
                  Gold Cutoff: Top {goldCutoff}
                </div>
              </div>
            </div>

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-5 py-4">
                <h3 className="text-lg font-black tracking-tight text-slate-950">Forecast Board</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-left">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Team</th>
                      <th className="px-4 py-3 text-center">Now</th>
                      <th className="px-4 py-3 text-center">Projected</th>
                      <th className="px-4 py-3 text-center">Range</th>
                      <th className="px-4 py-3 text-center">Projected Record</th>
                      <th className="px-4 py-3 text-center">Gold Odds</th>
                      <th className="px-4 py-3 text-center">Run Diff</th>
                      <th className="px-5 py-3 text-right">TPI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {modelRows.map((team) => {
                      const movement = (team.rank || 99) - team.projectedRank;
                      const range = seedRangeForTeam(team.id);
                      return (
                        <tr key={`forecast-${team.id}`} className="hover:bg-slate-50/70">
                          <td className="px-5 py-4 font-black">{displayName(team.name)}</td>
                          <td className="px-4 py-4 text-center font-black">#{team.rank}</td>
                          <td className="px-4 py-4 text-center font-black">
                            #{team.projectedRank}
                            <span className={`ml-2 rounded-full px-2 py-1 text-[10px] font-black ${movement > 0 ? "bg-emerald-100 text-emerald-700" : movement < 0 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"}`}>
                              {movement > 0 ? `+${movement}` : movement < 0 ? `-${Math.abs(movement)}` : "0"}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center font-black">#{range.best}–#{range.worst}</td>
                          <td className="px-4 py-4 text-center font-black">{team.projectedRecord}</td>
                          <td className="px-4 py-4 text-center font-black">{formatGoldPct(team)}</td>
                          <td className={`px-4 py-4 text-center font-black ${team.projectedRunDiff > 0 ? "text-emerald-600" : team.projectedRunDiff < 0 ? "text-red-600" : "text-slate-500"}`}>
                            {team.projectedRunDiff > 0 ? "+" : ""}{team.projectedRunDiff}
                          </td>
                          <td className="px-5 py-4 text-right font-black">{team.tpi > 0 ? "+" : ""}{team.tpi.toFixed(2)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black tracking-tight text-slate-950">Games That Matter Most</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Next up</span>
              </div>
              {gamesThatMatterMost.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm font-bold text-slate-500">No remaining games.</div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {gamesThatMatterMost.map((item) => (
                    <div key={`matter-${item.game.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-black uppercase tracking-wide text-slate-400">#{item.rank} · {item.date}</div>
                          <div className="mt-1 font-black text-slate-950">{item.label}</div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${gameStatusClasses(item.reason)}`}>{item.reason}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black tracking-tight text-slate-950">Bubble Watch</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Around Top {goldCutoff}</span>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {bubbleMovementRows.map(({ team, tier, sos }) => {
                  const range = seedRangeForTeam(team.id);
                  const bubbleNote = team.projectedRank <= goldCutoff && (team.rank || 99) > goldCutoff
                    ? `${displayName(team.name)} is projected to move into the Gold Bracket.`
                    : (team.rank || 99) <= goldCutoff && team.projectedRank > goldCutoff
                      ? `${displayName(team.name)} currently holds a Gold spot but projects to fall below the cut line.`
                      : (team.rank || 99) === goldCutoff
                        ? `${displayName(team.name)} currently owns the final Gold Bracket spot.`
                        : (team.rank || 99) === goldCutoff + 1
                          ? `${displayName(team.name)} is the first team outside the Gold Bracket.`
                          : `${displayName(team.name)} is close enough to the cut line to matter.`;
                  return (
                    <div key={`bubble-${team.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{displayName(team.name)}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">Now #{team.rank} · Projected #{team.projectedRank} · Range #{range.best}–#{range.worst}</div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200">{tier}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs font-black">
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><div className="text-slate-400">Gold</div><div className="mt-1 text-slate-950">{formatGoldPct(team)}</div></div>
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><div className="text-slate-400">SOS</div><div className="mt-1 text-slate-950">{sos.label}</div></div>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{bubbleNote} {teamPathNote(team)} Remaining opponents: {sos.opponents}.</p>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-black tracking-tight text-slate-950">Projected Cut Line Games</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Next Two</span>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {projectedCutLineTeams.slice(0, 6).map((team) => {
                  const swings = nextTwoSwingGames(team.id);
                  if (!swings.length) return null;
                  return (
                    <div key={`model-swing-${team.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="font-black">{displayName(team.name)}</div>
                        <div className="text-xs font-black text-slate-500">#{team.rank} now · #{team.projectedRank} projected</div>
                      </div>
                      <div className="space-y-2">
                        {swings.map((swing) => (
                          <div key={swing.game.id} className="rounded-xl bg-white p-3 text-sm shadow-sm ring-1 ring-slate-200">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-black">{swing.teamIsAway ? "at" : "vs"} {swing.opponentName}</span>
                              <span className="text-xs font-black text-slate-500">{formatGameDate(swing.game.date)}</span>
                            </div>
                            <div className="mt-2 text-xs font-bold text-slate-500">Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win chance</div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs font-bold">
                              <div className="rounded-lg bg-emerald-50 px-2 py-2 text-emerald-700">Win: #{swing.winSeed}</div>
                              <div className="rounded-lg bg-red-50 px-2 py-2 text-red-700">Loss: #{swing.lossSeed}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-lg font-black tracking-tight text-slate-950">Game Forecasts</h3>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                  {gameForecasts.length} Remaining
                </span>
              </div>

              {gameForecasts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center font-bold text-slate-500">
                  No remaining games to project.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {gameForecasts.map((item) => {
                    const margin = Math.abs(item.prediction.awayScore - item.prediction.homeScore);
                    const runLine = projectedRunLine(item.prediction, liveTeams);
                    const upsetRisk = upsetRiskLabel(item.winnerPct, margin);
                    return (
                      <article key={`game-forecast-${item.game.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">
                              {formatGameDate(item.game.date)}
                            </div>
                            <div className="mt-1 text-base font-black tracking-tight text-slate-950">
                              {item.awayName} at {item.homeName}
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm ring-1 ring-slate-200">
                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Pick</div>
                            <div className="text-sm font-black text-slate-950">{item.winnerName}</div>
                          </div>
                        </div>

                        <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-black">
                          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">Spread</div>
                            <div className="mt-1 text-base text-slate-950">{runLine}</div>
                          </div>
                          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">Chance</div>
                            <div className="mt-1 text-base text-slate-950">{Math.round(item.winnerPct * 100)}%</div>
                          </div>
                          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">Upset Risk</div>
                            <div className="mt-1 text-base text-slate-950">{upsetRisk}</div>
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-1 text-[11px] font-black ${item.prediction.confidence === "High" ? "bg-emerald-100 text-emerald-700" : item.prediction.confidence === "Medium" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>
                            {item.prediction.confidence} Confidence
                          </span>
                          {margin <= 2 && (
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-black text-amber-700">Toss-Up</span>
                          )}
                          <span className={`rounded-full px-3 py-1 text-[11px] font-black ${item.impact.impactLabel === "High" ? "bg-red-100 text-red-700" : item.impact.impactLabel === "Medium" ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-600"}`}>Seed Impact: {item.impact.impactLabel}</span>
                        </div>

                        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                          {item.explanation}
                        </p>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </section>

        ) : activeView === "settings" ? (
          <section className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-black tracking-tight text-slate-950">Settings</h2>
              <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-2">
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Season</span>
                  <input
                    value={settings.seasonLabel}
                    onChange={(event) => setSettings((prev) => ({ ...prev, seasonLabel: event.target.value }))}
                    placeholder="Spring 26"
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-bold outline-none focus:border-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Gold Cutoff</span>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, teams.length)}
                    value={settings.goldCutoff}
                    onChange={(event) => setSettings((prev) => ({ ...prev, goldCutoff: Number(event.target.value) }))}
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-bold outline-none focus:border-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Win Points</span>
                  <input
                    type="number"
                    step="0.5"
                    value={settings.winPoints}
                    onChange={(event) => setSettings((prev) => ({ ...prev, winPoints: Number(event.target.value) }))}
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-bold outline-none focus:border-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Tie Points</span>
                  <input
                    type="number"
                    step="0.5"
                    value={settings.tiePoints}
                    onChange={(event) => setSettings((prev) => ({ ...prev, tiePoints: Number(event.target.value) }))}
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-bold outline-none focus:border-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Max Score Cap</span>
                  <input
                    type="number"
                    min={8}
                    max={30}
                    value={settings.maxScoreCap}
                    onChange={(event) => setSettings((prev) => ({ ...prev, maxScoreCap: Number(event.target.value) }))}
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-bold outline-none focus:border-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-black text-slate-700">Model Aggression</span>
                  <select
                    value={settings.modelAggression}
                    onChange={(event) => setSettings((prev) => ({ ...prev, modelAggression: event.target.value }))}
                    className="mt-2 w-full rounded-2xl border border-slate-300 px-4 py-3 font-bold outline-none focus:border-slate-950"
                  >
                    <option>Conservative</option>
                    <option>Balanced</option>
                    <option>Aggressive</option>
                  </select>
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-slate-300 px-4 py-3">
                  <span className="text-sm font-black text-slate-700">Run Differential Tiebreaker</span>
                  <input
                    type="checkbox"
                    checked={settings.runDiffTiebreaker}
                    onChange={(event) => setSettings((prev) => ({ ...prev, runDiffTiebreaker: event.target.checked }))}
                    className="h-5 w-5"
                  />
                </label>
              </div>

              <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-lg font-black tracking-tight text-slate-950">Data</h3>
                <div className="mt-4 flex flex-wrap gap-3">
                  <label className="cursor-pointer rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white shadow-sm hover:bg-slate-800">
                    Import CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) importCSV(file);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button onClick={exportCSV} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-white">Export CSV</button>
                  <button onClick={exportBackup} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-black text-slate-800 shadow-sm hover:bg-white">Backup JSON</button>
                  <button onClick={resetSeason} className="rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-black text-red-600 shadow-sm hover:bg-red-50">Reset Season</button>
                </div>
              </div>
            </div>
            <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-black tracking-tight text-slate-950">Current Setup</h3>
              <div className="mt-4 space-y-3 text-sm font-bold text-slate-600">
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Season</span><span className="text-slate-950">{settings.seasonLabel}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Gold Cutoff</span><span className="text-slate-950">Top {goldCutoff}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Win / Tie Points</span><span className="text-slate-950">{settings.winPoints} / {settings.tiePoints}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Run Diff Tiebreaker</span><span className="text-slate-950">{settings.runDiffTiebreaker ? "On" : "Off"}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Score Cap</span><span className="text-slate-950">{settings.maxScoreCap}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Model</span><span className="text-slate-950">{settings.modelAggression}</span></div>
                <div className="flex justify-between rounded-2xl bg-slate-50 px-4 py-3"><span>Teams</span><span className="text-slate-950">{teams.length}</span></div>
              </div>
            </aside>
          </section>
        ) : (
          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[140px_1fr_1fr_auto]">
                <input type="text" placeholder="5/1" value={newDate} onChange={(event) => setNewDate(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-bold outline-none focus:border-slate-950" />
                <select value={newAway} onChange={(event) => setNewAway(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-bold outline-none focus:border-slate-950">
                  {teams.map((team) => <option key={team.id} value={team.id}>{displayName(team.name)}</option>)}
                </select>
                <select value={newHome} onChange={(event) => setNewHome(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 font-bold outline-none focus:border-slate-950">
                  {teams.map((team) => <option key={team.id} value={team.id}>{displayName(team.name)}</option>)}
                </select>
                <button onClick={addGame} className="rounded-xl bg-red-600 px-5 py-2 font-black text-white shadow-sm hover:bg-red-700">Add Game</button>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="text-sm font-black text-slate-700">Scoreboard Filter</div>
                <select value={scoreboardTeamFilter} onChange={(event) => setScoreboardTeamFilter(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold outline-none focus:border-slate-950 md:w-72">
                  <option value="ALL">All Teams</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{displayName(team.name)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {scoreboardGames.map((game) => {
                const log = logs[game.id] || blankLog();
                const away = teams.find((team) => team.id === game.away);
                const home = teams.find((team) => team.id === game.home);
                const final = isFinal(log);
                return (
                  <article key={game.id} className={`overflow-hidden rounded-3xl border bg-white shadow-sm ${final ? "border-slate-200 opacity-80" : "border-slate-200"}`}>
                    <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                      <GameDateInput
                        value={game.date}
                        onCommit={(nextDate) =>
                          setMatchups((prev) =>
                            prev.map((item) =>
                              item.id === game.id ? { ...item, date: nextDate } : item
                            )
                          )
                        }
                      />
                      <div className="flex gap-2">
                        <button onClick={() => toggleFinal(game.id)} className={`rounded-lg px-3 py-1 text-xs font-black ${final ? "bg-emerald-600 text-white" : "bg-slate-950 text-white"}`}>{final ? "Final" : "Open"}</button>
                        <button onClick={() => swapGame(game.id)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-black">Swap</button>
                        <button onClick={() => removeGame(game.id)} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-black text-red-600">Delete</button>
                      </div>
                    </div>

                    <div className="space-y-4 p-4">
                      {!final && (() => {
                        const prediction = predictGame(game, liveTeams);
                        const winner = teams.find((team) => team.id === prediction.winnerId);
                        const winnerPct = prediction.winnerId === game.away ? prediction.awayWinPct : 1 - prediction.awayWinPct;
                        const status = gameStatusForGame(game);
                        return (
                          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full bg-white px-3 py-1 text-slate-700 shadow-sm ring-1 ring-slate-200">Spread: {projectedRunLine(prediction, liveTeams)}</span>
                              <span className={`rounded-full px-3 py-1 ${gameStatusClasses(status)}`}>{status}</span>
                            </div>
                            <span className="text-slate-500">Pick: {displayName(winner?.name || prediction.winnerId)} · {Math.round(winnerPct * 100)}%</span>
                          </div>
                        );
                      })()}
                      <ScoreRow teamName={away?.name || game.away} prefix="away" log={log} onChange={(field, value) => updateLog(game.id, field, value)} />
                      <ScoreRow teamName={home?.name || game.home} prefix="home" log={log} onChange={(field, value) => updateLog(game.id, field, value)} />
                      <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-bold text-slate-500">
                        <label className="flex items-center gap-2">Innings
                          <input value={log.innings} onChange={(event) => updateLog(game.id, "innings", event.target.value)} className="w-14 rounded-lg border border-slate-300 px-2 py-1 text-center font-black text-slate-950" />
                        </label>
                        <span>{final ? `Final · ${formatGameDate(game.date)}` : game.date.trim() ? formatGameDateLong(game.date) : "Needs Date"}</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </main>

      {selectedTeam && (
        <TeamDrawer
          team={selectedTeam}
          range={seedRangeForTeam(selectedTeam.id)}
          control={controlLevelForTeam(selectedTeam)}
          bubble={bubbleTierForTeam(selectedTeam)}
          currentSosRank={currentSosRanks[selectedTeam.id] || null}
          sos={scheduleDifficultyForTeam(selectedTeam.id)}
          swings={nextTwoSwingGames(selectedTeam.id)}
          clinchScenarios={clinchScenariosForTeam(selectedTeam.id)}
          titleRace={titleRaceBadgeForTeam(selectedTeam)}
          playoffStatus={statusLabel(selectedTeam)}
          goldPctLabel={formatGoldPct(selectedTeam)}
          cutoff={goldCutoff}
          onClose={() => setSelectedTeamId(null)}
        />
      )}
    </div>
  );
}

function TeamDrawer({
  team,
  range,
  control,
  bubble,
  currentSosRank,
  sos,
  swings,
  clinchScenarios,
  titleRace,
  playoffStatus,
  goldPctLabel,
  cutoff,
  onClose,
}: {
  team: TeamWithProjection;
  range: { best: number; worst: number; baseline: number };
  control: string;
  bubble: string;
  currentSosRank: number | null;
  sos: { label: string; avgSeed: number; opponents: string };
  swings: SwingGame[];
  clinchScenarios: string[];
  titleRace: string;
  playoffStatus: string;
  goldPctLabel: string;
  cutoff: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 p-3" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto rounded-3xl bg-white p-6 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-400">Team Detail</div>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-slate-950">{displayName(team.name)}</h2>
            <div className="mt-2 text-sm font-bold text-slate-500">Current #{team.rank} · Projected #{team.projectedRank} · Top {cutoff} Gold Bracket</div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-500 hover:bg-slate-50">Close</button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <DrawerMetric label="Record" value={recordText(team)} />
          <DrawerMetric label="Gold %" value={goldPctLabel} />
          <DrawerMetric label="Range" value={`#${range.best}–#${range.worst}`} />
          <DrawerMetric label="Bubble" value={bubble} />
          <DrawerMetric label="Runs/Game" value={team.rsg.toFixed(1)} />
          <DrawerMetric label="Hits/Game" value={team.hpg.toFixed(1)} />
          <DrawerMetric label="K/Game" value={team.kpg.toFixed(1)} />
          <DrawerMetric label="Current SOS" value={currentSosRank ? `#${currentSosRank}` : "—"} />
          <DrawerMetric label="Remaining SOS" value={sos.label} />
          {titleRace && <DrawerMetric label="Title Race" value={titleRace} />}
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-black tracking-tight text-slate-950">Playoff Status</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {playoffStatus === "Clinched"
              ? `${displayName(team.name)} has mathematically secured a Gold Bracket spot.`
              : playoffStatus === "Eliminated"
                ? `${displayName(team.name)} is eliminated from Gold Bracket contention. Even winning out cannot clear the cut line.`
                : playoffStatus === "Firmly In"
                  ? `${displayName(team.name)} is not officially clinched, but the math and projection both strongly favor a Gold Bracket spot.`
                  : playoffStatus === "In"
                    ? `${displayName(team.name)} is currently positioned for the Gold Bracket but has not fully secured it.`
                    : playoffStatus === "Alive"
                      ? `${displayName(team.name)} is still realistically alive for the Gold Bracket based on remaining games and projected movement.`
                      : `${displayName(team.name)} still has a mathematical path, but there is real work to do and help may be needed.`}
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-black tracking-tight text-slate-950">Path</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {team.goldStatus === "Clinched"
              ? `${displayName(team.name)} has secured a Gold Bracket spot. The remaining games are about seeding and regular-season positioning.`
              : team.goldStatus === "Eliminated"
                ? `${displayName(team.name)} is eliminated from Gold Bracket contention and can only affect other teams' paths.`
                : playoffStatus === "Firmly In" || playoffStatus === "In"
                  ? `${displayName(team.name)} is inside the Gold cut line, but the remaining games still affect seeding and safety.`
                  : playoffStatus === "Alive"
                    ? `${displayName(team.name)} is close enough to push into the Gold Bracket with strong results and some help around the cut line.`
                    : `${displayName(team.name)} still has a path, but needs wins and help from teams above the cut line.`}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500">Current SOS #{currentSosRank || "—"} measures opponents already played. Remaining SOS is {sos.label.toLowerCase()} based on opponents still left: {sos.opponents}.</p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-black tracking-tight text-slate-950">Clinch Scenarios</h3>
          <div className="mt-3 space-y-2">
            {clinchScenarios.map((scenario, index) => (
              <div key={`clinch-scenario-${index}`} className="rounded-xl bg-white p-3 text-sm font-bold leading-6 text-slate-600 shadow-sm ring-1 ring-slate-200">
                {scenario}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <h3 className="font-black tracking-tight text-slate-950">Next Two</h3>
          <div className="mt-3 space-y-3">
            {swings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm font-bold text-slate-500">No remaining games for this team.</div>
            ) : swings.map((swing) => (
              <div key={swing.game.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-black">{swing.teamIsAway ? "at" : "vs"} {swing.opponentName}</div>
                  <div className="text-xs font-black text-slate-500">{formatGameDate(swing.game.date)}</div>
                </div>
                <div className="mt-2 text-xs font-bold text-slate-500">Model: {swing.modelPick} · {Math.round(swing.winPct * 100)}% team win chance</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-black">
                  <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-700">Win: #{swing.winSeed}</div>
                  <div className="rounded-xl bg-red-50 px-3 py-2 text-red-700">Loss: #{swing.lossSeed}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

function DrawerMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-black text-slate-950">{value}</div>
    </div>
  );
}

function InsightTile({ label, value, tone }: { label: string; value: string; tone: "slate" | "red" | "blue" | "amber" }) {
  const toneClasses =
    tone === "red"
      ? "border-red-100 bg-red-50 text-red-700"
      : tone === "blue"
        ? "border-blue-100 bg-blue-50 text-blue-700"
        : tone === "amber"
          ? "border-amber-100 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-800";
  return (
    <div className={`rounded-2xl border p-4 ${toneClasses}`}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 line-clamp-2 text-sm font-black leading-5">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="p-4">
      <div className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 truncate text-xl font-black tracking-tight">{value}</div>
    </div>
  );
}

function ScoreRow({
  teamName,
  prefix,
  log,
  onChange,
}: {
  teamName: string;
  prefix: "away" | "home";
  log: GameLog;
  onChange: (field: keyof GameLog, value: string) => void;
}) {
  const fields = [
    { key: `${prefix}Runs` as keyof GameLog, label: "R" },
    { key: `${prefix}Hits` as keyof GameLog, label: "H" },
    { key: `${prefix}K` as keyof GameLog, label: "K" },
  ];

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-xs font-black text-white">{teamAbbr(teamName)}</div>
        <div className="truncate font-black" title={teamName}>{displayName(teamName)}</div>
      </div>
      <div className="flex gap-2">
        {fields.map((field) => (
          <label key={field.key} className="text-center text-[10px] font-black uppercase text-slate-400">
            {field.label}
            <input
              value={String(log[field.key] || "")}
              onChange={(event) => onChange(field.key, event.target.value)}
              inputMode="numeric"
              className="mt-1 block h-10 w-11 rounded-xl border border-slate-300 bg-white text-center text-base font-black text-slate-950 outline-none focus:border-slate-950"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function calcBip(hits: string, runs: string, strikeouts: string, innings: string) {
  const h = parseNumber(hits, NaN);
  const r = parseNumber(runs, NaN);
  const k = parseNumber(strikeouts, 0);
  const inn = parseNumber(innings, 6);
  const contact = Number.isFinite(h) ? h : Number.isFinite(r) ? r : 0;
  return contact + inn * 3 - k;
}
