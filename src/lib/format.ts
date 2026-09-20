import type { Team } from "./types";

export const displayName = (name: string) => {
  const cleaned = name
    .replace(/\b8u\b/gi, "")
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

export const teamAbbr = (name: string) => {
  const short = displayName(name)
    .replace(/[^a-z0-9 ]/gi, "")
    .trim();
  const words = short.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return words
      .map((w) => w[0])
      .join("")
      .slice(0, 3)
      .toUpperCase();
  }
  return short.slice(0, 3).toUpperCase() || "TM";
};

/**
 * A winning percentage the way a standings table writes one: three decimals, no leading zero.
 * ".833", not "0.833" and not "83%" — the number the table sorts on, printed as it is read.
 */
export const winPct = (value: number): string =>
  value >= 1 ? "1.000" : value.toFixed(3).replace(/^0/, "");

export const recordText = (team: Pick<Team, "w" | "l" | "t">) =>
  `${team.w}-${team.l}${team.t ? `-${team.t}` : ""}`;

export type TeamFormat = { display: string; abbr: string; record: string };

export const buildTeamFormats = (teams: Pick<Team, "id" | "name" | "w" | "l" | "t">[]) => {
  const map = new Map<string, TeamFormat>();
  teams.forEach((team) => {
    map.set(team.id, {
      display: displayName(team.name),
      abbr: teamAbbr(team.name),
      record: recordText(team),
    });
  });
  return map;
};
