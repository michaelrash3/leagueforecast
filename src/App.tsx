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
  const [lastImpact, setLastImpact] = useState<{ title: string; messages: string[] } | null>(null);
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

  const mostImportantTeam = useMemo(() => {
    return [...dashboardRows]
      .filter((team) => !["Clinched", "Eliminated"].includes(team.goldStatus))
      .sort((a, b) => {
        const aScore = Math.abs(a.goldPct - 50) + Math.abs((a.rank || 99) - goldCutoff) * 8;
        const bScore = Math.abs(b.goldPct - 50) + Math.abs((b.rank || 99) - goldCutoff) * 8;
        return aScore - bScore;
      })[0] || null;
  }, [dashboardRows, goldCutoff]);

  const todayPicture = useMemo(() => {
    const clinched = dashboardRows.filter((team) => team.goldStatus === "Clinched").map((team) => displayName(team.name));
    const eliminated = dashboardRows.filter((team) => team.goldStatus === "Eliminated").map((team) => displayName(team.name));
    return {
      clinched: clinched.length ? clinched.join(", ") : "None",
      eliminated: eliminated.length ? eliminated.join(", ") : "None",
      importantTeam: mostImportantTeam ? displayName(mostImportantTeam.name) : "None",
      biggestGame: biggestBubbleGame || "None",
    };
  }, [dashboardRows, mostImportantTeam, biggestBubbleGame]);

  const bubbleRows = useMemo(() => {
    return dashboardRows.map((team) => ({
      team,
      tier: bubbleTierForTeam(team),
      sos: scheduleDifficultyForTeam(team.id),
      control: controlLevelForTeam(team),
    }));
  }, [dashboardRows, remainingGames, goldCutoff]);

  const getGameScenarioImpact = (game: Matchup) => {
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
  };


  const gameStatusForGame = (game: Matchup) => {
    const impact = getGameScenarioImpact(game);
    const away = dashboardRows.find((team) => team.id === game.away);
    const home = dashboardRows.find((team) => team.id === game.home);
    const nearCutLine = [away, home].some((team) => team && Math.abs((team.rank || 99) - goldCutoff) <= 1);
    const canCreateClinch = [
      away && away.goldStatus !== "Clinched" && impact.awaySeedWin <= goldCutoff && away.goldPct >= 55,
      home && home.goldStatus !== "Clinched" && impact.homeSeedWin <= goldCutoff && home.goldPct >= 55,
    ].some(Boolean);
    const canCreateEliminationRisk = [
      away && away.goldStatus !== "Eliminated" && impact.awaySeedLoss > goldCutoff && away.goldPct <= 45,
      home && home.goldStatus !== "Eliminated" && impact.homeSeedLoss > goldCutoff && home.goldPct <= 45,
    ].some(Boolean);

    if (canCreateClinch) return "Clinching Game";
    if (canCreateEliminationRisk) return "Elimination Game";
    if (impact.seedImpact >= 2) return "High Impact";
    if (nearCutLine || impact.seedImpact >= 1) return "Bubble Game";
    return "Low Impact";
  };

  const gameStatusClasses = (label: string) => {
    if (label === "Clinching Game") return "bg-emerald-100 text-emerald-700";
    if (label === "Elimination Game") return "bg-red-100 text-red-700";
    if (label === "High Impact") return "bg-amber-100 text-amber-700";
    if (label === "Bubble Game") return "bg-blue-100 text-blue-700";
    return "bg-slate-200 text-slate-600";
  };

  const clinchScenariosForTeam = (teamId: string) => {
    const team = dashboardRows.find((item) => item.id === teamId);
    if (!team) return [];
    const teamName = displayName(team.name);

    if (team.goldStatus === "Clinched") return [`${teamName} has already clinched a Gold spot.`];
    if (team.goldStatus === "Eliminated") return [`${teamName} is mathematically eliminated from Gold.`];

    const scenarios = nextTwoSwingGames(teamId).slice(0, 2).map((swing) => {
      const opponentLine = `${swing.teamIsAway ? "at" : "vs"} ${swing.opponentName}`;
      if (swing.winSeed <= goldCutoff && swing.lossSeed > goldCutoff) {
        return `${opponentLine}: win projects inside Gold at #${swing.winSeed}; loss drops outside at #${swing.lossSeed}.`;
      }
      if (swing.winSeed <= goldCutoff && swing.lossSeed <= goldCutoff) {
        return `${opponentLine}: win improves or protects the Gold path at #${swing.winSeed}; loss still projects #${swing.lossSeed}.`;
      }
      if (swing.winSeed > goldCutoff && swing.lossSeed > goldCutoff) {
        return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}, so outside help is still needed.`;
      }
      return `${opponentLine}: win projects #${swing.winSeed}; loss projects #${swing.lossSeed}.`;
    });

    if (!scenarios.length) return [`${teamName} has no remaining games; Gold status depends only on outside results.`];
    return scenarios;
  };

  const bubbleMovementRows = useMemo(() => {
    return bubbleRows
      .filter(({ tier }) => ["Bubble In", "Bubble Out", "Long Shot"].includes(tier))
      .sort((a, b) => Math.abs(a.team.goldPct - 50) - Math.abs(b.team.goldPct - 50))
      .slice(0, 8);
  }, [bubbleRows]);

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

      if (!aFinal && !bFinal && aNoDate !== bNoDate) return aNoDate ? -1 : 1;
      if (aFinal !== bFinal) return aFinal ? 1 : -1;
      return parseDateValue(a.date) - parseDateValue(b.date);
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
        const confirmed = window.confirm(
          `Import this schedule?\n\n${importedTeams.length} teams found\n${importedMatchups.length} games found\n${finalGames} finals imported\n${openGames} open games imported\n\nThis will replace the current season data.`
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

  const readBuilderTeamNames = () => {
    return Array.from(
      new Set(
        seasonBuilderText
          .split(/\r?\n|,/)
          .map((name) => name.trim())
          .filter(Boolean)
      )
    );
  };

  const buildRoundRobinSeason = () => {
    const names = readBuilderTeamNames();
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

  const summarizeChanges = (before: ReturnType<typeof buildRankSnapshot>, after: ReturnType<typeof buildRankSnapshot>) => {
    const messages: string[] = [];
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
        messages.push(`${teamName} moved above the Gold cut line`);
      }

      if (typeof old.goldPct === "number" && typeof team.goldPct === "number") {
        const delta = Math.round(team.goldPct - old.goldPct);
        if (Math.abs(delta) >= 8) {
          messages.push(`${teamName} Gold odds ${delta > 0 ? "+" : ""}${delta}%`);
        }
      }

      if (old.goldStatus !== team.goldStatus) {
        if (team.goldStatus === "Eliminated") messages.push(`${teamName} was mathematically eliminated`);
        else if (team.goldStatus === "Clinched") messages.push(`${teamName} clinched Gold`);
        else messages.push(`${teamName} is now ${team.goldStatus}`);
      }
    });

    return Array.from(new Set(messages)).slice(0, 7);
  };

  const toggleFinal = (gameId: string) => {
    const current = logs[gameId] || blankLog();
    const isMarkingFinal = !current.isFinal;
    const before = buildRankSnapshot(logs);
    const nextLogs = {
      ...logs,
      [gameId]: { ...current, isFinal: !current.isFinal },
    };
    const after = buildRankSnapshot(nextLogs);
    const messages = isMarkingFinal ? summarizeChanges(before, after) : [];

    setLogs(nextLogs);
    setRecentChanges(messages);

    if (isMarkingFinal) {
      const game = matchups.find((item) => item.id === gameId);
      const away = game ? teams.find((team) => team.id === game.away) : null;
      const home = game ? teams.find((team) => team.id === game.home) : null;
      const awayRuns = current.awayRuns || "0";
      const homeRuns = current.homeRuns || "0";
      const title = game && away && home
        ? `After ${displayName(away.name)} ${awayRuns}, ${displayName(home.name)} ${homeRuns}`
        : "After final score";

      setLastImpact({
        title,
        messages: messages.length ? messages : ["No seed, Gold status, or major Gold odds changes from this result."],
      });
    } else {
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
              Model
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
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_360px]">
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-2 divide-x divide-slate-200 border-b border-slate-200 bg-slate-950 text-white md:grid-cols-4">
                <Metric label="Leader" value={currentLeader ? displayName(currentLeader.name) : "—"} />
                <Metric label="Finals" value={`${finalCount}/${totalGames}`} />
                <Metric label="Cut Line" value={`Top ${goldCutoff}`} />
                <Metric label="Remaining" value={remainingGames.length} />
              </div>

              <div className="border-b border-slate-200 bg-white px-5 py-4">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <InsightTile label="Clinched" value={todayPicture.clinched} tone="slate" />
                  <InsightTile label="Eliminated" value={todayPicture.eliminated} tone="red" />
                  <InsightTile label="Most Important Team" value={todayPicture.importantTeam} tone="blue" />
                  <InsightTile label="Biggest Bubble Game" value={todayPicture.biggestGame} tone="amber" />
                </div>
              </div>

              {lastImpact && (
                <div className="border-b border-slate-200 bg-blue-50 px-5 py-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wide text-blue-700">Impact Since Last Final</div>
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
                  <div className="flex flex-wrap gap-2 text-xs font-black text-blue-700">
                    {lastImpact.messages.map((change) => (
                      <span key={change} className="rounded-full bg-white px-3 py-1 shadow-sm ring-1 ring-blue-100">{change}</span>
                    ))}
                  </div>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full min-w-[1060px] text-left">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3">Seed</th>
                      <th className="px-5 py-3">Team</th>
                      <th className="px-4 py-3 text-center">Record</th>
                      <th className="px-4 py-3 text-center">Diff</th>
                      <th className="px-4 py-3 text-center">Gold</th>
                      <th className="px-4 py-3 text-center">Status</th>
                      <th className="px-4 py-3 text-center">Bubble</th>
                      <th className="px-4 py-3 text-center">SOS</th>
                      <th className="px-4 py-3 text-center">Trend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dashboardRows.map((team, index) => (
                      <React.Fragment key={team.id}>
                        {index === goldCutoff && (
                          <tr>
                            <td colSpan={9} className="bg-slate-950 px-5 py-2 text-center text-xs font-black uppercase tracking-[0.22em] text-red-400">
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
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${team.goldPct >= 75 ? "bg-emerald-100 text-emerald-700" : team.goldPct >= 40 ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                              {team.goldPct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span
                              title={
                                team.goldStatus === "Eliminated"
                                  ? `${displayName(team.name)} can max out at ${team.maxPoints} standings points, but ${team.blockersAhead} team${team.blockersAhead === 1 ? "" : "s"} already sit above that number.`
                                  : team.goldStatus === "Clinched"
                                    ? `${displayName(team.name)} has mathematically secured a Top ${goldCutoff} spot even if they lose out.`
                                    : `${displayName(team.name)} has not mathematically secured or lost a Top ${goldCutoff} finish yet.`
                              }
                              className={`rounded-full px-3 py-1 text-xs font-black ${
                                team.goldStatus === "Eliminated"
                                  ? "bg-red-100 text-red-700"
                                  : team.goldStatus === "Clinched"
                                    ? "bg-slate-950 text-white"
                                    : team.goldStatus === "In"
                                      ? "bg-emerald-100 text-emerald-700"
                                      : "bg-amber-100 text-amber-700"
                              }`}
                            >
                              {team.goldStatus}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${bubbleTierForTeam(team) === "Locked In" ? "bg-slate-950 text-white" : bubbleTierForTeam(team) === "Eliminated" ? "bg-red-100 text-red-700" : bubbleTierForTeam(team) === "Bubble In" ? "bg-emerald-100 text-emerald-700" : bubbleTierForTeam(team) === "Bubble Out" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{bubbleTierForTeam(team)}</span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span title={scheduleDifficultyForTeam(team.id).opponents} className={`rounded-full px-3 py-1 text-xs font-black ${scheduleDifficultyForTeam(team.id).label === "Hard" ? "bg-red-100 text-red-700" : scheduleDifficultyForTeam(team.id).label === "Medium" ? "bg-amber-100 text-amber-700" : scheduleDifficultyForTeam(team.id).label === "Easy" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{scheduleDifficultyForTeam(team.id).label}</span>
                          </td>
                          <td className="px-4 py-4 text-center"><Sparkline values={team.goldTrend} /></td>
                        </tr>
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <aside className="space-y-6">
              <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-black tracking-tight">Cut Line</h2>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Top {goldCutoff}</span>
                </div>
                <div className="space-y-3">
                  {cutLineTeams.map((team) => {
                    const inside = (team.rank || 99) <= goldCutoff;
                    const onLine = Math.abs((team.rank || 99) - goldCutoff) <= 1;
                    return (
                      <div key={team.id} className={`rounded-2xl border p-4 ${inside ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="font-black">{displayName(team.name)}</div>
                            <div className="mt-1 text-xs font-bold text-slate-500">
                              #{team.rank} · {recordText(team)} · {team.goldPct.toFixed(0)}% Gold
                            </div>
                          </div>
                          <span className={`rounded-full px-3 py-1 text-xs font-black ${inside ? "bg-emerald-100 text-emerald-700" : onLine ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                            {inside ? "In" : onLine ? "Bubble" : "Chasing"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </aside>
          </div>
        ) : activeView === "model" ? (
          <section className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-950">Model</h2>
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
                      <th className="px-4 py-3 text-center">Control</th>
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
                      const control = controlLevelForTeam(team);
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
                          <td className="px-4 py-4 text-center">
                            <span className={`rounded-full px-3 py-1 text-xs font-black ${control === "Clinched" ? "bg-slate-950 text-white" : control === "Eliminated" ? "bg-red-100 text-red-700" : control === "Needs Help" ? "bg-amber-100 text-amber-700" : control === "At Risk" ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"}`}>
                              {control}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center font-black">{team.projectedRecord}</td>
                          <td className="px-4 py-4 text-center font-black">{team.goldPct.toFixed(0)}%</td>
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
                <h3 className="text-lg font-black tracking-tight text-slate-950">Bubble Movement</h3>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">Cut Line View</span>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {bubbleMovementRows.map(({ team, tier, sos, control }) => {
                  const range = seedRangeForTeam(team.id);
                  return (
                    <div key={`bubble-${team.id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-black text-slate-950">{displayName(team.name)}</div>
                          <div className="mt-1 text-xs font-bold text-slate-500">Now #{team.rank} · Projected #{team.projectedRank} · Range #{range.best}–#{range.worst}</div>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-700 shadow-sm ring-1 ring-slate-200">{tier}</span>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-2 text-xs font-black">
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><div className="text-slate-400">Gold</div><div className="mt-1 text-slate-950">{team.goldPct.toFixed(0)}%</div></div>
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><div className="text-slate-400">SOS</div><div className="mt-1 text-slate-950">{sos.label}</div></div>
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200"><div className="text-slate-400">Control</div><div className="mt-1 text-slate-950">{control}</div></div>
                      </div>
                      <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">Remaining opponents: {sos.opponents}.</p>
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
                  <div className="mt-1 text-xs font-bold text-slate-500">Uses a spread-style projected margin for readability, not gambling.</div>
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
          sos={scheduleDifficultyForTeam(selectedTeam.id)}
          swings={nextTwoSwingGames(selectedTeam.id)}
          clinchScenarios={clinchScenariosForTeam(selectedTeam.id)}
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
  sos,
  swings,
  clinchScenarios,
  cutoff,
  onClose,
}: {
  team: TeamWithProjection;
  range: { best: number; worst: number; baseline: number };
  control: string;
  bubble: string;
  sos: { label: string; avgSeed: number; opponents: string };
  swings: SwingGame[];
  clinchScenarios: string[];
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
            <div className="mt-2 text-sm font-bold text-slate-500">Current #{team.rank} · Projected #{team.projectedRank} · Top {cutoff} Gold</div>
          </div>
          <button onClick={onClose} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-black text-slate-500 hover:bg-slate-50">Close</button>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <DrawerMetric label="Record" value={recordText(team)} />
          <DrawerMetric label="Gold" value={`${team.goldPct.toFixed(0)}%`} />
          <DrawerMetric label="Range" value={`#${range.best}–#${range.worst}`} />
          <DrawerMetric label="Bubble" value={bubble} />
          <DrawerMetric label="SOS" value={sos.label} />
          <DrawerMetric label="Control" value={control} />
        </div>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <h3 className="font-black tracking-tight text-slate-950">Status</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {team.goldStatus === "Clinched"
              ? `${displayName(team.name)} has mathematically secured a Gold spot.`
              : team.goldStatus === "Eliminated"
                ? `${displayName(team.name)} is mathematically eliminated from Gold. Even winning out cannot clear the cut line.`
                : control === "Needs Help"
                  ? `${displayName(team.name)} can still reach Gold, but winning out may not be enough without help.`
                  : control === "At Risk"
                    ? `${displayName(team.name)} is currently inside the cut line, but a loss can create real danger.`
                    : `${displayName(team.name)} controls enough of its path to stay in the Gold race.`}
          </p>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="font-black tracking-tight text-slate-950">Needs</h3>
          <p className="mt-2 text-sm font-semibold leading-6 text-slate-600">
            {team.goldStatus === "Clinched"
              ? `${displayName(team.name)} can focus on seeding; the Gold spot is secure.`
              : team.goldStatus === "Eliminated"
                ? `${displayName(team.name)} is out of the Gold math and can only affect other teams' paths.`
                : control === "Controls Spot" || control === "Controls Path"
                  ? `${displayName(team.name)} controls enough of the path: winning the remaining key games keeps the team in the Gold race.`
                  : control === "At Risk"
                    ? `${displayName(team.name)} needs to avoid a slip because one bad result can push them below the cut line.`
                    : `${displayName(team.name)} needs help from teams above the cut line plus wins in its own remaining games.`}
          </p>
          <p className="mt-2 text-xs font-bold text-slate-500">Remaining SOS: {sos.label}. Opponents left: {sos.opponents}.</p>
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
