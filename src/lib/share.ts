import type { GameLog, Matchup, Settings, TeamBase } from "./types";
import { coerceSettings, isGameLog, isMatchup, isRecord, isTeamBase } from "./validate";

export type SharedSnapshot = { v: 1; teams: TeamBase[]; matchups: Matchup[]; logs: Record<string, GameLog>; settings: Settings };
export const MAX_SHARE_URL_PAYLOAD = 7000;

const encodeRaw = (value: string) => btoa(unescape(encodeURIComponent(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decodeRaw = (encoded: string) => {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  const full = padded + "=".repeat(padLen);
  return decodeURIComponent(escape(atob(full)));
};

export const encodeSnapshot = (snapshot: SharedSnapshot): string => encodeRaw(JSON.stringify(snapshot));

export const decodeSnapshot = (encoded: string): SharedSnapshot | null => {
  try {
    if (!encoded || encoded.length > MAX_SHARE_URL_PAYLOAD) return null;
    const parsed = JSON.parse(decodeRaw(encoded)) as unknown;
    if (!isRecord(parsed) || parsed.v !== 1) return null;
    if (!Array.isArray(parsed.teams) || !Array.isArray(parsed.matchups) || !isRecord(parsed.logs)) return null;
    const teams = parsed.teams.filter(isTeamBase);
    const matchups = parsed.matchups.filter(isMatchup);
    const logs: Record<string, GameLog> = {};
    Object.entries(parsed.logs).forEach(([k, v]) => { if (isGameLog(v)) logs[k] = v; });
    return { v: 1, teams, matchups, logs, settings: coerceSettings(parsed.settings) };
  } catch { return null; }
};

export const buildShareUrl = (baseUrl: string, snapshot: SharedSnapshot) => {
  const encoded = encodeSnapshot(snapshot);
  if (encoded.length > MAX_SHARE_URL_PAYLOAD) throw new Error("Snapshot is too large to share as a URL.");
  return `${baseUrl.replace(/#.*$/, "")}#s=${encoded}`;
};

export const readSharedFromHash = (hash: string): SharedSnapshot | null => {
  if (!hash) return null;
  const payload = new URLSearchParams(hash.replace(/^#/, "")).get("s");
  if (!payload) return null;
  return decodeSnapshot(payload);
};
