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

const SHARE_VIEWS = new Set<ActiveShareView>(["standings", "games", "model", "settings"]);

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

export const encodeSnapshot = (snapshot: SharedSnapshot): string =>
  encodeRaw(JSON.stringify(snapshot));

export const decodeSnapshot = (encoded: string): SharedSnapshot | null => {
  try {
    if (!encoded || encoded.length > MAX_SHARE_URL_PAYLOAD) return null;
    const parsed = JSON.parse(decodeRaw(encoded)) as unknown;
    if (!isRecord(parsed) || parsed.v !== 1) return null;
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
