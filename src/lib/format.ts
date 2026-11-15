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

/**
 * The seeds a team can still finish in, as every League view writes them: "#2–#4", or "#4" alone
 * where the best and the worst are the same place. Written as a range either way, three teams of
 * the demo's eight read "#1–#1", "#4–#4" and "#6–#6".
 */
export const seedRangeText = (range: { best: number; worst: number }): string =>
  range.best === range.worst ? `#${range.best}` : `#${range.best}–#${range.worst}`;

/**
 * A game as the model sees it from one team's side: who it picks, and that team's own chance.
 * It read "Model: Southtown Sluggers · 46% team win chance" on a card that is Metro Mashers',
 * where the 46% is the Mashers' and the eye gave it to the team just named. The figure is given
 * its team's name, but for the team the model picks, which the line has just named.
 */
export const pickAndChanceText = (modelPick: string, teamName: string, winPct: number): string => {
  const chance = `${Math.round(winPct * 100)}% to win`;
  // Picked itself, the team is named once.
  return `Model pick: ${modelPick} · ${modelPick === teamName ? chance : `${teamName} ${chance}`}`;
};
