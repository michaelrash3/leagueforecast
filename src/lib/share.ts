import type { GameLog, Matchup, Settings, TeamBase } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export type SharedSnapshot = {
  v: 1;
  teams: TeamBase[];
  matchups: Matchup[];
  logs: Record<string, GameLog>;
  settings: Settings;
};

/**
 * Encode a snapshot as URL-safe base64 of a minified JSON payload. Tiny
 * helper; no compression dep. Designed to fit under typical URL length
 * limits for the league sizes this app targets (~14 teams, ~90 games).
 */
export const encodeSnapshot = (snapshot: SharedSnapshot): string => {
  const json = JSON.stringify(snapshot);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const decodeSnapshot = (encoded: string): SharedSnapshot | null => {
  try {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (padded.length % 4)) % 4;
    const full = padded + "=".repeat(padLen);
    const raw = decodeURIComponent(escape(atob(full)));
    const parsed = JSON.parse(raw) as SharedSnapshot;
    if (!parsed || parsed.v !== 1) return null;
    if (!Array.isArray(parsed.teams) || !Array.isArray(parsed.matchups)) return null;
    if (typeof parsed.logs !== "object" || !parsed.logs) return null;
    return {
      ...parsed,
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
    };
  } catch {
    return null;
  }
};

export const buildShareUrl = (baseUrl: string, snapshot: SharedSnapshot) =>
  `${baseUrl.replace(/#.*$/, "")}#s=${encodeSnapshot(snapshot)}`;

export const readSharedFromHash = (hash: string): SharedSnapshot | null => {
  if (!hash) return null;
  const trimmed = hash.replace(/^#/, "");
  const params = new URLSearchParams(trimmed);
  const payload = params.get("s");
  if (!payload) return null;
  return decodeSnapshot(payload);
};
