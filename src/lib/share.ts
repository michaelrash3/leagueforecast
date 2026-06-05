import type { ActiveShareView, GameLog, Matchup, Settings, TeamBase } from "./types";
import { coerceLogs, coerceMatchups, coerceSettings, coerceTeams, isRecord } from "./validate";

export type SharedSnapshot = {
  v: 1;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
};
export type ShareUiState = { view?: ActiveShareView; teamId?: string };
export const MAX_SHARE_URL_PAYLOAD = 7000;

type CompactTeam = [id: string, name: string];
type CompactMatchup = [id: string, date: string, away: string, home: string];
type CompactGameLog = [
  awayRuns: string,
  awayHits: string,
  awayK: string,
  homeRuns: string,
  homeHits: string,
  homeK: string,
  innings: string,
  isFinal?: 1,
];
type CompactSnapshot = {
  v: 2;
  t: CompactTeam[];
  m: CompactMatchup[];
  l: Record<string, CompactGameLog>;
  s: Settings;
};

const SHARE_VIEWS = new Set<ActiveShareView>([
  "standings",
  "teamStats",
  "games",
  "model",
  "display",
  "settings",
]);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};
const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
const encodeRaw = (value: string) =>
  bytesToBase64(new TextEncoder().encode(value))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const decodeRaw = (encoded: string) => {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const full = padded + "=".repeat(padLen);
  return new TextDecoder().decode(base64ToBytes(full));
};

const compactSnapshot = (snapshot: SharedSnapshot): CompactSnapshot => ({
  v: 2,
  t: snapshot.teams.map((team) => [team.id, team.name]),
  m: snapshot.matchups.map((matchup) => [matchup.id, matchup.date, matchup.away, matchup.home]),
  l: Object.fromEntries(
    Object.entries(snapshot.logs).map(([id, log]) => [
      id,
      [
        log.awayRuns,
        log.awayHits,
        log.awayK,
        log.homeRuns,
        log.homeHits,
        log.homeK,
        log.innings,
        log.isFinal ? 1 : undefined,
      ].filter((value, index) => index < 7 || value !== undefined) as CompactGameLog,
    ])
  ),
  s: snapshot.settings,
});

const expandCompactSnapshot = (parsed: CompactSnapshot): SharedSnapshot | null => {
  if (!Array.isArray(parsed.t) || !Array.isArray(parsed.m) || !isRecord(parsed.l)) return null;
  const teams = parsed.t.map((team) => ({
    id: String(team[0] ?? ""),
    name: String(team[1] ?? ""),
  }));
  const matchups = parsed.m.map((matchup) => ({
    id: String(matchup[0] ?? ""),
    date: String(matchup[1] ?? ""),
    away: String(matchup[2] ?? ""),
    home: String(matchup[3] ?? ""),
  }));
  const logs = Object.fromEntries(
    Object.entries(parsed.l).map(([id, value]) => {
      const log = Array.isArray(value) ? value : [];
      return [
        id,
        {
          awayRuns: String(log[0] ?? ""),
          awayHits: String(log[1] ?? ""),
          awayK: String(log[2] ?? ""),
          homeRuns: String(log[3] ?? ""),
          homeHits: String(log[4] ?? ""),
          homeK: String(log[5] ?? ""),
          innings: String(log[6] ?? "6"),
          isFinal: log[7] === 1,
        },
      ];
    })
  );
  const settings = coerceSettings(parsed.s);
  const coercedTeams = coerceTeams(teams);
  const coercedMatchups = coerceMatchups(matchups, coercedTeams);
  return {
    v: 1,
    teams: coercedTeams,
    matchups: coercedMatchups,
    logs: coerceLogs(logs, coercedMatchups, settings),
    settings,
  };
};

export const encodeSnapshot = (snapshot: SharedSnapshot): string =>
  encodeRaw(JSON.stringify(compactSnapshot(snapshot)));

export const decodeSnapshot = (encoded: string): SharedSnapshot | null => {
  try {
    if (!encoded || encoded.length > MAX_SHARE_URL_PAYLOAD) return null;
    const parsed = JSON.parse(decodeRaw(encoded)) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.v === 2) return expandCompactSnapshot(parsed as CompactSnapshot);
    if (parsed.v !== 1) return null;
    if (!Array.isArray(parsed.teams) || !Array.isArray(parsed.matchups) || !isRecord(parsed.logs))
      return null;
    const settings = coerceSettings(parsed.settings);
    const teams = coerceTeams(parsed.teams);
    const matchups = coerceMatchups(parsed.matchups, teams);
    const logs = coerceLogs(parsed.logs, matchups, settings);
    return { v: 1, teams, matchups, logs, settings };
  } catch {
    return null;
  }
};

export const buildShareUrl = (baseUrl: string, snapshot: SharedSnapshot, ui: ShareUiState = {}) => {
  const encoded = encodeSnapshot(snapshot);
  if (encoded.length > MAX_SHARE_URL_PAYLOAD)
    throw new Error("Snapshot is too large to share as a URL.");
  const params = new URLSearchParams({ s: encoded });
  if (ui.view && SHARE_VIEWS.has(ui.view)) params.set("view", ui.view);
  if (ui.teamId) params.set("team", ui.teamId);
  return `${baseUrl.replace(/#.*$/, "")}#${params.toString()}`;
};

export const readSharedFromHash = (hash: string): SharedSnapshot | null => {
  if (!hash) return null;
  const payload = new URLSearchParams(hash.replace(/^#/, "")).get("s");
  if (!payload) return null;
  return decodeSnapshot(payload);
};

export const readShareUiStateFromHash = (hash: string): ShareUiState => {
  if (!hash) return {};
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const view = params.get("view");
  const teamId = params.get("team") ?? undefined;
  return {
    view: view && SHARE_VIEWS.has(view as ActiveShareView) ? (view as ActiveShareView) : undefined,
    teamId,
  };
};
