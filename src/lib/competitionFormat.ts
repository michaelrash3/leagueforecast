import type { PostseasonFormat, Settings, TeamBase } from "./types";

export const COMPETITION_FORMAT_VERSION = 1 as const;
export type CompetitionPreset =
  "top-n" | "everyone" | "regular-season" | "division-wildcard" | "pool-wildcard";
export type BracketFormat = "single-elimination" | "double-elimination";
export type CompetitionFormat = {
  version: typeof COMPETITION_FORMAT_VERSION;
  preset: CompetitionPreset;
  groups: Record<string, string>;
  automaticBids: number;
  wildcardBids: number;
  bracket: BracketFormat;
  byes: number;
  reseed: boolean;
};

export const migrateCompetitionFormat = (settings: Settings): CompetitionFormat => {
  const preset: CompetitionPreset =
    settings.postseasonFormat === "all"
      ? "everyone"
      : settings.postseasonFormat === "none"
        ? "regular-season"
        : "top-n";
  return {
    version: COMPETITION_FORMAT_VERSION,
    preset,
    groups: {},
    automaticBids: preset === "top-n" ? settings.goldCutoff : 0,
    wildcardBids: 0,
    bracket: "single-elimination",
    byes: 0,
    reseed: false,
  };
};

export const postseasonFormatFor = (format: CompetitionFormat): PostseasonFormat =>
  format.preset === "regular-season" ? "none" : format.preset === "everyone" ? "all" : "cut";

export const validateCompetitionFormat = (
  format: CompetitionFormat,
  teams: readonly TeamBase[]
): string[] => {
  const errors: string[] = [];
  const grouped = format.preset === "division-wildcard" || format.preset === "pool-wildcard";
  if (grouped && teams.some((team) => !format.groups[team.id])) {
    errors.push("Every team needs a division or pool.");
  }
  const groupCount = new Set(teams.map((team) => format.groups[team.id]).filter(Boolean)).size;
  const bids = grouped
    ? groupCount * format.automaticBids + format.wildcardBids
    : format.automaticBids;
  if (
    format.preset !== "regular-season" &&
    format.preset !== "everyone" &&
    (bids < 1 || bids > teams.length)
  ) {
    errors.push("The number of postseason bids must be between one and the number of teams.");
  }
  if (format.byes < 0 || format.byes >= Math.max(1, bids))
    errors.push("Byes must leave at least two teams in the opening bracket.");
  return errors;
};

/** Group winners first, then wild cards by the caller's already tie-resolved standings order. */
export const selectQualifiers = <T extends { id: string }>(
  ranked: readonly T[],
  format: CompetitionFormat
): T[] => {
  if (format.preset === "regular-season") return [];
  if (format.preset === "everyone") return [...ranked];
  if (format.preset === "top-n") return ranked.slice(0, format.automaticBids);
  const groups = new Map<string, T[]>();
  ranked.forEach((team) => {
    const group = format.groups[team.id];
    if (!group) return;
    groups.set(group, [...(groups.get(group) ?? []), team]);
  });
  const automatic = [...groups.values()].flatMap((members) =>
    members.slice(0, format.automaticBids)
  );
  const automaticIds = new Set(automatic.map((team) => team.id));
  const wildcards = ranked
    .filter((team) => !automaticIds.has(team.id))
    .slice(0, format.wildcardBids);
  const qualified = new Set([...automatic, ...wildcards].map((team) => team.id));
  return ranked.filter((team) => qualified.has(team.id));
};
